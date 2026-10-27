const prisma = require('../config/db');
const { existenciaTotal } = require('./inventario.service');
const { semaforoBodega } = require('./bodega.service');
const {
  demandaReal,
  evaluarInsumo,
  mesesParaVencer,
  excedenteAlVencer,
  saldoDesdeMovimientos,
  periodoDe,
  periodosHasta,
  MESES_PMDR,
  DIA_CORTE,
} = require('./logistica.service');

/**
 * Lectura del abastecimiento desde la base.
 *
 * Aqui se juntan los movimientos y la demanda no atendida para armar las
 * cifras que pide el MSPAS. Los calculos viven en logistica.service; este
 * archivo solo consulta y arma.
 */

// Solo un lote disponible cuenta como existencia. Uno en cuarentena esta
// fisicamente ahi pero no se puede entregar, asi que no es saldo utilizable.
const ESTADO_UTILIZABLE = 'disponible';

/**
 * Limites de un periodo mensual en hora local de Guatemala (UTC-6): del 26 del
 * mes anterior al 25 del mes, que es cuando cierra.
 */
function limitesDePeriodo(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  const desfase = 6 * 3600000;
  return {
    desde: new Date(Date.UTC(anio, mes - 2, DIA_CORTE + 1) + desfase),
    hasta: new Date(Date.UTC(anio, mes - 1, DIA_CORTE + 1) + desfase),
  };
}

/** Limites del mes de calendario (del 1 al último día), para los formularios SIGSA. */
function limitesDeMes(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  const desfase = 6 * 3600000;
  return {
    desde: new Date(Date.UTC(anio, mes - 1, 1) + desfase),
    hasta: new Date(Date.UTC(anio, mes, 1) + desfase),
  };
}

/** Configuracion logistica del establecimiento, creandola si aun no existe. */
async function configuracion(establecimientoId) {
  const existente = await prisma.configuracionLogistica.findUnique({
    where: { establecimientoId },
  });
  if (existente) return existente;

  return prisma.configuracionLogistica.create({ data: { establecimientoId } });
}

/** Rangos del semaforo que configuro el centro, en meses. */
function rangosSemaforo(config) {
  return { rojo: config.semaforoRojoMeses, amarillo: config.semaforoAmarilloMeses };
}

/**
 * Funcion de semaforo con los rangos del establecimiento, para quien no
 * tiene la configuracion a mano.
 */
async function semaforoDelCentro(establecimientoId) {
  const rangos = rangosSemaforo(await configuracion(establecimientoId));
  return (fechaVence, ahora = new Date()) => semaforoBodega(fechaVence, ahora, rangos);
}

/**
 * Parametros numericos listos para el calculo.
 *
 * Mandan los niveles del centro (minimo 2 y maximo 4 meses en su BRES). El
 * calculo del MSPAS los expresa como tiempo de solicitud y recepcion y
 * frecuencia de pedido (minimo = 2 x tiempo, maximo = minimo + frecuencia),
 * asi que se traducen: un solo minimo y un solo maximo en todo el sistema.
 */
function parametros(config) {
  const minimo = Number(config.nivelMinimoMeses);
  const maximo = Number(config.nivelMaximoMeses);
  return {
    mesesSolicitudRecepcion: minimo / 2,
    mesesFrecuenciaPedido: maximo - minimo,
  };
}

/**
 * Saldo utilizable de un insumo: lo que hay en lotes disponibles y no
 * vencidos. Es lo que de verdad se puede entregar hoy.
 */
function saldoUtilizable(lotes, ahora = new Date()) {
  // Una sola definicion de "disponible" en todo el sistema.
  return existenciaTotal(lotes, ahora);
}

/**
 * Demanda real mes a mes de un insumo, del mas antiguo al mas reciente.
 *
 * Lo entregado sale de los movimientos de entrega, que se guardan en
 * negativo. Lo no entregado sale de la tabla de demanda no atendida.
 */
