const {
  seleccionarLoteFEFO,
  planFraccionamiento,
  esLoteFEFO,
  lotesDisponibles,
  existenciaTotal,
} = require('./inventario.service');

/**
 * Que se entrega de una receta y de que lotes. Funcion pura: recibe los lotes
 * ya vistos desde la farmacia (inventario.enUbicacion) y no escribe nada.
 *
 * - Se entrega lo que hay; lo que falta queda como demanda no atendida. Al
 *   paciente no se le manda con las manos vacias habiendo existencia, y el
 *   faltante queda contado para que el pedido del mes siguiente no salga corto.
 * - Sin lote indicado se reparte por PEPE (el que vence primero) y, si un lote
 *   no alcanza, se fracciona.
 * - Si se elige otro lote, se exige el motivo por escrito.
 *
 * Devuelve { error } si no se puede entregar, o el plan con aEntregar,
 * noAtendido, reparto y avisoFefo.
 */
function planEntrega({ lotes, cantidad, pendiente, loteId = null, motivo = null, ahora = new Date() }) {
  if (pendiente <= 0) {
    return { error: { status: 409, codigo: 'ya_entregada', mensaje: 'Esta prescripción ya fue entregada por completo' } };
  }
  if (cantidad > pendiente) {
    return { error: { status: 400, codigo: 'cantidad_excede', mensaje: `Solo quedan ${pendiente} por entregar de esta prescripción` } };
  }

  const disponible = existenciaTotal(lotes, ahora);
  const aEntregar = Math.min(cantidad, disponible);
  const noAtendido = cantidad - aEntregar;
  if (aEntregar === 0) return { aEntregar: 0, noAtendido, reparto: [], avisoFefo: null };

  if (loteId) {
    const elegido = lotesDisponibles(lotes, ahora).find((l) => l.id === loteId);
    if (!elegido) {
      return { error: { status: 400, codigo: 'lote_invalido', mensaje: 'El lote indicado no está en farmacia, está vencido o no tiene existencia' } };
    }
    if (elegido.cantidadActual < aEntregar) {
      return { error: { status: 409, codigo: 'existencia_insuficiente', mensaje: `El lote ${elegido.numeroLote} solo tiene ${elegido.cantidadActual} en farmacia` } };
    }
    let avisoFefo = null;
    if (!esLoteFEFO(loteId, lotes, aEntregar, ahora)) {
      if (!motivo) {
        const propuesta = seleccionarLoteFEFO(lotes, aEntregar, ahora);
        const sugerido = propuesta.requiereFraccionamiento ? propuesta.lotes[0] : propuesta.lote;
        return {
          error: {
            status: 400,
            codigo: 'motivo_requerido',
            mensaje: 'Este no es el lote de vencimiento más próximo. Indique motivo',
            detalles: { loteSugerido: sugerido && { id: sugerido.id, numeroLote: sugerido.numeroLote, fechaVence: sugerido.fechaVence } },
          },
        };
      }
      avisoFefo = `Se dispensó un lote distinto al de vencimiento más próximo. Motivo: ${motivo}`;
    }
    return {
      aEntregar,
      noAtendido,
      reparto: [{ loteId, numeroLote: elegido.numeroLote, fechaVence: elegido.fechaVence, cantidad: aEntregar }],
      avisoFefo,
    };
  }

  const plan = planFraccionamiento(lotes, aEntregar, ahora);
  return {
    aEntregar,
    noAtendido,
    reparto: plan.map((p) => ({ loteId: p.loteId, numeroLote: p.lote.numeroLote, fechaVence: p.lote.fechaVence, cantidad: p.cantidad })),
    avisoFefo: null,
  };
}

/**
 * Cuanto queda por entregar de una prescripcion: lo recetado menos lo
 * entregado y menos lo que farmacia ya registro como no entregado. Ese
 * faltante cierra la receta en farmacia: el paciente ya se fue y lo busca
 * fuera; si no, quedaria esperando su entrega para siempre.
 */
function pendienteDe(prescripcion) {
  const entregado = prescripcion.dispensaciones
    .filter((d) => !d.anulada)
    .reduce((suma, d) => suma + d.cantidad, 0);
  const noEntregado = (prescripcion.demandaNoAtendida ?? []).reduce((suma, d) => suma + d.cantidad, 0);
  return prescripcion.cantidad - entregado - noEntregado;
}

module.exports = { planEntrega, pendienteDe };
