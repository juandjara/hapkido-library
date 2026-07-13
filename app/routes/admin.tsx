import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Ban,
  Check,
  Copy,
  KeyRound,
  Loader2,
  UserCheck,
  UserX,
} from "lucide-react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import {
  createItem,
  readItems,
  readUsers,
  updateItem,
  updateUser,
} from "@directus/sdk";
import {
  getDirectusClient,
  getCurrentUser,
  isAuthenticated,
  HAPKIDO_ROLE_IDS,
} from "@/lib/directus";
import Loading from "@/components/Loading";

interface Member {
  id: string;
  first_name: string | null;
  email: string | null;
  status: string;
  date_created: string | null;
  invite: string | null;
}

interface Invite {
  id: string;
  code: string;
  note: string | null;
  max_uses: number | null;
  expires_at: string | null;
  revoked: boolean;
  date_created: string | null;
}

export async function clientLoader() {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return redirect("/login");
    }

    const currentUser = await getCurrentUser();
    if (!currentUser?.isAdmin) {
      return redirect("/");
    }

    const directus = getDirectusClient();
    const [members, invites] = await Promise.all([
      directus.request(
        readUsers({
          fields: [
            "id",
            "first_name",
            "email",
            "status",
            "date_created",
            "invite",
          ],
          filter: { role: { _in: HAPKIDO_ROLE_IDS } },
          sort: ["first_name"],
          limit: -1,
        }),
      ) as Promise<Member[]>,
      directus.request(
        readItems("hapkido_invites", {
          fields: [
            "id",
            "code",
            "note",
            "max_uses",
            "expires_at",
            "revoked",
            "date_created",
          ],
          sort: ["-date_created"],
          limit: -1,
        }),
      ) as Promise<Invite[]>,
    ]);

    return { currentUser, members, invites };
  } catch (err) {
    console.error("Error loading adming page: ", err);
    return {
      currentUser: null,
      members: [],
      invites: [],
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <Loading />;
}

// Unambiguous alphabet: no I, L, O, 0, 1
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;

function generateInviteCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
    "",
  );
}

