import {
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type ClientActionFunctionArgs,
} from "react-router";
import { createUser, readItems, readUsers } from "@directus/sdk";
import { isDirectusError } from "@directus/sdk";
import {
  authenticateUser,
  serverDirectus,
  MEMBER_ROLE_ID,
} from "@/lib/directus";
import { DIRECTUS_STATIC_TOKEN } from "@/lib/env";
import useRootData from "@/lib/useRootData";

const INVALID_CODE_MESSAGE = "Código inválido o expirado";

type ActionResult = { ok: true } | { error: string };

// Runs on the server (Netlify function) with the static token, so the
// privileged credentials never reach the browser
export async function action({
  request,
}: ActionFunctionArgs): Promise<ActionResult> {
  if (!DIRECTUS_STATIC_TOKEN) {
    console.error("Signup unavailable: DIRECTUS_STATIC_TOKEN is not set");
    return { error: "El registro no está disponible en este momento" };
  }

  const formData = await request.formData();
  const code = String(formData.get("code") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!code || !firstName || !email || !password) {
    return { error: "Por favor completa todos los campos" };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres" };
  }

  try {
    const invites = await serverDirectus.request(
      readItems("hapkido_invites", {
        filter: { code: { _eq: code } },
        fields: ["id", "expires_at", "max_uses", "revoked"],
        limit: 1,
      }),
    );
    const invite = invites[0];

    // Vague message on purpose: don't confirm whether a code exists
    if (!invite || invite.revoked) {
      return { error: INVALID_CODE_MESSAGE };
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return { error: INVALID_CODE_MESSAGE };
    }
    if (invite.max_uses != null) {
      const redemptions = await serverDirectus.request(
        readUsers({
          filter: { invite: { _eq: invite.id } },
          fields: ["id"],
          limit: invite.max_uses,
        }),
      );
      if (redemptions.length >= invite.max_uses) {
        return { error: INVALID_CODE_MESSAGE };
      }
    }

    // `invite` is a custom field on directus_users the SDK core types don't know
    const newUser = {
      first_name: firstName,
      email,
      password,
      role: MEMBER_ROLE_ID,
      invite: invite.id,
    } as Parameters<typeof createUser>[0];
    await serverDirectus.request(createUser(newUser));

    return { ok: true };
  } catch (error) {
    console.error("Signup error:", error);
    if (
      isDirectusError(error) &&
      error.errors?.[0]?.extensions?.code === "RECORD_NOT_UNIQUE"
    ) {
      return { error: "Ese email ya está registrado" };
    }
    return { error: "Error al crear la cuenta. Por favor intenta de nuevo." };
  }
}

// After the server creates the account, log in from the browser so the
// token lands in localStorage like a normal login
export async function clientAction({
  request,
  serverAction,
}: ClientActionFunctionArgs) {
  const formData = await request.clone().formData();
  const result = await serverAction<typeof action>();

  if ("error" in result) {
    return result;
  }

  const login = await authenticateUser(
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
    String(formData.get("password") ?? ""),
  );

  // Account exists either way; fall back to the login screen if the
  // automatic login fails
  return redirect(login.success ? "/" : "/login");
}

export default function Signup() {
  const actionData = useActionData<typeof clientAction>();
  const navigation = useNavigation();
  const { globals } = useRootData();
  const isSubmitting = navigation.state !== "idle";

  const inputClassName =
    "appearance-none relative block w-full px-3 py-3 border border-gray-300 bg-white placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div
        style={{
          backgroundImage: globals.login_background
            ? `url('${globals.login_background}')`
            : "",
        }}
        className="absolute inset-0 z-10 bg-cover bg-no-repeat"
      ></div>
      <div className="absolute inset-0 z-20 bg-gray-50/80"></div>
      <div className="max-w-lg w-full space-y-8 relative z-30">
        <div className="text-center">
          <img
            src={globals.logo ?? ""}
            className="w-24 mb-6 block mx-auto rounded-full"
          />
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            {globals.app_title}
          </h1>
          <p className="text-gray-600">
            Crea tu cuenta con un código de invitación
          </p>
        </div>

        <Form method="post" className="mt-8 space-y-6">
          {actionData && "error" in actionData && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {actionData.error}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="code" className="sr-only">
                Código de invitación
              </label>
              <input
                id="code"
                name="code"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                required
                className={inputClassName}
                placeholder="Código de invitación"
              />
            </div>
            <div>
              <label htmlFor="first_name" className="sr-only">
                Tu nombre
              </label>
              <input
                id="first_name"
                name="first_name"
                type="text"
                autoComplete="name"
                required
                className={inputClassName}
                placeholder="Tu nombre"
              />
            </div>
            <div>
              <label htmlFor="email" className="sr-only">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={inputClassName}
                placeholder="Email"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className={inputClassName}
                placeholder="Contraseña (mínimo 8 caracteres)"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            {isSubmitting ? "Creando cuenta..." : "Crear cuenta"}
          </button>

          <p className="text-center text-sm text-gray-600">
            ¿Ya tienes cuenta?{" "}
            <Link
              to="/login"
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              Inicia sesión
            </Link>
          </p>
        </Form>
      </div>
    </div>
  );
}
