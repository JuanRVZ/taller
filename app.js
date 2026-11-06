// ===== Pantallas de la aplicación =====

// ---------- Navegación ----------
function nav(t) { $nav.hidden = false; document.getElementById("fab").hidden = false; tab(t); }
function toggleAdminUI() {
  document.querySelectorAll("[data-admin]").forEach(b => { b.hidden = !isAdmin(); });
  document.getElementById("fab").hidden = !session;
}
$nav.onclick = e => {
  const b = e.target.closest("[data-go]"); if (!b) return;
  if (!session) return viewAuth();
  ({ home: viewHome, list: viewList, clients: viewClients, gastos: viewGastos, new: () => viewForm(), profile: viewPerfil, admin: viewAdmin })[b.dataset.go]?.();
};
document.getElementById("fab").onclick = () => session && viewForm();
document.getElementById("logout").onclick = async () => {
  if (D.cola.length && !(await confirmar("Hay cambios sin enviar", `Tienes ${D.cola.length} cambio(s) pendientes de enviar al servidor. Si sales ahora se perderán en este dispositivo.`, "Salir igualmente"))) return;
  db.auth.signOut();
};
// Botones 📷 junto a los campos de matrícula
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-scan]"); if (!b) return;
  const inp = b.previousElementSibling; if (!inp) return;
  const m = await escanearMatricula();
  if (m) { inp.value = m; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); }
});
const campoMatricula = attrs => `<div class="conbtn"><input ${attrs}><button type="button" data-scan title="Escanear matrícula con la cámara">📷</button></div>`;

// ---------- Acceso (sin registro público: las cuentas las da de alta el administrador) ----------
function viewAuth() {
  $nav.hidden = true; document.getElementById("fab").hidden = true;
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
    if (error) document.getElementById("err").textContent = esRed(error) ? "Sin conexión: necesitas internet para entrar la primera vez." : "Email o contraseña incorrectos";
  };
}

// ---------- Abrir presupuesto: editable si es mío y está abierto; si no, vista de documento ----------
function openQuote(p, back = viewList) {
  const mio = p.user_id === me();
  if (mio && p.estado !== "cerrado") return viewForm(p, {}, back);
  viewPrint(p, p, calc(p.lineas, p.margen), back, mio ? { reabrir: () => reabrirPresupuesto(p, back), cobro: () => gestionarCobro(p, back) } : null);
}
async function gestionarCobro(p, back) {
  let upd;
  if (p.pagado) {
    if (!(await confirmar("¿Anular el cobro?", "Volverá a figurar como pendiente de cobro.", "Sí, anular", false))) return;
    upd = { pagado: false, pagado_at: null, forma_pago: null, pago_efectivo: 0, pago_bizum: 0 };
  } else {
    const resto = Math.max(0, r2(desglose(p).total - (+p.anticipo || 0)));
    const r = await Swal.fire({
      icon: "question", title: "¿Cómo ha pagado?",
      html: `Falta por cobrar <b>${eur(resto)}</b>${+p.anticipo > 0 ? ` <small>(ya dejó ${eur(p.anticipo)} de anticipo)</small>` : ""}`,
      input: "radio", inputValue: "efectivo",
      inputOptions: { efectivo: "💵 Todo en efectivo", bizum: "📱 Todo por Bizum", mixto: "➗ Una parte en cada uno" },
      showCancelButton: true, confirmButtonText: "Cobrar", cancelButtonText: "Cancelar", confirmButtonColor: "#15803d"
    });
    if (!r.isConfirmed) return;
    let ef = 0, bz = 0;
    if (r.value === "efectivo") ef = resto;
    else if (r.value === "bizum") bz = resto;
    else {
      const m = await Swal.fire({
        title: "¿Cuánto fue en efectivo?", html: `De ${eur(resto)}. <b>Lo que quede se apunta como Bizum.</b>`,
        input: "number", inputValue: r2(resto / 2), inputAttributes: { min: 0, max: resto, step: "any" },
        showCancelButton: true, confirmButtonText: "Cobrar", cancelButtonText: "Cancelar", confirmButtonColor: "#15803d",
        inputValidator: v => (v === "" || isNaN(+v) || +v < 0 || +v > resto) && `Pon un importe entre 0 y ${eur(resto)}`
      });
      if (!m.isConfirmed) return;
      ef = r2(+m.value); bz = r2(resto - ef);
    }
    upd = { pagado: true, pagado_at: new Date().toISOString(), pago_efectivo: ef, pago_bizum: bz, forma_pago: ef && bz ? "efectivo + bizum" : bz ? "bizum" : "efectivo" };
  }
  const q = actualizar("presupuestos", p.id, upd);
  ok(upd.pagado ? "Cobro registrado 💶" : "Cobro anulado"); openQuote(q, back);
}
async function reabrirPresupuesto(p, back) {
  if (!(await confirmar("¿Reabrir este presupuesto?", "Volverá a estado «aceptado», se borrará el cobro si lo había y podrás editarlo de nuevo.", "Sí, reabrir", false))) return;
  const q = actualizar("presupuestos", p.id, { estado: "aceptado", cerrado_at: null, pagado: false, pagado_at: null, forma_pago: null, pago_efectivo: 0, pago_bizum: 0 });
  ok("Presupuesto reabierto"); viewForm(q, {}, back);
}

// ---------- Inicio: búsqueda rápida y resumen con gráficos ----------
let graficos = [], periodo = "12m";
const PERIODOS = [["mes", "Este mes"], ["3m", "Últimos 3 meses"], ["anio", "Este año"], ["12m", "Últimos 12 meses"], ["todo", "Todo"]];
const desdeFecha = p => { const d = new Date(); return p === "mes" ? new Date(d.getFullYear(), d.getMonth(), 1) : p === "3m" ? new Date(d.getFullYear(), d.getMonth() - 2, 1) : p === "anio" ? new Date(d.getFullYear(), 0, 1) : p === "12m" ? new Date(d.getFullYear(), d.getMonth() - 11, 1) : new Date(0); };
const modoOscuro = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const paleta = () => modoOscuro()
  ? { ing: "#5b86ff", gas: "#f59e0b", gan: "#34d399", txt: "#e8eaf0", rej: "#f87171", grid: "#2c3240" }
  : { ing: "#1f4fd8", gas: "#d97706", gan: "#15803d", txt: "#1b1f27", rej: "#b91c1c", grid: "#e2e5ea" };

