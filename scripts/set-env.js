/**
 * Script to generate environment files from Netlify environment variables
 * Run this during the Netlify build process
 */
const fs = require('fs');
const path = require('path');

const envDir = path.join(__dirname, '../src/environments');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.log('⚠️  Keine SUPABASE_URL oder SUPABASE_ANON_KEY gefunden. Überspringe set-env.js und verwende bestehende environment.ts');
  process.exit(0);
}

const prodEnvContent = `/**
 * Production environment configuration
 * Auto-generated during build from environment variables
 */
export const environment = {
  production: true,
  supabase: {
    url: '${supabaseUrl}',
    anonKey: '${supabaseAnonKey}',
  },
};
`;

const devEnvContent = `/**
 * Development environment configuration
 * Auto-generated during build from environment variables
 */
export const environment = {
  production: false,
  supabase: {
    url: '${supabaseUrl}',
    anonKey: '${supabaseAnonKey}',
  },
};
`;

// Ensure environments directory exists
if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
}

// Write environment files
fs.writeFileSync(path.join(envDir, 'environment.ts'), devEnvContent);
fs.writeFileSync(path.join(envDir, 'environment.prod.ts'), prodEnvContent);

console.log('✅ Environment files generated successfully');
console.log(`   SUPABASE_URL: ${supabaseUrl.substring(0, 30)}...`);
console.log(`   SUPABASE_ANON_KEY: ${supabaseAnonKey.substring(0, 20)}...`);


