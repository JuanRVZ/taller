// ===== Datos "primero local": la app lee de una copia guardada en el dispositivo y envía los cambios a Supabase en cuanto hay conexión =====
// Sin cobertura se puede seguir trabajando: los cambios quedan en una cola y se envían solos al volver internet.
const TABLAS = ["clientes", "vehiculos", "presupuestos", "gastos"];
const D = { t: { clientes: [], vehiculos: [], presupuestos: [], gastos: [] }, cola: [], sincronizando: false, ultimoRefresco: 0 };
const kD = () => `taller:${session.user.id}:datos`;
const kC = () => `taller:${session.user.id}:cola`;
const esRed = e => !navigator.onLine || /failed to fetch|network|load failed|fetch/i.test(String(e?.message || e));

function guardarLocal() {
  try { localStorage.setItem(kD(), JSON.stringify(D.t)); localStorage.setItem(kC(), JSON.stringify(D.cola)); }
  catch (e) { /* almacenamiento del navegador lleno: la app sigue funcionando en memoria */ }
}
function cargarLocal() {
  D.t = { clientes: [], vehiculos: [], presupuestos: [], gastos: [] }; D.cola = [];
  try { const t = JSON.parse(localStorage.getItem(kD())); if (t) Object.assign(D.t, t); D.cola = JSON.parse(localStorage.getItem(kC())) || []; } catch {}
}
function limpiarLocal() { D.t = { clientes: [], vehiculos: [], presupuestos: [], gastos: [] }; D.cola = []; }

// El servidor corta en 1000 filas por consulta: se pide por páginas para no perder datos
async function todas(tabla, cols = "*") {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from(tabla).select(cols).order("created_at").order("id").range(desde, desde + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas;
}

// Descarga todo lo que ve este usuario (el administrador ve lo de todos). No pisa cambios aún sin enviar.
async function refrescar() {
  if (!navigator.onLine || D.cola.length || D.sincronizando) return false;
  try {
    const r = await Promise.all(TABLAS.map(t => todas(t)));
    if (D.cola.length) return false;
    TABLAS.forEach((t, i) => { D.t[t] = r[i]; });
    D.ultimoRefresco = Date.now(); guardarLocal(); return true;
  } catch (e) { if (!esRed(e)) throw e; return false; }
}

async function iniciarDatos() {
  cargarLocal(); pintarEstado();
  if (navigator.onLine) { await sincronizar(); await refrescar(); }
}

// ---- escritura: se aplica al momento en la copia local y se encola para el servidor ----
const porDefectoLocal = { presupuestos: u => ({ email: u, numero: null, n_taller: null, pagado: false, anticipo: 0 }), clientes: u => ({ email_mecanico: u }), gastos: u => ({ email: u }), vehiculos: () => ({}) };

function insertar(tabla, fila) {
  const f = { id: crypto.randomUUID(), user_id: me(), created_at: new Date().toISOString(), ...fila };
  const local = { ...porDefectoLocal[tabla](session.user.email), ...f, _pend: true };
  D.t[tabla].push(local);
  D.cola.push({ tabla, op: "insert", fila: f });
  guardarLocal(); pintarEstado(); sincronizar();
  return local;
}

function actualizar(tabla, id, cambios) {
  const r = D.t[tabla].find(x => x.id === id);
  if (r) Object.assign(r, cambios);
  const ins = D.cola.find(o => o.tabla === tabla && o.op === "insert" && o.fila.id === id);
  if (ins) Object.assign(ins.fila, cambios);          // aún no llegó al servidor: se fusiona con el alta
  else D.cola.push({ tabla, op: "update", id, cambios });
  guardarLocal(); pintarEstado(); sincronizar();
  return r;
}

function borrar(tabla, id) {
  const eraPendiente = D.cola.some(o => o.tabla === tabla && o.op === "insert" && o.fila.id === id);
  let ids = [id];
  D.t[tabla] = D.t[tabla].filter(x => x.id !== id);
  if (tabla === "clientes") {                         // el servidor borra sus vehículos y deja sus presupuestos sin cliente
    const vids = D.t.vehiculos.filter(v => v.cliente_id === id).map(v => v.id);
    ids = ids.concat(vids);
    D.t.vehiculos = D.t.vehiculos.filter(v => v.cliente_id !== id);
    D.t.presupuestos.forEach(p => { if (p.cliente_id === id) { p.cliente_id = null; if (vids.includes(p.vehiculo_id)) p.vehiculo_id = null; } });
  }
  if (tabla === "vehiculos") D.t.presupuestos.forEach(p => { if (p.vehiculo_id === id) p.vehiculo_id = null; });
  // se descartan operaciones que ya no tienen sentido (sobre lo borrado o que cuelgan de ello)
  D.cola = D.cola.filter(o => !(ids.includes(o.fila?.id) || ids.includes(o.id) || (o.tabla === "vehiculos" && o.fila?.cliente_id === id)));
  if (!eraPendiente) D.cola.push({ tabla, op: "delete", id });
  guardarLocal(); pintarEstado(); sincronizar();
}

// ---- envío al servidor, en orden; si no hay red se para y se reintenta al volver ----
async function sincronizar() {
  if (D.sincronizando || !D.cola.length || !navigator.onLine || !session) { pintarEstado(); return; }
  D.sincronizando = true; pintarEstado();
  const rechazadas = [];
  try {
    while (D.cola.length) {
      const o = D.cola[0]; let error = null, data = null;
      try {
        if (o.op === "insert") ({ data, error } = await db.from(o.tabla).insert(o.fila).select().single());
        else if (o.op === "update") ({ error } = await db.from(o.tabla).update(o.cambios).eq("id", o.id));
        else ({ error } = await db.from(o.tabla).delete().eq("id", o.id));
      } catch (e) { error = e; }
      if (error) {
        if (esRed(error)) break;                      // sin conexión: se queda en la cola
        rechazadas.push(error.message);               // el servidor la rechaza: se descarta para no bloquear el resto
        D.cola.shift(); guardarLocal(); continue;
      }
      D.cola.shift();
      if (o.op === "insert" && data) { const i = D.t[o.tabla].findIndex(x => x.id === o.fila.id); if (i >= 0) D.t[o.tabla][i] = data; }
      guardarLocal();
    }
  } finally { D.sincronizando = false; guardarLocal(); pintarEstado(); }
  if (rechazadas.length) { ko("El servidor no aceptó algún cambio: " + rechazadas[0]); await refrescar(); }
}

function pintarEstado() {
  const el = document.getElementById("estado"); if (!el) return;
  const n = D.cola.length, off = !navigator.onLine;
  el.hidden = !session || (!off && !n);
  el.textContent = off ? (n ? `📴 Sin conexión · ${n} sin enviar` : "📴 Sin conexión") : `⏳ Enviando ${n}…`;
  el.title = off ? "Puedes seguir trabajando: todo se enviará al volver la conexión" : "Sincronizando con el servidor";
}
window.addEventListener("online", async () => {
  pintarEstado();
  if (!session) return;
  await sincronizar();
  if (await refrescar()) info("Conexión recuperada: todo sincronizado");
});
window.addEventListener("offline", () => { pintarEstado(); if (session) aviso("Sin conexión: puedes seguir trabajando, se enviará al volver."); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && session && Date.now() - D.ultimoRefresco > 60000) sincronizar().then(refrescar);
});

