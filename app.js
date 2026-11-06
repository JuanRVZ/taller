const { SUPABASE_URL, SUPABASE_ANON_KEY, TALLER } = window.CONFIG;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
document.getElementById("brand").textContent = TALLER;
let session = null;
let filtroEstado = "todos"; // filtro del listado de presupuestos (se recuerda al cambiar de pantalla)
let perfil = {}; // ajustes del mecánico (tabla perfiles)
const taller = () => perfil.taller || TALLER;
const datosTallerTxt = () => perfil.datos || (window.CONFIG.TALLER_DATOS || []).join("\n");
const lineasDatos = txt => String(txt || "").split("\n").map(x => x.trim()).filter(Boolean);
const aplicarMarca = () => { document.getElementById("brand").textContent = taller(); document.title = taller() + " · Presupuestos"; };

const me = () => session.user.id;
const isAdmin = () => !!session && session.user.email?.toLowerCase() === (window.CONFIG.ADMIN_EMAIL || "").toLowerCase();
const eur = n => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fecha = d => new Date(d).toLocaleDateString("es-ES");
const nombreC = c => [c.nombre, c.apellidos].filter(Boolean).join(" ");
const r2 = n => Math.round((+n || 0) * 100) / 100;
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
const norm = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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
const tab = name => document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.go === name));
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

// ---------- Tema: por defecto el del sistema; el botón recorre sistema → claro → oscuro ----------
const TEMAS = [["auto", "🖥️", "Sistema"], ["light", "☀️", "Claro"], ["dark", "🌙", "Oscuro"]];
const getTema = () => { try { const t = localStorage.getItem("tema"); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; } };
function aplicarTema(t) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const [, icono, nombre] = TEMAS.find(x => x[0] === t);
  const b = document.getElementById("theme"); b.textContent = icono; b.title = `Tema: ${nombre} (pulsa para cambiar)`;
}
aplicarTema(getTema());
document.getElementById("theme").onclick = () => {
  const sig = TEMAS[(TEMAS.findIndex(x => x[0] === getTema()) + 1) % TEMAS.length][0];
  try { sig === "auto" ? localStorage.removeItem("tema") : localStorage.setItem("tema", sig); } catch {}
  aplicarTema(sig);
  if (document.getElementById("charts-home")) viewHome();
  info("Tema: " + TEMAS.find(x => x[0] === sig)[2], 1500);
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

// ---------- Auth (sin registro público: las cuentas las da de alta el administrador) ----------
function viewAuth() {
  $nav.hidden = true;
  $app.innerHTML = `
    <form class="card auth" id="f">
      <h2>Acceso mecánicos</h2>
      <label>Email</label><input type="email" name="email" required autocomplete="username">
      <label>Contraseña</label><input type="password" name="pass" required autocomplete="current-password">
      <p class="err" id="err"></p>
      <div class="actions"><button class="primary">Entrar</button></div>
      <p style="color:var(--mut);font-size:.85rem">¿Sin acceso? Pídele una cuenta al administrador del taller.</p>
    </form>`;
  document.getElementById("f").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const { error } = await db.auth.signInWithPassword({ email: f.email.value, password: f.pass.value });
    if (error) document.getElementById("err").textContent = "Email o contraseña incorrectos";
  };
}
document.getElementById("logout").onclick = () => db.auth.signOut();
$nav.onclick = e => {
  if (!session) return viewAuth();
  const g = e.target.dataset.go;
  if (g === "home") viewHome();
  if (g === "list") viewList();
  if (g === "clients") viewClients();
  if (g === "new") viewForm();
  if (g === "profile") viewPerfil();
};

// Abre un presupuesto: editable si es mío, solo lectura (admin) si es de otro
function openQuote(p, back = viewList) {
  const mio = p.user_id === me();
  if (mio && p.estado !== "cerrado") return viewForm(p, {}, back);
  viewPrint(p, p, calc(p.lineas, p.margen), back, mio ? { reabrir: () => reabrirPresupuesto(p, back) } : null);
}
async function reabrirPresupuesto(p, back) {
  if (!(await confirmar("¿Reabrir este presupuesto?", "Volverá a estado «aceptado» y podrás editarlo de nuevo.", "Sí, reabrir", false))) return;
  const { data, error } = await db.from("presupuestos").update({ estado: "aceptado", cerrado_at: null }).eq("id", p.id).select().single();
  if (error) return ko(error.message);
  ok("Presupuesto reabierto"); viewForm(data, {}, back);
}

// ---------- Historial de presupuestos ----------
async function viewList() {
  if (!session) return viewAuth();
  $nav.hidden = false; tab("list");
  const admin = isAdmin();
  $app.innerHTML = `<input id="q" placeholder="Buscar cliente, matrícula, vehículo${admin ? ", mecánico" : ""}…"><div class="chips" id="chips"></div><div id="l" class="grid">Cargando…</div>`;
  const { data, error } = await db.from("presupuestos").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) return fail(error);
  const ESTADOS = [["todos", "Todos"], ["pendiente", "Pendientes"], ["aceptado", "Aceptados"], ["cerrado", "Cerrados"], ["rechazado", "Rechazados"]];
  const draw = () => {
    const q = document.getElementById("q").value.toLowerCase();
    const porTexto = data.filter(p => [p.cliente, p.matricula, p.vehiculo, p.email].join(" ").toLowerCase().includes(q));
    const cuenta = e => e === "todos" ? porTexto.length : porTexto.filter(p => p.estado === e).length;
    const chips = document.getElementById("chips");
    chips.innerHTML = ESTADOS.map(([e, t]) => `<button data-f="${e}" class="${filtroEstado === e ? "on" : ""}">${t} <small>${cuenta(e)}</small></button>`).join("");
    chips.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filtroEstado = b.dataset.f; draw(); });
    const rows = filtroEstado === "todos" ? porTexto : porTexto.filter(p => p.estado === filtroEstado);
    document.getElementById("l").innerHTML = rows.length ? rows.map(p => `
      <div class="card item" data-id="${p.id}">
        <div><b>#${p.numero} · ${esc(p.cliente)}</b><br><small>${esc(p.vehiculo)} ${esc(p.matricula)} · ${fecha(p.created_at)}${admin ? " · <b>" + esc(p.email || "?") + "</b>" : ""}</small></div>
        <div class="right"><b>${eur(p.total)}</b><br><span class="tag ${p.estado}">${p.estado}</span></div>
      </div>`).join("") : `<p>${data.length ? "Ningún presupuesto coincide con el filtro." : "Aún no hay presupuestos."}</p>`;
    document.querySelectorAll(".item").forEach(el => el.onclick = () => openQuote(data.find(x => x.id === el.dataset.id)));
  };
  document.getElementById("q").oninput = draw; draw();
}