// Búsqueda por matrícula, cliente o teléfono sobre la copia local (funciona sin conexión)
function buscarRapido(q) {
  const pq = placa(q), nq = norm(q), dig = q.replace(/\D/g, "");
  const cli = id => D.t.clientes.find(c => c.id === id);
  const vs = D.t.vehiculos.filter(v => (pq.length >= 2 && placa(v.matricula).includes(pq)) || (nq.length >= 3 && norm(v.vehiculo).includes(nq)));
  const idsConCoche = new Set(vs.map(v => v.cliente_id));
  const cs = D.t.clientes.filter(c => !idsConCoche.has(c.id) && ((nq.length >= 2 && norm(nombreC(c)).includes(nq)) || (dig.length >= 4 && String(c.telefono || "").replace(/\D/g, "").includes(dig))));
  const ultimo = (cid, vid) => D.t.presupuestos.filter(p => p.cliente_id === cid && (!vid || p.vehiculo_id === vid)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return { vs: vs.slice(0, 8).map(v => ({ v, c: cli(v.cliente_id), u: ultimo(v.cliente_id, v.id) })), cs: cs.slice(0, 6).map(c => ({ c, u: ultimo(c.id) })), pq };
}
function pintarBusqueda(q) {
  const box = document.getElementById("qres"); if (!box) return;
  if (!q.trim()) { box.innerHTML = ""; return; }
  const { vs, cs, pq } = buscarRapido(q);
  const ult = u => u ? `<small>Último trabajo: ${fecha(u.created_at)} · ${esc((u.lineas || []).map(l => l.desc).filter(Boolean).join(", ").slice(0, 70))} · ${eur(u.total)}</small>` : `<small>Sin presupuestos todavía</small>`;
  const acciones = c => c ? `<div class="actions"><button data-abrir="${c.id}">Abrir ficha</button>${c.user_id === me() ? `<button class="primary" data-nuevo="${c.id}">＋ Presupuesto</button>` : ""}</div>` : "";
  box.innerHTML = (vs.length || cs.length) ? `<div class="grid">` +
    vs.map(({ v, c, u }) => `<div class="card"><b>🚗 ${esc(v.vehiculo)} ${esc(v.matricula)}</b><br>${c ? `👤 ${esc(nombreC(c))} ${esc(c.telefono)}` : ""}<br>${ult(u)}${acciones(c)}</div>`).join("") +
    cs.map(({ c, u }) => `<div class="card"><b>👤 ${esc(nombreC(c))}</b> ${esc(c.telefono)}<br>${ult(u)}${acciones(c)}</div>`).join("") + `</div>`
    : `<div class="card"><p>No hay ningún cliente ni coche que coincida con «${esc(q)}».</p>${pq.length >= 5 ? `<button class="primary" id="nuevo-con-placa">➕ Nuevo cliente con la matrícula ${esc(q.toUpperCase())}</button>` : ""}</div>`;
  box.querySelectorAll("[data-abrir]").forEach(b => b.onclick = () => viewClient(D.t.clientes.find(c => c.id === b.dataset.abrir)));
  box.querySelectorAll("[data-nuevo]").forEach(b => b.onclick = () => viewForm(null, { cliente_id: b.dataset.nuevo }));
  const n = document.getElementById("nuevo-con-placa");
  if (n) n.onclick = () => viewClient(null, { vehs: [{ vehiculo: "", matricula: q.trim().toUpperCase(), anio: "" }] });
}

function viewHome() {
  if (!session) return viewAuth();
  nav("home");
  graficos.forEach(g => g.destroy()); graficos = [];
  const data = D.t.presupuestos, gastos = D.t.gastos, admin = isAdmin();
  const desde = desdeFecha(periodo), hoy = new Date(), idxHoy = hoy.getFullYear() * 12 + hoy.getMonth();
  const fCierre = q => new Date(q.cerrado_at || q.created_at);
  const cerrados = data.filter(q => q.estado === "cerrado" && fCierre(q) >= desde).map(q => ({ q, d: desglose(q) }));
  const suma = (arr, f) => r2(arr.reduce((a, x) => a + f(x), 0));
  const ing = suma(cerrados, x => x.d.total), gasP = suma(cerrados, x => x.d.coste);
  // gastos fijos del periodo: se cuentan mes a mes desde el inicio del periodo hasta hoy
  let idx0 = desde.getFullYear() * 12 + desde.getMonth();
  if (periodo === "todo") idx0 = Math.min(idxHoy, ...data.map(q => mesIdx(q.created_at)), ...gastos.map(g => mesIdx(g.fecha)));
  let gasF = 0; if (usaGastos()) for (let i = idx0; i <= idxHoy; i++) gastos.forEach(g => { gasF += gastoEnMes(g, i); }); gasF = r2(gasF);
  const gan = r2(ing - gasP - gasF);
  const por = e => data.filter(q => q.estado === e);
  const pend = por("pendiente"), acep = por("aceptado"), rech = por("rechazado"), cerr = por("cerrado");
  const tot = arr => suma(arr, q => desglose(q).total);
  const xcobrar = cerr.filter(q => !q.pagado);
  const cobradoVia = cerrados.filter(x => x.q.pagado).reduce((a, x) => { const v = pagoPorVia(x.q); a.efectivo += v.efectivo; a.bizum += v.bizum; return a; }, { efectivo: 0, bizum: 0 });
  const ingMes = suma(data.filter(q => q.estado === "cerrado" && mesIdx(q.cerrado_at || q.created_at) === idxHoy), q => desglose(q).total);
  const obj = +perfil.objetivo_mensual || 0;

  $app.innerHTML = `
  <div class="busq"><input id="qh" placeholder="🔎 Buscar por matrícula, cliente o teléfono…" autocomplete="off"><button id="scan" title="Escanear matrícula con la cámara">📷</button></div>
  <div id="qres"></div>
  <div id="alm"></div>
  <div class="row" style="justify-content:space-between;align-items:end;margin-top:1rem">
    <div><h2 style="margin:0">Resumen${admin ? " de todos los mecánicos" : ""}</h2>
    <p class="hint" style="margin:.2rem 0 0">El dinero cuenta los presupuestos <b>cerrados</b> (trabajo ya hecho).</p></div>
    <select id="per" style="width:auto;flex:0 0 auto">${PERIODOS.map(([v, t]) => `<option value="${v}" ${periodo === v ? "selected" : ""}>${t}</option>`).join("")}</select>
  </div>
  ${obj ? `<div class="card objetivo"><div class="row" style="justify-content:space-between"><b>🎯 Objetivo de este mes</b><span>${eur(ingMes)} de ${eur(obj)} · <b>${Math.round(ingMes / obj * 100)} %</b></span></div>
    <div class="barra"><div style="width:${Math.min(100, ingMes / obj * 100)}%"></div></div>
    <small class="hint">${ingMes >= obj ? "¡Objetivo cumplido! 🎉" : `Te faltan ${eur(obj - ingMes)}`}</small></div>` : ""}
  <div class="kpis">
    <div class="kpi"><span>Ingresos</span><b>${eur(ing)}</b><small>lo facturado en trabajos cerrados</small></div>
    <div class="kpi"><span>Gastos en piezas</span><b>${eur(gasP)}</b><small>lo que costaron las piezas</small></div>
    ${usaGastos() ? `<div class="kpi"><span>Gastos fijos</span><b>${eur(gasF)}</b><small>alquiler, luz, herramientas…</small></div>` : ""}
    <div class="kpi gan"><span>${usaGastos() ? "Ganancia neta" : "Ganancia"}</span><b>${eur(gan)}</b><small>${usaGastos() ? "ingresos − piezas − gastos fijos" : "ingresos − gastos en piezas"}</small></div>
    <div class="kpi"><span>Pendientes</span><b>${pend.length}</b><small>${eur(tot(pend))} esperando respuesta</small></div>
    <div class="kpi"><span>Aceptados por cerrar</span><b>${acep.length}</b><small>${eur(tot(acep))} por hacer</small></div>
    <div class="kpi"><span>Cerrados</span><b>${cerrados.length}</b><small>en este periodo</small></div>
    <div class="kpi"><span>Cobrado</span><b>${eur(cobradoVia.efectivo + cobradoVia.bizum)}</b><small>💵 ${eur(cobradoVia.efectivo)} · 📱 ${eur(cobradoVia.bizum)}</small></div>
    <div class="kpi"><span>Por cobrar</span><b>${eur(suma(xcobrar, porCobrar))}</b><small>${xcobrar.length} trabajo${xcobrar.length === 1 ? "" : "s"} hecho${xcobrar.length === 1 ? "" : "s"} sin cobrar</small></div>
  </div>
  <div class="charts" id="charts-home">
    <div class="card wide"><h4>Ingresos, gastos y ganancia por mes</h4><div class="cv"><canvas id="c1"></canvas></div></div>
    <div class="card"><h4>Presupuestos por estado</h4><div class="cv"><canvas id="c2"></canvas></div></div>
    <div class="card"><h4>De dónde viene el dinero</h4>${cerrados.length ? `<div class="cv"><canvas id="c3"></canvas></div>` : `<p class="hint">Cuando cierres presupuestos verás aquí cuánto es mano de obra, piezas y margen.</p>`}</div>
    ${admin ? `<div class="card wide"><h4>Ingresos por mecánico</h4>${cerrados.length ? `<div class="cv"><canvas id="c4"></canvas></div>` : `<p class="hint">Sin trabajos cerrados en este periodo.</p>`}</div>` : ""}
  </div>
  ${data.length ? "" : `<p class="hint">Aún no hay presupuestos. Crea el primero con «＋ Nuevo»; cuando termines el trabajo, ciérralo y aparecerá en estos números.</p>`}`;
  document.getElementById("per").onchange = e => { periodo = e.target.value; viewHome(); };
  const qh = document.getElementById("qh");
  qh.oninput = () => pintarBusqueda(qh.value);
  document.getElementById("scan").onclick = async () => { const m = await escanearMatricula(); if (m) { qh.value = m; pintarBusqueda(m); } };
  if (admin) avisoAlmacenamiento();
  if (!window.Chart) return;

  const c = paleta();
  Chart.defaults.color = c.txt; Chart.defaults.borderColor = c.grid; Chart.defaults.font.family = "system-ui, sans-serif";
  const opts = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, ...extra });
  const nuevo = (id, cfg) => { const el = document.getElementById(id); if (el) graficos.push(new Chart(el, cfg)); };
  const monedaY = { y: { beginAtZero: true, ticks: { callback: v => eur(v) } }, x: { grid: { display: false } } };

  // 1) por mes (últimos 12): gastos = piezas + gastos fijos
  const meses = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1); meses.push({ idx: d.getFullYear() * 12 + d.getMonth(), t: d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" }), ing: 0, gas: 0 }); }
  data.filter(q => q.estado === "cerrado").forEach(q => { const m = meses.find(x => x.idx === mesIdx(q.cerrado_at || q.created_at)); if (m) { const d = desglose(q); m.ing += d.total; m.gas += d.coste; } });
  if (usaGastos()) meses.forEach(m => gastos.forEach(g => { m.gas += gastoEnMes(g, m.idx); }));
  nuevo("c1", { type: "bar", data: { labels: meses.map(m => m.t), datasets: [
    { label: "Ingresos", data: meses.map(m => r2(m.ing)), backgroundColor: c.ing, borderRadius: 4 },
    { label: usaGastos() ? "Gastos (piezas + fijos)" : "Gastos en piezas", data: meses.map(m => r2(m.gas)), backgroundColor: c.gas, borderRadius: 4 },
    { label: usaGastos() ? "Ganancia neta" : "Ganancia", data: meses.map(m => r2(m.ing - m.gas)), backgroundColor: c.gan, borderRadius: 4 }] },
    options: opts({ scales: monedaY, plugins: { tooltip: { callbacks: { label: x => `${x.dataset.label}: ${eur(x.parsed.y)}` } } } }) });
  // 2) por estado (ahora mismo)
  const est = [["Pendientes", pend.length, c.gas], ["Aceptados", acep.length, c.ing], ["Cerrados", cerr.length, c.gan], ["Rechazados", rech.length, c.rej]];
  nuevo("c2", { type: "doughnut", data: { labels: est.map(e => e[0]), datasets: [{ data: est.map(e => e[1]), backgroundColor: est.map(e => e[2]), borderWidth: 0 }] },
    options: opts({ cutout: "62%", plugins: { legend: { position: "bottom" } } }) });
  // 3) mano de obra / coste de piezas / margen de piezas (cerrados del periodo)
  if (cerrados.length) {
    const mano = suma(cerrados, x => x.d.mano), margenP = suma(cerrados, x => x.d.venta - x.d.coste);
    nuevo("c3", { type: "doughnut", data: { labels: ["Mano de obra", "Piezas (coste)", "Margen de piezas"], datasets: [{ data: [mano, gasP, margenP], backgroundColor: [c.ing, c.gas, c.gan], borderWidth: 0 }] },
      options: opts({ cutout: "62%", plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: x => `${x.label}: ${eur(x.parsed)}` } } } }) });
  }
  // 4) administrador: por mecánico
  if (admin && cerrados.length) {
    const g = {}; cerrados.forEach(({ q, d }) => { const k = q.email || "?"; g[k] = g[k] || { ing: 0, gan: 0 }; g[k].ing += d.total; g[k].gan += d.ganancia; });
    const ks = Object.keys(g).sort((a, b) => g[b].ing - g[a].ing);
    nuevo("c4", { type: "bar", data: { labels: ks, datasets: [{ label: "Ingresos", data: ks.map(k => r2(g[k].ing)), backgroundColor: c.ing, borderRadius: 4 }, { label: "Ganancia (sin gastos fijos)", data: ks.map(k => r2(g[k].gan)), backgroundColor: c.gan, borderRadius: 4 }] },
      options: opts({ indexAxis: "y", scales: { x: { beginAtZero: true, ticks: { callback: v => eur(v) } }, y: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: x => `${x.dataset.label}: ${eur(x.parsed.x)}` } } } }) });
  }
}

