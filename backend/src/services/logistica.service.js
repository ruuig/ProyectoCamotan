/**
 * Calculos logisticos del MSPAS.
 *
 * Son las definiciones oficiales con las que el ministerio decide cuanto
 * pedir de cada insumo. Estan aqui aisladas y sin acceso a base de datos
 * porque son el nucleo del modulo: si estas se equivocan, el centro pide de
 * menos justo lo que mas falta, o acumula lo que no se usa hasta que vence.
 *
 * La diferencia de fondo con lo que habia antes es la demanda real. Contar
 * solo lo entregado hace invisible el desabastecimiento: un insumo que se
 * agoto el dia 3 y que nadie pudo recetar el resto del mes aparece con
 * consumo bajo, y el sistema concluye que hay que pedir poco. Contando
 * tambien lo que no se pudo entregar, ese mismo insumo sube en la lista.
 */

// El ministerio promedia la demanda real de los seis meses mas recientes.
const MESES_PMDR = 6;

// Un mes logistico son 30 dias: asi se expresan los dias de cobertura del
// panel a partir de los meses de existencia disponible.
const DIAS_POR_MES = 30;

// Semaforo de vencimiento del MSPAS, en meses.
const MESES_ROJO = 3;
const MESES_AMARILLO = 12;

/**
 * Demanda real de un periodo: lo entregado mas lo que no se entrego por
 * falta de existencia.
 */
function demandaReal(entregado, noEntregado) {
  return Math.max(0, entregado) + Math.max(0, noEntregado);
}

/**
 * Promedio mensual de demanda real.
 *
 * `meses` es la lista de demanda real mes a mes, del mas antiguo al mas
 * reciente. Se toman los ultimos seis. Si hay menos, se promedia lo que hay
 * y se informa cuantos meses lo sostienen, para que quien lea la cifra sepa
 * cuanta confianza merece. Sin ningun mes no se devuelve cero: se devuelve
 * null, porque cero afirmaria que no hay demanda.
 */
function pmdr(meses) {
  const recientes = meses.slice(-MESES_PMDR);
  if (recientes.length === 0) return { valor: null, mesesUsados: 0, completo: false };

  const demandaTotal = recientes.reduce((total, demandaDelMes) => total + demandaDelMes, 0);
  return {
    valor: demandaTotal / recientes.length,
    mesesUsados: recientes.length,
    completo: recientes.length === MESES_PMDR,
  };
}

/**
 * Meses de existencia disponible: cuantos meses alcanza el saldo al ritmo
 * de la demanda real.
 */
function med(saldo, promedioMensual) {
  if (promedioMensual === null || promedioMensual <= 0) return null;
  return saldo / promedioMensual;
}

/** Dias de cobertura, que es como los lee el panel. */
function diasDeCobertura(mesesDisponibles) {
  if (mesesDisponibles === null) return null;
  return Math.floor(mesesDisponibles * DIAS_POR_MES);
}

/**
 * Nivel minimo en meses: el doble del tiempo que tarda un pedido en llegar.
 * El doble, y no el tiempo justo, porque si el pedido se atrasa el servicio
 * tiene que seguir atendiendo mientras tanto.
 */
function nivelMinimoMeses(mesesSolicitudRecepcion) {
  return 2 * mesesSolicitudRecepcion;
}

/**
 * Nivel maximo en meses: el minimo mas lo que dura un ciclo de pedido. Pasado
 * ese punto lo que sobra corre riesgo de vencerse en bodega.
 */
function nivelMaximoMeses(mesesSolicitudRecepcion, mesesFrecuenciaPedido) {
  return nivelMinimoMeses(mesesSolicitudRecepcion) + mesesFrecuenciaPedido;
}

/** Cantidad minima que deberia haber en existencia. */
function cantidadMinima(promedioMensual, mesesSolicitudRecepcion) {
  if (promedioMensual === null) return null;
  return Math.ceil(promedioMensual * nivelMinimoMeses(mesesSolicitudRecepcion));
}

/** Cantidad maxima que conviene tener en existencia. */
function cantidadMaxima(promedioMensual, mesesSolicitudRecepcion, mesesFrecuenciaPedido) {
  if (promedioMensual === null) return null;
  return Math.ceil(
    promedioMensual * nivelMaximoMeses(mesesSolicitudRecepcion, mesesFrecuenciaPedido),
  );
}

/**
 * Cuanto pedir: lo que falta para llegar al maximo, contando lo que ya se
 * tiene. Nunca negativa: si hay de sobra, no se pide nada.
 */
function cantidadASolicitar(maxima, saldoFinal) {
  if (maxima === null) return null;
  return Math.max(0, maxima - saldoFinal);
}

/**
 * Todo el calculo de un insumo, tal como va en el BRES y en el panel.
 *
 * `demandaPorMes` va del mes mas antiguo al mas reciente e incluye el mes que
 * se esta cerrando.
 */