// ---------- Clientes ----------
async function viewClients() {
  if (!session) return viewAuth();
  $nav.hidden = false; tab("clients");
  const admin = isAdmin();
  $app.innerHTML = `<div class="row"><input id="q" placeholder="Buscar nombre, teléfono, matrícula${admin ? ", mecánico" : ""}…"><button id="nc" class="primary" style="flex:0 0 auto">+ Nuevo cliente</button></div><div id="l" class="grid">Cargando…</div>`;
  document.getElementById("nc").onclick = () => viewClient(null);
  const [rc, rv] = await Promise.all([
    db.from("clientes").select("*").order("nombre").limit(2000),
    db.from("vehiculos").select("*").limit(5000)]);
  if (rc.error) return fail(rc.error);
  const cs = rc.data, vs = rv.data || [];
  const draw = () => {
    const q = document.getElementById("q").value.toLowerCase();
    const rows = cs.map(c => ({ c, v: vs.filter(v => v.cliente_id === c.id) }))
      .filter(({ c, v }) => [nombreC(c), c.telefono, c.email, c.email_mecanico, ...v.map(x => x.vehiculo + " " + x.matricula)].join(" ").toLowerCase().includes(q));
    document.getElementById("l").innerHTML = rows.length ? rows.map(({ c, v }) => `
      <div class="card item" data-id="${c.id}"><div>
        <b>${esc(nombreC(c))}</b><br>
        <small>${[esc(c.telefono), v.map(x => esc(x.vehiculo) + " " + esc(x.matricula)).join(", "), admin ? "<b>" + esc(c.email_mecanico || "?") + "</b>" : ""].filter(Boolean).join(" · ")}</small>
      </div></div>`).join("") : "<p>No hay clientes.</p>";
    document.querySelectorAll(".item").forEach(el => el.onclick = () => viewClient(cs.find(x => x.id === el.dataset.id)));
  };
  document.getElementById("q").oninput = draw; draw();
}

async function viewClient(c) {
  if (!session) return viewAuth();
  $nav.hidden = false; tab("clients");
  loading();
  const ro = !!c && c.user_id !== me(); // el admin ve fichas ajenas en solo lectura
  const s = c ? { ...c } : { nombre: "", apellidos: "", telefono: "", email: "", notas: "", vehs: [{ vehiculo: "", matricula: "", anio: "" }] };
  let vehs = [], quotes = [];
  if (c) {
    const [rv, rq] = await Promise.all([
      db.from("vehiculos").select("*").eq("cliente_id", c.id).order("created_at"),
      db.from("presupuestos").select("*").eq("cliente_id", c.id).order("created_at", { ascending: false })]);
    if (rv.error) return fail(rv.error);
    vehs = rv.data; quotes = rq.data || [];
  }
  const dis = ro ? "disabled" : "";
  const histo = list => list.length ? list.map(p => `
      <div class="hist" data-q="${p.id}"><span>${fecha(p.created_at)}${p.km != null ? " · " + p.km.toLocaleString("es-ES") + " km" : ""}</span>
      <span>${esc(p.lineas.map(l => l.desc).filter(Boolean).join(", ").slice(0, 90))}</span>
      <span class="right"><b>${eur(p.total)}</b> <span class="tag ${p.estado}">${p.estado}</span></span></div>`).join("") : "<small>Sin presupuestos.</small>";

  const render = () => {
    const sinVeh = quotes.filter(p => !p.vehiculo_id);
    $app.innerHTML = `
    <div class="card">
      <h3>${c ? esc(nombreC(c)) : "Nuevo cliente"}</h3>
      <div class="row">
        <div><label>Nombre *</label><input data-k="nombre" value="${esc(s.nombre)}" ${dis}></div>
        <div><label>Apellidos</label><input data-k="apellidos" value="${esc(s.apellidos)}" ${dis}></div>
      </div>
      <div class="row">
        <div><label>Teléfono</label><input data-k="telefono" type="tel" value="${esc(s.telefono)}" ${dis}></div>
        <div><label>Email</label><input data-k="email" type="email" value="${esc(s.email)}" ${dis}></div>
      </div>
      <label>Notas</label><textarea data-k="notas" rows="2" ${dis}>${esc(s.notas)}</textarea>
      ${c ? "" : `
      <div class="seccion">
        <h4>🚗 Vehículos del cliente</h4>
        <p class="hint">Añade ya sus coches. Si tiene más de uno, pulsa "Añadir otro vehículo". También puedes dejarlo vacío y añadirlos más tarde.</p>
        ${s.vehs.map((v, i) => `
        <div class="veh" data-nv="${i}">
          <input data-nf="vehiculo" placeholder="Marca y modelo (Ej.: Renault Clio)" value="${esc(v.vehiculo)}">
          <input data-nf="matricula" placeholder="Matrícula" value="${esc(v.matricula)}">
          <input data-nf="anio" type="number" placeholder="Año" value="${esc(v.anio)}">
          ${s.vehs.length > 1 ? `<button data-nvd="${i}" class="danger" title="Quitar este vehículo">×</button>` : ""}
        </div>`).join("")}
        <button id="addnv">+ Añadir otro vehículo</button>
      </div>`}
      <div class="actions">
        ${ro ? "" : `<button class="primary" id="save">Guardar</button>`}
        ${c && !ro ? `<button id="np">Nuevo presupuesto</button><button id="del" class="danger">Borrar cliente</button>` : ""}
        <button id="back">Volver</button>
      </div>
    </div>
    ${c ? `
    <div class="card"><h3>Vehículos e historial de mantenimiento</h3>
      ${vehs.map(v => `
        <div class="veh" data-v="${v.id}">
          <input data-f="vehiculo" value="${esc(v.vehiculo)}" placeholder="Marca y modelo" ${dis}>
          <input data-f="matricula" value="${esc(v.matricula)}" placeholder="Matrícula" ${dis}>
          <input data-f="anio" type="number" value="${v.anio ?? ""}" placeholder="Año" ${dis}>
          ${ro ? "" : `<button data-vs>Guardar</button><button data-vd class="danger">×</button>`}
        </div>
        <div class="histbox">${histo(quotes.filter(p => p.vehiculo_id === v.id))}</div>`).join("") || "<small>Aún no hay vehículos.</small>"}
      ${sinVeh.length ? `<div class="veh"><b>Otros presupuestos (sin vehículo)</b></div><div class="histbox">${histo(sinVeh)}</div>` : ""}
      ${ro ? "" : `
      <h4 style="margin:1.2rem 0 0">➕ Añadir otro vehículo a este cliente</h4>
      <p class="hint">Si ya es cliente y trae un coche nuevo, ponlo aquí. Quedará guardado para sus próximos presupuestos.</p>
      <div class="veh" id="addv">
        <input id="nv-v" placeholder="Marca y modelo (Ej.: Seat León)"><input id="nv-m" placeholder="Matrícula"><input id="nv-a" type="number" placeholder="Año">
        <button id="addvb" class="primary">Añadir vehículo</button>
      </div>`}
    </div>` : ""}`;
    bind();
  };

  const bind = () => {
    $app.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { s[el.dataset.k] = el.value; });
    $app.querySelectorAll("[data-nf]").forEach(el => el.oninput = () => { s.vehs[+el.closest("[data-nv]").dataset.nv][el.dataset.nf] = el.value; });
    $app.querySelectorAll("[data-nvd]").forEach(el => el.onclick = () => { s.vehs.splice(+el.dataset.nvd, 1); render(); });
    const anv = document.getElementById("addnv"); if (anv) anv.onclick = () => { s.vehs.push({ vehiculo: "", matricula: "", anio: "" }); render(); };
    document.getElementById("back").onclick = viewClients;
    $app.querySelectorAll("[data-q]").forEach(el => el.onclick = () => openQuote(quotes.find(p => p.id === el.dataset.q), () => viewClient(c)));
    const save = document.getElementById("save");
    if (save) save.onclick = async () => {
      if (!s.nombre.trim()) return aviso("Falta el nombre del cliente");
      const row = { nombre: s.nombre.trim(), apellidos: s.apellidos.trim(), telefono: s.telefono, email: s.email, notas: s.notas };
      if (c) {
        const { error } = await db.from("clientes").update(row).eq("id", c.id);
        if (error) return ko(error.message);
        ok("Cliente guardado"); viewClients();
      } else {
        const { data, error } = await db.from("clientes").insert(row).select().single();
        if (error) return ko(error.message);
        const vs = s.vehs.filter(v => v.vehiculo.trim() || v.matricula.trim())
          .map(v => ({ cliente_id: data.id, vehiculo: v.vehiculo.trim(), matricula: v.matricula.trim(), anio: v.anio ? +v.anio : null }));
        if (vs.length) { const r = await db.from("vehiculos").insert(vs); if (r.error) ko("El cliente se creó, pero falló al guardar un vehículo: " + r.error.message); }
        ok(vs.length ? `Cliente creado con ${vs.length} vehículo${vs.length > 1 ? "s" : ""}` : "Cliente creado");
        viewClient(data);
      }
    };
    if (!c || ro) return;
    document.getElementById("np").onclick = () => viewForm(null, { cliente_id: c.id }, () => viewClient(c));
    document.getElementById("del").onclick = async () => {
      if (!(await confirmar("¿Borrar este cliente?", "Se borrarán también sus vehículos. Sus presupuestos se conservan."))) return;
      const { error } = await db.from("clientes").delete().eq("id", c.id);
      if (error) return ko(error.message); viewClients();
    };
    document.getElementById("addvb").onclick = async () => {
      const v = document.getElementById("nv-v").value.trim(), m = document.getElementById("nv-m").value.trim(), a = document.getElementById("nv-a").value;
      if (!v && !m) return aviso("Pon marca y modelo o la matrícula");
      const { error } = await db.from("vehiculos").insert({ cliente_id: c.id, vehiculo: v, matricula: m, anio: a ? +a : null });
      if (error) return ko(error.message); viewClient(c);
    };
    $app.querySelectorAll(".veh[data-v]").forEach(box => {
      const id = box.dataset.v;
      const val = f => box.querySelector(`[data-f=${f}]`).value;
      box.querySelector("[data-vs]").onclick = async () => {
        const { error } = await db.from("vehiculos").update({ vehiculo: val("vehiculo"), matricula: val("matricula"), anio: val("anio") ? +val("anio") : null }).eq("id", id);
        error ? ko(error.message) : ok("Vehículo guardado");
      };
      box.querySelector("[data-vd]").onclick = async () => {
        if (!(await confirmar("¿Borrar este vehículo?", "Sus presupuestos se conservan."))) return;
        const { error } = await db.from("vehiculos").delete().eq("id", id);
        if (error) return ko(error.message); viewClient(c);
      };
    });
  };
  render();
}