// Aviso al administrador cuando las fotos se acercan al límite del plan gratis (1 GB)
async function avisoAlmacenamiento() {
  if (!navigator.onLine) return;
  try {
    const total = (await usoFotos()).reduce((a, f) => a + f.bytes, 0), pct = total / GB * 100;
    const box = document.getElementById("alm"); if (!box || pct < 60) return;
    box.innerHTML = `<div class="card aviso-alm ${pct >= 85 ? "grave" : ""}">⚠️ Las fotos ocupan ${mb(total)} (${Math.round(pct)} % del 1 GB gratis). ${pct >= 85 ? "Estás cerca del límite: pide a los mecánicos que liberen espacio en su Perfil." : "Conviene ir liberando fotos antiguas desde el Perfil."}</div>`;
  } catch { /* sin conexión o sin permisos: no se avisa */ }
}

// ---------- Listado de presupuestos ----------
function viewList() {
  if (!session) return viewAuth();
  nav("list");
  const admin = isAdmin();
  const data = [...D.t.presupuestos].sort((a, b) => b.created_at.localeCompare(a.created_at));
  $app.innerHTML = `<input id="q" placeholder="Buscar cliente, matrícula, vehículo${admin ? ", mecánico" : ""}…"><div class="chips" id="chips"></div><div id="l" class="grid"></div>`;
  const ESTADOS = [["todos", "Todos"], ["pendiente", "Pendientes"], ["aceptado", "Aceptados"], ["cerrado", "Cerrados"], ["porcobrar", "Por cobrar"], ["rechazado", "Rechazados"]];
  const coincide = (p, e) => e === "todos" || (e === "porcobrar" ? p.estado === "cerrado" && !p.pagado : p.estado === e);
  const draw = () => {
    const q = document.getElementById("q").value.toLowerCase();
    const porTexto = data.filter(p => [p.cliente, p.matricula, p.vehiculo, p.email].join(" ").toLowerCase().includes(q));
    const cuenta = e => porTexto.filter(p => coincide(p, e)).length;
    const chips = document.getElementById("chips");
    chips.innerHTML = ESTADOS.map(([e, t]) => `<button data-f="${e}" class="${filtroEstado === e ? "on" : ""}">${t} <small>${cuenta(e)}</small></button>`).join("");
    chips.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filtroEstado = b.dataset.f; draw(); });
    const rows = porTexto.filter(p => coincide(p, filtroEstado));
    document.getElementById("l").innerHTML = rows.length ? rows.map(p => `
      <div class="card item" data-id="${p.id}">
        <div><b>#${num(p)} · ${esc(p.cliente)}</b>${p._pend ? ` <span class="tag pendiente" title="Aún no enviado al servidor">⏳</span>` : ""}<br><small>${esc(p.vehiculo)} ${esc(p.matricula)} · ${fecha(p.created_at)}${admin ? " · <b>" + esc(p.email || "?") + "</b>" : ""}</small></div>
        <div class="right"><b>${eur(p.total)}</b><br><span class="tag ${p.estado}">${p.estado}</span>${p.estado === "cerrado" ? `<br><span class="tag ${p.pagado ? "aceptado" : "pendiente"}">${p.pagado ? "cobrado" : "sin cobrar"}</span>` : ""}${+p.anticipo > 0 && !p.pagado ? `<br><small>anticipo ${eur(p.anticipo)}</small>` : ""}</div>
      </div>`).join("") : `<p>${data.length ? "Ningún presupuesto coincide con el filtro." : "Aún no hay presupuestos."}</p>`;
    document.querySelectorAll(".item").forEach(el => el.onclick = () => openQuote(data.find(x => x.id === el.dataset.id)));
  };
  document.getElementById("q").oninput = draw; draw();
}

// ---------- Clientes ----------
function viewClients() {
  if (!session) return viewAuth();
  nav("clients");
  const admin = isAdmin(), cs = [...D.t.clientes].sort((a, b) => nombreC(a).localeCompare(nombreC(b), "es")), vs = D.t.vehiculos;
  $app.innerHTML = `<div class="row"><input id="q" placeholder="Buscar nombre, teléfono, matrícula${admin ? ", mecánico" : ""}…"><button id="nc" class="primary" style="flex:0 0 auto">+ Nuevo cliente</button></div><div id="l" class="grid"></div>`;
  document.getElementById("nc").onclick = () => viewClient(null);
  const draw = () => {
    const q = document.getElementById("q").value.toLowerCase();
    const rows = cs.map(c => ({ c, v: vs.filter(v => v.cliente_id === c.id) }))
      .filter(({ c, v }) => [nombreC(c), c.telefono, c.email, c.email_mecanico, ...v.map(x => x.vehiculo + " " + x.matricula)].join(" ").toLowerCase().includes(q));
    document.getElementById("l").innerHTML = rows.length ? rows.map(({ c, v }) => `
      <div class="card item" data-id="${c.id}"><div>
        <b>${esc(nombreC(c))}</b>${c._pend ? ` <span class="tag pendiente" title="Aún no enviado al servidor">⏳</span>` : ""}<br>
        <small>${[esc(c.telefono), v.map(x => esc(x.vehiculo) + " " + esc(x.matricula)).join(", "), admin ? "<b>" + esc(c.email_mecanico || "?") + "</b>" : ""].filter(Boolean).join(" · ")}</small>
      </div></div>`).join("") : "<p>No hay clientes.</p>";
    document.querySelectorAll(".item").forEach(el => el.onclick = () => viewClient(cs.find(x => x.id === el.dataset.id)));
  };
  document.getElementById("q").oninput = draw; draw();
}

function viewClient(c, pre = {}) {
  if (!session) return viewAuth();
  nav("clients");
  const ro = !!c && c.user_id !== me(); // el administrador ve fichas ajenas en solo lectura
  const s = c ? { ...c } : { nombre: "", apellidos: "", telefono: "", email: "", notas: "", vehs: pre.vehs || [{ vehiculo: "", matricula: "", anio: "" }] };
  const vehs = c ? D.t.vehiculos.filter(v => v.cliente_id === c.id) : [];
  const quotes = c ? D.t.presupuestos.filter(p => p.cliente_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at)) : [];
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
      <label>Notas (internas)</label><textarea data-k="notas" rows="2" ${dis}>${esc(s.notas)}</textarea>
      ${c ? "" : `
      <div class="seccion">
        <h4>🚗 Vehículos del cliente</h4>
        <p class="hint">Añade ya sus coches. Si tiene más de uno, pulsa "Añadir otro vehículo". También puedes dejarlo vacío y añadirlos más tarde.</p>
        ${s.vehs.map((v, i) => `
        <div class="veh" data-nv="${i}">
          <input data-nf="vehiculo" placeholder="Marca y modelo (Ej.: Renault Clio)" value="${esc(v.vehiculo)}">
          ${campoMatricula(`data-nf="matricula" placeholder="Matrícula" value="${esc(v.matricula)}"`)}
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
        <input id="nv-v" placeholder="Marca y modelo (Ej.: Seat León)">${campoMatricula(`id="nv-m" placeholder="Matrícula"`)}<input id="nv-a" type="number" placeholder="Año">
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
    if (save) save.onclick = () => {
      if (!s.nombre.trim()) return aviso("Falta el nombre del cliente");
      const row = { nombre: s.nombre.trim(), apellidos: s.apellidos.trim(), telefono: s.telefono, email: s.email, notas: s.notas };
      if (c) { actualizar("clientes", c.id, row); ok("Cliente guardado"); viewClients(); return; }
      const nuevo = insertar("clientes", row);
      const vs = s.vehs.filter(v => v.vehiculo.trim() || v.matricula.trim());
      vs.forEach(v => insertar("vehiculos", { cliente_id: nuevo.id, vehiculo: v.vehiculo.trim(), matricula: v.matricula.trim(), anio: v.anio ? +v.anio : null }));
      ok(vs.length ? `Cliente creado con ${vs.length} vehículo${vs.length > 1 ? "s" : ""}` : "Cliente creado");
      viewClient(nuevo);
    };
    if (!c || ro) return;
    document.getElementById("np").onclick = () => viewForm(null, { cliente_id: c.id }, () => viewClient(c));
    document.getElementById("del").onclick = async () => {
      if (!(await confirmar("¿Borrar este cliente?", "Se borrarán también sus vehículos. Sus presupuestos se conservan."))) return;
      borrar("clientes", c.id); viewClients();
    };
    document.getElementById("addvb").onclick = () => {
      const v = document.getElementById("nv-v").value.trim(), m = document.getElementById("nv-m").value.trim(), a = document.getElementById("nv-a").value;
      if (!v && !m) return aviso("Pon marca y modelo o la matrícula");
      insertar("vehiculos", { cliente_id: c.id, vehiculo: v, matricula: m, anio: a ? +a : null }); viewClient(c);
    };
    $app.querySelectorAll(".veh[data-v]").forEach(box => {
      const id = box.dataset.v, val = f => box.querySelector(`[data-f=${f}]`).value;
      box.querySelector("[data-vs]").onclick = () => { actualizar("vehiculos", id, { vehiculo: val("vehiculo"), matricula: val("matricula"), anio: val("anio") ? +val("anio") : null }); ok("Vehículo guardado"); };
      box.querySelector("[data-vd]").onclick = async () => {
        if (!(await confirmar("¿Borrar este vehículo?", "Sus presupuestos se conservan."))) return;
        borrar("vehiculos", id); viewClient(c);
      };
    });
  };
  render();
}

