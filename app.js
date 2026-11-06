const { SUPABASE_URL, SUPABASE_ANON_KEY, TALLER } = window.CONFIG;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
document.getElementById("brand").textContent = TALLER;
let session = null;

const me = () => session.user.id;
const isAdmin = () => !!session && session.user.email?.toLowerCase() === (window.CONFIG.ADMIN_EMAIL || "").toLowerCase();
const eur = n => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fecha = d => new Date(d).toLocaleDateString("es-ES");
const nombreC = c => [c.nombre, c.apellidos].filter(Boolean).join(" ");
const calc = (lineas, iva) => {
  const base = lineas.reduce((a, l) => a + (+l.cant || 0) * (+l.precio || 0), 0);
  const i = base * (+iva || 0) / 100;
  return { base, iva: i, total: base + i };
};
const toast = m => { const t = document.getElementById("toast"); t.textContent = m; t.className = "show"; setTimeout(() => t.className = "", 2400); };
const loading = () => { $app.innerHTML = "<p>Cargando…</p>"; };
const fail = e => { $app.innerHTML = `<p class="err">${esc(e.message)}</p>`; };

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
  if (g === "list") viewList();
  if (g === "clients") viewClients();
  if (g === "new") viewForm();
};

// Abre un presupuesto: editable si es mío, solo lectura (admin) si es de otro
function openQuote(p, back = viewList) {
  if (p.user_id === me()) return viewForm(p, {}, back);
  viewPrint(p, p, calc(p.lineas, p.iva), back);
}

// ---------- Historial de presupuestos ----------
async function viewList() {
  if (!session) return viewAuth();
  $nav.hidden = false;
  const admin = isAdmin();
  $app.innerHTML = `<input id="q" placeholder="Buscar cliente, matrícula, vehículo${admin ? ", mecánico" : ""}…"><div id="l" style="margin-top:.8rem">Cargando…</div>`;
  const { data, error } = await db.from("presupuestos").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) return fail(error);
  const draw = () => {
    const q = document.getElementById("q").value.toLowerCase();
    const rows = data.filter(p => [p.cliente, p.matricula, p.vehiculo, p.email].join(" ").toLowerCase().includes(q));
    document.getElementById("l").innerHTML = rows.length ? rows.map(p => `
      <div class="card item" data-id="${p.id}">
        <div><b>#${p.numero} · ${esc(p.cliente)}</b><br><small>${esc(p.vehiculo)} ${esc(p.matricula)} · ${fecha(p.created_at)}${admin ? " · <b>" + esc(p.email || "?") + "</b>" : ""}</small></div>
        <div class="right"><b>${eur(p.total)}</b><br><span class="tag ${p.estado}">${p.estado}</span></div>
      </div>`).join("") : "<p>No hay presupuestos.</p>";
    document.querySelectorAll(".item").forEach(el => el.onclick = () => openQuote(data.find(x => x.id === el.dataset.id)));
  };
  document.getElementById("q").oninput = draw; draw();
}