// ---------- Presupuesto ----------
async function viewForm(p = null, pre = {}, back = viewList) {
  if (!session) return viewAuth();
  $nav.hidden = false; tab(p ? "list" : "new");
  loading();
  const [rc, rv, rh] = await Promise.all([
    db.from("clientes").select("*").eq("user_id", me()).order("nombre").limit(2000),
    db.from("vehiculos").select("*").eq("user_id", me()).limit(5000),
    db.from("presupuestos").select("id,numero,created_at,cliente,vehiculo,km,lineas").eq("user_id", me()).order("created_at", { ascending: false }).limit(500)]);
  if (rc.error) return fail(rc.error);
  const clientes = rc.data, vehiculos = rv.data || [];
  const hist = (rh.data || []).filter(q => q.id !== p?.id);
  // última vez que se usó cada trabajo / pieza (la lista está de más reciente a más antigua)
  const previas = new Map();
  hist.forEach(q => (q.lineas || []).forEach(l => {
    const k = (l.tipo === "pieza" ? "p|" : "m|") + norm(l.desc).trim();
    if (String(l.desc).trim() && !previas.has(k)) previas.set(k, l);
  }));
  const sugerencias = tipo => [...previas.entries()].filter(([k]) => k.startsWith(tipo === "pieza" ? "p|" : "m|")).map(([, l]) => l.desc).slice(0, 300);
  const s = p ? { ...structuredClone(p), cliente_id: p.cliente_id || "", vehiculo_id: p.vehiculo_id || "", km: p.km ?? "", margen: p.margen ?? 0 }
    : { cliente_id: pre.cliente_id || "", vehiculo_id: "", km: "", notas: "", margen: perfil.margen_defecto ?? 0, estado: "pendiente", lineas: [{ tipo: "mano_obra", desc: "", cant: 1, precio: perfil.precio_hora ?? 0 }] };
  s.nc = { nombre: "", apellidos: "", telefono: "", email: "" };
  s.nv = { vehiculo: "", matricula: "", anio: "" };
  if (!p && s.cliente_id) { const vs = vehiculos.filter(v => v.cliente_id === s.cliente_id); if (vs.length === 1) s.vehiculo_id = vs[0].id; }

  const totalesHtml = () => { const t = calc(s.lineas, s.margen);
    const coste = r2(s.lineas.filter(l => l.tipo === "pieza" && String(l.desc).trim()).reduce((a, l) => a + (+l.cant || 0) * (+l.precio || 0), 0));
    return `Mano de obra ${eur(t.mano)} · Piezas ${eur(t.piezas)}${+s.margen ? ` <small>(coste ${eur(coste)} + ${s.margen} % de margen)</small>` : ""}<br>Total para el cliente <b>${eur(t.total)}</b>`; };

  const anadirLinea = (l, callado = false) => {
    const nl = { tipo: l.tipo === "pieza" ? "pieza" : "mano_obra", desc: l.desc, cant: l.cant, precio: l.precio };
    const vacio = s.lineas.findIndex(x => x.tipo === nl.tipo && !String(x.desc).trim());
    if (vacio >= 0) s.lineas[vacio] = nl; else s.lineas.push(nl);
    if (!callado) { render(); ok("Línea añadida"); }
  };
  const drawHist = () => {
    const box = document.getElementById("hres"); if (!box) return;
    const ks = claves(s.hq || ""); if (!ks.length) { box.innerHTML = ""; return; }
    const res = hist.map(q => ({ q, ls: (q.lineas || []).map((l, i) => [l, i]).filter(([l]) => { const d = norm(l.desc); return ks.every(k => d.includes(k)); }) }))
      .filter(r => r.ls.length).slice(0, 8);
    box.innerHTML = res.length ? res.map(({ q, ls }) => {
      const ok = new Set(ls.map(([, i]) => i));
      return `
      <div class="hres-q"><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem"><span><b>#${q.numero}</b> · ${fecha(q.created_at)} · ${esc(q.cliente)}${q.vehiculo ? " · " + esc(q.vehiculo) : ""}${q.km != null ? " · " + q.km.toLocaleString("es-ES") + " km" : ""}</span>
        <button data-hqall="${q.id}">Añadir todo</button></div>
      ${(q.lineas || []).map((l, i) => `<div class="hres-l ${ok.has(i) ? "coincide" : ""}"><span>${l.tipo === "pieza" ? "⚙️" : "🔧"} ${esc(l.desc)} <small>· ${l.cant} ${l.tipo === "pieza" ? "ud" : "h"} × ${eur(l.precio)}${l.tipo === "pieza" ? " (coste)" : ""}</small></span><button data-hq="${q.id}:${i}">Añadir</button></div>`).join("")}
      </div>`; }).join("") : `<p class="hint">No hay nada parecido en tus presupuestos anteriores.</p>`;
    box.querySelectorAll("[data-hq]").forEach(b => b.onclick = () => { const [qid, i] = b.dataset.hq.split(":"); anadirLinea(hist.find(x => x.id === qid).lineas[+i]); });
    box.querySelectorAll("[data-hqall]").forEach(b => b.onclick = () => { const q = hist.find(x => x.id === b.dataset.hqall); q.lineas.forEach(l => anadirLinea(l, true)); render(); ok(`${q.lineas.length} líneas añadidas`); });
  };
  const impLinea = l => r2((+l.cant || 0) * pvp(l, s.margen));
  const filaLinea = (l, i) => l.tipo === "pieza" ? `
    <div class="lin lin-pz">
      <div class="d"><label>Pieza o recambio</label><input data-i="${i}" data-l="desc" list="dl-pieza" placeholder="Ej.: Pastillas de freno delanteras" value="${esc(l.desc)}"></div>
      <div><label>Unidades</label><input data-i="${i}" data-l="cant" type="number" step="any" min="0" value="${l.cant}"></div>
      <div><label>Coste por unidad (€)</label><input data-i="${i}" data-l="precio" type="number" step="any" min="0" value="${l.precio}"></div>
      <div><label>Precio al cliente por unidad</label><output data-pvp="${i}">${eur(pvp(l, s.margen))}</output></div>
      <div><label>Importe</label><output data-imp="${i}">${eur(impLinea(l))}</output></div>
      <button data-del="${i}" class="danger" title="Quitar esta pieza">×</button>
    </div>` : `
    <div class="lin lin-mo">
      <div class="d"><label>Trabajo realizado</label><input data-i="${i}" data-l="desc" list="dl-mano_obra" placeholder="Ej.: Cambio de pastillas de freno" value="${esc(l.desc)}"></div>
      <div><label>Horas</label><input data-i="${i}" data-l="cant" type="number" step="any" min="0" value="${l.cant}"></div>
      <div><label>Precio por hora (€)</label><input data-i="${i}" data-l="precio" type="number" step="any" min="0" value="${l.precio}"></div>
      <div><label>Importe</label><output data-imp="${i}">${eur(impLinea(l))}</output></div>
      <button data-del="${i}" class="danger" title="Quitar este trabajo">×</button>
    </div>`;
  const seccionLineas = tipo => {
    const pz = tipo === "pieza";
    const filas = s.lineas.map((l, i) => [l, i]).filter(([l]) => (l.tipo === "pieza") === pz);
    return `<div class="seccion">
      <h4>${pz ? "⚙️ Piezas" : "🔧 Mano de obra"}</h4>
      <p class="hint">${pz ? "Pon lo que te cuesta cada pieza: el margen se suma solo y al cliente solo le sale el precio final." : "Horas trabajadas y lo que cobras por hora."}</p>
      ${filas.map(([l, i]) => filaLinea(l, i)).join("") || `<p class="hint">${pz ? "Sin piezas todavía." : "Sin mano de obra todavía."}</p>`}
      <button data-add="${tipo}">${pz ? "+ Añadir pieza" : "+ Añadir mano de obra"}</button>
      <datalist id="dl-${tipo}">${sugerencias(tipo).map(d => `<option value="${esc(d)}">`).join("")}</datalist>
    </div>`;
  };

  const render = () => {
    const vs = vehiculos.filter(v => v.cliente_id === s.cliente_id);
    const legacy = p && !p.cliente_id && p.cliente ? `<small>Presupuesto antiguo sin ficha: ${esc(p.cliente)} ${esc(p.vehiculo)} ${esc(p.matricula)}</small>` : "";
    $app.innerHTML = `
    <div class="cols">
    <div class="card">
      <h3>${p ? "Presupuesto #" + p.numero : "Nuevo presupuesto"}</h3>
      <label>Cliente *</label>
      <select data-r="cliente_id">
        <option value="">— Elige un cliente de tu lista o crea uno nuevo —</option>
        ${clientes.map(c => `<option value="${c.id}" ${s.cliente_id === c.id ? "selected" : ""}>${esc(nombreC(c))}${c.telefono ? " · " + esc(c.telefono) : ""}</option>`).join("")}
        <option value="new" ${s.cliente_id === "new" ? "selected" : ""}>➕ Nuevo cliente…</option>
      </select>
      ${legacy}
      ${s.cliente_id === "new" ? `
        <div class="row">
          <div><label>Nombre del cliente *</label><input data-n="nombre" placeholder="Ej.: María" value="${esc(s.nc.nombre)}"></div>
          <div><label>Apellidos</label><input data-n="apellidos" value="${esc(s.nc.apellidos)}"></div>
        </div>
        <div class="row">
          <div><label>Teléfono</label><input data-n="telefono" type="tel" value="${esc(s.nc.telefono)}"></div>
          <div><label>Email</label><input data-n="email" type="email" value="${esc(s.nc.email)}"></div>
        </div>` : ""}
      ${s.cliente_id && s.cliente_id !== "new" ? `
        <label>Coche del cliente</label>
        <select data-r="vehiculo_id">
          <option value="">— Sin vehículo —</option>
          ${vs.map(v => `<option value="${v.id}" ${s.vehiculo_id === v.id ? "selected" : ""}>${esc(v.vehiculo)} ${esc(v.matricula)}</option>`).join("")}
          <option value="new" ${s.vehiculo_id === "new" ? "selected" : ""}>➕ Nuevo vehículo…</option>
        </select>` : ""}
      ${s.cliente_id === "new" || s.vehiculo_id === "new" ? `
        <div class="row">
          <div><label>Coche (marca y modelo)</label><input data-m="vehiculo" placeholder="Ej.: Renault Clio" value="${esc(s.nv.vehiculo)}"></div>
          <div><label>Matrícula</label><input data-m="matricula" placeholder="Ej.: 1234 ABC" value="${esc(s.nv.matricula)}"></div>
          <div><label>Año</label><input data-m="anio" type="number" value="${esc(s.nv.anio)}"></div>
        </div>` : ""}
      <div class="row">
        <div><label>Kilómetros del coche</label><input data-k="km" type="number" min="0" placeholder="Los del cuentakilómetros" value="${s.km}"></div>
        <div><label>Margen sobre las piezas (%)</label><input data-k="margen" type="number" step="any" min="0" placeholder="Ej.: 20" value="${s.margen}"></div>
        <div><label>Estado del presupuesto</label><select data-k="estado">${["pendiente", "aceptado", "rechazado"].map(e => `<option ${s.estado === e ? "selected" : ""}>${e}</option>`).join("")}</select></div>
      </div>
      <p class="hint">Margen: porcentaje que sumas al coste de cada pieza. Estado: pendiente = el cliente aún no ha contestado. Cuando termines el trabajo, pulsa «Cerrar presupuesto».</p>
      <label>Observaciones para el cliente</label><textarea data-k="notas" rows="3" placeholder="Salen en el PDF. Ej.: garantía 12 meses, plazo de entrega…">${esc(s.notas)}</textarea>
    </div>
    <div class="card">
      ${seccionLineas("mano_obra")}
      ${seccionLineas("pieza")}
      <div class="seccion">
        <h4>🔎 Buscar en tus presupuestos anteriores</h4>
        <p class="hint">Escribe un trabajo o pieza (aceite, neumáticos, frenos…) y reutiliza lo que hiciste y cobraste otras veces.</p>
        <input id="hq" placeholder="Ej.: cambio de aceite" value="${esc(s.hq || "")}">
        <div id="hres"></div>
      </div>
      <p class="tot" id="tot">${totalesHtml()}</p>
      <div class="actions no-print">
        <button class="primary" id="save">Guardar</button>
        ${p ? `<button id="print">PDF / Factura</button><button id="close" class="cerrar" title="Úsalo cuando el trabajo ya esté hecho">✅ Cerrar presupuesto</button><button id="dup">Duplicar</button><button id="del" class="danger">Borrar</button>` : ""}
        <button id="back">Volver</button>
      </div>
    </div>
    </div>`;
    bind();
  };

  const bind = () => {
    const upd = () => {
      document.getElementById("tot").innerHTML = totalesHtml();
      s.lineas.forEach((l, i) => {
        const imp = $app.querySelector(`[data-imp="${i}"]`), pv = $app.querySelector(`[data-pvp="${i}"]`);
        if (imp) imp.textContent = eur(impLinea(l));
        if (pv) pv.textContent = eur(pvp(l, s.margen));
      });
    };
    $app.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { s[el.dataset.k] = el.value; upd(); });
    $app.querySelectorAll("[data-n]").forEach(el => el.oninput = () => { s.nc[el.dataset.n] = el.value; });
    $app.querySelectorAll("[data-m]").forEach(el => el.oninput = () => { s.nv[el.dataset.m] = el.value; });
    $app.querySelectorAll("[data-l]").forEach(el => el.oninput = () => { s.lineas[el.dataset.i][el.dataset.l] = el.value; upd(); });
    $app.querySelectorAll('[data-l="desc"]').forEach(el => el.onchange = () => {
      const l = s.lineas[+el.dataset.i], prev = previas.get((l.tipo === "pieza" ? "p|" : "m|") + norm(l.desc).trim());
      if (!prev || +l.precio) return; // solo rellena si aún no has puesto precio
      l.cant = prev.cant; l.precio = prev.precio;
      $app.querySelector(`[data-i="${el.dataset.i}"][data-l="cant"]`).value = l.cant;
      $app.querySelector(`[data-i="${el.dataset.i}"][data-l="precio"]`).value = l.precio;
      upd(); info("Rellenado con tu último precio de esto");
    });
    const hq = document.getElementById("hq"); hq.oninput = () => { s.hq = hq.value; drawHist(); }; drawHist();
    $app.querySelectorAll("[data-r]").forEach(el => el.onchange = () => {
      s[el.dataset.r] = el.value;
      if (el.dataset.r === "cliente_id") {
        const vs = vehiculos.filter(v => v.cliente_id === el.value);
        s.vehiculo_id = vs.length === 1 ? vs[0].id : "";
      }
      render();
    });
    $app.querySelectorAll("[data-del]").forEach(el => el.onclick = () => { s.lineas.splice(el.dataset.del, 1); render(); });
    $app.querySelectorAll("[data-add]").forEach(el => el.onclick = () => { s.lineas.push({ tipo: el.dataset.add, desc: "", cant: 1, precio: el.dataset.add === "mano_obra" ? (perfil.precio_hora ?? 0) : 0 }); render(); });
    document.getElementById("back").onclick = back;
    document.getElementById("save").onclick = () => guardar();
    if (p) {
      document.getElementById("print").onclick = () => viewPrint(p, { ...p, lineas: s.lineas, margen: s.margen, notas: s.notas, km: s.km === "" ? null : +s.km }, calc(s.lineas, s.margen), () => viewForm(p, {}, back));
      document.getElementById("close").onclick = async () => {
        if (!(await confirmar("¿Cerrar este presupuesto?", "Úsalo cuando el trabajo ya esté hecho. Se guardarán los cambios y quedará bloqueado; podrás reabrirlo si hace falta.", "Sí, cerrar", false))) return;
        guardar({ cerrar: true });
      };
      document.getElementById("dup").onclick = () => { p = null; s.estado = "pendiente"; render(); info("Copia lista: revisa y pulsa Guardar"); };
      document.getElementById("del").onclick = async () => {
        if (!(await confirmar("¿Borrar este presupuesto?", "Esta acción no se puede deshacer."))) return;
        const { error } = await db.from("presupuestos").delete().eq("id", p.id);
        if (error) return ko(error.message); back();
      };
    }
  };

  const guardar = async (opts = {}) => {
    if (opts.cerrar && !s.lineas.some(l => String(l.desc).trim())) return aviso("Añade al menos una línea antes de cerrar");
    let cli = null, veh = null, cid = s.cliente_id, vid = s.vehiculo_id;
    if (cid === "new") {
      if (!s.nc.nombre.trim()) return aviso("Falta el nombre del cliente");
      const { data, error } = await db.from("clientes").insert({ nombre: s.nc.nombre.trim(), apellidos: s.nc.apellidos.trim(), telefono: s.nc.telefono, email: s.nc.email }).select().single();
      if (error) return ko(error.message);
      cli = data; cid = data.id; clientes.push(data);
    } else if (cid) cli = clientes.find(c => c.id === cid);
    else if (!(p && p.cliente)) return aviso("Elige un cliente o crea uno nuevo");

    const nuevoVeh = vid === "new" || (s.cliente_id === "new" && (s.nv.vehiculo.trim() || s.nv.matricula.trim()));
    if (nuevoVeh) {
      if (!s.nv.vehiculo.trim() && !s.nv.matricula.trim()) return aviso("Pon marca y modelo o la matrícula del vehículo");
      const { data, error } = await db.from("vehiculos").insert({ cliente_id: cid, vehiculo: s.nv.vehiculo.trim(), matricula: s.nv.matricula.trim(), anio: s.nv.anio ? +s.nv.anio : null }).select().single();
      if (error) return ko(error.message);
      veh = data; vid = data.id; vehiculos.push(data);
    } else if (vid) veh = vehiculos.find(v => v.id === vid);

    const row = {
      cliente_id: cid || null, vehiculo_id: vid || null, km: s.km === "" ? null : +s.km,
      cliente: cli ? nombreC(cli) : p.cliente, telefono: cli ? cli.telefono : p?.telefono,
      vehiculo: veh ? veh.vehiculo : (cli ? "" : p?.vehiculo), matricula: veh ? veh.matricula : (cli ? "" : p?.matricula),
      notas: s.notas, estado: opts.cerrar ? "cerrado" : s.estado, margen: +s.margen || 0, iva: 0,
      ...(opts.cerrar ? { cerrado_at: new Date().toISOString() } : {}),
      ...(p && p.taller ? {} : { taller: taller(), taller_datos: datosTallerTxt() }),
      lineas: s.lineas.filter(l => String(l.desc).trim()).map(l => ({ ...l, cant: +l.cant || 0, precio: +l.precio || 0 })),
      total: calc(s.lineas, s.margen).total
    };
    const { error } = p ? await db.from("presupuestos").update(row).eq("id", p.id) : await db.from("presupuestos").insert(row);
    if (error) return ko(error.message);
    ok(opts.cerrar ? "Presupuesto cerrado ✅" : p ? "Presupuesto guardado" : "Presupuesto creado"); back();
  };
  render();
}

