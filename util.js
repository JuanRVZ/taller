// ===== Utilidades comunes: cliente de Supabase, formatos, cálculos, mensajes y tema =====
const { SUPABASE_URL, SUPABASE_ANON_KEY, TALLER } = window.CONFIG;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
document.getElementById("brand").textContent = TALLER;

let session = null;
let filtroEstado = "todos"; // filtro del listado de presupuestos (se recuerda al cambiar de pantalla)
let perfil = {};            // ajustes del mecánico (tabla perfiles)
const taller = () => perfil.taller || TALLER;
const datosTallerTxt = () => perfil.datos || (window.CONFIG.TALLER_DATOS || []).join("\n");
const lineasDatos = txt => String(txt || "").split("\n").map(x => x.trim()).filter(Boolean);
const aplicarMarca = () => { document.getElementById("brand").textContent = taller(); document.title = taller() + " · Presupuestos"; };

const me = () => session.user.id;
const isAdmin = () => !!session && session.user.email?.toLowerCase() === (window.CONFIG.ADMIN_EMAIL || "").toLowerCase();
const eur = n => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fecha = d => new Date(d).toLocaleDateString("es-ES");
const num = x => x.n_taller ?? x.numero ?? "…"; // número propio de cada mecánico ("…" hasta que se sincroniza)
const nombreC = c => [c.nombre, c.apellidos].filter(Boolean).join(" ");
const r2 = n => Math.round((+n || 0) * 100) / 100;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const placa = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); // "1234 abc" -> "1234ABC"
const mb = b => (b / 1048576).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " MB";

// Mano de obra al precio puesto; las piezas llevan el margen del mecánico (el cliente solo ve el precio final)
const pvp = (l, m) => l.tipo === "pieza" ? r2((+l.precio || 0) * (1 + (+m || 0) / 100)) : r2(l.precio);
const lineasCliente = (lineas, m) => lineas.filter(l => String(l.desc).trim())
  .map(l => ({ desc: l.desc, tipo: l.tipo, cant: +l.cant || 0, precio: pvp(l, m), importe: r2((+l.cant || 0) * pvp(l, m)) }));
const calc = (lineas, m) => {
  const rows = lineasCliente(lineas, m);
  const mano = r2(rows.filter(r => r.tipo !== "pieza").reduce((a, r) => a + r.importe, 0));
  const piezas = r2(rows.filter(r => r.tipo === "pieza").reduce((a, r) => a + r.importe, 0));
  return { mano, piezas, total: r2(mano + piezas) };
};
const norm = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// "neumáticos" y "neumático" (o "frenos"/"freno") deben encontrarse entre sí: se compara por raíz de 5 letras
const claves = q => norm(q).split(/[^a-z0-9]+/).filter(w => w.length >= 3).map(w => w.length > 5 ? w.slice(0, 5) : w);
// Desglose real de un presupuesto: lo que paga el cliente, lo que cuestan las piezas y lo que queda
const desglose = q => {
  const m = +q.margen || 0; let mano = 0, coste = 0, venta = 0;
  (q.lineas || []).forEach(l => {
    if (!String(l.desc).trim()) return;
    const cant = +l.cant || 0;
    if (l.tipo === "pieza") { coste += cant * (+l.precio || 0); venta += r2(cant * pvp(l, m)); }
    else mano += r2(cant * (+l.precio || 0));
  });
  mano = r2(mano); coste = r2(coste); venta = r2(venta);
  return { mano, coste, venta, total: r2(mano + venta), ganancia: r2(mano + venta - coste) };
};
// Lo que aún debe el cliente de un trabajo cerrado: total menos el anticipo (0 si ya está cobrado)
const porCobrar = q => q.pagado ? 0 : Math.max(0, r2(desglose(q).total - (+q.anticipo || 0)));

// Gastos fijos: un gasto puntual cuenta en su mes; uno mensual cuenta cada mes desde su fecha (hasta la fecha "hasta", si la hay)
const mesIdx = d => { const f = new Date(String(d).slice(0, 10) + "T12:00:00"); return f.getFullYear() * 12 + f.getMonth(); };
const gastoEnMes = (g, idx) => {
  const ini = mesIdx(g.fecha);
  if (!g.mensual) return ini === idx ? +g.importe : 0;
  const fin = g.hasta ? mesIdx(g.hasta) : Infinity;
  return idx >= ini && idx <= fin ? +g.importe : 0;
};

