// ===== Escáner de matrícula: OCR en el propio navegador (Tesseract.js). El lector se descarga solo la primera vez que se usa =====
// Método: 1) localizar dónde está la placa (una fila de 5-8 caracteres del mismo tamaño), 2) leer SOLO esa zona,
// 3) validar el formato español corrigiendo confusiones típicas (8/B, 0/D, 5/S…), 4) enseñar al usuario lo que se ha leído.
let _cargandoTess = null;
function cargarTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return (_cargandoTess ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = res;
    s.onerror = () => { _cargandoTess = null; rej(new Error("No se pudo cargar el lector de matrículas. Revisa la conexión.")); };
    document.head.appendChild(s);
  }));
}

// ---- formato de matrícula española ----
const CONSONANTES = "BCDFGHJKLMNPRSTVWXYZ";                     // las matrículas actuales no usan vocales, Ñ ni Q
const A_DIGITO = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", T: "7", B: "8" };
const A_LETRA = { 0: "D", 1: "L", 2: "Z", 5: "S", 6: "G", 7: "T", 8: "B", O: "D", Q: "D", I: "L", U: "V", E: "F", A: "R" };
// Cadena de 7 caracteres -> matrícula "1234 BCD" corrigiendo lo mínimo; coste = nº de caracteres corregidos
function ventanaPlaca(s) {
  let coste = 0, out = "";
  for (let i = 0; i < 7; i++) {
    const ch = s[i];
    if (i < 4) { if (/\d/.test(ch)) out += ch; else if (A_DIGITO[ch]) { out += A_DIGITO[ch]; coste++; } else return null; }
    else { if (CONSONANTES.includes(ch)) out += ch; else if (A_LETRA[ch]) { out += A_LETRA[ch]; coste++; } else return null; }
  }
  return { placa: `${out.slice(0, 4)} ${out.slice(4)}`, coste };
}
// Candidatos dentro del texto de UNA zona (no se mezclan textos de distintas partes de la foto)
function buscarPlacas(texto) {
  const s = String(texto).toUpperCase().replace(/[^A-Z0-9]/g, ""), r = [];
  for (let i = 0; i + 7 <= s.length; i++) {
    const v = ventanaPlaca(s.slice(i, i + 7));
    if (v && v.coste <= 2) r.push({ placa: v.placa, coste: v.coste + 0.25 * Math.max(0, s.length - 7 - 1) });
  }
  const viejo = s.match(/^E?([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/);   // formato antiguo: M-1234-AB (solo si la zona es exactamente eso)
  if (viejo) r.push({ placa: `${viejo[1]}-${viejo[2]}-${viejo[3]}`, coste: 1.5 });
  return r;
}

// ---- imagen ----
async function aCanvas(file, maxLado) {
  const img = await cargarImagen(file), w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight, k = Math.min(1, maxLado / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); img.close?.();
  return c;
}
function grises(c) {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, g = new Float32Array(c.width * c.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return g;
}
// Binarización local (compara cada punto con la media de su entorno): sirve con luz irregular, reflejos y poco contraste
function binarizarLocal(g, w, h, claroSobreOscuro) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let fila = 0; for (let x = 0; x < w; x++) { fila += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + fila; } }
  const r = Math.max(10, Math.round(w / 10)), bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const media = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const dif = claroSobreOscuro ? g[y * w + x] - media : media - g[y * w + x];
      bin[y * w + x] = dif > Math.max(14, media * 0.16) ? 1 : 0;
    }
  }
  return bin;
}
// Componentes conectados -> cajas {x0,y0,x1,y1,area}
function componentes(bin, w, h) {
  const lab = new Int32Array(w * h), par = [0]; let n = 0;
  const raiz = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!bin[i]) continue;
    const izq = x > 0 ? lab[i - 1] : 0, arr = y > 0 ? lab[i - w] : 0;
    if (!izq && !arr) { par[++n] = n; lab[i] = n; }
    else if (izq && arr) { const a = raiz(izq), b = raiz(arr); lab[i] = Math.min(a, b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
    else lab[i] = izq || arr;
  }
  const cajas = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = lab[y * w + x]; if (!l) continue; const r = raiz(l); let c = cajas.get(r);
    if (!c) cajas.set(r, c = { x0: x, y0: y, x1: x, y1: y, area: 0 });
    if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y; c.area++;
  }
  return [...cajas.values()];
}
// Busca filas de caracteres alineados y del mismo tamaño (así es una matrícula); devuelve las más probables
function filasDeCaracteres(cajas, W, H) {
  const chars = cajas.map(c => ({ ...c, w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1 }))
    .filter(c => c.h >= 0.035 * H && c.h <= 0.75 * H && c.w / c.h >= 0.1 && c.w / c.h <= 1.3 && c.area / (c.w * c.h) >= 0.16 && c.area / (c.w * c.h) <= 0.95)
    .sort((a, b) => a.x0 - b.x0);
  const filas = [];
  for (const c of chars) {
    const cy = (c.y0 + c.y1) / 2;
    const f = filas.find(f => Math.abs(f.cy - cy) < 0.35 * f.h && c.h / f.h > 0.72 && c.h / f.h < 1.38 && c.x0 - f.x1 < 1.5 * f.h);
    if (f) { f.items.push(c); f.x1 = Math.max(f.x1, c.x1); f.x0 = Math.min(f.x0, c.x0); f.y0 = Math.min(f.y0, c.y0); f.y1 = Math.max(f.y1, c.y1); f.h = f.items.reduce((a, i) => a + i.h, 0) / f.items.length; f.cy = f.items.reduce((a, i) => a + (i.y0 + i.y1) / 2, 0) / f.items.length; }
    else filas.push({ items: [c], x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, h: c.h, cy });
  }
  return filas.filter(f => f.items.length >= 5 && f.items.length <= 10)
    .map(f => ({ ...f, puntos: Math.min(f.items.length, 7) * 10 - Math.abs(f.items.length - 7) * 2 + (f.h / H) * 25 }))
    .sort((a, b) => b.puntos - a.puntos).slice(0, 3);
}
// Recorta la fila y la deja con caracteres de ~90 px de alto, con margen blanco (el OCR lo necesita)
function recortarFila(base, f, W, H) {
  const x0 = Math.max(0, f.x0 - 0.6 * f.h), x1 = Math.min(W, f.x1 + 0.6 * f.h), y0 = Math.max(0, f.y0 - 0.45 * f.h), y1 = Math.min(H, f.y1 + 0.45 * f.h);
  const k = Math.min(4, Math.max(0.4, 90 / f.h)), c = document.createElement("canvas");
  c.width = Math.round((x1 - x0) * k) + 48; c.height = Math.round((y1 - y0) * k) + 48;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = "high";
  g.drawImage(base, x0, y0, x1 - x0, y1 - y0, 24, 24, c.width - 48, c.height - 48);
  return c;
}
// Variantes de la misma zona: contraste estirado y blanco/negro puro (Otsu); si el texto era claro sobre oscuro se invierte
function variantes(c, invertir) {
  const g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height), p = d.data, n = c.width * c.height, gr = new Uint8Array(n), hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) { const y = Math.round(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]); gr[j] = y; hist[y]++; }
  let acc = 0, lo = 0, hi = 255; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } } acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const k = 255 / Math.max(30, hi - lo), est = new Uint8Array(n); for (let j = 0; j < n; j++) est[j] = Math.max(0, Math.min(255, (gr[j] - lo) * k));
  const h2 = new Array(256).fill(0); est.forEach(v => h2[v]++); let sum = 0; for (let v = 0; v < 256; v++) sum += v * h2[v];
  let sb = 0, wb = 0, mx = 0, t = 128; for (let v = 0; v < 256; v++) { wb += h2[v]; if (!wb) continue; const wf = n - wb; if (!wf) break; sb += v * h2[v]; const mb_ = sb / wb, mf = (sum - sb) / wf, e = wb * wf * (mb_ - mf) ** 2; if (e > mx) { mx = e; t = v; } }
  const mk = f => { const o = document.createElement("canvas"); o.width = c.width; o.height = c.height; const og = o.getContext("2d"), od = og.createImageData(c.width, c.height); for (let j = 0, i = 0; j < n; j++, i += 4) { let v = f(est[j]); if (invertir) v = 255 - v; od.data[i] = od.data[i + 1] = od.data[i + 2] = v; od.data[i + 3] = 255; } og.putImageData(od, 0, 0); return o; };
  return [mk(v => v), mk(v => v > t ? 255 : 0)];
}

