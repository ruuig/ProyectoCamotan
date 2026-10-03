const prisma = require('../config/db');
const { semaforoDelCentro } = require('./abastecimiento.service');
const {
  evaluarCobertura,
  excedenteProyectado,
  MIN_DIAS_HISTORIAL,
} = require('./indicadores.service');
const {
  diasParaVencer,
  existenciaTotal,
} = require('./inventario.service');

const DIAS_VENTANA_CONSUMO = 30;
const MS_POR_DIA = 86400000;

/**
 * Consumo diario promedio de un insumo en los ultimos 30 dias.
 *
 * Se calcula con Prisma en lugar de leer la vista materializada
 * consumo_diario para no escribir SQL crudo y para que el dato sea el del
 * momento. La vista se usara en la Fase 6, donde el panel necesita que la
 * agregacion ya este hecha para cargar al instante.
 */
async function consumoDiario(insumoId, ahora = new Date()) {
  const desde = new Date(new Date(ahora).getTime() - DIAS_VENTANA_CONSUMO * MS_POR_DIA);

  const [salidas, primerMovimiento] = await Promise.all([
    prisma.movimientoInsumo.aggregate({
      where: { tipo: 'salida', registradoEn: { gte: desde }, lote: { insumoId } },
      _sum: { cantidad: true },
      _count: true,
    }),
    prisma.movimientoInsumo.findFirst({
      where: { lote: { insumoId } },
      orderBy: { registradoEn: 'asc' },
      select: { registradoEn: true },
    }),
  ]);

  // Las salidas se guardan en negativo.
  const totalSalidas = Math.abs(salidas._sum.cantidad ?? 0);

  const diasHistorial = primerMovimiento
    ? Math.floor((new Date(ahora) - new Date(primerMovimiento.registradoEn)) / MS_POR_DIA)
    : null;

  return {
    consumoDia: totalSalidas / DIAS_VENTANA_CONSUMO,
    movimientos: salidas._count,
    diasHistorial,
    historialSuficiente: diasHistorial != null && diasHistorial >= MIN_DIAS_HISTORIAL,
  };
}

/**
 * Cobertura de un insumo con sus lotes ya interpretados: cuantos dias
 * alcanza, que lotes estan en ventana de vencimiento y cuanto sobrara.
 */
async function coberturaDeInsumo(insumoId, establecimientoId, ahora = new Date()) {
  const insumo = await prisma.insumo.findFirst({
    where: { id: insumoId, establecimientoId },
    include: { lotes: { orderBy: { fechaVence: 'asc' } } },
  });

  if (!insumo) return null;
  const colorDe = await semaforoDelCentro(establecimientoId);

  const consumo = await consumoDiario(insumoId, ahora);
  const saldoTotal = existenciaTotal(insumo.lotes, ahora);

  const cobertura = evaluarCobertura({
    saldoTotal,
    consumoDiario: consumo.consumoDia,
    diasHistorial: consumo.diasHistorial,
  });

  const lotes = insumo.lotes.map((lote) => {
    const semaforo = colorDe(lote.fechaVence, ahora);
    return {
      id: lote.id,
      numeroLote: lote.numeroLote,
      fechaVence: lote.fechaVence,
      cantidadActual: lote.cantidadActual,
      cantidadInicial: lote.cantidadInicial,
      diasParaVencer: diasParaVencer(lote.fechaVence, ahora),
      semaforo,
      // Solo tiene sentido proyectar excedente si hay consumo con que estimarlo.
      excedenteProyectado: consumo.historialSuficiente
        ? excedenteProyectado(lote.cantidadActual, consumo.consumoDia, lote.fechaVence, ahora)
        : null,
    };
  });

  return {
    insumo: {
      id: insumo.id,
      nombreGenerico: insumo.nombreGenerico,
      presentacion: insumo.presentacion,
      unidadMedida: insumo.unidadMedida,
      categoria: insumo.categoria,
      stockMinimo: insumo.stockMinimo,
    },
    saldoTotal,
    bajoMinimo: saldoTotal < insumo.stockMinimo,
    consumoDiario: Number(consumo.consumoDia.toFixed(3)),
    diasHistorial: consumo.diasHistorial,
    cobertura,
    lotes,
  };
}

module.exports = {
  DIAS_VENTANA_CONSUMO,
  consumoDiario,
  coberturaDeInsumo,
};
