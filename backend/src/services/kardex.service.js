/**
 * Tarjeta de Control de Suministro (kardex) de cada producto de la bodega,
 * con las columnas de la tarjeta de la DDRISS Chiquimula:
 *
 *   Fecha | Numero de referencia | Remitente / Destinatario |
 *   Entrada (cantidad, precio unitario, valor total) | Fecha de vencimiento |
 *   Numero de lote | Salida | Reajuste (+/-) | Saldo (cantidad, precio) |
 *   Observaciones
 *
 * La tarjeta oficial es la autorizada por la Contraloria: el sistema la deja
 * lista para copiarla o imprimir los datos encima.
 */

const prisma = require('../config/db');
const { configuracion } = require('./abastecimiento.service');
const { ETIQUETA_TIPO, ETIQUETA_CAUSA, ETIQUETA_ORIGEN } = require('./movimientos.service');

const INCLUIR = {
  lote: {
    select: {
      id: true, insumoId: true, numeroLote: true, fechaVence: true, costoUnitario: true, origen: true, actaDonacion: true,
      requisicion: { select: { numero: true, almacen: true } },
    },
  },
  traslado: { select: { numero: true, ubicacion: { select: { nombre: true } }, requisicion: { select: { numero: true } } } },
  usuario: { select: { nombre: true } },
};

const req = (n) => (n ? `Req. ${n}` : null);

/**
 * En que columna cae un movimiento y que va en referencia, remitente o
 * destinatario y observaciones.
 *   entrada: lo que llega a la bodega (de la DDRISS, donaciones, devoluciones).
 *   salida: lo que sale a un servicio o a la farmacia por requisicion.
 *   reajuste: lo demas (inventario fisico, bajas, correcciones), con su signo.
 */
function describir(m) {
  const t = m.traslado;
  if (t) {
    return {
      columna: m.cantidad < 0 ? 'salida' : 'entrada',
      referencia: req(t.requisicion?.numero) ?? t.numero,
      remitenteDestinatario: m.tipo === 'paso_farmacia' ? 'Farmacia (post-consulta)' : (t.ubicacion?.nombre ?? m.servicio ?? ''),
      observaciones: m.cantidad > 0 ? 'Devolución' : '',
    };
  }
  switch (m.tipo) {
    case 'ingreso':
      return {
        columna: 'entrada',
        referencia: req(m.lote.requisicion?.numero) ?? (m.lote.actaDonacion ? `Acta ${m.lote.actaDonacion}` : ''),
        remitenteDestinatario: m.lote.requisicion?.almacen ?? ETIQUETA_ORIGEN[m.lote.origen] ?? '',
        observaciones: m.lote.origen === 'donacion' ? 'Donación' : '',
      };
    case 'paso_farmacia':
      return {
        columna: m.cantidad < 0 ? 'salida' : 'entrada',
        referencia: '',
        remitenteDestinatario: 'Farmacia (post-consulta)',
        observaciones: m.cantidad > 0 ? 'Devolución de farmacia' : '',
      };
    default:
      return {
        columna: 'reajuste',
        referencia: '',
        remitenteDestinatario: m.servicio ?? '',
        observaciones: [ETIQUETA_TIPO[m.tipo] ?? m.tipo, ETIQUETA_CAUSA[m.causa] ?? m.causa].filter(Boolean).join(': '),
      };
  }
}

const costo = (m) => (m.lote.costoUnitario != null ? Number(m.lote.costoUnitario) : null);
const redondear = (v) => Math.round(v * 100) / 100;

/**
 * Renglones de la tarjeta a partir del saldo anterior. Funcion pura: recibe
 * los movimientos de bodega ya ordenados.
 */
function filasKardex(movimientos, saldoAnterior = 0, valorAnterior = 0) {
  let saldo = saldoAnterior;
  let valor = valorAnterior ?? 0;
  let valorCompleto = valorAnterior != null;
  const filas = movimientos.map((m) => {
    saldo += m.cantidad;
    const precio = costo(m);
    if (precio == null) valorCompleto = false;
    else valor += m.cantidad * precio;
    const d = describir(m);
    const entrada = d.columna === 'entrada' ? m.cantidad : null;
    return {
      id: m.id,
      fecha: m.registradoEn,
      tipo: m.tipo,
      referencia: d.referencia,
      remitenteDestinatario: d.remitenteDestinatario,
      entrada,
      precioUnitario: entrada != null ? precio : null,
      valorEntrada: entrada != null && precio != null ? redondear(entrada * precio) : null,
      fechaVence: m.lote.fechaVence,
      numeroLote: m.lote.numeroLote,
      salida: d.columna === 'salida' ? -m.cantidad : null,
      reajuste: d.columna === 'reajuste' ? m.cantidad : null,
      saldo,
      valorSaldo: valorCompleto ? redondear(valor) : null,
      observaciones: d.observaciones,
      usuario: m.usuario?.nombre ?? null,
    };
  });
  return {
    filas,
    saldoFinal: saldo,
    entradas: filas.reduce((s, f) => s + (f.entrada ?? 0), 0),
    salidas: filas.reduce((s, f) => s + (f.salida ?? 0), 0),
    reajustes: filas.reduce((s, f) => s + (f.reajuste ?? 0), 0),
    valorFinal: valorCompleto ? redondear(valor) : null,
  };
}