// ---------- Presupuesto ----------
function viewForm(p = null, pre = {}, back = viewList) {
  if (!session) return viewAuth();
  nav(p ? "list" : "new");
  const mios = t => D.t[t].filter(x => x.user_id === me());
  const clientes = mios("clientes").sort((a, b) => nombreC(a).localeCompare(nombreC(b), "es")), vehiculos = mios("vehiculos");
  const hist = mios("presupuestos").filter(q => q.id !== p?.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  // última vez que se usó cada trabajo / pieza (la lista está de más reciente a más antigua)
  const previas = new Map();
  hist.forEach(q => (q.lineas || []).forEach(l => {
    const k = (l.tipo === "pieza" ? "p|" : "m|") + norm(l.desc).trim();
    if (String(l.desc).trim() && !previas.has(k)) previas.set(k, l);
  }));
  const sugerencias = tipo => [...previas.entries()].filter(([k]) => k.startsWith(tipo === "pieza" ? "p|" : "m|")).map(([, l]) => l.desc).slice(0, 300);
  const s = p ? { ...structuredClone(p), cliente_id: p.cliente_id || "", vehiculo_id: p.vehiculo_id || "", km: p.km ?? "", margen: p.margen ?? 0, anticipo: p.anticipo || "", anticipo_forma: p.anticipo_forma || "efectivo", notas_internas: p.notas_internas || "" }
    : { cliente_id: pre.cliente_id || "", vehiculo_id: "", km: "", notas: "", notas_internas: "", anticipo: "", anticipo_forma: "efectivo", margen: perfil.margen_defecto ?? 0, estado: "pendiente", lineas: [{ tipo: "mano_obra", desc: "", cant: 1, precio: perfil.precio_hora ?? 0 }] };
  s.nc = { nombre: "", apellidos: "", telefono: "", email: "" };
  s.nv = { vehiculo: "", matricula: "", anio: "" };
  if (!p && s.cliente_id) { const vs = vehiculos.filter(v => v.cliente_id === s.cliente_id); if (vs.length === 1) s.vehiculo_id = vs[0].id; }

  const totalesHtml = () => { const t = calc(s.lineas, s.margen);
    const coste = r2(s.lineas.filter(l => l.tipo === "pieza" && String(l.desc).trim()).reduce((a, l) => a + (+l.cant || 0) * (+l.precio || 0), 0));
    const ant = +s.anticipo || 0;
    return `Mano de obra ${eur(t.mano)} · Piezas ${eur(t.piezas)}${+s.margen ? ` <small>(coste ${eur(coste)} + ${s.margen} % de margen)</small>` : ""}<br>Total para el cliente <b>${eur(t.total)}</b>${ant > 0 ? `<br><small>Anticipo ${eur(ant)} · Resta por pagar <b>${eur(Math.max(0, t.total - ant))}</b></small>` : ""}`; };

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
      const coinc = new Set(ls.map(([, i]) => i));
      return `
      <div class="hres-q"><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem"><span><b>#${num(q)}</b> · ${fecha(q.created_at)} · ${esc(q.cliente)}${q.vehiculo ? " · " + esc(q.vehiculo) : ""}${q.km != null ? " · " + q.km.toLocaleString("es-ES") + " km" : ""}</span>
        <button data-hqall="${q.id}">Añadir todo</button></div>
      ${(q.lineas || []).map((l, i) => `<div class="hres-l ${coinc.has(i) ? "coincide" : ""}"><span>${l.tipo === "pieza" ? "⚙️" : "🔧"} ${esc(l.desc)} <small>· ${l.cant} ${l.tipo === "pieza" ? "ud" : "h"} × ${eur(l.precio)}${l.tipo === "pieza" ? " (coste)" : ""}</small></span><button data-hq="${q.id}:${i}">Añadir</button></div>`).join("")}
      </div>`; }).join("") : `<p class="hint">No hay nada parecido en tus presupuestos anteriores.</p>`;
    box.querySelectorAll("[data-hq]").forEach(b => b.onclick = () => { const [qid, i] = b.dataset.hq.split(":"); anadirLinea(hist.find(x => x.id === qid).lineas[+i]); });
    box.querySelectorAll("[data-hqall]").forEach(b => b.onclick = () => { const q = hist.find(x => x.id === b.dataset.hqall); q.lineas.forEach(l => anadirLinea(l, true)); render(); ok(`${q.lineas.length} líneas añadidas`); });
  };
  const impLinea = l => String(l.desc).trim() ? r2((+l.cant || 0) * pvp(l, s.margen)) : 0; // una línea sin descripción aún no cuenta
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
      <h3>${p ? "Presupuesto #" + num(p) : "Nuevo presupuesto"}</h3>
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
          <div><label>Matrícula</label>${campoMatricula(`data-m="matricula" placeholder="Ej.: 1234 ABC" value="${esc(s.nv.matricula)}"`)}</div>
          <div><label>Año</label><input data-m="anio" type="number" value="${esc(s.nv.anio)}"></div>
        </div>` : ""}
      <div class="row">
        <div><label>Kilómetros del coche</label><input data-k="km" type="number" min="0" placeholder="Los del cuentakilómetros" value="${s.km}"></div>
        <div><label>Margen sobre las piezas (%)</label><input data-k="margen" type="number" step="any" min="0" placeholder="Ej.: 20" value="${s.margen}"></div>
        <div><label>Estado del presupuesto</label><select data-k="estado">${["pendiente", "aceptado", "rechazado"].map(e => `<option ${s.estado === e ? "selected" : ""}>${e}</option>`).join("")}</select></div>
      </div>
      <div class="row">
        <div><label>Anticipo entregado (€)</label><input data-k="anticipo" type="number" step="any" min="0" placeholder="Lo que dejó a cuenta" value="${s.anticipo}"></div>
        <div><label>¿Cómo lo dejó?</label><select data-k="anticipo_forma"><option value="efectivo" ${s.anticipo_forma !== "bizum" ? "selected" : ""}>💵 Efectivo</option><option value="bizum" ${s.anticipo_forma === "bizum" ? "selected" : ""}>📱 Bizum</option></select></div>
      </div>
      <p class="hint">Margen: porcentaje que sumas al coste de cada pieza. Estado: pendiente = el cliente aún no ha contestado. Cuando termines el trabajo, pulsa «Cerrar presupuesto».</p>
      <label>Observaciones para el cliente</label><textarea data-k="notas" rows="3" placeholder="Salen en el PDF. Ej.: garantía 12 meses, plazo de entrega…">${esc(s.notas)}</textarea>
      <label>🔒 Notas internas</label><textarea data-k="notas_internas" rows="2" placeholder="Solo las ves tú; no salen en el PDF. Ej.: cliente que paga tarde, pieza pedida a…">${esc(s.notas_internas)}</textarea>
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
      ${p ? `<div class="seccion" id="fotos-sec"><h4>📷 Fotos</h4>
        <p class="hint">Se comprimen solas (unos 100 KB cada una) para no gastar espacio. Máximo ${FOTOS_MAX_POR_PRESUPUESTO} por presupuesto.</p>
        <div id="galeria" class="galeria"><small>Cargando…</small></div>
        <div class="actions"><button id="foto-cam">📷 Hacer foto</button><button id="foto-gal">🖼️ Elegir de la galería</button></div></div>`
        : `<p class="hint">📷 Guarda el presupuesto para poder añadirle fotos.</p>`}
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

  // ---- fotos del presupuesto ----
  const pintarGaleria = async () => {
    const g = document.getElementById("galeria"); if (!g) return;
    if (!navigator.onLine) { g.innerHTML = `<small>Las fotos necesitan conexión a internet.</small>`; return; }
    if (p._pend) { g.innerHTML = `<small>Se podrán añadir fotos cuando el presupuesto termine de sincronizarse.</small>`; return; }
    try {
      const fs = await fotosDe(p.id);
      g.innerHTML = fs.length ? fs.map(f => `<figure><img src="${esc(f.url)}" data-ver="${esc(f.url)}" alt="Foto" loading="lazy"><figcaption>${Math.round(f.bytes / 1024)} KB <button data-fdel="${f.id}" class="danger" title="Borrar foto">🗑 Borrar</button></figcaption></figure>`).join("") : `<small>Aún no hay fotos.</small>`;
      g.querySelectorAll("[data-ver]").forEach(i => i.onclick = () => Swal.fire({ imageUrl: i.dataset.ver, imageAlt: "Foto", showConfirmButton: false, showCloseButton: true, width: "auto", padding: "1rem" }));
      g.querySelectorAll("[data-fdel]").forEach(b => b.onclick = async () => {
        if (!(await confirmar("¿Borrar esta foto?", "Se elimina del almacenamiento y libera espacio."))) return;
        try { await borrarFotos(fs.filter(f => f.id === b.dataset.fdel)); ok("Foto borrada"); pintarGaleria(); } catch (e) { ko(e.message); }
      });
      g.dataset.n = fs.length;
    } catch (e) { g.innerHTML = `<small>No se pudieron cargar las fotos: ${esc(e.message)}</small>`; }
  };
  const anadirFotos = camara => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = !camara;
    if (camara) inp.setAttribute("capture", "environment");
    inp.onchange = async () => {
      const g = document.getElementById("galeria"); let n = +(g?.dataset.n || 0);
      for (const f of inp.files) {
        if (n >= FOTOS_MAX_POR_PRESUPUESTO) { aviso(`Máximo ${FOTOS_MAX_POR_PRESUPUESTO} fotos por presupuesto`); break; }
        try {
          Swal.fire({ title: "Comprimiendo y subiendo…", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
          const r = await subirFoto(p, f); n++; Swal.close();
          ok(`Foto añadida (${(r.original / 1048576).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB → ${Math.round(r.final / 1024)} KB)`);
        } catch (e) { Swal.close(); await ko(e.message); break; }
      }
      pintarGaleria();
    };
    inp.click();
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
      pintarGaleria();
      document.getElementById("foto-cam").onclick = () => anadirFotos(true);
      document.getElementById("foto-gal").onclick = () => anadirFotos(false);
      document.getElementById("print").onclick = () => viewPrint(p, { ...p, lineas: s.lineas, margen: s.margen, notas: s.notas, anticipo: +s.anticipo || 0, anticipo_forma: s.anticipo_forma, km: s.km === "" ? null : +s.km }, calc(s.lineas, s.margen), () => viewForm(p, {}, back));
      document.getElementById("close").onclick = async () => {
        if (!(await confirmar("¿Cerrar este presupuesto?", "Úsalo cuando el trabajo ya esté hecho. Se guardarán los cambios y quedará bloqueado; podrás reabrirlo si hace falta.", "Sí, cerrar", false))) return;
        guardar({ cerrar: true });
      };
      document.getElementById("dup").onclick = () => { p = null; s.estado = "pendiente"; s.anticipo = ""; render(); info("Copia lista: revisa y pulsa Guardar"); };
      document.getElementById("del").onclick = async () => {
        if (!(await confirmar("¿Borrar este presupuesto?", "Esta acción no se puede deshacer. También se borrarán sus fotos."))) return;
        if (!p._pend) {
          if (!navigator.onLine) return aviso("Para borrar un presupuesto necesitas conexión (así se liberan también sus fotos).");
          try { await borrarFotosDePresupuesto(p.id); } catch (e) { return ko(e.message); }
        }
        borrar("presupuestos", p.id); ok("Presupuesto borrado"); back();
      };
    }
  };

  const guardar = (opts = {}) => {
    if (opts.cerrar && !s.lineas.some(l => String(l.desc).trim())) return aviso("Añade al menos una línea antes de cerrar");
    if (s.cliente_id === "new" && !s.nc.nombre.trim()) return aviso("Falta el nombre del cliente");
    if (!s.cliente_id && !(p && p.cliente)) return aviso("Elige un cliente o crea uno nuevo");
    const nuevoVeh = s.vehiculo_id === "new" || (s.cliente_id === "new" && (s.nv.vehiculo.trim() || s.nv.matricula.trim()));
    if (nuevoVeh && !s.nv.vehiculo.trim() && !s.nv.matricula.trim()) return aviso("Pon marca y modelo o la matrícula del vehículo");
    let cli = null, veh = null, cid = s.cliente_id, vid = s.vehiculo_id;
    if (cid === "new") { cli = insertar("clientes", { nombre: s.nc.nombre.trim(), apellidos: s.nc.apellidos.trim(), telefono: s.nc.telefono, email: s.nc.email }); cid = cli.id; clientes.push(cli); }
    else if (cid) cli = clientes.find(c => c.id === cid);
    if (nuevoVeh) { veh = insertar("vehiculos", { cliente_id: cid, vehiculo: s.nv.vehiculo.trim(), matricula: s.nv.matricula.trim(), anio: s.nv.anio ? +s.nv.anio : null }); vid = veh.id; vehiculos.push(veh); }
    else if (vid) veh = vehiculos.find(v => v.id === vid);

    const row = {
      cliente_id: cid || null, vehiculo_id: vid || null, km: s.km === "" ? null : +s.km,
      cliente: cli ? nombreC(cli) : p.cliente, telefono: cli ? cli.telefono : p?.telefono,
      vehiculo: veh ? veh.vehiculo : (cli ? "" : p?.vehiculo), matricula: veh ? veh.matricula : (cli ? "" : p?.matricula),
      notas: s.notas, notas_internas: s.notas_internas || null, anticipo: Math.max(0, +s.anticipo || 0), anticipo_forma: s.anticipo_forma === "bizum" ? "bizum" : "efectivo",
      estado: opts.cerrar ? "cerrado" : s.estado, margen: +s.margen || 0, iva: 0,
      ...(opts.cerrar ? { cerrado_at: new Date().toISOString() } : {}),
      ...(p && p.taller ? {} : { taller: taller(), taller_datos: datosTallerTxt() }),
      lineas: s.lineas.filter(l => String(l.desc).trim()).map(l => ({ ...l, cant: +l.cant || 0, precio: +l.precio || 0 })),
      total: calc(s.lineas, s.margen).total
    };
    if (p) actualizar("presupuestos", p.id, row); else insertar("presupuestos", row);
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
  doc.setFont("helvetica", "bold").setFontSize(16).text(`${tipo.toUpperCase()} Nº ${num(p)}`, 196, 18, { align: "right" });
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
  doc.setFont("helvetica", "normal").setFontSize(10);
  const ant = +s.anticipo || 0;
  if (s.pagado) { y += 7; doc.text(`Pagado el ${fecha(s.pagado_at)}: ${textoPago(s)}`, 196, y, { align: "right" }); }
  else if (ant > 0) {
    y += 7; doc.text(`Anticipo entregado (${s.anticipo_forma === "bizum" ? "bizum" : "efectivo"}): -${eurPdf(ant)}`, 196, y, { align: "right" });
    y += 7; doc.setFont("helvetica", "bold").setFontSize(12).text(`RESTA POR PAGAR: ${eurPdf(Math.max(0, t.total - ant))}`, 196, y, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(10);
  }
  if (s.notas) doc.text(doc.splitTextToSize(String(s.notas), 182), 14, y + 10); // las notas internas NO se imprimen nunca
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
  const t = calc(s.lineas, s.margen), name = `${slug(tipo)}-${num(p)}-${slug(s.cliente)}.pdf`;
  const texto = `Hola ${s.cliente}, te envío tu ${tipo.toLowerCase()} nº ${num(p)} de ${s.taller || taller()}. Total: ${eurPdf(t.total)}. Gracias.`;
  const file = new File([doc.output("blob")], name, { type: "application/pdf" });
  // Móvil: se comparte el PDF directamente (aparece WhatsApp en la lista)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: texto }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  // Ordenador: WhatsApp Web no permite adjuntar por enlace → se descarga el PDF y se abre el chat con el mensaje
  doc.save(name);
  window.open(`https://wa.me/${telWhatsApp(s.telefono)}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  info("PDF descargado. Arrástralo al chat de WhatsApp para enviarlo.", 6000);
}

