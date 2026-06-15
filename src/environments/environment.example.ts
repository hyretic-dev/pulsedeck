/**
 * Local environment configuration
 * Copy this file to environment.ts and replace values for production or specific environments
 */
export const environment = {
    production: false,
    supabase: {
        // Default local Supabase CLI credentials
        url: 'http://127.0.0.1:54321',
        anonKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
    },
};
