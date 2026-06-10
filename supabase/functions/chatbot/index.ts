import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { streamText, embed } from "npm:ai@3.4.15";
import { createMistral } from "npm:@ai-sdk/mistral@0.0.40";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const mistralKey = Deno.env.get("MISTRAL_API_KEY");

    if (!mistralKey) {
        throw new Error("MISTRAL_API_KEY is not configured.");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // We expect the client to send: messages array, optionally session_id, and organization_id
    const { messages: rawMessages, session_id, organization_id } = await req.json();

    if (!organization_id) {
      return new Response(JSON.stringify({ error: "Organization ID is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!rawMessages || !Array.isArray(rawMessages)) {
      return new Response(JSON.stringify({ error: "Messages array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter out empty assistant messages that might have been created by unhandled tool calls
    const messages = rawMessages.filter(m => m.content && m.content.trim() !== "");

    // Get the member record for this organization
    const { data: memberRecord, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, organization_id, name, app_role")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .single();

    if (memberError || !memberRecord) {
      return new Response(JSON.stringify({ error: "Member record not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const organizationId = memberRecord.organization_id;
    const memberId = memberRecord.id;

    let currentSessionId = session_id;

    // If no session_id is provided, create a new one
    if (!currentSessionId) {
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from("chat_sessions")
        .insert({ user_id: user.id, organization_id: organizationId })
        .select()
        .single();
      
      if (sessionError) {
        throw new Error(`Failed to create chat session: ${sessionError.message}`);
      }
      currentSessionId = sessionData.id;
    }

    // Identify the latest user message to persist it
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === "user") {
       await supabaseAdmin.from("chat_messages").insert({
          session_id: currentSessionId,
          role: "user",
          content: lastMessage.content
       });
    }

    const mistral = createMistral({ apiKey: mistralKey });

    let knowledgeContext = "";
    if (lastMessage && lastMessage.role === "user" && lastMessage.content) {
      try {
        const { embedding } = await embed({
          model: mistral.textEmbeddingModel("mistral-embed"),
          value: lastMessage.content,
        });

        const { data: knowledgeDocs, error: knowledgeError } = await supabaseAdmin.rpc("match_knowledge", {
          query_embedding: embedding,
          match_threshold: 0.7,
          match_count: 3,
          org_id: organizationId
        });

        if (!knowledgeError && knowledgeDocs && knowledgeDocs.length > 0) {
          knowledgeContext = "\n\nHier sind relevante Informationen aus der Dokumentation/Wiki:\n" + 
            knowledgeDocs.map((doc: any) => `### ${doc.title}\n${doc.content}`).join("\n\n");
        }
      } catch (err) {
        console.error("Embedding / RAG error:", err);
      }
    }

    const systemPrompt = `Du bist der PulseDeck Onboarding-Assistent. 
Dein Gesprächspartner ist "${memberRecord.name}". Die Berechtigungsrolle des Nutzers in dieser Organisation ist "${memberRecord.app_role}". Beachte diese Rechte bei deinen Antworten (z.B. können nur Admins Einstellungen ändern).
Du hilfst Nutzern sich auf der Plattform zurechtzufinden, ihr Profil auszufüllen und relevanten Arbeitsgruppen (AGs) beizutreten. Du bist freundlich, professionell und fasst dich kurz.
Das System ist mandantenfähig, d.h. du arbeitest im Kontext der Organisation des Nutzers.

WICHTIG FÜR VORSCHLÄGE: Wenn du dem Nutzer nächste Schritte anbietest, musst du diese zwingend in <suggestions> Tags hüllen, wobei jede Option ein Bullet Point ist!
Beispiel:
<suggestions>
- Arbeitsgruppen ansehen
- Mein Profil bearbeiten
</suggestions>${knowledgeContext}`;

    const result = await streamText({
      model: mistral("mistral-small-latest"),
      system: systemPrompt,
      messages,
      maxSteps: 5,
      tools: {
        getUpcomingEvents: {
          description: "Holt anstehende Termine und Events der Organisation.",
          parameters: z.object({
            limit: z.number().optional().describe("Maximale Anzahl an Terminen"),
          }),
          execute: async ({ limit }) => {
            const { data } = await supabaseAdmin
              .from("events")
              .select("id, title, date, start_time, location")
              .eq("organization_id", organizationId)
              .gte("date", new Date().toISOString().split("T")[0])
              .order("date", { ascending: true })
              .limit(limit || 5);
            return data || [];
          },
        },
        getWorkingGroups: {
          description: "Gibt alle verfügbaren Arbeitsgruppen (AGs) der Organisation zurück.",
          parameters: z.object({}),
          execute: async () => {
             const { data } = await supabaseAdmin
              .from("working_groups")
              .select("id, name, description, members_count, category")
              .eq("organization_id", organizationId)
              .order("name", { ascending: true });
             return data || [];
          },
        },
        joinWorkingGroup: {
          description: "Trägt den Nutzer in eine Arbeitsgruppe ein.",
          parameters: z.object({
            workingGroupId: z.string().describe("Die UUID der Arbeitsgruppe"),
          }),
          execute: async ({ workingGroupId }) => {
             // Zuerst in die neue Tabelle ag_memberships einfügen
             let { error } = await supabaseAdmin
               .from("ag_memberships")
               .insert({
                  working_group_id: workingGroupId,
                  member_id: memberId,
                  role: "member"
               });
               
             // Fallback auf die alte Tabelle, falls die neue nicht greift (außer bei Unique Constraint)
             if (error && error.code !== '23505') {
                 const { error: oldError } = await supabaseAdmin
                   .from("working_group_members")
                   .insert({
                      working_group_id: workingGroupId,
                      member_id: memberId
                   });
                 error = oldError;
             }

             if (error) {
                // Unique constraint violation (bereits Mitglied)
                if (error.code === '23505') {
                    return { success: false, message: "Nutzer ist bereits Mitglied dieser AG." };
                }
                return { success: false, message: `Fehler beim Beitreten: ${error.message}` };
             }
             return { success: true, message: "Erfolgreich beigetreten." };
          },
        },
        updateProfile: {
           description: "Aktualisiert die Profildaten des Nutzers, z.B. wenn er im Chat sagt, dass er seine Adresse oder Telefonnummer eintragen möchte.",
           parameters: z.object({
             street: z.string().optional(),
             zip_code: z.string().optional(),
             city: z.string().optional(),
             phone: z.string().optional(),
             birthday: z.string().optional(),
             status: z.string().optional().describe("Z.B. Active")
           }),
           execute: async (args) => {
              const updateData: any = {};
              if (args.street) updateData.street = args.street;
              if (args.zip_code) updateData.zip_code = args.zip_code;
              if (args.city) updateData.city = args.city;
              if (args.phone) updateData.phone = args.phone;
              if (args.birthday) updateData.birthday = args.birthday;
              if (args.status) updateData.status = args.status;

              if (Object.keys(updateData).length === 0) {
                 return { success: false, message: "Keine Daten zum Aktualisieren übergeben." };
              }

              const { error } = await supabaseAdmin
                 .from("members")
                 .update(updateData)
                 .eq("id", memberId);

              if (error) {
                 return { success: false, message: `Fehler beim Speichern: ${error.message}` };
              }
              return { success: true, message: "Profil erfolgreich aktualisiert." };
           }
        }
      },
      onFinish: async ({ text, toolCalls, toolResults }) => {
        // Save the assistant's message
        if (text) {
           await supabaseAdmin.from("chat_messages").insert({
              session_id: currentSessionId,
              role: "assistant",
              content: text
           });
        }
        // Save tool calls and results as well if necessary, but simple text might be enough for Phase 1.
        // For accurate history with Vercel AI SDK, it might be beneficial to store the full JSON.
        // But for our simple DB schema, we just store text.
      }
    });

    const response = result.toDataStreamResponse();
    // Add custom headers to the response
    response.headers.set("x-chat-session-id", currentSessionId);
    for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value as string);
    }
    return response;

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
