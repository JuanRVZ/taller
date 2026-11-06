// Función de Supabase (Edge Function) para que el administrador gestione mecánicos desde la app.
// Usa la clave de servicio, que Supabase inyecta aquí y NUNCA llega al navegador.
// Solo responde si quien llama es el administrador (comprobado con su sesión, no con datos que envíe la web).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN = "juanravaz@icloud.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error: eAuth } = await admin.auth.getUser(token);
    if (eAuth || !user || user.email?.toLowerCase() !== ADMIN) return json({ error: "No autorizado" }, 403);

    const b = await req.json();
    switch (b.accion) {
      case "listar": {
        const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
        if (error) return json({ error: error.message }, 500);
        return json({ usuarios: data.users.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, banned_until: u.banned_until })) });
      }
      case "crear": {
        const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
        if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Email no válido" }, 400);
        if (password.length < 8) return json({ error: "La contraseña necesita al menos 8 caracteres" }, 400);
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) return json({ error: error.message }, 400);
        return json({ id: data.user?.id });
      }
      case "contrasena": {
        if (String(b.password || "").length < 8) return json({ error: "La contraseña necesita al menos 8 caracteres" }, 400);
        const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "desactivar":
      case "activar": {
        if (b.id === user.id) return json({ error: "No puedes desactivar tu propia cuenta" }, 400);
        const { error } = await admin.auth.admin.updateUserById(b.id, { ban_duration: b.accion === "desactivar" ? "876000h" : "none" });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      default:
        return json({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
