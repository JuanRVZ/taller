# Presupuestos Taller

App web sin compilación (HTML, CSS y JS) publicada con GitHub Pages desde `main`. Datos, login, fotos y una función de servidor en Supabase. El `README.md` explica las piezas.

## Seguridad: leer antes de tocar nada

- **`SEGURIDAD.md`** (en esta carpeta, fuera de git) tiene la auditoría con los hallazgos pendientes, cómo arreglar cada uno y cómo probarlo. Léelo antes de cambiar reglas de base de datos, login, la función `usuarios`, fotos o lo que se guarda en el dispositivo. Actualiza allí el estado de lo que arregles.
- **El repositorio es público y Pages publica todo lo que se sube.** No subas `SEGURIDAD.md`, contraseñas, la clave `service_role` ni datos de clientes. Antes de `git add -A`, mira `git status`.
- La clave `anon` de `config.js` es pública por diseño. La seguridad la dan las reglas de fila (RLS) de `supabase.sql`. Lo que haga la web (ocultar botones, `isAdmin()`, límites) es comodidad, no protección: toda regla que importe tiene que estar también en la base de datos.
- Tabla nueva: `enable row level security` y sus políticas en el mismo bloque. Función `security definer`: con `set search_path` y permisos de ejecución explícitos.
- Todo dato que se pinte con `innerHTML` pasa por `esc()`, salvo números ya convertidos con `eur()`, `num()` o `+valor`. En SweetAlert, usa `text`, no `html`, para texto que venga de datos.
- Las librerías de terceros van en `vendor/`, con versión fija y su huella anotada en `vendor/LEEME.md`. La política de contenido (CSP) de `index.html` bloquea scripts y conexiones a otros dominios: si añades algo externo, no funcionará hasta que lo alojes en `vendor/` (o amplíes la CSP con motivo).
- Si cambias el script en línea del `<head>` de `index.html`, recalcula su hash `sha256-…` en la CSP o el tema dejará de aplicarse.
- Quién es administrador lo decide la tabla `admins` (función `es_admin()`), nunca un email en el código.

## Cómo trabajar aquí

- Los cambios de base de datos se añaden al final de `supabase.sql` como bloque `-- vN:` y además hay que ejecutarlos en Supabase > SQL Editor. La función de `supabase/functions/usuarios/` se despliega aparte en Supabase; subirla a GitHub no la actualiza.
- No inicies sesión con contraseñas ni crees cuentas: lo hace el usuario. Las pruebas con sesión se hacen en la que él tenga abierta, con datos que empiecen por `ZZ ` y borrándolos al terminar.
- Al cambiar cualquier archivo que sirve la web, sube el número de versión **en los dos sitios a la vez**: `CACHE = "taller-vN"` en `sw.js` y los `?v=N` de `index.html` y de `SHELL` en `sw.js`. Sin el `?v=` nuevo, los navegadores siguen usando los `.js` antiguos hasta 10 minutos.
- La app trabaja "primero en local" (`datos.js`): se escribe en una copia del dispositivo y una cola lo envía al servidor. Cualquier regla nueva del servidor debe seguir aceptando ese orden de envío (cliente, vehículo, presupuesto).
- Los usuarios finales no manejan bien la informática: textos claros, pocos pasos y nada que les pueda hacer perder datos sin avisar.
