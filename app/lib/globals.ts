import { readSingleton } from "@directus/sdk";
import { serverDirectus } from "./directus";
import { DIRECTUS_URL } from "./env";

export type Globals = {
  app_title: string;
  app_subtitle: string;
  login_background: string | null;
  logo: string | null;
};

const DEFAULT_TITLE = "Biblioteca Hapkido";
const DEFAULT_SUBTITLE = "합기도 • Biblioteca de Técnicas Secretas";

export async function getGlobals() {
  try {
    const { app_title, app_subtitle, login_background, logo } =
      await serverDirectus.request(
        readSingleton("hapkido_settings", {
          fields: ["app_title", "app_subtitle", "login_background", "logo"],
        }),
      );
    return {
      app_title: app_title ?? DEFAULT_TITLE,
      app_subtitle: app_subtitle ?? DEFAULT_SUBTITLE,
      login_background: login_background
        ? `${DIRECTUS_URL}/assets/${login_background}`
        : null,
      logo: logo ? `${DIRECTUS_URL}/assets/${logo}` : null,
    };
  } catch (err) {
    console.error("Error reading globals:", err);
    return {
      app_title: DEFAULT_TITLE,
      app_subtitle: DEFAULT_SUBTITLE,
      login_background: null,
      logo: null,
    };
  }
}
