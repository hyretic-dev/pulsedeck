import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed } from "npm:ai@3.4.15";
import { createMistral } from "npm:@ai-sdk/mistral@0.0.40";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    if (!mistralKey) throw new Error("Missing MISTRAL_API_KEY");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase config");

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
    const mistral = createMistral({ apiKey: mistralKey });

    // 1. Fetch DOCS.md from production
    console.log("Fetching DOCS.md...");
    const docsResponse = await fetch("https://pulsedeck.de/DOCS.md");
    if (!docsResponse.ok) {
      throw new Error(`Failed to fetch DOCS.md: ${docsResponse.statusText}`);
    }
    const content = await docsResponse.text();

    // 2. Chunking (Simple paragraph/section splitting)
    const chunks = content.split(/\n#{2,3} /).map((c, i) => i === 0 ? c : `## ${c}`).filter(c => c.trim().length > 20);
    console.log(`Found ${chunks.length} chunks.`);

    let inserted = 0;

    // 3. Clear existing global docs to avoid duplicates
    await supabaseAdmin.from("knowledge_base").delete().is("organization_id", null);

    // 4. Generate Embeddings & Insert for DOCS
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const lines = chunk.trim().split("\n");
      const title = lines[0].replace(/#/g, "").trim();

      const { embedding } = await embed({
        model: mistral.textEmbeddingModel("mistral-embed"),
        value: chunk,
      });

      const { error } = await supabaseAdmin.from("knowledge_base").insert({
        title: `PulseDeck Doc: ${title}`,
        content: chunk,
        embedding: embedding,
        organization_id: null // Global doc
      });

      if (error) {
        console.error(`Error inserting docs chunk ${i}:`, error.message);
      } else {
        inserted++;
      }
    }

    // 5. Ingest Database Content (Working Groups and Events)
    console.log("Fetching database content...");
    
    // Clear existing DB-generated knowledge
    await supabaseAdmin.from("knowledge_base").delete().like("title", "Arbeitsgruppe: %");
    await supabaseAdmin.from("knowledge_base").delete().like("title", "Termin: %");

    // 5.1 Working Groups
    const { data: workingGroups } = await supabaseAdmin.from("working_groups").select("*");
    if (workingGroups) {
      for (const wg of workingGroups) {
        const content = `Informationen zur Arbeitsgruppe (AG):
Name: ${wg.name}
Kategorie: ${wg.category || 'Keine'}
Beschreibung: ${wg.description || 'Keine Beschreibung vorhanden'}
Diese AG dient der vereinsinternen Organisation.`;

        const { embedding } = await embed({
          model: mistral.textEmbeddingModel("mistral-embed"),
          value: content,
        });

        const { error } = await supabaseAdmin.from("knowledge_base").insert({
          title: `Arbeitsgruppe: ${wg.name}`,
          content: content,
          embedding: embedding,
          organization_id: wg.organization_id
        });

        if (error) console.error(`Error inserting AG ${wg.name}:`, error.message);
        else inserted++;
      }
    }

    // 5.2 Upcoming Events
    const today = new Date().toISOString().split("T")[0];
    const { data: events } = await supabaseAdmin
      .from("events")
      .select("*, working_groups(name)")
      .gte("date", today);

    if (events) {
      for (const evt of events) {
        const agInfo = evt.working_groups?.name ? ` (Gehört zur AG: ${evt.working_groups.name})` : '';
        const content = `Informationen zum Termin${agInfo}:
Titel: ${evt.title}
Datum: ${evt.date}
Startzeit: ${evt.start_time}
Endzeit: ${evt.end_time || 'Nicht definiert'}
Ort/Location: ${evt.location}
Beschreibung/Agenda: ${evt.description || 'Keine weitere Beschreibung'}`;

        const { embedding } = await embed({
          model: mistral.textEmbeddingModel("mistral-embed"),
          value: content,
        });

        const { error } = await supabaseAdmin.from("knowledge_base").insert({
          title: `Termin: ${evt.title}`,
          content: content,
          embedding: embedding,
          organization_id: evt.organization_id
        });

        if (error) console.error(`Error inserting event ${evt.title}:`, error.message);
        else inserted++;
      }
    }

    return new Response(JSON.stringify({ success: true, inserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Ingestion error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
