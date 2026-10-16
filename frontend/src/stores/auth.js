import { defineStore } from 'pinia';
import http, { CLAVE_TOKEN, CLAVE_USUARIO } from '../services/http';

// Cada rol entra directo a su panel operativo. No hay pantalla de bienvenida.
export const PANEL_POR_ROL = {
  admin: '/panel/admin',
  preconsulta: '/panel/preconsulta',
  medico: '/panel/medico',
  farmacia: '/panel/farmacia',
  bodega: '/panel/bodega',
};

function leerUsuarioGuardado() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_USUARIO)) || null;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(CLAVE_TOKEN) || null,
    usuario: leerUsuarioGuardado(),
  }),

  getters: {
    autenticado: (state) => Boolean(state.token && state.usuario),
    rol: (state) => state.usuario?.rol ?? null,
    rutaPanel: (state) => PANEL_POR_ROL[state.usuario?.rol] ?? '/login',
  },

  actions: {
    guardarSesion(token, usuario) {
      this.token = token;
      this.usuario = usuario;
      localStorage.setItem(CLAVE_TOKEN, token);
      localStorage.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
    },

    limpiarSesion() {
      this.token = null;
      this.usuario = null;
      localStorage.removeItem(CLAVE_TOKEN);
      localStorage.removeItem(CLAVE_USUARIO);
    },

    async iniciarSesion(usuario, password, codigoTotp) {
      // El token vencido no debe viajar con el inicio de sesion.
      this.limpiarSesion();
      const cuerpo = {
        usuario,
        password,
        // Solo viaja si el servidor lo pidio: los demas roles no lo usan.
        ...(codigoTotp ? { codigoTotp } : {}),
      };
      let datos;
      try {
        datos = await http.post('/auth/login', cuerpo);
      } catch (fallo) {
        // Si no llego al servidor, se intenta una vez mas: iniciar sesion no
        // cambia nada si se repite.
        if (fallo.codigo !== 'error_red') throw fallo;
        await new Promise((r) => setTimeout(r, 400));
        datos = await http.post('/auth/login', cuerpo);
      }
      this.guardarSesion(datos.token, datos.usuario);
      return datos.usuario;
    },

    async cerrarSesion() {
      // Aunque falle el aviso al servidor, la sesion local debe quedar limpia.
      try {
        await http.post('/auth/logout');
      } catch {
        // El token pudo haber expirado ya; no hay nada que recuperar.
      }
      this.limpiarSesion();
    },
  },
});
