import { defineStore } from 'pinia';
import http from '../services/http';
import {
  encolar,
  listarCola,
  quitarDeCola,
  marcarIntento,
  nuevaClaveIdempotencia,
} from '../services/almacenLocal';

// Operaciones que NO se permiten sin conexion, porque afectan saldos y no
// pueden resolverse a ciegas: cerrar la atencion medica y confirmar un
// ajuste de inventario.
export const NO_PERMITIDO_SIN_CONEXION = [
  { patron: /\/atenciones\/\d+\/consulta$/, motivo: 'cerrar la atencion medica' },
  { patron: /\/inventario\/ajustes$/, motivo: 'confirmar un ajuste de inventario' },
];

export function requiereConexion(ruta) {
  return NO_PERMITIDO_SIN_CONEXION.find((r) => r.patron.test(ruta)) ?? null;
}

function esFalloDeRed(error) {
  // El cliente HTTP marca asi lo que no llego al servidor.
  return error?.codigo === 'error_red' || error?.message?.includes('No se pudo conectar');
}

export const useSincronizacionStore = defineStore('sincronizacion', {
  state: () => ({
    enLinea: navigator.onLine,
    pendientes: [],
    sincronizando: false,
    ultimoResultado: null,
  }),

  getters: {
    hayPendientes: (state) => state.pendientes.length > 0,
  },

  actions: {
    async refrescarPendientes() {
      this.pendientes = await listarCola();
    },

    /**
     * Envia una escritura. Si la red falla, la encola en lugar de perderla,
     * salvo que sea una operacion que no se permite sin conexion.
     */
    async enviar({ metodo, ruta, cuerpo, descripcion }) {
      const bloqueada = requiereConexion(ruta);
      const idempotencyKey = nuevaClaveIdempotencia();

      try {
        const respuesta = await http.request(metodo, ruta, cuerpo, {
          'Idempotency-Key': idempotencyKey,
        });
        return { encolada: false, respuesta };
      } catch (error) {
        if (!esFalloDeRed(error)) throw error;

        if (bloqueada) {
          const negado = new Error(
            `Sin conexion no se puede ${bloqueada.motivo}. Intente cuando vuelva la red.`,
          );
          negado.codigo = 'requiere_conexion';
          throw negado;
        }

        await encolar({ idempotencyKey, metodo, ruta, cuerpo, descripcion });
        await this.refrescarPendientes();
        return { encolada: true, respuesta: null };
      }
    },

    /**
     * Reenvia lo encolado. Cada operacion lleva su clave, asi que un reenvio
     * repetido no duplica registros.
     */
    async sincronizar() {
      if (this.sincronizando || !navigator.onLine) return;

      this.sincronizando = true;
      let enviadas = 0;
      let fallidas = 0;

      try {
        for (const registro of await listarCola()) {
          try {
            await http.request(registro.metodo, registro.ruta, registro.cuerpo, {
              'Idempotency-Key': registro.idempotencyKey,
            });
            await quitarDeCola(registro.idempotencyKey);
            enviadas += 1;
          } catch (error) {
            if (esFalloDeRed(error)) {
              // Sigue sin red: se deja en cola para el proximo intento.
              await marcarIntento(registro, error.message);
              fallidas += 1;
              break;
            }
            // El servidor la rechazo por una razon de negocio: reintentarla
            // no va a cambiar nada, y dejarla atascaria la cola.
            await marcarIntento(registro, error.message);
            await quitarDeCola(registro.idempotencyKey);
            fallidas += 1;
          }
        }

        this.ultimoResultado = { enviadas, fallidas, en: new Date() };
      } finally {
        this.sincronizando = false;
        await this.refrescarPendientes();
      }
    },

    iniciarEscucha() {
      const alConectar = () => {
        this.enLinea = true;
        this.sincronizar();
      };
      const alDesconectar = () => {
        this.enLinea = false;
      };

      window.addEventListener('online', alConectar);
      window.addEventListener('offline', alDesconectar);

      this.refrescarPendientes();
      if (navigator.onLine) this.sincronizar();
    },
  },
});
