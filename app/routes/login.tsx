import { useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  type ClientActionFunctionArgs,
} from "react-router";
import { authenticateUser } from "@/lib/directus";
import useRootData from "@/lib/useRootData";

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");

  if (!email || !password) {
    return { error: "Por favor ingresa tu email y contraseña" };
  }

  const result = await authenticateUser(String(email), String(password));

  if (result.success) {
    // Token is automatically stored by Directus SDK in localStorage
    return redirect("/");
  }

  return {
    error: result.message || "Contraseña incorrecta",
  };
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const actionData = useActionData();
  const { globals } = useRootData();

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
          <p className="text-gray-600">Ingresa tus datos para continuar</p>
        </div>

        <Form method="post" className="mt-8 space-y-6">
          {actionData?.error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {actionData.error}
            </div>
          )}

          <div className="space-y-3">
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gray-300 bg-white placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none relative block w-full px-3 py-3 border border-gray-300 bg-white placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Contraseña"
              />
            </div>
          </div>

          <button
            type="submit"
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            Entrar
          </button>

          <p className="text-center text-sm text-gray-600">
            ¿Tienes un código de invitación?{" "}
            <Link
              to="/signup"
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              Crea tu cuenta
            </Link>
          </p>
        </Form>
      </div>
    </div>
  );
}
