const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_URL;
const USER_EMAIL = import.meta.env.VITE_USER_EMAIL;

if (!DIRECTUS_URL) {
  throw new Error("DIRECTUS_URL must be defined in environment");
}
if (!USER_EMAIL) {
  throw new Error("USER_EMAIL must be defined in environment");
}

export { DIRECTUS_URL, USER_EMAIL };
