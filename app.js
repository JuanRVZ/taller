const { SUPABASE_URL, SUPABASE_ANON_KEY, TALLER } = window.CONFIG;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
let session = null;
const isAdmin = () => !!session && session.user.email?.toLowerCase() === (window.CONFIG.ADMIN_EMAIL || "").toLowerCase();
document.getElementById("brand").textContent = TALLER;

const eur = n => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fecha = d => new Date(d).toLocaleDateString("es-ES");
const toast = m => { const t = document.getElementById("toast"); t.textContent = m; t.className = "show"; setTimeout(() => t.className = "", 2200); };

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

// ---------- Auth ----------
function viewAuth() {
  $nav.hidden = true;
  $app.innerHTML = `
    <form class="card auth" id="f">
      <h2>Acceso mecánicos</h2>
      <label>Email</label><input type="email" name="email" required autocomplete="username">
      <label>Contraseña</label><input type="password" name="pass" required minlength="6" autocomplete="current-password">
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
$nav.onclick = e => { if (!session) return viewAuth(); const g = e.target.dataset.go; if (g === "list") viewList(); if (g === "new") viewForm(); };

// ---------- Historial ----------
async function viewList() {
  if (!session) return viewAuth();
  $nav.hidden = false;
  const admin = isAdmin();
  $app.innerHTML = `<input id="q" placeholder="Buscar cliente, matrícula, vehículo${admin ? ", mecánico" : ""}…"><div id="l" style="margin-top:.8rem">Cargando…</div>`;
  const { data, error } = await db.from("presupuestos").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) return $app.innerHTML = `<p class="err">${esc(error.message)}</p>`;
  const draw = () => {
    const q = document.getElementById("q").value.toLowerCase();
    const rows = data.filter(p => [p.cliente, p.matricula, p.vehiculo, p.email].join(" ").toLowerCase().includes(q));
    document.getElementById("l").innerHTML = rows.length ? rows.map(p => `
      <div class="card item" data-id="${p.id}">
        <div><b>#${p.numero} · ${esc(p.cliente)}</b><br><small>${esc(p.vehiculo)} ${esc(p.matricula)} · ${fecha(p.created_at)}${admin ? " · <b>" + esc(p.email || "?") + "</b>" : ""}</small></div>
        <div class="right"><b>${eur(p.total)}</b><br><span class="tag ${p.estado}">${p.estado}</span></div>
      </div>`).join("") : "<p>No hay presupuestos.</p>";
    document.querySelectorAll(".item").forEach(el => el.onclick = () => {
      const p = data.find(x => x.id === el.dataset.id);
      if (p.user_id === session.user.id) return viewForm(p);
      const base = p.lineas.reduce((a, l) => a + l.cant * l.precio, 0), iva = base * p.iva / 100; // solo lectura (admin)
      viewPrint(p, p, { base, iva, total: base + iva }, viewList);
    });
  };
  document.getElementById("q").oninput = draw; draw();
}

// ---------- Formulario ----------
function viewForm(p = null) {
  if (!session) return viewAuth();
  $nav.hidden = false;
  const s = p ? structuredClone(p) : { cliente: "", telefono: "", matricula: "", vehiculo: "", notas: "", iva: 21, estado: "pendiente", lineas: [{ tipo: "mano_obra", desc: "", cant: 1, precio: 0 }] };
  const calc = () => {
    const base = s.lineas.reduce((a, l) => a + (+l.cant || 0) * (+l.precio || 0), 0);
    const iva = base * (+s.iva || 0) / 100;
    return { base, iva, total: base + iva };
  };
  const render = () => {
    const t = calc();
    $app.innerHTML = `
    <div class="card">
      <h3>${p ? "Presupuesto #" + p.numero : "Nuevo presupuesto"}</h3>
      <div class="row">
        <div><label>Cliente *</label><input data-k="cliente" value="${esc(s.cliente)}"></div>
        <div><label>Teléfono</label><input data-k="telefono" type="tel" value="${esc(s.telefono)}"></div>
      </div>
      <div class="row">
        <div><label>Vehículo</label><input data-k="vehiculo" value="${esc(s.vehiculo)}"></div>
        <div><label>Matrícula</label><input data-k="matricula" value="${esc(s.matricula)}"></div>
      </div>
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
    const upd = () => document.getElementById("tot").innerHTML = (t => `Base ${eur(t.base)} · IVA ${eur(t.iva)}<br>Total <b>${eur(t.total)}</b>`)(calc());
    $app.querySelectorAll("[data-k]").forEach(el => el.oninput = () => { s[el.dataset.k] = el.value; upd(); });
    $app.querySelectorAll("[data-l]").forEach(el => el.oninput = () => { s.lineas[el.dataset.i][el.dataset.l] = el.value; upd(); });
    $app.querySelectorAll("[data-del]").forEach(el => el.onclick = () => { s.lineas.splice(el.dataset.del, 1); render(); });
    document.getElementById("add").onclick = () => { s.lineas.push({ tipo: "pieza", desc: "", cant: 1, precio: 0 }); render(); };
    document.getElementById("back").onclick = viewList;
    document.getElementById("save").onclick = async () => {
      if (!s.cliente.trim()) return toast("Falta el cliente");
      const row = { cliente: s.cliente.trim(), telefono: s.telefono, matricula: s.matricula, vehiculo: s.vehiculo, notas: s.notas, estado: s.estado, iva: +s.iva || 0,
        lineas: s.lineas.filter(l => l.desc.trim() || +l.precio).map(l => ({ ...l, cant: +l.cant || 0, precio: +l.precio || 0 })), total: +calc().total.toFixed(2) };
      const { error } = p ? await db.from("presupuestos").update(row).eq("id", p.id) : await db.from("presupuestos").insert(row);
      if (error) return toast(error.message);
      toast("Guardado"); viewList();
    };
    if (p) {
      document.getElementById("print").onclick = () => viewPrint(p, s, calc());
      document.getElementById("dup").onclick = () => { p = null; s.estado = "pendiente"; render(); toast("Copia lista: pulsa Guardar"); };
      document.getElementById("del").onclick = async () => {
        if (!confirm("¿Borrar este presupuesto?")) return;
        const { error } = await db.from("presupuestos").delete().eq("id", p.id);
        if (error) return toast(error.message); viewList();
      };
    }
  };
  render();
}

