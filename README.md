# Presupuestos Taller (PWA)

HTML/CSS/JS sin build + Supabase (Postgres + login, plan gratis). Sin dependencias que instalar.

## Puesta en marcha

1. Crea un proyecto gratis en https://supabase.com.
2. En **SQL Editor** pega y ejecuta `supabase.sql` (crea la tabla y la seguridad por mecánico).
3. En **Project Settings > API** copia `Project URL` y `anon key` a `config.js`.
4. (Opcional) En **Authentication > Providers > Email** desactiva "Confirm email" para que los mecánicos entren sin verificar correo.
5. Probar en local: `python3 -m http.server 8000` y abre http://localhost:8000
6. Publicar gratis: sube la carpeta a GitHub Pages, Netlify (arrastrar carpeta) o Cloudflare Pages.
7. En Supabase > Authentication > URL Configuration pon la URL publicada como Site URL.

## Instalar como app
En el móvil: menú del navegador > "Añadir a pantalla de inicio" / "Instalar app".

## Notas
- Cada mecánico solo ve sus presupuestos (Row Level Security).
- Sin conexión la app abre, pero guardar/consultar requiere internet.
- Para iconos PNG (mejor en iPhone) añade `icon-192.png` y `icon-512.png` al manifest.
- Plan gratis de Supabase: el proyecto se pausa tras 1 semana sin uso; se reactiva desde el panel.