function evaluarInsumo({
  saldoFinal,
  demandaPorMes,
  mesesSolicitudRecepcion,
  mesesFrecuenciaPedido,
}) {
  const promedio = pmdr(demandaPorMes);
  const mesesDisponibles = med(saldoFinal, promedio.valor);
  const minima = cantidadMinima(promedio.valor, mesesSolicitudRecepcion);
  const maxima = cantidadMaxima(promedio.valor, mesesSolicitudRecepcion, mesesFrecuenciaPedido);

  return {
    pmdr: promedio.valor,
    mesesHistoria: promedio.mesesUsados,
    // Con menos de seis meses la cifra se sostiene en poca historia y hay que
    // decirlo donde se muestre.
    historiaCompleta: promedio.completo,
    med: mesesDisponibles,
    diasCobertura: diasDeCobertura(mesesDisponibles),
    nivelMinimoMeses: nivelMinimoMeses(mesesSolicitudRecepcion),
    nivelMaximoMeses: nivelMaximoMeses(mesesSolicitudRecepcion, mesesFrecuenciaPedido),
    cantidadMinima: minima,
    cantidadMaxima: maxima,
    cantidadSolicitar: cantidadASolicitar(maxima, saldoFinal),
    // Bajo el minimo hay que pedir; en cero con demanda, hay desabastecimiento.
    bajoMinimo: minima !== null && minima > 0 && saldoFinal < minima,
    desabastecido: saldoFinal === 0 && (promedio.valor ?? 0) > 0,
    // Quedarse en cero importa aunque todavia no haya demanda con que
    // calcular nada: no se puede entregar lo que no hay.
    sinExistencia: saldoFinal === 0,
  };
}

/**
 * Semaforo de vencimiento del MSPAS.
 *
 * Rojo de 1 a 3 meses, amarillo de 4 a 12, verde a mas de 12. Lo ya vencido
 * tambien es rojo: sigue ocupando espacio y hay que darlo de baja.
 *
 * Esto sustituye el semaforo por categoria que habia antes, que daba verde a
 * un medicamento con cuatro meses de vida y rojo a uno con cinco semanas.
 */
function semaforoVencimientoMspas(fechaVence, ahora = new Date()) {
  const meses = mesesParaVencer(fechaVence, ahora);

  if (meses <= MESES_ROJO) return 'rojo';
  if (meses <= MESES_AMARILLO) return 'amarillo';
  return 'verde';
}

/** Meses que le quedan a un lote, para mostrarlos junto al semaforo. */
function mesesParaVencer(fechaVence, ahora = new Date()) {
  return (new Date(fechaVence) - new Date(ahora)) / (DIAS_POR_MES * 86400000);
}

/**
 * Cuanto sobrara del lote sin usar cuando venza, al ritmo de la demanda real.
 * Es lo que convierte una fecha en una decision de redistribuir.
 */
function excedenteAlVencer(cantidadLote, promedioMensual, fechaVence, ahora = new Date()) {
  if (promedioMensual === null || promedioMensual <= 0) return null;
  const meses = Math.max(0, mesesParaVencer(fechaVence, ahora));
  return Math.max(0, Math.round(cantidadLote - promedioMensual * meses));
}

/**
 * Saldo de un lote recalculado desde sus movimientos.
 *
 * El saldo guardado existe por rendimiento, pero la verdad son los
 * movimientos. Esto permite verificar que cuadran, que es lo que pide la
 * auditoria y lo que evita que un error de registro se vuelva permanente.
 */
function saldoDesdeMovimientos(movimientos) {
  return movimientos.reduce((suma, m) => suma + m.cantidad, 0);
}

/** El mes de inventario cierra el día 25: octubre va del 26 de septiembre al 25 de octubre. */
const DIA_CORTE = 25;

/**
 * Etiqueta del periodo mensual, como AAAA-MM, de un momento (se toma la hora
 * de Guatemala). Del 26 en adelante ya cuenta en el mes siguiente.
 */
function periodoDe(fecha) {
  const f = new Date(new Date(fecha).getTime() - 6 * 3600000);
  if (f.getUTCDate() > DIA_CORTE) {
    f.setUTCDate(1);
    f.setUTCMonth(f.getUTCMonth() + 1);
  }
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Los n periodos mensuales hasta uno dado, del mas antiguo al mas reciente. */
function periodosHasta(periodo, cantidad = MESES_PMDR) {
  const [anio, mes] = periodo.split('-').map(Number);
  const lista = [];
  for (let i = cantidad - 1; i >= 0; i -= 1) {
    const f = new Date(Date.UTC(anio, mes - 1 - i, 1));
    lista.push(`${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return lista;
}

module.exports = {
  DIA_CORTE,
  MESES_PMDR,
  DIAS_POR_MES,
  MESES_ROJO,
  MESES_AMARILLO,
  demandaReal,
  pmdr,
  med,
  diasDeCobertura,
  nivelMinimoMeses,
  nivelMaximoMeses,
  cantidadMinima,
  cantidadMaxima,
  cantidadASolicitar,
  evaluarInsumo,
  semaforoVencimientoMspas,
  mesesParaVencer,
  excedenteAlVencer,
  saldoDesdeMovimientos,
  periodoDe,
  periodosHasta,
};
