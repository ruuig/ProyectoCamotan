import { defineStore } from 'pinia';
import http from '../services/http';

/**
 * Datos del establecimiento.
 *
 * El nombre y el municipio se muestran en la barra lateral y en el encabezado
 * de toda ficha impresa. Se piden una sola vez por sesión y se comparten: no
 * van escritos en el código, porque el mismo sistema debe poder instalarse en
 * otro centro sin tocar una línea.
 */
export const useEstablecimientoStore = defineStore('establecimiento', {
  state: () => ({
    datos: null,
    cargado: false,
  }),

  getters: {
    nombre: (state) => state.datos?.nombre ?? '',
    // "Camotán, Chiquimula". Sin municipio no se muestra una coma suelta.
    ubicacion: (state) =>
      state.datos?.municipio
        ? `${state.datos.municipio}, ${state.datos.departamento}`
        : '',
  },

  actions: {
    async cargar() {
      if (this.cargado) return;
      try {
        const { establecimiento } = await http.get('/admin/establecimiento');
        this.datos = establecimiento;
      } catch {
        // Sin conexión la barra lateral se queda sin subtítulo, pero el
        // sistema sigue operando: no es un dato que detenga la atención.
      } finally {
        this.cargado = true;
      }
    },

    limpiar() {
      this.datos = null;
      this.cargado = false;
    },
  },
});