async function demandaPorMes(insumoId, periodos) {
  const desde = limitesDePeriodo(periodos[0]).desde;
  const hasta = limitesDePeriodo(periodos[periodos.length - 1]).hasta;

  const [entregas, faltantes] = await Promise.all([
    prisma.movimientoInsumo.findMany({
      where: {
        tipo: 'entrega',
        registradoEn: { gte: desde, lt: hasta },
        lote: { insumoId },
      },
      select: { cantidad: true, registradoEn: true },
    }),
    prisma.demandaNoAtendida.findMany({
      where: { insumoId, registradaEn: { gte: desde, lt: hasta } },
      select: { cantidad: true, registradaEn: true },
    }),
  ]);

  const porPeriodo = new Map(periodos.map((p) => [p, { entregado: 0, noEntregado: 0 }]));

  for (const e of entregas) {
    const fila = porPeriodo.get(periodoDe(e.registradoEn));
    if (fila) fila.entregado += Math.abs(e.cantidad);
  }
  for (const f of faltantes) {
    const fila = porPeriodo.get(periodoDe(f.registradaEn));
    if (fila) fila.noEntregado += f.cantidad;
  }

  return periodos.map((p) => {
    const { entregado, noEntregado } = porPeriodo.get(p);
    return { periodo: p, entregado, noEntregado, demandaReal: demandaReal(entregado, noEntregado) };
  });
}

/**
 * Evaluacion completa de un insumo: saldo, niveles, cuanto pedir y el estado
 * de cada uno de sus lotes.
 */
async function evaluarAbastecimiento(insumoId, establecimientoId, ahora = new Date()) {
  const insumo = await prisma.insumo.findFirst({
    where: { id: insumoId, establecimientoId },
    include: { lotes: { orderBy: { fechaVence: 'asc' } } },
  });
  if (!insumo) return null;

  const config = await configuracion(establecimientoId);
  const periodos = periodosHasta(periodoDe(ahora), MESES_PMDR);
  const demanda = await demandaPorMes(insumoId, periodos);

  const saldo = saldoUtilizable(insumo.lotes, ahora);
  const calculo = evaluarInsumo({
    saldoFinal: saldo,
    demandaPorMes: demanda.map((d) => d.demandaReal),
    ...parametros(config),
  });

  const lotes = insumo.lotes.map((lote) => ({
    id: lote.id,
    numeroLote: lote.numeroLote,
    fechaVence: lote.fechaVence,
    cantidadActual: lote.cantidadActual,
    cantidadInicial: lote.cantidadInicial,
    estado: lote.estado,
    motivoEstado: lote.motivoEstado,
    origen: lote.origen,
    ubicacion: lote.ubicacion,
    fabricante: lote.fabricante,
    registroSanitario: lote.registroSanitario,
    semaforo: semaforoBodega(lote.fechaVence, ahora, rangosSemaforo(config)),
    mesesParaVencer: Number(mesesParaVencer(lote.fechaVence, ahora).toFixed(1)),
    // El excedente solo tiene sentido en lo que todavia se puede entregar.
    excedente:
      lote.estado === ESTADO_UTILIZABLE
        ? excedenteAlVencer(lote.cantidadActual, calculo.pmdr, lote.fechaVence, ahora)
        : null,
  }));

  return {
    insumo: {
      id: insumo.id,
      codigoInterno: insumo.codigoInterno,
      nombreGenerico: insumo.nombreGenerico,
      formaFarmaceutica: insumo.formaFarmaceutica,
      concentracion: insumo.concentracion,
      presentacion: insumo.presentacion,
      unidadEntrega: insumo.unidadEntrega,
      categoria: insumo.categoria,
      cadenaFrio: insumo.cadenaFrio,
      perecedero: insumo.perecedero,
    },
    saldo,
    // El saldo en cuarentena esta fisicamente pero no se puede entregar.
    saldoEnCuarentena: insumo.lotes
      .filter((l) => l.estado === 'cuarentena')
      .reduce((s, l) => s + l.cantidadActual, 0),
    demanda,
    ...calculo,
    // Mientras el Area de Salud no confirme los tiempos, toda cifra derivada
    // de ellos se muestra marcada.
    provisional: config.provisional,
    configuracion: {
      mesesSolicitudRecepcion: Number(config.mesesSolicitudRecepcion),
      mesesFrecuenciaPedido: Number(config.mesesFrecuenciaPedido),
      provisional: config.provisional,
    },
    lotes,
  };
}

/**
 * Evaluacion de todos los insumos activos, para listados y para el panel.
 */