// ---------- Impresión ----------
function viewPrint(p, s, t, back) {
  if (!session) return viewAuth();
  $app.innerHTML = `
    <div class="card">
      <h2>${esc(TALLER)} · Presupuesto #${p.numero}</h2>
      <p>${fecha(p.created_at)}<br><b>${esc(s.cliente)}</b> ${esc(s.telefono)}<br>${esc(s.vehiculo)} ${esc(s.matricula)}</p>
      <table><tr><th>Descripción</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr>
      ${s.lineas.map(l => `<tr><td>${esc(l.desc)}</td><td class="n">${l.cant}</td><td class="n">${eur(l.precio)}</td><td class="n">${eur(l.cant * l.precio)}</td></tr>`).join("")}
      </table>
      <p class="tot">Base ${eur(t.base)}<br>IVA ${s.iva}% ${eur(t.iva)}<br>Total <b>${eur(t.total)}</b></p>
      ${s.notas ? `<p>${esc(s.notas)}</p>` : ""}
      <div class="actions no-print"><button class="primary" onclick="print()">Imprimir / Guardar PDF</button><button id="b">Volver</button></div>
    </div>`;
  document.getElementById("b").onclick = back || (() => viewForm(p));
}

// ---------- Arranque ----------
db.auth.onAuthStateChange((_e, sess) => { session = sess; sess ? viewList() : viewAuth(); });
viewAuth(); // estado inicial seguro: login hasta confirmar sesión