// ---- lectura ----
async function leerMatricula(file) {
  await cargarTesseract();
  const base = await aCanvas(file, 1400), W = base.width, H = base.height, g = grises(base);
  // 1) localizar zonas (texto oscuro sobre claro; si no aparece nada, claro sobre oscuro)
  let zonas = [];
  for (const inv of [false, true]) {
    const filas = filasDeCaracteres(componentes(binarizarLocal(g, W, H, inv), W, H), W, H);
    zonas.push(...filas.map(f => ({ f, inv })));
    if (zonas.length) break;
  }
  const cand = new Map();
  const añadir = (p, score, vista) => {
    const c = cand.get(p);
    if (!c) cand.set(p, { placa: p, score, votos: 1, vista });
    else { c.votos++; if (score > c.score) { c.score = score; c.vista = vista; } c.score += 6; } // varias lecturas iguales dan más confianza
  };
  const worker = await Tesseract.createWorker("eng");
  let vistaZona = null;
  try {
    // 2) leer cada zona como UNA línea de texto, con lista de caracteres válidos
    await worker.setParameters({ tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", tessedit_pageseg_mode: "7" });
    for (const z of zonas) {
      const rec = recortarFila(base, z.f, W, H); vistaZona ||= rec.toDataURL("image/jpeg", 0.8);
      for (const v of variantes(rec, z.inv)) {
        const { data } = await worker.recognize(v);
        for (const c of buscarPlacas(data.text)) añadir(c.placa, data.confidence - 18 * c.coste, rec.toDataURL("image/jpeg", 0.8));
      }
    }
    // 3) plan B si no se encontró ninguna zona: imagen entera, sin lista de caracteres, y solo se aceptan lecturas exactas por línea
    if (!cand.size && !zonas.length) {
      await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "11" });
      const { data } = await worker.recognize(base);
      for (const l of (data.lines || [])) for (const c of buscarPlacas(l.text)) if (c.coste === 0 && l.confidence >= 70) añadir(c.placa, l.confidence - 10, null);
    }
  } finally { await worker.terminate(); }
  const lista = [...cand.values()].sort((a, b) => b.score - a.score);
  return { candidatos: lista, matricula: lista[0]?.placa || null, confianza: lista[0]?.score ?? 0, vista: lista[0]?.vista || vistaZona, zonas: zonas.length };
}

