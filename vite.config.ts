import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import netlifyReactRouter from "@netlify/vite-plugin-react-router";

// These are inlined into the bundles at build time, so a missing value
// silently compiles to `undefined`. Fail the build instead.
const REQUIRED_ENV_VARS = ["VITE_DIRECTUS_URL", "VITE_USER_EMAIL"];

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    for (const key of REQUIRED_ENV_VARS) {
      if (!env[key]) {
        throw new Error(
          `${key} is not defined. Set it in the build environment (locally via .env, on Netlify via Site configuration → Environment variables).`,
        );
      }
    }
  }

  return {
    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths(),
      netlifyReactRouter(),
    ],
  };
});
