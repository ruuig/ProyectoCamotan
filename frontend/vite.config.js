import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    // App instalable (PWA), pensada para la tablet de preconsulta: la interfaz
    // queda guardada en el equipo y abre sin conexion. Los datos sin conexion
    // los maneja la propia app (services/almacenLocal.js): el service worker no
    // guarda respuestas de la API, para no duplicar datos de pacientes.
    VitePWA({
      // 'prompt' y no 'autoUpdate': una version nueva no recarga la pagina sola,
      // porque borraria una preconsulta a medio llenar. Ver AvisoActualizacion.vue.
      registerType: 'prompt',
      includeAssets: ['iconos/favicon-64.png', 'iconos/apple-touch-icon.png'],
      manifest: {
        name: 'Consultas · Centro de Salud de Camotán',
        short_name: 'Camotán',
        description: 'Registro de pacientes, preconsulta, cola de atención y farmacia del Centro de Salud de Camotán, Chiquimula.',
        lang: 'es-GT',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#1F3566',
        background_color: '#F2F4F7',
        categories: ['medical', 'health', 'government'],
        icons: [
          { src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/iconos/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Preconsulta', url: '/panel/preconsulta', icons: [{ src: '/iconos/icono-192.png', sizes: '192x192' }] },
          { name: 'Cola de atención', url: '/cola', icons: [{ src: '/iconos/icono-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Solo las fuentes con alfabeto latino: las variantes cirilica, griega y
        // vietnamita no se usan y harian pesada la primera instalacion.
        globPatterns: ['**/*.{js,css,html,png,svg}', 'assets/*-latin-*.woff2'],
        globIgnores: ['**/*-latin-ext-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    // En desarrollo el frontend y el backend corren en puertos distintos.
    // El proxy evita CORS y hace que las rutas relativas /api/v1 funcionen
    // igual que en produccion, donde ambos van tras el mismo dominio.
    proxy: {
      '/api': {
        // 127.0.0.1 y no localhost: en Windows localhost puede ir primero por
        // IPv6 y la primera conexion fallar.
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
