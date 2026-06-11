import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed } from "npm:ai@3.4.15";
import { createMistral } from "npm:@ai-sdk/mistral@0.0.40";
import pdf from "npm:pdf-parse@1.1.1";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { file_id } = await req.json();
    if (!file_id) {
      return new Response(JSON.stringify({ error: "Missing file_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    if (!mistralKey) throw new Error("Missing MISTRAL_API_KEY");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase config");

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
    const mistral = createMistral({ apiKey: mistralKey });

    // 1. Fetch file metadata
    const { data: fileDoc, error: fileError } = await supabaseAdmin
      .from("files")
      .select("*")
      .eq("id", file_id)
      .single();

    if (fileError || !fileDoc) {
      throw new Error(`File not found: ${fileError?.message || 'No record'}`);
    }

    if (fileDoc.is_indexed) {
      return new Response(JSON.stringify({ message: "File is already indexed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isPdf = fileDoc.mime_type === "application/pdf";
    const isText = fileDoc.mime_type?.startsWith("text/");
    
    if (!isPdf && !isText) {
      return new Response(JSON.stringify({ message: "Unsupported file type for indexing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 10 MB limit (10 * 1024 * 1024 bytes)
    const MAX_SIZE_BYTES = 10485760;
    if (fileDoc.size_bytes > MAX_SIZE_BYTES) {
      // Mark as indexed so we don't retry, but log it's too large
      await supabaseAdmin.from("files").update({ is_indexed: true }).eq("id", file_id);
      return new Response(JSON.stringify({ 
        success: false, 
        message: "Die Datei ist über 10 MB groß und wird aus Performance-Gründen nicht in die KI indiziert." 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing file: ${fileDoc.name} (${fileDoc.mime_type})`);

    // 2. Download file from storage
    const { data: fileBlob, error: downloadError } = await supabaseAdmin
      .storage
      .from("files")
      .download(fileDoc.storage_path);

    if (downloadError || !fileBlob) {
      throw new Error(`Download error: ${downloadError?.message}`);
    }

    // 3. Extract text
    let extractedText = "";
    
    if (isText) {
      extractedText = await fileBlob.text();
    } else if (isPdf) {
      try {
         const arrayBuffer = await fileBlob.arrayBuffer();
         const buffer = Buffer.from(arrayBuffer);
         const pdfData = await pdf(buffer);
         extractedText = pdfData.text;
      } catch (pdfErr: any) {
         throw new Error(`PDF Parsing failed: ${pdfErr.message}`);
      }
    }

    if (!extractedText || extractedText.trim() === "") {
       return new Response(JSON.stringify({ message: "No text found in document" }), {
         headers: { ...corsHeaders, "Content-Type": "application/json" },
       });
    }

    // 4. Chunking (Simple paragraph/section splitting)
    // We split by double newlines or large breaks
    let chunks = extractedText
      .split(/\n\s*\n/)
      .map(c => c.trim())
      .filter(c => c.length > 50); // Ignore very small artifacts

    // If it's a huge block of text, further chunking might be needed, 
    // but for simple documents this works fine.
    
    // Chunk size limit roughly 1500 chars to avoid embedding limits and keep context focused
    const maxChunkSize = 1500;
    const finalChunks: string[] = [];
    
    for (const chunk of chunks) {
      if (chunk.length <= maxChunkSize) {
         finalChunks.push(chunk);
      } else {
         // Split large chunks arbitrarily by roughly maxChunkSize
         let current = chunk;
         while (current.length > 0) {
            finalChunks.push(current.substring(0, maxChunkSize));
            current = current.substring(maxChunkSize);
         }
      }
    }

    console.log(`Generated ${finalChunks.length} chunks.`);

    let inserted = 0;

    // Clear old knowledge chunks for this file if any
    await supabaseAdmin.from("knowledge_base").delete().eq("file_id", file_id);

    // 5. Generate Embeddings & Insert
    for (let i = 0; i < finalChunks.length; i++) {
      const chunkText = finalChunks[i];
      // Wir fügen den Dateinamen und ggf. die Beschreibung als Kontext zum Text hinzu
      const contextText = `Datei: ${fileDoc.name}\n${fileDoc.description ? 'Beschreibung: ' + fileDoc.description + '\n' : ''}\nInhalt:\n${chunkText}`;

      const { embedding } = await embed({
        model: mistral.textEmbeddingModel("mistral-embed"),
        value: contextText,
      });

      const { error: insertError } = await supabaseAdmin.from("knowledge_base").insert({
        title: `Datei: ${fileDoc.name} (Abschnitt ${i+1})`,
        content: contextText,
        embedding: embedding,
        organization_id: fileDoc.organization_id,
        file_id: file_id
      });

      if (insertError) {
        console.error(`Error inserting chunk ${i}:`, insertError.message);
      } else {
        inserted++;
      }
    }

    // 6. Mark file as indexed
    await supabaseAdmin.from("files").update({ is_indexed: true }).eq("id", file_id);

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
