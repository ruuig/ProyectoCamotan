import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
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
