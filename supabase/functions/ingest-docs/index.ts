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

    // 4. Generate Embeddings & Insert
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Extract title from first line if possible
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
        console.error(`Error inserting chunk ${i}:`, error.message);
      } else {
        inserted++;
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
