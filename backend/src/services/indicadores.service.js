// Indicadores derivados del inventario. Funciones puras.

// Sin este historial no se puede estimar consumo con sentido.
const MIN_DIAS_HISTORIAL = 30;
const MENSAJE_SIN_HISTORIAL =
  'Aun no se puede estimar: hacen falta 30 días de registro de consumo';

// Umbral que el panel de farmacia usa para "requieren accion".
const DIAS_COBERTURA_CRITICA = 15;

const MS_POR_DIA = 86400000;

/**
 * Dias que alcanza la existencia al ritmo de consumo actual.
 * Devuelve null cuando no es calculable. Nunca 0 ni un numero inventado.
 */
function diasCobertura(saldoTotal, consumoDiarioPromedio) {
  if (!consumoDiarioPromedio || consumoDiarioPromedio === 0) return null;
  return Math.floor(saldoTotal / consumoDiarioPromedio);
}

/**
 * Unidades que sobraran sin usar cuando el lote venza.
 * Es lo que convierte "vence el 12/08" en una decision de redistribuir.
 */
function excedenteProyectado(saldoTotal, consumoDiario, fechaVence, ahora = new Date()) {
  const diasHasta = Math.max(0, (new Date(fechaVence) - new Date(ahora)) / MS_POR_DIA);
  return Math.max(0, Math.round(saldoTotal - consumoDiario * diasHasta));
}

/**
 * Evaluacion completa de cobertura, lista para mostrarse.
 * Distingue "consumo bajo" de "historial insuficiente", que es la razon
 * por la que nunca debe mostrarse un 0 enganoso.
 */
function evaluarCobertura({ saldoTotal, consumoDiario, diasHistorial }) {
  if (diasHistorial == null || diasHistorial < MIN_DIAS_HISTORIAL) {
    return {
      dias: null,
      calculable: false,
      critica: false,
      mensaje: MENSAJE_SIN_HISTORIAL,
    };
  }

  const dias = diasCobertura(saldoTotal, consumoDiario);

  if (dias === null) {
    return {
      dias: null,
      calculable: false,
      critica: false,
      mensaje: 'No se ha usado en el período, no se puede estimar cuanto dura',
    };
  }

  return {
    dias,
    calculable: true,
    critica: dias < DIAS_COBERTURA_CRITICA,
    mensaje: `Alcanza para unos ${dias} días`,
  };
}

module.exports = {
  MIN_DIAS_HISTORIAL,
  MENSAJE_SIN_HISTORIAL,
  DIAS_COBERTURA_CRITICA,
  diasCobertura,
  excedenteProyectado,
  evaluarCobertura,
};