// ---------- Clientes ----------
async function viewClients() {
  if (!session) return viewAuth();
  $nav.hidden = false;
  const admin = isAdmin();
  $app.innerHTML = `<div class="row"><input id="q" placeholder="Buscar nombre, teléfono, matrícula${admin ? ", mecánico" : ""}…"><button id="nc" class="primary" style="flex:0 0 auto">+ Nuevo cliente</button></div><div id="l" style="margin-top:.8rem">Cargando…</div>`;
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
  $nav.hidden = false;
  loading();
  const ro = !!c && c.user_id !== me(); // el admin ve fichas ajenas en solo lectura
  const s = c ? { ...c } : { nombre: "", apellidos: "", telefono: "", email: "", notas: "" };
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
      <div class="veh" id="addv">
        <input id="nv-v" placeholder="Nuevo vehículo: marca y modelo"><input id="nv-m" placeholder="Matrícula"><input id="nv-a" type="number" placeholder="Año">
        <button id="addvb" class="primary">Añadir</button>
      </div>`}
    </div>` : ""}`;
    bind();
  };

  const bind = () => {
    $app.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { s[el.dataset.k] = el.value; });
    document.getElementById("back").onclick = viewClients;
    $app.querySelectorAll("[data-q]").forEach(el => el.onclick = () => openQuote(quotes.find(p => p.id === el.dataset.q), () => viewClient(c)));
    const save = document.getElementById("save");
    if (save) save.onclick = async () => {
      if (!s.nombre.trim()) return toast("Falta el nombre");
      const row = { nombre: s.nombre.trim(), apellidos: s.apellidos.trim(), telefono: s.telefono, email: s.email, notas: s.notas };
      if (c) {
        const { error } = await db.from("clientes").update(row).eq("id", c.id);
        if (error) return toast(error.message);
        toast("Guardado"); viewClients();
      } else {
        const { data, error } = await db.from("clientes").insert(row).select().single();
        if (error) return toast(error.message);
        toast("Cliente creado"); viewClient(data); // se queda para añadir vehículos
      }
    };
    if (!c || ro) return;
    document.getElementById("np").onclick = () => viewForm(null, { cliente_id: c.id }, () => viewClient(c));
    document.getElementById("del").onclick = async () => {
      if (!confirm("¿Borrar este cliente y sus vehículos? Sus presupuestos se conservan.")) return;
      const { error } = await db.from("clientes").delete().eq("id", c.id);
      if (error) return toast(error.message); viewClients();
    };
    document.getElementById("addvb").onclick = async () => {
      const v = document.getElementById("nv-v").value.trim(), m = document.getElementById("nv-m").value.trim(), a = document.getElementById("nv-a").value;
      if (!v && !m) return toast("Pon marca/modelo o matrícula");
      const { error } = await db.from("vehiculos").insert({ cliente_id: c.id, vehiculo: v, matricula: m, anio: a ? +a : null });
      if (error) return toast(error.message); viewClient(c);
    };
    $app.querySelectorAll(".veh[data-v]").forEach(box => {
      const id = box.dataset.v;
      const val = f => box.querySelector(`[data-f=${f}]`).value;
      box.querySelector("[data-vs]").onclick = async () => {
        const { error } = await db.from("vehiculos").update({ vehiculo: val("vehiculo"), matricula: val("matricula"), anio: val("anio") ? +val("anio") : null }).eq("id", id);
        toast(error ? error.message : "Vehículo guardado");
      };
      box.querySelector("[data-vd]").onclick = async () => {
        if (!confirm("¿Borrar este vehículo? Sus presupuestos se conservan.")) return;
        const { error } = await db.from("vehiculos").delete().eq("id", id);
        if (error) return toast(error.message); viewClient(c);
      };
    });
  };
  render();
}

// ---------- Presupuesto ----------
async function viewForm(p = null, pre = {}, back = viewList) {
  if (!session) return viewAuth();
  $nav.hidden = false;
  loading();
  const [rc, rv] = await Promise.all([
    db.from("clientes").select("*").eq("user_id", me()).order("nombre").limit(2000),
    db.from("vehiculos").select("*").eq("user_id", me()).limit(5000)]);
  if (rc.error) return fail(rc.error);
  const clientes = rc.data, vehiculos = rv.data || [];
  const s = p ? { ...structuredClone(p), cliente_id: p.cliente_id || "", vehiculo_id: p.vehiculo_id || "", km: p.km ?? "" }
    : { cliente_id: pre.cliente_id || "", vehiculo_id: "", km: "", notas: "", iva: 21, estado: "pendiente", lineas: [{ tipo: "mano_obra", desc: "", cant: 1, precio: 0 }] };
  s.nc = { nombre: "", apellidos: "", telefono: "", email: "" };
  s.nv = { vehiculo: "", matricula: "", anio: "" };
  // si el cliente solo tiene un vehículo, lo preselecciona
  if (!p && s.cliente_id) { const vs = vehiculos.filter(v => v.cliente_id === s.cliente_id); if (vs.length === 1) s.vehiculo_id = vs[0].id; }

  const render = () => {
    const t = calc(s.lineas, s.iva);
    const vs = vehiculos.filter(v => v.cliente_id === s.cliente_id);
    const legacy = p && !p.cliente_id && p.cliente ? `<small>Presupuesto antiguo sin ficha: ${esc(p.cliente)} ${esc(p.vehiculo)} ${esc(p.matricula)}</small>` : "";
    $app.innerHTML = `
    <div class="card">
      <h3>${p ? "Presupuesto #" + p.numero : "Nuevo presupuesto"}</h3>
      <label>Cliente *</label>
      <select data-r="cliente_id">
        <option value="">— Elegir cliente —</option>
        ${clientes.map(c => `<option value="${c.id}" ${s.cliente_id === c.id ? "selected" : ""}>${esc(nombreC(c))}${c.telefono ? " · " + esc(c.telefono) : ""}</option>`).join("")}
        <option value="new" ${s.cliente_id === "new" ? "selected" : ""}>➕ Nuevo cliente…</option>
      </select>
      ${legacy}
      ${s.cliente_id === "new" ? `
        <div class="row">
          <div><label>Nombre *</label><input data-n="nombre" value="${esc(s.nc.nombre)}"></div>
          <div><label>Apellidos</label><input data-n="apellidos" value="${esc(s.nc.apellidos)}"></div>
        </div>
        <div class="row">
          <div><label>Teléfono</label><input data-n="telefono" type="tel" value="${esc(s.nc.telefono)}"></div>
          <div><label>Email</label><input data-n="email" type="email" value="${esc(s.nc.email)}"></div>
        </div>` : ""}
      ${s.cliente_id && s.cliente_id !== "new" ? `
        <label>Vehículo</label>
        <select data-r="vehiculo_id">
          <option value="">— Sin vehículo —</option>
          ${vs.map(v => `<option value="${v.id}" ${s.vehiculo_id === v.id ? "selected" : ""}>${esc(v.vehiculo)} ${esc(v.matricula)}</option>`).join("")}
          <option value="new" ${s.vehiculo_id === "new" ? "selected" : ""}>➕ Nuevo vehículo…</option>
        </select>` : ""}
      ${s.cliente_id === "new" || s.vehiculo_id === "new" ? `
        <div class="row">
          <div><label>Vehículo (marca y modelo)</label><input data-m="vehiculo" value="${esc(s.nv.vehiculo)}"></div>
          <div><label>Matrícula</label><input data-m="matricula" value="${esc(s.nv.matricula)}"></div>
          <div><label>Año</label><input data-m="anio" type="number" value="${esc(s.nv.anio)}"></div>
        </div>` : ""}
      <div class="row"><div><label>Kilómetros actuales</label><input data-k="km" type="number" min="0" value="${s.km}"></div></div>
      <label>Líneas</label>
      ${s.lineas.map((l, i) => `
        <div class="linea">
          <select data-i="${i}" data-l="tipo"><option value="mano_obra" ${l.tipo === "mano_obra" ? "selected" : ""}>Mano obra</option><option value="pieza" ${l.tipo === "pieza" ? "selected" : ""}>Pieza</option></select>
          <input class="desc" data-i="${i}" data-l="desc" placeholder="Descripción" value="${esc(l.desc)}">
          <input data-i="${i}" data-l="cant" type="number" step="any" min="0" value="${l.cant}" title="Cantidad / horas">
          <input data-i="${i}" data-l="precio" type="number" step="any" min="0" value="${l.precio}" title="Precio unidad">
          <button data-del="${i}" class="danger" title="Quitar">×</button>
        </div>`).join("")}
      <button id="add">+ Añadir línea</button>
      <div class="row">
        <div><label>IVA %</label><input data-k="iva" type="number" step="any" value="${s.iva}"></div>
        <div><label>Estado</label><select data-k="estado">${["pendiente", "aceptado", "rechazado"].map(e => `<option ${s.estado === e ? "selected" : ""}>${e}</option>`).join("")}</select></div>
      </div>
      <label>Notas</label><textarea data-k="notas" rows="3">${esc(s.notas)}</textarea>
      <p class="tot" id="tot">Base ${eur(t.base)} · IVA ${eur(t.iva)}<br>Total <b>${eur(t.total)}</b></p>
      <div class="actions no-print">
        <button class="primary" id="save">Guardar</button>
        ${p ? `<button id="print">Imprimir / PDF</button><button id="dup">Duplicar</button><button id="del" class="danger">Borrar</button>` : ""}
        <button id="back">Volver</button>
      </div>
    </div>`;
    bind();
  };

  const bind = () => {
    const upd = () => document.getElementById("tot").innerHTML = (t => `Base ${eur(t.base)} · IVA ${eur(t.iva)}<br>Total <b>${eur(t.total)}</b>`)(calc(s.lineas, s.iva));
    $app.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { s[el.dataset.k] = el.value; upd(); });
    $app.querySelectorAll("[data-n]").forEach(el => el.oninput = () => { s.nc[el.dataset.n] = el.value; });
    $app.querySelectorAll("[data-m]").forEach(el => el.oninput = () => { s.nv[el.dataset.m] = el.value; });
    $app.querySelectorAll("[data-l]").forEach(el => el.oninput = () => { s.lineas[el.dataset.i][el.dataset.l] = el.value; upd(); });
    $app.querySelectorAll("[data-r]").forEach(el => el.onchange = () => {
      s[el.dataset.r] = el.value;
      if (el.dataset.r === "cliente_id") {
        const vs = vehiculos.filter(v => v.cliente_id === el.value);
        s.vehiculo_id = vs.length === 1 ? vs[0].id : "";
      }
      render();
    });
    $app.querySelectorAll("[data-del]").forEach(el => el.onclick = () => { s.lineas.splice(el.dataset.del, 1); render(); });
    document.getElementById("add").onclick = () => { s.lineas.push({ tipo: "pieza", desc: "", cant: 1, precio: 0 }); render(); };
    document.getElementById("back").onclick = back;
    document.getElementById("save").onclick = guardar;
    if (p) {
      document.getElementById("print").onclick = () => viewPrint(p, { ...p, lineas: s.lineas, iva: s.iva, notas: s.notas, km: s.km === "" ? null : +s.km }, calc(s.lineas, s.iva), () => viewForm(p, {}, back));
      document.getElementById("dup").onclick = () => { p = null; s.estado = "pendiente"; render(); toast("Copia lista: pulsa Guardar"); };
      document.getElementById("del").onclick = async () => {
        if (!confirm("¿Borrar este presupuesto?")) return;
        const { error } = await db.from("presupuestos").delete().eq("id", p.id);
        if (error) return toast(error.message); back();
      };
    }
  };

  const guardar = async () => {
    let cli = null, veh = null, cid = s.cliente_id, vid = s.vehiculo_id;
    if (cid === "new") {
      if (!s.nc.nombre.trim()) return toast("Falta el nombre del cliente");
      const { data, error } = await db.from("clientes").insert({ nombre: s.nc.nombre.trim(), apellidos: s.nc.apellidos.trim(), telefono: s.nc.telefono, email: s.nc.email }).select().single();
      if (error) return toast(error.message);
      cli = data; cid = data.id; clientes.push(data);
    } else if (cid) cli = clientes.find(c => c.id === cid);
    else if (!(p && p.cliente)) return toast("Elige o crea un cliente");

    const nuevoVeh = vid === "new" || (s.cliente_id === "new" && (s.nv.vehiculo.trim() || s.nv.matricula.trim()));
    if (nuevoVeh) {
      if (!s.nv.vehiculo.trim() && !s.nv.matricula.trim()) return toast("Pon marca/modelo o matrícula del vehículo");
      const { data, error } = await db.from("vehiculos").insert({ cliente_id: cid, vehiculo: s.nv.vehiculo.trim(), matricula: s.nv.matricula.trim(), anio: s.nv.anio ? +s.nv.anio : null }).select().single();
      if (error) return toast(error.message);
      veh = data; vid = data.id; vehiculos.push(data);
    } else if (vid) veh = vehiculos.find(v => v.id === vid);

    const row = {
      cliente_id: cid || null, vehiculo_id: vid || null, km: s.km === "" ? null : +s.km,
      cliente: cli ? nombreC(cli) : p.cliente, telefono: cli ? cli.telefono : p?.telefono,
      vehiculo: veh ? veh.vehiculo : (cli ? "" : p?.vehiculo), matricula: veh ? veh.matricula : (cli ? "" : p?.matricula),
      notas: s.notas, estado: s.estado, iva: +s.iva || 0,
      lineas: s.lineas.filter(l => String(l.desc).trim() || +l.precio).map(l => ({ ...l, cant: +l.cant || 0, precio: +l.precio || 0 })),
      total: +calc(s.lineas, s.iva).total.toFixed(2)
    };
    const { error } = p ? await db.from("presupuestos").update(row).eq("id", p.id) : await db.from("presupuestos").insert(row);
    if (error) return toast(error.message);
    toast("Guardado"); back();
  };
  render();
}

// ---------- Impresión / solo lectura ----------
function viewPrint(p, s, t, back = viewList) {
  if (!session) return viewAuth();
  $nav.hidden = false;
  $app.innerHTML = `
    <div class="card">
      <h2>${esc(TALLER)} · Presupuesto #${p.numero}</h2>
      <p>${fecha(p.created_at)}<br><b>${esc(s.cliente)}</b> ${esc(s.telefono)}<br>${esc(s.vehiculo)} ${esc(s.matricula)}${s.km != null && s.km !== "" ? " · " + Number(s.km).toLocaleString("es-ES") + " km" : ""}</p>
      <table><tr><th>Descripción</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr>
      ${s.lineas.map(l => `<tr><td>${esc(l.desc)}</td><td class="n">${l.cant}</td><td class="n">${eur(l.precio)}</td><td class="n">${eur(l.cant * l.precio)}</td></tr>`).join("")}
      </table>
      <p class="tot">Base ${eur(t.base)}<br>IVA ${s.iva}% ${eur(t.iva)}<br>Total <b>${eur(t.total)}</b></p>
      ${s.notas ? `<p>${esc(s.notas)}</p>` : ""}
      <div class="actions no-print"><button class="primary" onclick="print()">Imprimir / Guardar PDF</button><button id="b">Volver</button></div>
    </div>`;
  document.getElementById("b").onclick = back;
}

// ---------- Arranque ----------
db.auth.onAuthStateChange((_e, sess) => { session = sess; sess ? viewList() : viewAuth(); });
viewAuth(); // estado inicial seguro: login hasta confirmar sesión
