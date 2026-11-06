# Presupuestos Taller (PWA)

HTML/CSS/JS sin build + Supabase (Postgres, login, almacenamiento y una función de servidor; plan gratis).
Publicada con GitHub Pages: https://juanrvz.github.io/taller/

## Qué hace
- Login obligatorio; cada mecánico solo ve lo suyo (seguridad en la base de datos). El administrador (`ADMIN_EMAIL` en `config.js`) lo ve todo en solo lectura.
- Clientes con varios vehículos, presupuestos (mano de obra + piezas con margen), cerrar y cobrar, anticipos, notas internas, PDF y envío por WhatsApp.
- Fotos por presupuesto, comprimidas en el móvil (~100 KB), en almacenamiento privado con tope de 300 KB por foto.
- Inicio con gráficos, objetivo mensual opcional, gastos fijos, búsqueda rápida por matrícula (y escáner con cámara).
- Funciona sin conexión: los cambios se guardan en el dispositivo y se envían al volver internet.
- Exportar a Excel / JSON y resumen trimestral en CSV.
- Administración (solo admin): crear/desactivar mecánicos, cambiar contraseñas, ver actividad y espacio.

## Piezas
- `supabase.sql`: todas las tablas y reglas de seguridad, en orden (v1 … v8). Se ejecutan en Supabase > SQL Editor.
- `supabase/functions/usuarios/index.ts`: función de servidor para gestionar mecánicos (se despliega en Supabase > Edge Functions con el nombre `usuarios`). Usa la clave de servicio, que nunca llega al navegador.
- `.github/workflows/mantener-supabase.yml`: consulta ligera cada 3 días para que Supabase gratis no se pause (se desactiva si el repo pasa 60 días sin actividad).
- `util.js`, `datos.js` (datos locales + cola + fotos), `escaner.js` (OCR), `app.js` (pantallas), `sw.js` (offline).

## Cuentas
No hay registro público: el administrador crea a los mecánicos desde la pestaña Admin (o en Supabase > Authentication > Users con "Auto Confirm User").

## Límites del plan gratis
1 GB de almacenamiento (las fotos se miden en Perfil y Admin), 500 MB de base de datos, pausa tras 1 semana sin actividad (cubierta por la tarea programada).
