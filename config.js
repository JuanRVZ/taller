// Pega aquí los datos de Supabase > Project Settings > API
// (la anon key es pública por diseño; la seguridad la da el RLS de supabase.sql)
window.CONFIG = {
  SUPABASE_URL: "https://ksukwhhhkzejruhnwgzi.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzdWt3aGhoa3planJ1aG53Z3ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNTAxMDQsImV4cCI6MjEwMjcyNjEwNH0.LHjyBWLf1-45vjxCzBOKuYXn30E3-WO7a5Aim2br14s",
  TALLER: "Mi Taller",
  TALLER_DATOS: [], // líneas bajo el nombre en el PDF, p. ej. ["C/ Mayor 1, Madrid", "NIF B12345678", "Tel. 600 000 000"]
  PREFIJO_TEL: "34", // prefijo de país para WhatsApp si el teléfono tiene 9 dígitos
  ADMIN_EMAIL: "juanravaz@icloud.com" // solo cambia lo que ve la interfaz; la seguridad real está en la base de datos
};