async function evaluarTodos(establecimientoId, ahora = new Date()) {
  const insumos = await prisma.insumo.findMany({
    where: { establecimientoId, activo: true },
    include: { lotes: true },
    orderBy: { nombreGenerico: 'asc' },
  });

  const config = await configuracion(establecimientoId);
  const periodos = periodosHasta(periodoDe(ahora), MESES_PMDR);

  const filas = [];
  for (const insumo of insumos) {
    const demanda = await demandaPorMes(insumo.id, periodos);
    const saldo = saldoUtilizable(insumo.lotes, ahora);
    const calculo = evaluarInsumo({
      saldoFinal: saldo,
      demandaPorMes: demanda.map((d) => d.demandaReal),
      ...parametros(config),
    });

    filas.push({
      insumoId: insumo.id,
      codigoInterno: insumo.codigoInterno,
      nombre: insumo.nombreGenerico,
      formaFarmaceutica: insumo.formaFarmaceutica,
      concentracion: insumo.concentracion,
      unidadEntrega: insumo.unidadEntrega,
      categoria: insumo.categoria,
      cadenaFrio: insumo.cadenaFrio,
      saldo,
      lotesEnCuarentena: insumo.lotes.filter((l) => l.estado === 'cuarentena').length,
      // Lotes que ya estan en rojo y todavia se pueden mover.
      lotesEnRojo: insumo.lotes.filter(
        (l) =>
          l.estado === ESTADO_UTILIZABLE
          && l.cantidadActual > 0
          && semaforoBodega(l.fechaVence, ahora, rangosSemaforo(config)) === 'rojo',
      ).length,
      ...calculo,
    });
  }

  return { configuracion: config, provisional: config.provisional, filas };
}

/**
 * Recalcula el saldo de un lote desde sus movimientos y lo compara con el
 * guardado.
 *
 * El saldo guardado existe por rendimiento; la verdad son los movimientos.
 * Esto es lo que permite demostrar que cuadran, y detectar un error de
 * registro antes de que se vuelva permanente.
 */
async function verificarSaldoLote(loteId) {
  const lote = await prisma.lote.findUnique({
    where: { id: loteId },
    include: { movimientos: { orderBy: { registradoEn: 'asc' } } },
  });
  if (!lote) return null;

  const calculado = saldoDesdeMovimientos(lote.movimientos);
  return {
    loteId,
    numeroLote: lote.numeroLote,
    saldoGuardado: lote.cantidadActual,
    saldoCalculado: calculado,
    diferencia: lote.cantidadActual - calculado,
    cuadra: lote.cantidadActual === calculado,
    movimientos: lote.movimientos.length,
  };
}

/** Verifica todos los lotes del establecimiento de una sola pasada. */
async function verificarSaldos(establecimientoId) {
  const lotes = await prisma.lote.findMany({
    where: { insumo: { establecimientoId } },
    include: { movimientos: { select: { cantidad: true, ubicacion: true } }, insumo: { select: { nombreGenerico: true } } },
  });

  const revisados = lotes.map((l) => {
    const calculado = saldoDesdeMovimientos(l.movimientos);
    // La parte de la farmacia tambien tiene que salir de sus movimientos.
    const farmaciaCalculada = saldoDesdeMovimientos(l.movimientos.filter((m) => m.ubicacion === 'farmacia'));
    return {
      loteId: l.id,
      insumo: l.insumo.nombreGenerico,
      numeroLote: l.numeroLote,
      saldoGuardado: l.cantidadActual,
      saldoCalculado: calculado,
      diferencia: l.cantidadActual - calculado,
      farmaciaGuardada: l.cantidadFarmacia,
      farmaciaCalculada,
      cuadra: l.cantidadActual === calculado && l.cantidadFarmacia === farmaciaCalculada,
    };
  });

  return {
    revisados: revisados.length,
    descuadrados: revisados.filter((r) => !r.cuadra),
    cuadranTodos: revisados.every((r) => r.cuadra),
  };
}

module.exports = {
  rangosSemaforo,
  semaforoDelCentro,
  ESTADO_UTILIZABLE,
  limitesDePeriodo,
  limitesDeMes,
  configuracion,
  parametros,
  saldoUtilizable,
  demandaPorMes,
  evaluarAbastecimiento,
  evaluarTodos,
  verificarSaldoLote,
  verificarSaldos,
};
