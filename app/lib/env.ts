// Client-side env vars (exposed to browser via VITE_ prefix)
const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_URL;
const USER_EMAIL = import.meta.env.VITE_USER_EMAIL;

if (!DIRECTUS_URL) {
  throw new Error("DIRECTUS_URL must be defined in environment");
}
if (!USER_EMAIL) {
  throw new Error("USER_EMAIL must be defined in environment");
}

// Server-side env var (NOT exposed to client, for SSG/loaders only)
// Access via process.env (Node.js) instead of import.meta.env
const DIRECTUS_STATIC_TOKEN =
  typeof process !== "undefined" ? process.env.DIRECTUS_STATIC_TOKEN : undefined;

export { DIRECTUS_URL, USER_EMAIL, DIRECTUS_STATIC_TOKEN };
