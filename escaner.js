// ===== Escáner de matrícula: OCR en el propio navegador (Tesseract.js). El lector se descarga solo la primera vez que se usa =====
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

const CONSONANTES = "BCDFGHJKLMNPRSTVWXYZ";
// Busca una matrícula española en el texto leído: "1234 BCD" (actual) o "M-1234-AB" (antigua)
function extraerMatricula(texto) {
  const compacto = String(texto).toUpperCase().replace(/[^A-Z0-9]/g, "");
  let m = compacto.match(new RegExp(`(\\d{4})([${CONSONANTES}]{3})`));
  if (m) return `${m[1]} ${m[2]}`;
  m = compacto.match(/([A-Z]{1,2})(\d{4})([A-Z]{1,2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Pasa a grises y sube el contraste para que el OCR lea mejor
async function prepararParaOCR(file) {
  const img = await cargarImagen(file);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight, k = Math.min(1, 1400 / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, (y - 128) * 1.6 + 128));
  }
  g.putImageData(d, 0, 0); img.close?.();
  return new Promise(r => c.toBlob(r, "image/png"));
}

async function leerMatricula(file) {
  await cargarTesseract();
  const img = await prepararParaOCR(file);
  const worker = await Tesseract.createWorker("eng");
  try {
    await worker.setParameters({ tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -", tessedit_pageseg_mode: "11" });
    const { data } = await worker.recognize(img);
    return { texto: data.text, matricula: extraerMatricula(data.text) };
  } finally { await worker.terminate(); }
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
      let r = { matricula: null };
      try { r = await leerMatricula(f); } catch (e) { Swal.close(); await ko(e.message); }
      const v = await Swal.fire({
        icon: r.matricula ? "success" : "question", title: r.matricula ? "He leído esta matrícula" : "No he podido leerla",
        text: r.matricula ? "Revísala y corrígela si hace falta." : "Escríbela tú.", input: "text", inputValue: r.matricula || "", inputPlaceholder: "1234 ABC",
        showCancelButton: true, confirmButtonText: "Usar", cancelButtonText: "Cancelar", confirmButtonColor: "#1f4fd8",
        inputValidator: v => !v.trim() && "Escribe la matrícula"
      });
      resolve(v.isConfirmed ? v.value.trim().toUpperCase() : null);
    };
    inp.click();
  });
}
