import { defineStore } from 'pinia';

/**
 * Qué logo institucional mostrar. Por defecto el oficial del MSPAS que viene
 * en public/; si dirección subió otro, ese. Se pregunta una vez por sesión y
 * sin token, porque también sale en el inicio de sesión.
 */
const OFICIAL = { vertical: '/mspas-vertical.png', horizontal: '/mspas-horizontal.png' };

export const useLogoStore = defineStore('logo', {
  state: () => ({ personalizado: { vertical: null, horizontal: null }, cargado: false }),
  getters: {
    vertical: (s) => s.personalizado.vertical ?? OFICIAL.vertical,
    horizontal: (s) => s.personalizado.horizontal ?? OFICIAL.horizontal,
  },
  actions: {
    async cargar(forzar = false) {
      if (this.cargado && !forzar) return;
      try {
        const r = await fetch('/api/v1/logo');
        if (r.ok) this.personalizado = await r.json();
      } catch {
        // Sin conexión se queda el oficial.
      } finally {
        this.cargado = true;
      }
    },
  },
});