function datosInsumo(i) {
  return {
    id: i.id,
    codigoInterno: i.codigoInterno,
    codigoMspas: i.codigoMspas,
    nombreGenerico: i.nombreGenerico,
    concentracion: i.concentracion,
    formaFarmaceutica: i.formaFarmaceutica,
    presentacion: i.presentacion,
    unidadEntrega: i.unidadEntrega,
    categoria: i.categoria,
  };
}

async function saldosAntes(insumoIds, desde) {
  if (!desde) return new Map();
  const previos = await prisma.movimientoInsumo.findMany({
    where: { ubicacion: 'bodega', registradoEn: { lt: desde }, lote: { insumoId: { in: insumoIds } } },
    select: { cantidad: true, lote: { select: { insumoId: true, costoUnitario: true } } },
  });
  const res = new Map();
  for (const m of previos) {
    const s = res.get(m.lote.insumoId) ?? { saldo: 0, valor: 0, completo: true };
    s.saldo += m.cantidad;
    if (m.lote.costoUnitario == null) s.completo = false;
    else s.valor += m.cantidad * Number(m.lote.costoUnitario);
    res.set(m.lote.insumoId, s);
  }
  return res;
}

/** Tarjetas de varios insumos en el rango [desde, hasta). */
async function kardexDe(establecimientoId, { insumoIds = null, desde = null, hasta = null, soloConMovimiento = false } = {}) {
  const insumos = await prisma.insumo.findMany({
    where: { establecimientoId, ...(insumoIds ? { id: { in: insumoIds } } : {}) },
    orderBy: [{ nombreGenerico: 'asc' }, { concentracion: 'asc' }],
  });
  const ids = insumos.map((i) => i.id);
  const fecha = { ...(desde ? { gte: desde } : {}), ...(hasta ? { lt: hasta } : {}) };
  const [movimientos, anteriores] = await Promise.all([
    prisma.movimientoInsumo.findMany({
      where: { ubicacion: 'bodega', lote: { insumoId: { in: ids } }, ...(desde || hasta ? { registradoEn: fecha } : {}) },
      include: INCLUIR,
      orderBy: [{ registradoEn: 'asc' }, { id: 'asc' }],
    }),
    saldosAntes(ids, desde),
  ]);
  const porInsumo = new Map();
  for (const m of movimientos) {
    if (!porInsumo.has(m.lote.insumoId)) porInsumo.set(m.lote.insumoId, []);
    porInsumo.get(m.lote.insumoId).push(m);
  }
  const tarjetas = [];
  for (const i of insumos) {
    const propios = porInsumo.get(i.id) ?? [];
    if (soloConMovimiento && propios.length === 0) continue;
    const ant = anteriores.get(i.id) ?? { saldo: 0, valor: 0, completo: true };
    tarjetas.push({
      insumo: datosInsumo(i),
      saldoAnterior: ant.saldo,
      valorAnterior: ant.completo ? redondear(ant.valor) : null,
      ...filasKardex(propios, ant.saldo, ant.completo ? ant.valor : null),
    });
  }
  return tarjetas;
}

/** Lo que va en el encabezado de la tarjeta, igual para todas. */
async function encabezadoKardex(establecimientoId) {
  const [est, config] = await Promise.all([
    prisma.establecimiento.findUnique({ where: { id: establecimientoId } }),
    configuracion(establecimientoId),
  ]);
  return {
    distrito: est ? `${est.municipio}, ${est.departamento}` : '',
    servicio: 'Bodega',
    nivelMinimo: Number(config.nivelMinimoMeses),
    nivelMaximo: Number(config.nivelMaximoMeses),
  };
}

module.exports = { kardexDe, filasKardex, describir, encabezadoKardex };
