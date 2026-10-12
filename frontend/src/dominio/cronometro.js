import http from '../services/http';

/**
 * Cronómetro de registro y consulta de fichas (objetivo 1 de la tesis).
 *
 * Arranca con la primera tecla y se detiene al guardar o al abrir la ficha.
 * Se envía solo y en silencio: si falla, el trabajo del personal sigue igual.
 */
export function cronometro(tipo, pantalla) {
  let inicio = null;
  return {
    iniciar() {
      if (inicio === null) inicio = performance.now();
    },
    reiniciar() {
      inicio = null;
    },
    terminar(pacienteId = null) {
      if (inicio === null) return;
      const milisegundos = Math.round(performance.now() - inicio);
      inicio = null;
      http.post('/indicadores/mediciones', { tipo, pantalla, milisegundos, pacienteId }).catch(() => {});
    },
  };
}