const usaGastos = () => window.CONFIG.GASTOS === true;
if (!usaGastos()) document.querySelectorAll("[data-gastos]").forEach(b => { b.hidden = true; });
// Lo cobrado por cada vía (efectivo / bizum), incluido el anticipo
const pagoPorVia = q => {
  const ant = +q.anticipo || 0; let ef = +q.pago_efectivo || 0, bz = +q.pago_bizum || 0;
  if (!ef && !bz && q.pagado) { const resto = Math.max(0, desglose(q).total - ant); if (/bizum/i.test(q.forma_pago || "")) bz = resto; else ef = resto; } // cobros antiguos
  if (ant) { if (q.anticipo_forma === "bizum") bz += ant; else ef += ant; }
  return { efectivo: r2(ef), bizum: r2(bz) };
};
const textoPago = q => { const p = pagoPorVia(q), t = []; if (p.efectivo) t.push(`${eur(p.efectivo)} en efectivo`); if (p.bizum) t.push(`${eur(p.bizum)} por bizum`); return t.join(" + "); };
const tab = name => document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.go === name));

// CSV para Excel en español: separador ";", coma decimal y BOM UTF-8
const csv = filas => "﻿" + filas.map(f => f.map(v => {
  const t = typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
  return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}).join(";")).join("\r\n");
const descargar = (blob, nombre) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

// ---------- Mensajes (SweetAlert2; si no cargara el CDN, aviso simple y confirm() nativo) ----------
const toastSimple = m => { const t = document.getElementById("toast"); t.textContent = m; t.className = "show"; setTimeout(() => t.className = "", 2400); };
const tostada = (icon, msg, ms) => {
  if (!window.Swal) return toastSimple(msg);
  Swal.fire({ toast: true, position: "top-end", icon, title: msg, showConfirmButton: false, timer: ms, timerProgressBar: true });
};
const ok = m => tostada("success", m, 2400);
const info = (m, ms = 3200) => tostada("info", m, ms);
const aviso = m => tostada("warning", m, 3600);
const amigable = m => {
  m = String(m || "");
  if (/failed to fetch|network|load failed/i.test(m)) return "No hay conexión con el servidor. Revisa internet e inténtalo de nuevo.";
  if (/jwt|expired|not authenticated/i.test(m)) return "Tu sesión ha caducado. Vuelve a entrar.";
  if (/row-level security|permission denied/i.test(m)) return "No tienes permiso para hacer esto.";
  if (/duplicate key/i.test(m)) return "Ese dato ya existe.";
  if (/exceeded the maximum allowed size|payload too large/i.test(m)) return "La foto es demasiado grande para subirla.";
  return m || "Error inesperado.";
};
const ko = m => {
  if (!window.Swal) return toastSimple(amigable(m));
  return Swal.fire({ icon: "error", title: "Algo ha ido mal", text: amigable(m), confirmButtonText: "Entendido", confirmButtonColor: "#1f4fd8" });
};
const confirmar = async (titulo, texto = "", boton = "Sí, borrar", peligro = true) => {
  if (!window.Swal) return confirm(titulo);
  const r = await Swal.fire({ icon: peligro ? "warning" : "question", title: titulo, text: texto, showCancelButton: true, confirmButtonText: boton, cancelButtonText: "Cancelar", confirmButtonColor: peligro ? "#b91c1c" : "#15803d", reverseButtons: true, focusCancel: peligro });
  return r.isConfirmed;
};
window.addEventListener("unhandledrejection", e => ko(e.reason?.message || e.reason));
const loading = () => { $app.innerHTML = "<p>Cargando…</p>"; };
const fail = e => { $app.innerHTML = `<p class="err">${esc(e.message)}</p>`; };

// ---------- Tema: claro u oscuro. Si nunca se ha elegido, arranca en el que ya tenga el dispositivo ----------
const sistemaOscuro = () => matchMedia("(prefers-color-scheme: dark)").matches;
const getTema = () => { try { const t = localStorage.getItem("tema"); if (t === "light" || t === "dark") return t; } catch {} return sistemaOscuro() ? "dark" : "light"; };
function aplicarTema(t) {
  document.documentElement.dataset.theme = t;
  const b = document.getElementById("theme");
  b.textContent = t === "dark" ? "🌙" : "☀️";
  b.title = t === "dark" ? "Modo oscuro (pulsa para el claro)" : "Modo claro (pulsa para el oscuro)";
}
aplicarTema(getTema());
document.getElementById("theme").onclick = () => {
  const nuevo = getTema() === "dark" ? "light" : "dark";
  try { localStorage.setItem("tema", nuevo); } catch {}
  aplicarTema(nuevo);
  if (document.getElementById("charts-home")) viewHome();
  info(nuevo === "dark" ? "Modo oscuro" : "Modo claro", 1200);
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