// ---------- Vista de documento (imprimir / PDF / WhatsApp / solo lectura) ----------
function viewPrint(p, s, t, back = viewList, extra = null) {
  if (!session) return viewAuth();
  nav("list");
  let tipo = ["aceptado", "cerrado"].includes(p.estado) ? "Factura" : "Presupuesto";
  const rows = lineasCliente(s.lineas, s.margen);
  const datos = lineasDatos(s.taller_datos ?? datosTallerTxt()).map(esc).join("<br>");
  const ant = +s.anticipo || 0;
  const render = () => {
    $app.innerHTML = `
    <div class="card doc">
      <div class="row" style="align-items:flex-start;justify-content:space-between">
        <div><h2 style="margin:0">${esc(s.taller || taller())}</h2><small>${datos}</small></div>
        <div class="right"><h2 style="margin:0">${tipo} nº ${num(p)}</h2>${fecha(p.created_at)}${p.estado === "cerrado" ? `<br><span class="tag cerrado">cerrado el ${fecha(p.cerrado_at || p.created_at)}</span> <span class="tag ${p.pagado ? "aceptado" : "pendiente"}">${p.pagado ? `cobrado el ${fecha(p.pagado_at)} · ${esc(textoPago(p))}` : "pendiente de cobro"}</span>` : ""}</div>
      </div>
      <p><b>${esc(s.cliente)}</b> ${esc(s.telefono)}<br>${esc(s.vehiculo)} ${esc(s.matricula)}${s.km != null && s.km !== "" ? " · " + Number(s.km).toLocaleString("es-ES") + " km" : ""}</p>
      <table><tr><th>Descripción</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.desc)}</td><td class="n">${r.cant}</td><td class="n">${eur(r.precio)}</td><td class="n">${eur(r.importe)}</td></tr>`).join("")}
      </table>
      <p class="tot">Total <b>${eur(t.total)}</b>${ant > 0 && !s.pagado ? `<br><small>Anticipo −${eur(ant)} · Resta por pagar <b>${eur(Math.max(0, t.total - ant))}</b></small>` : ""}</p>
      ${s.notas ? `<p>${esc(s.notas)}</p>` : ""}
      <div id="galeria" class="galeria"></div>
      <div class="actions no-print">
        <select id="tipo" style="width:auto"><option ${tipo === "Presupuesto" ? "selected" : ""}>Presupuesto</option><option ${tipo === "Factura" ? "selected" : ""}>Factura</option></select>
        <button class="primary" id="pdf">Descargar PDF</button>
        <button id="wa">Enviar por WhatsApp</button>
        <button id="prt">Imprimir</button>
        ${extra?.cobro ? `<button id="cobro" class="cerrar">${p.pagado ? "Anular cobro" : "💶 Marcar como cobrado"}</button>` : ""}
        ${extra?.reabrir ? `<button id="reab">Reabrir presupuesto</button>` : ""}
        <button id="b">Volver</button>
      </div>
    </div>`;
    document.getElementById("tipo").onchange = e => { tipo = e.target.value; render(); };
    document.getElementById("pdf").onclick = () => { try { buildPdf(p, s, tipo).save(`${slug(tipo)}-${num(p)}-${slug(s.cliente)}.pdf`); } catch (e) { ko(e.message); } };
    document.getElementById("wa").onclick = () => enviarWhatsApp(p, s, tipo);
    document.getElementById("prt").onclick = () => print();
    document.getElementById("b").onclick = back;
    if (extra?.reabrir) document.getElementById("reab").onclick = extra.reabrir;
    if (extra?.cobro) document.getElementById("cobro").onclick = extra.cobro;
    mostrarFotos();
  };
  const mostrarFotos = async () => {
    const g = document.getElementById("galeria"); if (!g || !navigator.onLine || p._pend) return;
    const propia = !!extra?.cobro; // en tus presupuestos cerrados también puedes borrar fotos (para liberar espacio)
    try {
      const fs = await fotosDe(p.id);
      if (!fs.length) { g.innerHTML = ""; return; }
      g.innerHTML = `<h4 class="no-print" style="width:100%;margin:.4rem 0 0">📷 Fotos</h4>` + fs.map(f => `<figure><img src="${esc(f.url)}" alt="Foto" loading="lazy">${propia ? `<figcaption class="no-print">${Math.round(f.bytes / 1024)} KB <button data-fdel="${f.id}" class="danger" title="Borrar foto">🗑 Borrar</button></figcaption>` : ""}</figure>`).join("");
      g.querySelectorAll("img").forEach(i => i.onclick = () => Swal.fire({ imageUrl: i.src, showConfirmButton: false, showCloseButton: true, width: "auto", padding: "1rem" }));
      g.querySelectorAll("[data-fdel]").forEach(b => b.onclick = async () => {
        if (!(await confirmar("¿Borrar esta foto?", "Se elimina del almacenamiento y libera espacio."))) return;
        try { await borrarFotos(fs.filter(f => f.id === b.dataset.fdel)); ok("Foto borrada"); mostrarFotos(); } catch (e) { ko(e.message); }
      });
    } catch { /* sin permisos o sin conexión: se muestra el documento sin fotos */ }
  };
  render();
}

// ---------- Gastos fijos del taller ----------
const CATEGORIAS = ["Alquiler", "Luz, agua e internet", "Herramientas y equipos", "Seguros", "Sueldos / autónomos", "Otros"];
function viewGastos(editId = null) {
  if (!session) return viewAuth();
  if (!usaGastos()) return viewHome();
  nav("gastos");
  const admin = isAdmin(), hoy = new Date(), idxHoy = hoy.getFullYear() * 12 + hoy.getMonth();
  const lista = [...D.t.gastos].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const e = editId ? D.t.gastos.find(g => g.id === editId) : null;
  const ro = !!e && e.user_id !== me();
  const f = e ? { ...e, hasta: e.hasta || "" } : { concepto: "", categoria: CATEGORIAS[0], importe: "", fecha: hoyISO(), mensual: false, hasta: "" };
  const esteMes = r2(lista.reduce((a, g) => a + gastoEnMes(g, idxHoy), 0));
  const fijoMensual = r2(lista.filter(g => g.mensual && gastoEnMes(g, idxHoy) > 0).reduce((a, g) => a + (+g.importe), 0));
  $app.innerHTML = `
  <div class="kpis"><div class="kpi"><span>Gastos de este mes</span><b>${eur(esteMes)}</b><small>fijos + puntuales</small></div>
  <div class="kpi"><span>Gastos que se repiten</span><b>${eur(fijoMensual)}</b><small>cada mes</small></div></div>
  <div class="cols">
    <div class="card">
      <h3>${e ? (ro ? "Gasto (solo lectura)" : "Editar gasto") : "Nuevo gasto"}</h3>
      <p class="hint">Apunta lo que cuesta mantener el taller (alquiler, luz, herramientas…). Se restan de tus ingresos para calcular la ganancia neta en Inicio.</p>
      <label>Concepto *</label><input data-g="concepto" placeholder="Ej.: Alquiler del local" value="${esc(f.concepto)}" ${ro ? "disabled" : ""}>
      <div class="row">
        <div><label>Categoría</label><select data-g="categoria" ${ro ? "disabled" : ""}>${CATEGORIAS.map(c => `<option ${f.categoria === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div><label>Importe (€) *</label><input data-g="importe" type="number" step="any" min="0" value="${f.importe}" ${ro ? "disabled" : ""}></div>
        <div><label>Fecha</label><input data-g="fecha" type="date" value="${esc(String(f.fecha).slice(0, 10))}" ${ro ? "disabled" : ""}></div>
      </div>
      <label class="chk"><input type="checkbox" data-g="mensual" ${f.mensual ? "checked" : ""} ${ro ? "disabled" : ""}> Se repite cada mes</label>
      <div id="hastaBox" ${f.mensual ? "" : "hidden"}><label>Hasta (opcional)</label><input data-g="hasta" type="date" value="${esc(f.hasta)}" ${ro ? "disabled" : ""}><p class="hint">Déjalo vacío si el gasto sigue activo. Cuenta desde el mes de la fecha indicada.</p></div>
      <div class="actions">${ro ? "" : `<button class="primary" id="gsave">${e ? "Guardar cambios" : "Añadir gasto"}</button>`}${e ? `<button id="gnew">Cancelar</button>` : ""}${e && !ro ? `<button id="gdel" class="danger">Borrar</button>` : ""}</div>
    </div>
    <div class="card">
      <h3>Tus gastos</h3>
      ${lista.length ? lista.map(g => `<div class="hist gasto" data-gid="${g.id}"><span>${esc(g.concepto)}${admin ? ` <small>· ${esc(g.email || "?")}</small>` : ""}<br><small>${esc(g.categoria || "")} · ${fecha(g.fecha)}${g.mensual ? ` · <b>cada mes</b>${g.hasta ? " hasta " + fecha(g.hasta) : ""}` : ""}</small></span><span></span><span class="right"><b>${eur(g.importe)}</b>${g._pend ? " ⏳" : ""}</span></div>`).join("") : `<p class="hint">Aún no has apuntado ningún gasto.</p>`}
    </div>
  </div>`;
  const campos = { ...f };
  $app.querySelectorAll("[data-g]").forEach(el => {
    el.oninput = el.onchange = () => {
      campos[el.dataset.g] = el.type === "checkbox" ? el.checked : el.value;
      if (el.dataset.g === "mensual") document.getElementById("hastaBox").hidden = !el.checked;
    };
  });
  $app.querySelectorAll("[data-gid]").forEach(el => el.onclick = () => viewGastos(el.dataset.gid));
  const n = document.getElementById("gnew"); if (n) n.onclick = () => viewGastos();
  const sv = document.getElementById("gsave");
  if (sv) sv.onclick = () => {
    if (!String(campos.concepto).trim()) return aviso("Pon el concepto del gasto");
    if (campos.importe === "" || isNaN(+campos.importe) || +campos.importe < 0) return aviso("Pon un importe válido");
    const row = { concepto: String(campos.concepto).trim(), categoria: campos.categoria, importe: +campos.importe, fecha: campos.fecha || hoyISO(), mensual: !!campos.mensual, hasta: campos.mensual && campos.hasta ? campos.hasta : null };
    if (e) { actualizar("gastos", e.id, row); ok("Gasto guardado"); } else { insertar("gastos", row); ok("Gasto añadido"); }
    viewGastos();
  };
  const dl = document.getElementById("gdel");
  if (dl) dl.onclick = async () => { if (await confirmar("¿Borrar este gasto?", "Dejará de contar en tus números.")) { borrar("gastos", e.id); ok("Gasto borrado"); viewGastos(); } };
}

// ---------- Exportar y copia de seguridad (funciona con la copia local, también sin conexión) ----------
function construirExcel() {
  const admin = isAdmin(), pres = D.t.presupuestos, cli = D.t.clientes, veh = D.t.vehiculos, gas = D.t.gastos;
  const cliPorId = Object.fromEntries(cli.map(c => [c.id, c]));
  const mec = e => admin ? { "Mecánico": e } : {};
  const p = pres.map(q => { const d = desglose(q); return { "Nº": num(q), ...mec(q.email), "Fecha": fecha(q.created_at), "Estado": q.estado, "Cerrado el": q.cerrado_at ? fecha(q.cerrado_at) : "", "Cobrado": q.estado === "cerrado" ? (q.pagado ? "Sí" : "No") : "", "Cobrado el": q.pagado_at ? fecha(q.pagado_at) : "", "Cobrado en efectivo €": q.pagado ? pagoPorVia(q).efectivo : "", "Cobrado por bizum €": q.pagado ? pagoPorVia(q).bizum : "", "Anticipo €": +q.anticipo || 0, "Anticipo en": +q.anticipo > 0 ? q.anticipo_forma || "efectivo" : "", "Cliente": q.cliente, "Teléfono": q.telefono || "", "Vehículo": q.vehiculo || "", "Matrícula": q.matricula || "", "Km": q.km ?? "", "Margen piezas %": q.margen, "Mano de obra €": d.mano, "Coste piezas €": d.coste, "Total cliente €": d.total, "Ganancia €": d.ganancia, "Observaciones": q.notas || "", "Notas internas": q.notas_internas || "" }; });
  const l = pres.flatMap(q => (q.lineas || []).filter(x => String(x.desc).trim()).map(x => ({ "Presupuesto Nº": num(q), ...mec(q.email), "Cliente": q.cliente, "Tipo": x.tipo === "pieza" ? "Pieza" : "Mano de obra", "Descripción": x.desc, "Cantidad / horas": +x.cant || 0, "Precio coste o por hora €": +x.precio || 0, "Precio al cliente €": pvp(x, q.margen), "Importe €": r2((+x.cant || 0) * pvp(x, q.margen)) })));
  const c = cli.map(x => ({ ...mec(x.email_mecanico), "Nombre": x.nombre, "Apellidos": x.apellidos || "", "Teléfono": x.telefono || "", "Email": x.email || "", "Notas": x.notas || "" }));
  const v = veh.map(x => ({ ...mec(cliPorId[x.cliente_id]?.email_mecanico), "Cliente": cliPorId[x.cliente_id] ? nombreC(cliPorId[x.cliente_id]) : "", "Vehículo": x.vehiculo || "", "Matrícula": x.matricula || "", "Año": x.anio ?? "" }));
  const g = gas.map(x => ({ ...mec(x.email), "Concepto": x.concepto, "Categoría": x.categoria || "", "Importe €": +x.importe, "Fecha": fecha(x.fecha), "Se repite cada mes": x.mensual ? "Sí" : "No", "Hasta": x.hasta ? fecha(x.hasta) : "" }));
  const wb = XLSX.utils.book_new();
  [["Presupuestos", p], ["Líneas", l], ["Clientes", c], ["Vehículos", v], ...(usaGastos() ? [["Gastos fijos", g]] : [])].forEach(([n, f]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(f.length ? f : [{ "(sin datos)": "" }]), n));
  return wb;
}
function exportarDatos(formato) {
  try {
    const hoy = hoyISO();
    if (formato === "json") {
      descargar(new Blob([JSON.stringify({ exportado: new Date().toISOString(), usuario: session.user.email, perfil, presupuestos: D.t.presupuestos, clientes: D.t.clientes, vehiculos: D.t.vehiculos, gastos: D.t.gastos }, null, 2)], { type: "application/json" }), `copia-taller-${hoy}.json`);
    } else {
      if (!window.XLSX) return ko("No se pudo cargar el módulo de Excel. Revisa la conexión e inténtalo de nuevo.");
      XLSX.writeFile(construirExcel(), `datos-taller-${hoy}.xlsx`);
    }
    ok(`Descarga lista: ${D.t.presupuestos.length} presupuestos, ${D.t.clientes.length} clientes`);
  } catch (e) { ko(e.message); }
}
// Resumen trimestral para el gestor: ingresos (trabajos cerrados), gastos de piezas y gastos fijos, en CSV para Excel
function exportarTrimestre(anio, trim) {
  const admin = isAdmin(), m0 = trim ? (trim - 1) * 3 : 0, m1 = trim ? m0 + 2 : 11, idx0 = anio * 12 + m0, idx1 = anio * 12 + m1;
  const cab = ["Fecha", "Tipo", "Nº", "Cliente / concepto", "Importe €", "Cobrado", "Forma de pago", ...(admin ? ["Mecánico"] : [])];
  const filas = [cab], mec = e => admin ? [e || ""] : [];
  let ing = 0, gp = 0, gf = 0;
  D.t.presupuestos.filter(q => q.estado === "cerrado" && mesIdx(q.cerrado_at || q.created_at) >= idx0 && mesIdx(q.cerrado_at || q.created_at) <= idx1)
    .sort((a, b) => String(a.cerrado_at || a.created_at).localeCompare(String(b.cerrado_at || b.created_at))).forEach(q => {
      const d = desglose(q); ing += d.total; gp += d.coste;
      filas.push([fecha(q.cerrado_at || q.created_at), "Ingreso", num(q), q.cliente, d.total, q.pagado ? "Sí" : "No", q.pagado ? textoPago(q) : "", ...mec(q.email)]);
      if (d.coste > 0) filas.push([fecha(q.cerrado_at || q.created_at), "Gasto piezas", num(q), q.cliente, -d.coste, "", "", ...mec(q.email)]);
    });
  if (usaGastos()) for (let i = idx0; i <= idx1; i++) D.t.gastos.forEach(g => {
    const imp = gastoEnMes(g, i); if (imp <= 0) return; gf += imp;
    filas.push([`01/${String((i % 12) + 1).padStart(2, "0")}/${Math.floor(i / 12)}`, "Gasto fijo", "", `${g.concepto}${g.categoria ? " (" + g.categoria + ")" : ""}`, -imp, "", "", ...mec(g.email)]);
  });
  filas.push([], ["", "TOTAL INGRESOS", "", "", r2(ing)], ["", "TOTAL GASTOS DE PIEZAS", "", "", -r2(gp)], ...(usaGastos() ? [["", "TOTAL GASTOS FIJOS", "", "", -r2(gf)]] : []), ["", usaGastos() ? "GANANCIA NETA" : "GANANCIA", "", "", r2(ing - gp - gf)]);
  descargar(new Blob([csv(filas)], { type: "text/csv;charset=utf-8" }), `resumen-${anio}-${trim ? "T" + trim : "anual"}.csv`);
  ok(`Resumen ${trim ? "T" + trim : "anual"} ${anio} descargado`);
}

// ---------- Perfil ----------
async function cargarPerfil() {
  const clave = `taller:${me()}:perfil`;
  try {
    if (!navigator.onLine) throw new Error("offline");
    const r = await db.from("perfiles").select("*").eq("user_id", me()).maybeSingle();
    if (r.error) throw r.error;
    perfil = r.data || {};
    try { localStorage.setItem(clave, JSON.stringify(perfil)); } catch {}
  } catch { try { perfil = JSON.parse(localStorage.getItem(clave)) || {}; } catch { perfil = {}; } }
  aplicarMarca();
}
async function registrarAcceso() { // para que el administrador vea quién usa la app
  if (!navigator.onLine) return;
  try { await db.from("perfiles").upsert({ user_id: me(), ultimo_acceso: new Date().toISOString() }); } catch {}
}

function viewPerfil() {
  if (!session) return viewAuth();
  nav("profile");
  const p = { taller: perfil.taller || "", datos: perfil.datos || "", margen_defecto: perfil.margen_defecto ?? "", precio_hora: perfil.precio_hora ?? "", objetivo_mensual: perfil.objetivo_mensual ?? "" };
  const anioHoy = new Date().getFullYear();
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
      <div class="card">
        <h3>🎯 Objetivo mensual <small>(opcional)</small></h3>
        <label>Ingresos que quieres alcanzar cada mes (€)</label>
        <input data-p="objetivo_mensual" type="number" step="any" min="0" placeholder="Déjalo vacío si no quieres usarlo" value="${esc(p.objetivo_mensual)}">
        <p class="hint">Si lo pones, Inicio muestra una barra con lo que llevas este mes (trabajos cerrados) frente al objetivo.</p>
      </div>
      <div class="actions"><button class="primary" id="psave">Guardar cambios</button></div>
    </div>
    <div>
      <div class="card">
        <h3>Mi cuenta</h3>
        <p>${esc(session.user.email)}${isAdmin() ? ' <span class="tag aceptado">administrador</span>' : ""}</p>
      </div>
      <div class="card">
        <h3>📷 Espacio de fotos</h3>
        <div id="uso"><small>Calculando…</small></div>
        <div class="row" style="margin-top:.6rem">
          <div><label>Borrar fotos de trabajos cerrados hace más de…</label>
            <select id="meses"><option value="6">6 meses</option><option value="12" selected>12 meses</option><option value="24">24 meses</option></select></div>
          <div style="align-self:end"><button id="liberar">Liberar espacio</button></div>
        </div>
        <p class="hint">Las fotos se comprimen solas al subirlas. Si el espacio se llena, aquí puedes borrar las de trabajos antiguos ya cerrados (los presupuestos se conservan).</p>
      </div>
      <div class="card">
        <h3>Mis datos y copia de seguridad</h3>
        <p class="hint">Descarga todo lo que tienes guardado (presupuestos, líneas, clientes y vehículos). Hazlo de vez en cuando: así no dependes de nadie si algo falla.${isAdmin() ? " Como administrador, incluye los datos de todos los mecánicos." : ""}</p>
        <div class="actions"><button id="xlsx" class="primary">📥 Descargar Excel</button><button id="json">📦 Copia de seguridad (JSON)</button></div>
        ${window.CONFIG.GESTOR === true ? `<h4 style="margin:1rem 0 .2rem">Resumen para el gestor</h4>
        <p class="hint">Ingresos, gastos de piezas y gastos fijos de un trimestre, en un CSV que abre Excel.</p>
        <div class="row">
          <div><select id="t-anio">${[anioHoy, anioHoy - 1, anioHoy - 2].map(a => `<option>${a}</option>`).join("")}</select></div>
          <div><select id="t-trim"><option value="1">1.er trimestre (ene–mar)</option><option value="2">2.º trimestre (abr–jun)</option><option value="3">3.er trimestre (jul–sep)</option><option value="4">4.º trimestre (oct–dic)</option><option value="0">Año completo</option></select></div>
          <div><button id="tri">📄 Descargar CSV</button></div>
        </div>` : ""}
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
  const tt = document.getElementById("t-trim"); if (tt) tt.value = String(Math.floor(new Date().getMonth() / 3) + 1);
  $app.querySelectorAll("[data-p]").forEach(el => el.oninput = () => { p[el.dataset.p] = el.value; });
  document.getElementById("psave").onclick = async () => {
    const num_ = v => v === "" || v == null ? null : +v;
    const row = { user_id: me(), taller: p.taller.trim() || null, datos: p.datos.trim() || null, margen_defecto: num_(p.margen_defecto), precio_hora: num_(p.precio_hora), objetivo_mensual: num_(p.objetivo_mensual), updated_at: new Date().toISOString() };
    if ([row.margen_defecto, row.precio_hora, row.objetivo_mensual].some(v => v != null && (isNaN(v) || v < 0))) return aviso("Revisa los números: no pueden ser negativos");
    if (!navigator.onLine) return aviso("Sin conexión: guarda el perfil cuando vuelva internet.");
    const { error } = await db.from("perfiles").upsert(row);
    if (error) return ko(error.message);
    perfil = { ...perfil, ...row }; aplicarMarca(); try { localStorage.setItem(`taller:${me()}:perfil`, JSON.stringify(perfil)); } catch {} ok("Perfil guardado");
  };
  document.getElementById("xlsx").onclick = () => exportarDatos("xlsx");
  document.getElementById("json").onclick = () => exportarDatos("json");
  const tri = document.getElementById("tri"); if (tri) tri.onclick = () => exportarTrimestre(+document.getElementById("t-anio").value, +document.getElementById("t-trim").value);
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
  pintarUso();
  document.getElementById("liberar").onclick = liberarEspacio;
}
async function pintarUso() {
  const box = document.getElementById("uso"); if (!box) return;
  if (!navigator.onLine) { box.innerHTML = `<small>Necesitas conexión para ver el espacio.</small>`; return; }
  try {
    const filas = await usoFotos(), admin = isAdmin();
    const mias = filas.filter(f => f.user_id === me()), bm = mias.reduce((a, f) => a + f.bytes, 0);
    const todas_ = filas.reduce((a, f) => a + f.bytes, 0), pct = todas_ / GB * 100;
    box.innerHTML = `<p><b>${mias.length}</b> fotos tuyas · <b>${mb(bm)}</b>${mias.length ? ` <small>(${Math.round(bm / mias.length / 1024)} KB de media)</small>` : ""}</p>
      ${admin ? `<p>Todo el taller: <b>${mb(todas_)}</b> de 1 GB gratis (${pct.toFixed(1)} %)</p><div class="barra ${pct >= 85 ? "roja" : pct >= 60 ? "ambar" : ""}"><div style="width:${Math.min(100, pct)}%"></div></div>` : ""}`;
  } catch (e) { box.innerHTML = `<small>No se pudo calcular: ${esc(e.message)}</small>`; }
}
async function liberarEspacio() {
  if (!navigator.onLine) return aviso("Necesitas conexión para borrar fotos.");
  const meses = +document.getElementById("meses").value, limite = new Date(); limite.setMonth(limite.getMonth() - meses);
  const ids = D.t.presupuestos.filter(q => q.user_id === me() && q.estado === "cerrado" && new Date(q.cerrado_at || q.created_at) < limite).map(q => q.id);
  if (!ids.length) return info("No hay trabajos cerrados de hace más de " + meses + " meses.");
  try {
    const fs = []; for (let i = 0; i < ids.length; i += 100) { const { data, error } = await db.from("fotos").select("*").in("presupuesto_id", ids.slice(i, i + 100)); if (error) throw error; fs.push(...data); }
    if (!fs.length) return info("Esos trabajos no tienen fotos.");
    const bytes = fs.reduce((a, f) => a + f.bytes, 0);
    if (!(await confirmar(`¿Borrar ${fs.length} fotos?`, `Se liberarán ${mb(bytes)}. Los presupuestos se conservan; solo se borran las fotos.`, "Sí, borrar fotos"))) return;
    await borrarFotos(fs); ok(`Liberados ${mb(bytes)}`); pintarUso();
  } catch (e) { ko(e.message); }
}

// ---------- Administración: mecánicos, actividad y espacio (solo administrador) ----------
async function llamarUsuarios(body) {
  const { data, error } = await db.functions.invoke("usuarios", { body });
  if (error) { let msg = error.message; try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch {} throw new Error(msg); }
  if (data?.error) throw new Error(data.error);
  return data;
}
const hace = d => { if (!d) return "nunca"; const dias = Math.floor((Date.now() - new Date(d)) / 86400000); return dias <= 0 ? "hoy" : dias === 1 ? "ayer" : dias < 30 ? `hace ${dias} días` : `hace ${Math.round(dias / 30)} mes(es)`; };
const claveAleatoria = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; const r = crypto.getRandomValues(new Uint32Array(14)); return [...r].map(n => a[n % a.length]).join(""); };

