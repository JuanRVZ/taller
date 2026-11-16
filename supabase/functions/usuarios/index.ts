// Función de Supabase (Edge Function) para que el administrador gestione mecánicos desde la app.
// Usa la clave de servicio, que Supabase inyecta aquí y NUNCA llega al navegador.
// Solo responde si quien llama está en la tabla `admins` (comprobado con su sesión, no con datos que envíe la web).
// IMPORTANTE: subir este archivo a GitHub no la actualiza; hay que desplegarla en Supabase > Edge Functions > usuarios.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ORIGEN = "https://juanrvz.github.io";
const cors = {
  "Access-Control-Allow-Origin": ORIGEN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: eAuth } = await admin.auth.getUser(token);
    if (eAuth || !user) return json({ error: "No autorizado" }, 403);
    const { data: fila, error: eAdm } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (eAdm || !fila) return json({ error: "No autorizado" }, 403);

    const b = await req.json().catch(() => ({}));
    const anotar = (accion: string, objetivo: string | null) =>
      admin.from("auditoria").insert({ quien: user.id, accion, objetivo });
    if (b.id !== undefined && !UUID.test(String(b.id))) return json({ error: "Usuario no válido" }, 400);

    switch (b.accion) {
      case "listar": {
        const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
        if (error) throw error;
        return json({ usuarios: data.users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, banned_until: u.banned_until })) });
      }
      case "crear": {
        const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: "Email no válido" }, 400);
        if (password.length < 10 || password.length > 72) return json({ error: "La contraseña necesita entre 10 y 72 caracteres" }, 400);
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) return json({ error: "No se pudo crear: puede que ese email ya exista" }, 400);
        await anotar("crear", data.user?.id ?? null);
        return json({ id: data.user?.id });
      }
      case "contrasena": {
        const password = String(b.password || "");
        if (!b.id) return json({ error: "Usuario no válido" }, 400);
        if (password.length < 10 || password.length > 72) return json({ error: "La contraseña necesita entre 10 y 72 caracteres" }, 400);
        const { error } = await admin.auth.admin.updateUserById(b.id, { password });
        if (error) return json({ error: "No se pudo cambiar la contraseña" }, 400);
        await anotar("contrasena", b.id);
        return json({ ok: true });
      }
      case "desactivar":
      case "activar": {
        if (!b.id) return json({ error: "Usuario no válido" }, 400);
        if (b.id === user.id) return json({ error: "No puedes desactivar tu propia cuenta" }, 400);
        const { error } = await admin.auth.admin.updateUserById(b.id, { ban_duration: b.accion === "desactivar" ? "876000h" : "none" });
        if (error) return json({ error: "No se pudo cambiar el estado del usuario" }, 400);
        await anotar(b.accion, b.id);
        return json({ ok: true });
      }
      default:
        return json({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    console.error(e);   // el detalle queda en los registros de Supabase, no se envía al navegador
    return json({ error: "Error interno. Inténtalo de nuevo." }, 500);
  }
});
