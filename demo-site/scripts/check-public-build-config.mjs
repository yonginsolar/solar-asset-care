// Public configuration is compiled into the client bundle. Never print its values.
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!projectUrl || !publishableKey?.startsWith('sb_publishable_')) {
  throw new Error('Build requires NEXT_PUBLIC_SUPABASE_URL and a modern NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
}
const url = new URL(projectUrl);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
  throw new Error('Build requires an HTTPS Supabase project URL.');
}
