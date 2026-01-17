import { useState } from "react";
import {
  Form,
  redirect,
  useActionData,
  type ClientActionFunctionArgs,
} from "react-router";
import { authenticateUser } from "@/lib/directus";

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const formData = await request.formData();
  const password = formData.get("password");

  if (!password) {
    return { error: "Por favor ingresa la contraseña" };
  }

  const result = await authenticateUser(String(password));

  if (result.success) {
    // Token is automatically stored by Directus SDK in localStorage
    return redirect("/");
  }

  return {
    error: result.message || "Contraseña incorrecta",
  };
}

export default function Access() {
  const [password, setPassword] = useState("");
  const actionData = useActionData();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Biblioteca Kukkiwon Doyang
          </h1>
          <p className="text-gray-600">Ingresa la contraseña para continuar</p>
        </div>

        <Form method="post" className="mt-8 space-y-6">
          {actionData?.error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {actionData.error}
            </div>
          )}

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
              className="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Contraseña"
            />
          </div>

          <button
            type="submit"
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            Entrar
          </button>
        </Form>

        {/* <div className="text-center text-sm text-gray-500">
          <p>¿No tienes acceso?</p>
          <p>Contacta a tu instructor</p>
        </div> */}
      </div>
    </div>
  );
}
