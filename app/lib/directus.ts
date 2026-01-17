import {
  createDirectus,
  rest,
  authentication,
  refresh,
  readMe,
  isDirectusError,
  staticToken,
  type AuthenticationData,
} from "@directus/sdk";
import { DIRECTUS_URL, USER_EMAIL, DIRECTUS_STATIC_TOKEN } from "./env";

const AUTH_KEY = "directus-data";

class LocalStorage {
  get() {
    const data = localStorage.getItem(AUTH_KEY);
    if (!data) {
      return null;
    }
    return JSON.parse(data) as AuthenticationData;
  }
  set(data: AuthenticationData | null) {
    if (!data) {
      localStorage.removeItem(AUTH_KEY);
    } else {
      localStorage.setItem(AUTH_KEY, JSON.stringify(data));
    }
  }
}

// Server-side Directus client with static token (for SSG/loaders)
// This runs at build time and needs a static token from env
export const serverDirectus = DIRECTUS_STATIC_TOKEN
  ? createDirectus(DIRECTUS_URL).with(staticToken(DIRECTUS_STATIC_TOKEN)).with(rest())
  : createDirectus(DIRECTUS_URL).with(rest());

// Client-side Directus client with user authentication (browser only)
// This runs in the browser and uses localStorage for JWT tokens
const directus = createDirectus(DIRECTUS_URL)
  .with(authentication("json", { storage: new LocalStorage() }))
  .with(rest());

/**
 * Login with Directus user account
 * @param {string} password - The Hapkido account password
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export async function authenticateUser(password: string) {
  try {
    await directus.login({
      email: USER_EMAIL,
      password,
    });

    return {
      success: true,
    };
  } catch (error) {
    console.error("Authentication error:", error);
    if (isDirectusError(error)) {
      if (error.errors?.[0]?.extensions?.code === "INVALID_CREDENTIALS") {
        return {
          success: false,
          message: "Contraseña incorrecta",
        };
      }
    }

    return {
      success: false,
      message: "Error al conectar con el servidor",
    };
  }
}

/**
 * Get Directus client (automatically uses stored token)
 * @returns {DirectusClient}
 */
export function getDirectusClient() {
  return directus;
}

/**
 * Check if user is authenticated and token is valid
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
  try {
    const token = directus.getToken();
    if (!token) return false;

    // Verify token by fetching current user
    await directus.request(readMe({ fields: ["name", "email"] }));
    return true;
  } catch (error) {
    // Token invalid or expired
    await logout();
    return false;
  }
}

/**
 * Refresh authentication token
 * @returns {Promise<boolean>}
 */
export async function refreshAuth() {
  try {
    await directus.request(refresh());
    return true;
  } catch (error) {
    console.error("Token refresh failed:", error);
    await logout();
    return false;
  }
}

/**
 * Clear authentication
 */
export async function logout() {
  try {
    await directus.logout({ mode: "json" });
  } catch (error) {
    // Ignore logout errors, just clear local storage
    console.error("Logout error:", error);
  }
  localStorage.removeItem(AUTH_KEY);
}

/**
 * Check if Directus server is online
 * @returns {Promise<boolean>}
 */
export async function checkServerStatus() {
  try {
    const response = await fetch(`${DIRECTUS_URL}/server/ping`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

export default directus;