// Abre la cámara (o la galería), lee la matrícula y deja confirmarla o corregirla. Devuelve la matrícula o null.
function escanearMatricula() {
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture", "environment");
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      if (!navigator.onLine) { await ko("El escáner necesita conexión la primera vez, para descargar el lector."); return resolve(null); }
      Swal.fire({ title: "Leyendo matrícula…", html: "La primera vez descarga el lector (unos 10 MB); después es rápido.", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      let r = { candidatos: [], matricula: null, confianza: 0, vista: null };
      try { r = await leerMatricula(f); } catch (e) { Swal.close(); await ko(e.message); }
      const seguro = r.matricula && ((r.candidatos[0]?.votos ?? 0) >= 2 || r.confianza >= 60), otras = r.candidatos.slice(1, 3).map(c => c.placa);
      const v = await Swal.fire({
        icon: r.vista ? undefined : (seguro ? "success" : "question"), imageUrl: r.vista || undefined, imageHeight: 90, imageAlt: "Zona leída",
        title: seguro ? "He leído esta matrícula" : r.matricula ? "No estoy seguro" : "No he podido leerla",
        html: seguro ? "Compruébala con la imagen y corrígela si hace falta."
          : "Escríbela tú. Para que salga bien: acércate hasta que la matrícula llene la foto, de frente y sin reflejos.",
        footer: otras.length ? `Otras lecturas posibles: <b>${otras.join("</b> · <b>")}</b>` : undefined,
        input: "text", inputValue: r.matricula || "", inputPlaceholder: "1234 ABC",
        showCancelButton: true, confirmButtonText: "Usar", cancelButtonText: "Cancelar", confirmButtonColor: "#1f4fd8",
        inputValidator: x => !x.trim() && "Escribe la matrícula"
      });
      resolve(v.isConfirmed ? v.value.trim().toUpperCase() : null);
    };
    inp.click();
  });
}