async function viewAdmin() {
  if (!session) return viewAuth();
  if (!isAdmin()) return viewHome();
  nav("admin"); loading();
  if (!navigator.onLine) { $app.innerHTML = `<p class="hint">La administración necesita conexión a internet.</p>`; return; }
  const [perf, fotos] = await Promise.all([db.from("perfiles").select("user_id,email,taller,ultimo_acceso"), usoFotos().catch(() => [])]);
  let usuarios = null, errFn = null;
  try { usuarios = (await llamarUsuarios({ accion: "listar" })).usuarios; } catch (e) { errFn = e.message; }
  const porId = Object.fromEntries((perf.data || []).map(p => [p.user_id, p]));
  const lista = usuarios ? usuarios.map(u => ({ id: u.id, email: u.email, creado: u.created_at, entro: u.last_sign_in_at, off: u.banned_until && new Date(u.banned_until) > new Date() }))
    : (perf.data || []).map(p => ({ id: p.user_id, email: p.email, creado: null, entro: null, off: false }));
  const filas = lista.map(u => {
    const q = D.t.presupuestos.filter(x => x.user_id === u.id), ult = [...q].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const fb = fotos.filter(f => f.user_id === u.id).reduce((a, f) => a + f.bytes, 0), pf = porId[u.id];
    return { ...u, taller: pf?.taller, acceso: pf?.ultimo_acceso || u.entro, n: q.length, cerrados: q.filter(x => x.estado === "cerrado").length, ult: ult?.created_at, fb };
  }).sort((a, b) => String(b.acceso || "").localeCompare(String(a.acceso || "")));
  const totalFotos = fotos.reduce((a, f) => a + f.bytes, 0), pct = totalFotos / GB * 100;
  $app.innerHTML = `
  <div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">🛡️ Administración</h2>${usuarios ? `<button class="primary" id="nuevoU" style="flex:0 0 auto">➕ Nuevo mecánico</button>` : ""}</div>
  ${errFn ? `<div class="card aviso-alm">La gestión de usuarios (crear, desactivar, cambiar contraseña) aún no está instalada en Supabase: ${esc(errFn)}. La actividad de abajo sí funciona.</div>` : ""}
  <div class="card"><h4 style="margin:0 0 .4rem">📷 Espacio de fotos de todo el taller</h4>
    <p style="margin:.2rem 0"><b>${mb(totalFotos)}</b> de 1 GB gratis (${pct.toFixed(1)} %) · ${fotos.length} fotos</p>
    <div class="barra ${pct >= 85 ? "roja" : pct >= 60 ? "ambar" : ""}"><div style="width:${Math.min(100, pct)}%"></div></div></div>
  <div class="card" style="overflow-x:auto"><h4 style="margin:0 0 .6rem">Mecánicos y actividad</h4>
  <table class="tabla"><tr><th>Mecánico</th><th>Último acceso</th><th class="n">Presupuestos</th><th class="n">Cerrados</th><th>Último presupuesto</th><th class="n">Fotos</th><th></th></tr>
  ${filas.map(u => `<tr class="${u.off ? "apagado" : ""}"><td><b>${esc(u.email)}</b>${u.id === me() ? " <small>(tú)</small>" : ""}${u.taller ? `<br><small>${esc(u.taller)}</small>` : ""}${u.off ? ` <span class="tag rechazado">desactivado</span>` : ""}</td>
    <td>${hace(u.acceso)}</td><td class="n">${u.n}</td><td class="n">${u.cerrados}</td><td>${u.ult ? hace(u.ult) : "—"}</td><td class="n">${mb(u.fb)}</td>
    <td>${usuarios && u.id !== me() ? `<button data-pw="${u.id}" data-em="${esc(u.email)}">Contraseña</button> <button data-off="${u.id}" data-em="${esc(u.email)}" data-estado="${u.off ? 1 : 0}" class="${u.off ? "" : "danger"}">${u.off ? "Activar" : "Desactivar"}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7">Aún no hay mecánicos.</td></tr>`}
  </table></div>`;
  const nu = document.getElementById("nuevoU");
  if (nu) nu.onclick = async () => {
    const r = await Swal.fire({ title: "Nuevo mecánico", html: `<input id="n-em" class="swal2-input" type="email" placeholder="Email (puede ser inventado, ej. toni@taller.local)"><input id="n-pw" class="swal2-input" type="text" placeholder="Contraseña (mín. 8)" value="${claveAleatoria()}"><p style="font-size:.8rem;opacity:.8">Apunta la contraseña y pásasela: después no se puede ver.</p>`, showCancelButton: true, confirmButtonText: "Crear", cancelButtonText: "Cancelar", confirmButtonColor: "#1f4fd8", focusConfirm: false,
      preConfirm: () => { const e = document.getElementById("n-em").value.trim(), p = document.getElementById("n-pw").value; if (!/^\S+@\S+\.\S+$/.test(e)) return Swal.showValidationMessage("Escribe un email válido"); if (p.length < 8) return Swal.showValidationMessage("La contraseña necesita al menos 8 caracteres"); return { e, p }; } });
    if (!r.isConfirmed) return;
    try { await llamarUsuarios({ accion: "crear", email: r.value.e, password: r.value.p }); ok("Mecánico creado"); viewAdmin(); } catch (e) { ko(e.message); }
  };
  $app.querySelectorAll("[data-pw]").forEach(b => b.onclick = async () => {
    const r = await Swal.fire({ title: "Nueva contraseña", text: b.dataset.em, input: "text", inputValue: claveAleatoria(), showCancelButton: true, confirmButtonText: "Cambiar", cancelButtonText: "Cancelar", confirmButtonColor: "#1f4fd8", inputValidator: v => v.length < 8 && "Mínimo 8 caracteres" });
    if (!r.isConfirmed) return;
    try { await llamarUsuarios({ accion: "contrasena", id: b.dataset.pw, password: r.value }); ok("Contraseña cambiada. Pásasela al mecánico."); } catch (e) { ko(e.message); }
  });
  $app.querySelectorAll("[data-off]").forEach(b => b.onclick = async () => {
    const off = b.dataset.estado === "1";
    if (!(await confirmar(off ? "¿Activar este mecánico?" : "¿Desactivar este mecánico?", off ? `${b.dataset.em} podrá volver a entrar.` : `${b.dataset.em} no podrá entrar, pero conserva todos sus datos.`, off ? "Sí, activar" : "Sí, desactivar", !off))) return;
    try { await llamarUsuarios({ accion: off ? "activar" : "desactivar", id: b.dataset.off }); ok(off ? "Mecánico activado" : "Mecánico desactivado"); viewAdmin(); } catch (e) { ko(e.message); }
  });
}

// ---------- Arranque ----------
db.auth.onAuthStateChange((_evento, sess) => {
  const antes = session?.user.id; session = sess;
  if (!sess) { perfil = {}; limpiarLocal(); aplicarMarca(); pintarEstado(); toggleAdminUI(); return viewAuth(); }
  if (antes === sess.user.id) return; // refresco de token o vuelta a la pestaña: no tocar lo que estás haciendo
  setTimeout(async () => { await cargarPerfil(); await iniciarDatos(); toggleAdminUI(); registrarAcceso(); viewHome(); setTimeout(avisarSiSeCerroConLaCamara, 700); }, 0);
});
viewAuth(); // estado inicial seguro: login hasta confirmar sesión
