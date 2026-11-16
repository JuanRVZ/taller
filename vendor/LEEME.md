# Librerías alojadas en la propia app

Se sirven desde aquí (no desde CDN) para que nadie de fuera pueda cambiar el código que ejecuta la app (ver S2 en SEGURIDAD.md).
Para actualizar una: descargar la versión nueva del mismo origen, comprobar su huella con la que publica el origen, sustituir el archivo, actualizar esta tabla y probar todas las pantallas.

| Archivo | Versión | Origen | SHA-256 (base64) | Verificada contra |
|---|---|---|---|---|
| `supabase.js` | @supabase/supabase-js 2.45.4 | npm (jsDelivr) dist/umd | `hZaWX+kY5lZgChtWjToWj1wNPSKmAIhrtvRKZVXbAec=` | huella del paquete npm (jsDelivr) |
| `591.supabase.js` | @supabase/supabase-js 2.45.4 | npm (jsDelivr) dist/umd | `nDBbd9q2PdeeuW76uQaTZvsiVb2HMda4Yih1WNJWBAY=` | huella del paquete npm (jsDelivr) |
| `jspdf.umd.min.js` | jspdf 2.5.1 | cdnjs | `mMzxeqEMILsTAXYmGPzJtqs6Tn8mtgcdZNC0EVTfOHU=` | SRI de cdnjs |
| `jspdf.plugin.autotable.min.js` | jspdf-autotable 3.8.2 | cdnjs | `J6nDthhDxjErh/FC1A/nfA8PBUyfPN7MxL/V8zIoWcg=` | SRI de cdnjs |
| `sweetalert2.all.min.js` | sweetalert2 11.14.5 | cdnjs | `1m4qVbsdcSU19tulVTbeQReg0BjZiW6yGffnlr/NJu4=` | SRI de cdnjs |
| `chart.umd.min.js` | Chart.js 4.4.1 | cdnjs | `gf+v4Tw34bJXk7Ag1Eb02XOblJ2tt/n3nXCaDK14HC8=` | SRI de cdnjs |
| `xlsx.full.min.js` | SheetJS xlsx 0.20.3 | cdn.sheetjs.com (único origen oficial) | `zAFRMKqFIefwiPiImOupSczcv7ON8L0Sm0S3Jzw6b0E=` | sin huella independiente publicada |
| `tesseract/tesseract.min.js` | tesseract.js 5.1.1 | npm (jsDelivr) | `qOKZGNCYsrBuEBK9rv+0rsBEXF1WVHCQI+C9H0QqgOg=` | huella del paquete npm (jsDelivr) |
| `tesseract/worker.min.js` | tesseract.js 5.1.1 | npm (jsDelivr) | `rKEiljn8mQfYb5boJZVaK3xXFtF/O8Os1x+cerZhgfw=` | huella del paquete npm (jsDelivr) |
| `tesseract/tesseract-core-lstm.wasm.js` | tesseract.js-core 5.1.1 | npm (jsDelivr) | `jwSqDMgee94z+A6S+gGnpmXwtIhNCYrPXenHEEoR36o=` | huella del paquete npm (jsDelivr) |
| `tesseract/tesseract-core-simd-lstm.wasm.js` | tesseract.js-core 5.1.1 | npm (jsDelivr) | `ziDtqVM8vtHmwrQnb7rh4K3GG2dUtVEwhL5gF4e0V88=` | huella del paquete npm (jsDelivr) |
| `tesseract/eng.traineddata.gz` | @tesseract.js-data/eng 1.0.0 (4.0.0_best_int) | npm (jsDelivr) | `RbTLNGckrBd08cNvQvGCuIe82yjr5j5v/5CsQfP8/5E=` | huella del paquete npm (jsDelivr) |

Avisos conocidos: jsPDF 2.5.1 tiene avisos de denegación de servicio en `addImage` con datos manipulados; la app no usa esa función con datos de usuarios. Al pasar a jsPDF 3.x hay que cambiar también jspdf-autotable a 5.x y probar el PDF.