// ===== Fotos: se comprimen en el dispositivo antes de subirlas (el plan gratis tiene 1 GB de almacenamiento) =====
const FOTOS_MAX_POR_PRESUPUESTO = 10, GB = 1024 * 1024 * 1024;

async function cargarImagen(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* navegador antiguo */ }
  return await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error("No se pudo leer la imagen")); img.src = URL.createObjectURL(file); });
}
// Reduce a un máximo de 1280 px y recomprime en WebP (o JPEG en Safari) hasta bajar de ~110 KB
async function comprimirImagen(file, { maxLado = 1280, objetivoKB = 110 } = {}) {
  const img = await cargarImagen(file);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  let lado = maxLado, q = 0.62, blob = null;
  for (let i = 0; i < 8; i++) {
    const k = Math.min(1, lado / Math.max(w0, h0));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, "image/webp", q));
    if (!blob || blob.type !== "image/webp") blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= objetivoKB * 1024) break;
    if (q > 0.42) q = Math.max(0.4, q - 0.1); else lado = Math.round(lado * 0.8);
  }
  img.close?.();
  return blob;
}
async function subirFoto(p, file) {
  if (!navigator.onLine) throw new Error("Las fotos necesitan conexión a internet.");
  if (p._pend) throw new Error("Espera un momento a que el presupuesto se sincronice y vuelve a intentarlo.");
  const blob = await comprimirImagen(file);
  const path = `${me()}/${p.id}/${crypto.randomUUID()}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
  const up = await db.storage.from("fotos").upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (up.error) throw up.error;
  const { data, error } = await db.from("fotos").insert({ presupuesto_id: p.id, path, bytes: blob.size }).select().single();
  if (error) { await db.storage.from("fotos").remove([path]); throw error; }
  return { foto: data, original: file.size, final: blob.size };
}
async function fotosDe(presupuestoId) {
  const { data, error } = await db.from("fotos").select("*").eq("presupuesto_id", presupuestoId).order("created_at");
  if (error) throw error;
  if (!data.length) return [];
  const { data: urls } = await db.storage.from("fotos").createSignedUrls(data.map(f => f.path), 3600);
  return data.map((f, i) => ({ ...f, url: urls?.[i]?.signedUrl }));
}
async function borrarFotos(lista) {
  if (!lista.length) return;
  const r = await db.storage.from("fotos").remove(lista.map(f => f.path));
  if (r.error) throw r.error;
  const d = await db.from("fotos").delete().in("id", lista.map(f => f.id));
  if (d.error) throw d.error;
}
async function borrarFotosDePresupuesto(id) {
  const { data, error } = await db.from("fotos").select("*").eq("presupuesto_id", id);
  if (error) throw error;
  await borrarFotos(data || []);
}
async function usoFotos() {
  const filas = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await db.from("fotos").select("user_id,bytes,presupuesto_id").range(d, d + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas;
}