function formatDate(date: string | null | undefined) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AdminMembers() {
  const { currentUser, members, invites } =
    useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();

  const [inviteNote, setInviteNote] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState("1");
  const [inviteExpiryDays, setInviteExpiryDays] = useState("7");
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const inviteUses = (inviteId: string) =>
    members.filter((m) => m.invite === inviteId).length;

  // Yourself first, everyone else keeps the alphabetical order
  const sortedMembers = [...members].sort(
    (a, b) =>
      Number(b.id === currentUser?.id) - Number(a.id === currentUser?.id),
  );

  const inviteState = (invite: Invite) => {
    if (invite.revoked) return "Revocada";
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return "Expirada";
    }
    if (invite.max_uses != null && inviteUses(invite.id) >= invite.max_uses) {
      return "Agotada";
    }
    return "Activa";
  };

  const handleCreateInvite = async (e: FormEvent) => {
    e.preventDefault();
    setIsCreatingInvite(true);
    try {
      const directus = getDirectusClient();
      const maxUses =
        inviteMaxUses.trim() === "" ? null : Number(inviteMaxUses);
      const expiryDays = Number(inviteExpiryDays) || 7;
      const code = generateInviteCode();

      await directus.request(
        createItem("hapkido_invites", {
          code,
          note: inviteNote.trim() || null,
          max_uses: maxUses,
          expires_at: new Date(
            Date.now() + expiryDays * 24 * 60 * 60 * 1000,
          ).toISOString(),
          revoked: false,
        }),
      );

      setInviteNote("");
      setInviteMaxUses("1");
      setInviteExpiryDays("7");
      revalidator.revalidate();
    } catch (error) {
      console.error("Create invite error:", error);
      alert("Error al crear la invitación. Por favor intenta de nuevo.");
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (error) {
      console.error("Copy error:", error);
    }
  };

  const handleRevokeInvite = async (invite: Invite) => {
    if (!confirm(`¿Revocar el código "${invite.code}"?`)) return;
    setBusyId(invite.id);
    try {
      const directus = getDirectusClient();
      await directus.request(
        updateItem("hapkido_invites", invite.id, { revoked: true }),
      );
      revalidator.revalidate();
    } catch (error) {
      console.error("Revoke invite error:", error);
      alert("Error al revocar la invitación. Por favor intenta de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleStatus = async (member: Member) => {
    const suspending = member.status === "active";
    const name = member.first_name || member.email || "este miembro";
    if (
      suspending &&
      !confirm(`¿Suspender el acceso de ${name}? No podrá iniciar sesión.`)
    ) {
      return;
    }
    setBusyId(member.id);
    try {
      const directus = getDirectusClient();
      await directus.request(
        updateUser(member.id, {
          status: suspending ? "suspended" : "active",
        }),
      );
      revalidator.revalidate();
    } catch (error) {
      console.error("Update member status error:", error);
      alert("Error al actualizar el miembro. Por favor intenta de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (member: Member) => {
    const name = member.first_name || member.email || "este miembro";
    const password = prompt(
      `Nueva contraseña para ${name} (mínimo 8 caracteres):`,
    );
    if (password === null) return;
    if (password.length < 8) {
      alert("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setBusyId(member.id);
    try {
      const directus = getDirectusClient();
      await directus.request(updateUser(member.id, { password }));
      alert(`Contraseña actualizada para ${name}`);
    } catch (error) {
      console.error("Reset password error:", error);
      alert("Error al cambiar la contraseña. Por favor intenta de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-8 px-2">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => history.back()}
            className="mb-3 flex items-center gap-2 p-1 pr-2 rounded-md hover:bg-white/10 text-white"
          >
            <ArrowLeft />
            <p>Volver</p>
          </button>
          <h1 className="text-3xl font-bold text-red-500 mb-2">Miembros</h1>
          <p className="text-slate-400">
            Gestiona los miembros del dojo y sus invitaciones
          </p>
        </div>

        {/* Invites */}
        <section className="bg-slate-800 rounded-lg p-4 border border-slate-700 mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">
            Invitaciones
          </h2>

          <form
            onSubmit={handleCreateInvite}
            className="flex flex-wrap items-end gap-3 mb-6"
          >
            <div className="grow min-w-40">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Descripci&oacute;n{" "}
                <span className="text-slate-500">(opcional)</span>
              </label>
              <input
                type="text"
                value={inviteNote}
                onChange={(e) => setInviteNote(e.target.value)}
                placeholder=""
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
              />
            </div>
            <div className="w-24">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Usos
              </label>
              <input
                type="number"
                min={1}
                value={inviteMaxUses}
                onChange={(e) => setInviteMaxUses(e.target.value)}
                placeholder="∞"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
              />
            </div>
            <div className="w-28">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Días válido
              </label>
              <input
                type="number"
                min={1}
                value={inviteExpiryDays}
                onChange={(e) => setInviteExpiryDays(e.target.value)}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
              />
            </div>
            <button
              type="submit"
              disabled={isCreatingInvite}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition flex items-center gap-2"
            >
              {isCreatingInvite && (
                <Loader2 className="animate-spin" size={16} />
              )}
              Crear invitación
            </button>
          </form>

          {invites.length === 0 ? (
            <p className="text-slate-400 text-sm">
              No hay invitaciones todavía
            </p>
          ) : (
            <ul className="space-y-2">
              {invites.map((invite) => {
                const state = inviteState(invite);
                const active = state === "Activa";
                return (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center gap-3 bg-slate-700/50 rounded-lg px-3 py-2"
                  >
                    <code
                      className={`font-mono text-sm px-2 py-1 rounded bg-slate-900 ${
                        active ? "text-white" : "text-slate-500 line-through"
                      }`}
                    >
                      {invite.code}
                    </code>
                    <button
                      onClick={() => handleCopyCode(invite.code)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-600 rounded transition"
                      title="Copiar código"
                    >
                      {copiedCode === invite.code ? (
                        <Check size={16} className="text-green-400" />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                    <div className="grow text-sm text-slate-300">
                      {invite.note && <span>{invite.note} · </span>}
                      <span className="text-slate-400">
                        {inviteUses(invite.id)}/{invite.max_uses ?? "∞"} usos
                        {invite.expires_at &&
                          ` · vence ${formatDate(invite.expires_at)}`}
                      </span>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        active
                          ? "bg-green-900/50 text-green-300"
                          : "bg-slate-600 text-slate-300"
                      }`}
                    >
                      {state}
                    </span>
                    {active && (
                      <button
                        onClick={() => handleRevokeInvite(invite)}
                        disabled={busyId === invite.id}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-600 rounded transition"
                        title="Revocar código"
                      >
                        <Ban size={16} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Members */}
        <section className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h2 className="text-xl font-semibold text-white mb-4">
            Miembros ({members.length})
          </h2>
          <ul className="space-y-2">
            {sortedMembers.map((member) => {
              const isSelf = member.id === currentUser?.id;
              const suspended = member.status !== "active";
              return (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center gap-3 bg-slate-700/50 rounded-lg px-3 py-2"
                >
                  <div className="grow">
                    <p
                      className={`text-sm font-medium ${
                        suspended ? "text-slate-500" : "text-white"
                      }`}
                    >
                      {member.first_name || member.email}
                      {isSelf && (
                        <span className="text-slate-400 font-normal">
                          {" "}
                          (tú)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {member.email}
                      {member.date_created &&
                        ` · desde ${formatDate(member.date_created)}`}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      suspended
                        ? "bg-red-900/50 text-red-300"
                        : "bg-green-900/50 text-green-300"
                    }`}
                  >
                    {suspended ? "Suspendido" : "Activo"}
                  </span>
                  <button
                    onClick={() => handleResetPassword(member)}
                    disabled={busyId === member.id}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-600 rounded transition"
                    title="Restablecer contraseña"
                  >
                    <KeyRound size={16} />
                  </button>
                  {!isSelf && (
                    <button
                      onClick={() => handleToggleStatus(member)}
                      disabled={busyId === member.id}
                      className={`p-1.5 text-slate-400 hover:bg-slate-600 rounded transition ${
                        suspended
                          ? "hover:text-green-400"
                          : "hover:text-red-500"
                      }`}
                      title={suspended ? "Reactivar" : "Suspender"}
                    >
                      {suspended ? (
                        <UserCheck size={16} />
                      ) : (
                        <UserX size={16} />
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