// ---------- PDF y WhatsApp ----------
const slug = t => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const eurPdf = n => eur(n).replace(/ /g, " ");

function buildPdf(p, s, tipo) {
  if (!window.jspdf) throw new Error("No se pudo cargar el generador de PDF. Revisa la conexión.");
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const rows = lineasCliente(s.lineas, s.margen), t = calc(s.lineas, s.margen);
  let y = 18;
  doc.setFont("helvetica", "bold").setFontSize(18).text(s.taller || taller(), 14, y);
  doc.setFont("helvetica", "normal").setFontSize(9);
  lineasDatos(s.taller_datos ?? datosTallerTxt()).forEach(d => { y += 5; doc.text(String(d), 14, y); });
  doc.setFont("helvetica", "bold").setFontSize(16).text(`${tipo.toUpperCase()} Nº ${p.numero}`, 196, 18, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10).text(fecha(p.created_at), 196, 25, { align: "right" });
  y = Math.max(y, 25) + 12;
  doc.setFont("helvetica", "bold").setFontSize(11).text("Cliente", 14, y);
  doc.setFont("helvetica", "normal").setFontSize(10);
  const datos = [s.cliente, s.telefono, [s.vehiculo, s.matricula].filter(Boolean).join(" · "), s.km != null && s.km !== "" ? Number(s.km).toLocaleString("es-ES") + " km" : ""].filter(Boolean);
  datos.forEach(d => { y += 5; doc.text(String(d), 14, y); });
  doc.autoTable({
    startY: y + 8, head: [["Descripción", "Cant.", "Precio", "Importe"]],
    body: rows.map(r => [r.desc, String(r.cant).replace(".", ","), eurPdf(r.precio), eurPdf(r.importe)]),
    styles: { fontSize: 10, cellPadding: 2.5 }, headStyles: { fillColor: [31, 79, 216] },
    columnStyles: { 1: { halign: "right", cellWidth: 20 }, 2: { halign: "right", cellWidth: 32 }, 3: { halign: "right", cellWidth: 32 } }
  });
  y = doc.lastAutoTable.finalY + 10;
  doc.setFont("helvetica", "bold").setFontSize(14).text(`TOTAL: ${eurPdf(t.total)}`, 196, y, { align: "right" });
  if (s.notas) { doc.setFont("helvetica", "normal").setFontSize(10).text(doc.splitTextToSize(String(s.notas), 182), 14, y + 10); }
  return doc;
}

