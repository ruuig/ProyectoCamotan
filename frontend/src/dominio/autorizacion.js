import { ref } from 'vue';

/**
 * Operación protegida en espera de la autorización del director. Se pide con
 * pedir(); el diálogo llama a confirmar() con el DPI y la contraseña.
 */
export function usarAutorizacion(alTerminar) {
  const pendiente = ref(null);
  const error = ref('');
  const enviando = ref(false);

  function pedir(operacion, ejecutar) {
    error.value = '';
    pendiente.value = { operacion, ejecutar };
  }

  async function confirmar(autorizacion) {
    enviando.value = true;
    error.value = '';
    try {
      const resultado = await pendiente.value.ejecutar(autorizacion);
      pendiente.value = null;
      await alTerminar?.(resultado);
    } catch (fallo) {
      error.value = fallo.message;
    } finally {
      enviando.value = false;
    }
  }

  function cancelar() {
    pendiente.value = null;
  }

  return { pendiente, error, enviando, pedir, confirmar, cancelar };
}
