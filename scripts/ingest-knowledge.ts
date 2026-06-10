import { createClient } from '@supabase/supabase-js';
import { embed } from 'ai';
import { createMistral } from '@ai-sdk/mistral';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables manually or rely on dotenv if available
// In this repo, you can run this with something like:
// npx ts-node scripts/ingest-knowledge.ts <file-path> [organization_id]

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';
const mistralKey = process.env.MISTRAL_API_KEY || 'your-mistral-key';

if (!supabaseUrl || !supabaseKey || !mistralKey) {
  console.error('Please set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MISTRAL_API_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const mistral = createMistral({ apiKey: mistralKey });

async function ingestFile(filePath: string, orgId?: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const title = path.basename(filePath, path.extname(filePath));

  console.log(`Processing: ${title}`);

  // Very basic chunking (e.g. by paragraphs or sections)
  // For a real setup, a better text splitter should be used.
  const chunks = content.split(/\n\n+/).filter(c => c.trim().length > 20);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`Embedding chunk ${i + 1}/${chunks.length}...`);

    try {
      const { embedding } = await embed({
        model: mistral.textEmbeddingModel('mistral-embed'),
        value: chunk,
      });

      const { error } = await supabase.from('knowledge_base').insert({
        title: `${title} - Part ${i + 1}`,
        content: chunk,
        embedding: embedding,
        organization_id: orgId || null
      });

      if (error) {
        console.error('Error inserting to Supabase:', error.message);
      } else {
        console.log(`Inserted chunk ${i + 1}`);
      }
    } catch (err) {
      console.error('Error embedding chunk:', err);
    }
  }

  console.log('Done.');
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: npx ts-node scripts/ingest-knowledge.ts <path-to-markdown-file> [organization_id]');
  process.exit(1);
}

const targetFile = args[0];
const targetOrg = args[1]; // optional

ingestFile(targetFile, targetOrg).catch(console.error);