function telWhatsApp(tel) {
  let d = String(tel || "").replace(/\D/g, "").replace(/^00/, "");
  if (d.length === 9) d = (window.CONFIG.PREFIJO_TEL || "34") + d;
  return d;
}

async function enviarWhatsApp(p, s, tipo) {
  let doc;
  try { doc = buildPdf(p, s, tipo); } catch (e) { return ko(e.message); }
  const t = calc(s.lineas, s.margen), name = `${slug(tipo)}-${p.numero}-${slug(s.cliente)}.pdf`;
  const texto = `Hola ${s.cliente}, te envío tu ${tipo.toLowerCase()} nº ${p.numero} de ${s.taller || taller()}. Total: ${eurPdf(t.total)}. Gracias.`;
  const file = new File([doc.output("blob")], name, { type: "application/pdf" });
  // Móvil: se comparte el PDF directamente (aparece WhatsApp en la lista)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: texto }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  // Ordenador: WhatsApp Web no permite adjuntar por enlace → se descarga el PDF y se abre el chat con el mensaje
  doc.save(name);
  const tel = telWhatsApp(s.telefono);
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  info("PDF descargado. Arrástralo al chat de WhatsApp para enviarlo.", 6000);
}

// ---------- Vista de documento (imprimir / PDF / WhatsApp / solo lectura) ----------
function viewPrint(p, s, t, back = viewList, extra = null) {
  if (!session) return viewAuth();
  $nav.hidden = false; tab("list");
  let tipo = ["aceptado", "cerrado"].includes(p.estado) ? "Factura" : "Presupuesto";
  const rows = lineasCliente(s.lineas, s.margen);
  const datos = lineasDatos(s.taller_datos ?? datosTallerTxt()).map(esc).join("<br>");
  const render = () => {
    $app.innerHTML = `
    <div class="card doc">
      <div class="row" style="align-items:flex-start;justify-content:space-between">
        <div><h2 style="margin:0">${esc(s.taller || taller())}</h2><small>${datos}</small></div>
        <div class="right"><h2 style="margin:0">${tipo} nº ${p.numero}</h2>${fecha(p.created_at)}${p.estado === "cerrado" ? `<br><span class="tag cerrado">cerrado el ${fecha(p.cerrado_at || p.created_at)}</span>` : ""}</div>
      </div>
      <p><b>${esc(s.cliente)}</b> ${esc(s.telefono)}<br>${esc(s.vehiculo)} ${esc(s.matricula)}${s.km != null && s.km !== "" ? " · " + Number(s.km).toLocaleString("es-ES") + " km" : ""}</p>
      <table><tr><th>Descripción</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.desc)}</td><td class="n">${r.cant}</td><td class="n">${eur(r.precio)}</td><td class="n">${eur(r.importe)}</td></tr>`).join("")}
      </table>
      <p class="tot">Total <b>${eur(t.total)}</b></p>
      ${s.notas ? `<p>${esc(s.notas)}</p>` : ""}
      <div class="actions no-print">
        <select id="tipo" style="width:auto"><option ${tipo === "Presupuesto" ? "selected" : ""}>Presupuesto</option><option ${tipo === "Factura" ? "selected" : ""}>Factura</option></select>
        <button class="primary" id="pdf">Descargar PDF</button>
        <button id="wa">Enviar por WhatsApp</button>
        <button id="prt">Imprimir</button>
        ${extra?.reabrir ? `<button id="reab">Reabrir presupuesto</button>` : ""}
        <button id="b">Volver</button>
      </div>
    </div>`;
    document.getElementById("tipo").onchange = e => { tipo = e.target.value; render(); };
    document.getElementById("pdf").onclick = () => { try { buildPdf(p, s, tipo).save(`${slug(tipo)}-${p.numero}-${slug(s.cliente)}.pdf`); } catch (e) { ko(e.message); } };
    document.getElementById("wa").onclick = () => enviarWhatsApp(p, s, tipo);
    document.getElementById("prt").onclick = () => print();
    document.getElementById("b").onclick = back;
    if (extra?.reabrir) document.getElementById("reab").onclick = extra.reabrir;
  };
  render();
}

// ---------- Inicio: resumen con gráficos ----------
let graficos = [], periodo = "12m";
const PERIODOS = [["mes", "Este mes"], ["3m", "Últimos 3 meses"], ["anio", "Este año"], ["12m", "Últimos 12 meses"], ["todo", "Todo"]];
const desdeFecha = p => { const d = new Date(); return p === "mes" ? new Date(d.getFullYear(), d.getMonth(), 1) : p === "3m" ? new Date(d.getFullYear(), d.getMonth() - 2, 1) : p === "anio" ? new Date(d.getFullYear(), 0, 1) : p === "12m" ? new Date(d.getFullYear(), d.getMonth() - 11, 1) : new Date(0); };
const modoOscuro = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const paleta = () => modoOscuro()
  ? { ing: "#5b86ff", gas: "#f59e0b", gan: "#34d399", txt: "#e8eaf0", rej: "#f87171", sin: "#9aa3b2", grid: "#2c3240" }
  : { ing: "#1f4fd8", gas: "#d97706", gan: "#15803d", txt: "#1b1f27", rej: "#b91c1c", sin: "#6b7280", grid: "#e2e5ea" };

async function viewHome() {
  if (!session) return viewAuth();
  $nav.hidden = false; tab("home");
  graficos.forEach(g => g.destroy()); graficos = [];
  loading();
  const r = await db.from("presupuestos").select("id,user_id,email,estado,total,lineas,margen,created_at,cerrado_at").limit(5000);
  if (r.error) return fail(r.error);
  const data = r.data, admin = isAdmin();
  const desde = desdeFecha(periodo);
  const cerrados = data.filter(q => q.estado === "cerrado" && new Date(q.cerrado_at || q.created_at) >= desde).map(q => ({ q, d: desglose(q) }));
  const suma = (arr, f) => r2(arr.reduce((a, x) => a + f(x), 0));
  const ing = suma(cerrados, x => x.d.total), gas = suma(cerrados, x => x.d.coste), gan = r2(ing - gas);
  const por = e => data.filter(q => q.estado === e);
  const pend = por("pendiente"), acep = por("aceptado"), rech = por("rechazado"), cerr = por("cerrado");
  const tot = arr => suma(arr, q => desglose(q).total);

  $app.innerHTML = `
  <div class="row" style="justify-content:space-between;align-items:end">
    <div><h2 style="margin:0">Resumen${admin ? " de todos los mecánicos" : ""}</h2>
    <p class="hint" style="margin:.2rem 0 0">El dinero cuenta los presupuestos <b>cerrados</b> (trabajo ya hecho).</p></div>
    <select id="per" style="width:auto;flex:0 0 auto">${PERIODOS.map(([v, t]) => `<option value="${v}" ${periodo === v ? "selected" : ""}>${t}</option>`).join("")}</select>
  </div>
  <div class="kpis">
    <div class="kpi"><span>Ingresos</span><b>${eur(ing)}</b><small>lo facturado en trabajos cerrados</small></div>
    <div class="kpi"><span>Gastos en piezas</span><b>${eur(gas)}</b><small>lo que costaron las piezas</small></div>
    <div class="kpi gan"><span>Ganancia</span><b>${eur(gan)}</b><small>ingresos − gastos</small></div>
    <div class="kpi"><span>Pendientes</span><b>${pend.length}</b><small>${eur(tot(pend))} esperando respuesta</small></div>
    <div class="kpi"><span>Aceptados por cerrar</span><b>${acep.length}</b><small>${eur(tot(acep))} por hacer</small></div>
    <div class="kpi"><span>Cerrados</span><b>${cerrados.length}</b><small>en este periodo</small></div>
  </div>
  <div class="charts" id="charts-home">
    <div class="card wide"><h4>Ingresos, gastos y ganancia por mes</h4><div class="cv"><canvas id="c1"></canvas></div></div>
    <div class="card"><h4>Presupuestos por estado</h4><div class="cv"><canvas id="c2"></canvas></div></div>
    <div class="card"><h4>De dónde viene el dinero</h4>${cerrados.length ? `<div class="cv"><canvas id="c3"></canvas></div>` : `<p class="hint">Cuando cierres presupuestos verás aquí cuánto es mano de obra, piezas y margen.</p>`}</div>
    ${admin ? `<div class="card wide"><h4>Ingresos por mecánico</h4>${cerrados.length ? `<div class="cv"><canvas id="c4"></canvas></div>` : `<p class="hint">Sin trabajos cerrados en este periodo.</p>`}</div>` : ""}
  </div>
  ${data.length ? "" : `<p class="hint">Aún no hay presupuestos. Crea el primero con «＋ Nuevo»; cuando termines el trabajo, ciérralo y aparecerá en estos números.</p>`}`;
  document.getElementById("per").onchange = e => { periodo = e.target.value; viewHome(); };
  if (!window.Chart) return;

  const c = paleta();
  Chart.defaults.color = c.txt; Chart.defaults.borderColor = c.grid; Chart.defaults.font.family = "system-ui, sans-serif";
  const opts = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, ...extra });
  const nuevo = (id, cfg) => { const el = document.getElementById(id); if (el) graficos.push(new Chart(el, cfg)); };
  const monedaY = { y: { beginAtZero: true, ticks: { callback: v => eur(v) } }, x: { grid: { display: false } } };

  // 1) por mes: siempre los últimos 12 meses
  const meses = []; const hoy = new Date();
  for (let i = 11; i >= 0; i--) { const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1); meses.push({ k: d.getFullYear() + "-" + d.getMonth(), t: d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" }), ing: 0, gas: 0 }); }
  data.filter(q => q.estado === "cerrado").forEach(q => { const f = new Date(q.cerrado_at || q.created_at), m = meses.find(x => x.k === f.getFullYear() + "-" + f.getMonth()); if (m) { const d = desglose(q); m.ing += d.total; m.gas += d.coste; } });
  nuevo("c1", { type: "bar", data: { labels: meses.map(m => m.t), datasets: [
    { label: "Ingresos", data: meses.map(m => r2(m.ing)), backgroundColor: c.ing, borderRadius: 4 },
    { label: "Gastos", data: meses.map(m => r2(m.gas)), backgroundColor: c.gas, borderRadius: 4 },
    { label: "Ganancia", data: meses.map(m => r2(m.ing - m.gas)), backgroundColor: c.gan, borderRadius: 4 }] },
    options: opts({ scales: monedaY, plugins: { tooltip: { callbacks: { label: x => `${x.dataset.label}: ${eur(x.parsed.y)}` } } } }) });

  // 2) por estado (ahora mismo)
  const est = [["Pendientes", pend.length, c.gas], ["Aceptados", acep.length, c.ing], ["Cerrados", cerr.length, c.gan], ["Rechazados", rech.length, c.rej]];
  nuevo("c2", { type: "doughnut", data: { labels: est.map(e => e[0]), datasets: [{ data: est.map(e => e[1]), backgroundColor: est.map(e => e[2]), borderWidth: 0 }] },
    options: opts({ cutout: "62%", plugins: { legend: { position: "bottom" } } }) });

  // 3) mano de obra / coste de piezas / margen de piezas (solo cerrados del periodo)
  if (cerrados.length) {
    const mano = suma(cerrados, x => x.d.mano), costeP = gas, margenP = suma(cerrados, x => x.d.venta - x.d.coste);
    nuevo("c3", { type: "doughnut", data: { labels: ["Mano de obra", "Piezas (coste)", "Margen de piezas"], datasets: [{ data: [mano, costeP, margenP], backgroundColor: [c.ing, c.gas, c.gan], borderWidth: 0 }] },
      options: opts({ cutout: "62%", plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: x => `${x.label}: ${eur(x.parsed)}` } } } }) });
  }

  // 4) admin: por mecánico
  if (admin && cerrados.length) {
    const g = {}; cerrados.forEach(({ q, d }) => { const k = q.email || "?"; g[k] = g[k] || { ing: 0, gan: 0 }; g[k].ing += d.total; g[k].gan += d.ganancia; });
    const ks = Object.keys(g).sort((a, b) => g[b].ing - g[a].ing);
    nuevo("c4", { type: "bar", data: { labels: ks, datasets: [{ label: "Ingresos", data: ks.map(k => r2(g[k].ing)), backgroundColor: c.ing, borderRadius: 4 }, { label: "Ganancia", data: ks.map(k => r2(g[k].gan)), backgroundColor: c.gan, borderRadius: 4 }] },
      options: opts({ indexAxis: "y", scales: { x: { beginAtZero: true, ticks: { callback: v => eur(v) } }, y: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: x => `${x.dataset.label}: ${eur(x.parsed.x)}` } } } }) });
  }
}

// ---------- Perfil ----------
async function cargarPerfil() {
  const r = await db.from("perfiles").select("*").eq("user_id", me()).maybeSingle();
  perfil = r.data || {};
  aplicarMarca();
}

function viewPerfil() {
  if (!session) return viewAuth();
  $nav.hidden = false; tab("profile");
  const p = { taller: perfil.taller || "", datos: perfil.datos || "", margen_defecto: perfil.margen_defecto ?? "", precio_hora: perfil.precio_hora ?? "" };
  $app.innerHTML = `
  <div class="cols">
    <div>
      <div class="card">
        <h3>Mi taller</h3>
        <label>Nombre de tu taller</label>
        <input data-p="taller" placeholder="Ej.: Taller Toni" value="${esc(p.taller)}">
        <p class="hint">Sale arriba en la app y en los PDF que das al cliente. Si lo dejas vacío se usa "${esc(TALLER)}".</p>
        <label>Datos del taller para el PDF</label>
        <textarea data-p="datos" rows="4" placeholder="Un dato por línea. Ej.:&#10;C/ Mayor 1, Madrid&#10;NIF 12345678A&#10;Tel. 600 000 000">${esc(p.datos)}</textarea>
        <p class="hint">Dirección, NIF, teléfono… van bajo el nombre en el PDF. Cada presupuesto guarda los datos que tenías al crearlo, así que los PDF antiguos no cambian.</p>
      </div>
      <div class="card">
        <h3>Valores por defecto</h3>
        <p class="hint">Se rellenan solos en cada presupuesto nuevo y puedes cambiarlos en cada uno. Déjalos vacíos si no quieres usarlos.</p>
        <div class="row">
          <div><label>Margen sobre las piezas (%)</label><input data-p="margen_defecto" type="number" step="any" min="0" placeholder="Ej.: 20" value="${esc(p.margen_defecto)}"></div>
          <div><label>Precio por hora de mano de obra (€)</label><input data-p="precio_hora" type="number" step="any" min="0" placeholder="Ej.: 40" value="${esc(p.precio_hora)}"></div>
        </div>
      </div>
      <div class="actions"><button class="primary" id="psave">Guardar cambios</button></div>
    </div>
    <div>
      <div class="card">
        <h3>Mi cuenta</h3>
        <p>${esc(session.user.email)}${isAdmin() ? ' <span class="tag aceptado">administrador</span>' : ""}</p>
      </div>
      <div class="card">
        <h3>Cambiar contraseña</h3>
        <label>Nueva contraseña</label><input id="pw1" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres">
        <label>Repite la nueva contraseña</label><input id="pw2" type="password" autocomplete="new-password">
        <p class="err" id="pwerr"></p>
        <div class="actions"><button id="pwsave">Cambiar contraseña</button></div>
      </div>
    </div>
  </div>`;
  $app.querySelectorAll("[data-p]").forEach(el => el.oninput = () => { p[el.dataset.p] = el.value; });
  document.getElementById("psave").onclick = async () => {
    const num = v => v === "" || v == null ? null : +v;
    const row = { user_id: me(), taller: p.taller.trim() || null, datos: p.datos.trim() || null, margen_defecto: num(p.margen_defecto), precio_hora: num(p.precio_hora), updated_at: new Date().toISOString() };
    if ((row.margen_defecto != null && (isNaN(row.margen_defecto) || row.margen_defecto < 0)) || (row.precio_hora != null && (isNaN(row.precio_hora) || row.precio_hora < 0))) return aviso("Revisa los números: no pueden ser negativos");
    const { error } = await db.from("perfiles").upsert(row);
    if (error) return ko(error.message);
    perfil = row; aplicarMarca(); ok("Perfil guardado");
  };
  document.getElementById("pwsave").onclick = async () => {
    const a = document.getElementById("pw1").value, b = document.getElementById("pw2").value, err = document.getElementById("pwerr");
    err.textContent = "";
    if (a.length < 8) return err.textContent = "La contraseña debe tener al menos 8 caracteres";
    if (a !== b) return err.textContent = "Las dos contraseñas no coinciden";
    const { error } = await db.auth.updateUser({ password: a });
    if (error) return err.textContent = error.message.includes("same") ? "La nueva contraseña debe ser distinta de la actual" : error.message;
    document.getElementById("pw1").value = document.getElementById("pw2").value = "";
    ok("Contraseña cambiada");
  };
}

// ---------- Arranque ----------
db.auth.onAuthStateChange((_evento, sess) => {
  const antes = session?.user.id; session = sess;
  if (!sess) { perfil = {}; aplicarMarca(); return viewAuth(); }
  if (antes === sess.user.id) return; // refresco de token o vuelta a la pestaña: no tocar lo que estás haciendo
  setTimeout(async () => { await cargarPerfil(); viewHome(); }, 0);
});
viewAuth(); // estado inicial seguro: login hasta confirmar sesión
