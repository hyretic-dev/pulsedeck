/**
 * Script to generate environment files from Netlify environment variables
 * Run this during the Netlify build process
 */
const fs = require('fs');
const path = require('path');

const envDir = path.join(__dirname, '../src/environments');

const supabaseUrl = process.env.SUPABASE_URL || 'MISSING_SUPABASE_URL';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'MISSING_SUPABASE_ANON_KEY';

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


