import {
  createDirectus,
  rest,
  authentication,
  refresh,
  readMe,
  isDirectusError,
  staticToken,
  type AuthenticationData,
  readItems,
  readSingleton,
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
  ? createDirectus(DIRECTUS_URL)
      .with(staticToken(DIRECTUS_STATIC_TOKEN))
      .with(rest())
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
    await directus.logout();
  } catch (error) {
    // Ignore logout errors, just clear local storage
    console.error("Logout error:", error);
  }
  localStorage.removeItem(AUTH_KEY);
}

/**
 * Upload a file to Directus reporting upload progress.
 * Uses XMLHttpRequest because fetch (what the SDK uses) cannot emit upload progress events.
 * @param {File} file - The file to upload
 * @param {(percent: number) => void} onProgress - Called with 0-100 as bytes are sent
 * @returns {Promise<{id: string}>} The created Directus file
 */
export async function uploadFileWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ id: string }> {
  const token = await directus.getToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${DIRECTUS_URL}/files`);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText).data);
        } catch {
          reject(new Error("Upload succeeded but response was not valid JSON"));
        }
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
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
