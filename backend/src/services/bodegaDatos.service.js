/**
 * Lecturas de la base para la bodega: existencia del centro, traslados a los
 * servicios, reportes mensuales de los servicios, balance consolidado y BRES
 * del municipio. Las reglas de calculo viven en bodega.service.js.
 *
 * Como se reparte la existencia (MD/Bodega.md):
 *   - Bodega: los lotes del centro. Post-consulta entrega desde esos mismos
 *     lotes, asi que no tiene saldo propio; en el balance es la columna de
 *     lo entregado a pacientes en el centro.
 *   - Puestos y centros comunitarios: su saldo es lo que reportan cada mes,
 *     partiendo de lo que la bodega les traslado.
 */

const prisma = require('../config/db');
const { limitesDePeriodo, configuracion } = require('./abastecimiento.service');
const { periodoDe } = require('./logistica.service');
const {
  filaReporte, filaBres, periodoAnterior, ultimosPeriodos, CATEGORIAS,
} = require('./bodega.service');

const sumar = (mapa, clave, valor) => mapa.set(clave, (mapa.get(clave) ?? 0) + valor);
const clave2 = (a, b) => `${a}:${b}`;

/** Ubicaciones del establecimiento, en el orden del balance. */
async function ubicaciones(establecimientoId, { soloActivas = true } = {}) {
  return prisma.ubicacion.findMany({
    where: { establecimientoId, ...(soloActivas ? { activo: true } : {}) },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
  });
}

/** Servicios que reciben traslados y reportan: ni la bodega ni post-consulta. */
const esServicioQueReporta = (u) => u.tipo === 'puesto_salud' || u.tipo === 'centro_comunitario';

/** Parametros numericos del BRES del centro. */
function parametrosBres(config) {
  return {
    nivelMinimoMeses: Number(config.nivelMinimoMeses),
    nivelMaximoMeses: Number(config.nivelMaximoMeses),
    mesesPromedio: config.mesesPromedio,
    formulaPedido: config.formulaPedido,
    diaCorteBres: config.diaCorteBres,
  };
}

// --- Centro -----------------------------------------------------------------------

const MOVIMIENTOS_VACIOS = {
  entradas: 0, entregado: 0, consumo: 0, trasladado: 0, aFarmacia: 0, devuelto: 0,
  reajustes: 0, reajustesBodega: 0, reajustesFarmacia: 0, bajas: 0,
};

/**
 * Movimientos del centro en un rango, por insumo y tipo.
 *
 * entradas: lo que recibio la bodega. aFarmacia: lo que paso de la bodega a
 * la farmacia (neto de lo que farmacia devolvio). entregado: lo entregado a
 * pacientes, menos lo de entregas anuladas (devuelto). trasladado: lo que
 * salio a los servicios. Los reajustes van por ubicacion.
 */
async function movimientosCentro(establecimientoId, desde, hasta) {
  const filas = await prisma.movimientoInsumo.findMany({
    where: { lote: { insumo: { establecimientoId } }, registradoEn: { gte: desde, lt: hasta } },
    select: { tipo: true, cantidad: true, ubicacion: true, lote: { select: { insumoId: true } } },
  });
  const salida = new Map();
  for (const m of filas) {
    const id = m.lote.insumoId;
    const fila = salida.get(id) ?? { ...MOVIMIENTOS_VACIOS };
    if (m.tipo === 'ingreso') fila.entradas += m.cantidad;
    else if (m.tipo === 'entrega') fila.entregado -= m.cantidad;
    else if (m.tipo === 'devolucion') fila.entregado -= m.cantidad;
    else if (m.tipo === 'consumo_interno') fila.consumo -= m.cantidad;
    else if (m.tipo === 'traslado') fila.trasladado -= m.cantidad;
    else if (m.tipo === 'paso_farmacia' && m.ubicacion === 'farmacia') fila.aFarmacia += m.cantidad;
    else if (m.tipo === 'reajuste') {
      fila.reajustes += m.cantidad;
      if (m.ubicacion === 'farmacia') fila.reajustesFarmacia += m.cantidad;
      else fila.reajustesBodega += m.cantidad;
    } else if (m.tipo === 'baja') fila.bajas -= m.cantidad;
    salida.set(id, fila);
  }
  return salida;
}

/**
 * Existencia fisica por insumo antes de una fecha: de todo el centro, o de
 * una ubicacion (bodega o farmacia).
 */
async function saldoCentro(establecimientoId, hasta, ubicacion = null) {
  const filas = await prisma.movimientoInsumo.findMany({
    where: { lote: { insumo: { establecimientoId } }, registradoEn: { lt: hasta }, ...(ubicacion ? { ubicacion } : {}) },
    select: { cantidad: true, lote: { select: { insumoId: true } } },
  });
  const salida = new Map();
  for (const m of filas) sumar(salida, m.lote.insumoId, m.cantidad);
  return salida;
}

/** Demanda no atendida en el centro (post-consulta), por insumo. */
async function noEntregadoCentro(establecimientoId, desde, hasta) {
  const filas = await prisma.demandaNoAtendida.findMany({
    where: { insumo: { establecimientoId }, registradaEn: { gte: desde, lt: hasta } },
    select: { insumoId: true, cantidad: true },
  });
  const salida = new Map();
  for (const f of filas) sumar(salida, f.insumoId, f.cantidad);
  return salida;
}

// --- Servicios ----------------------------------------------------------------------

/** Traslados a servicios antes de una fecha, con su fecha, ubicacion e insumo. */
async function trasladosHasta(establecimientoId, hasta) {
  const filas = await prisma.movimientoInsumo.findMany({
    where: { tipo: 'traslado', NOT: { trasladoId: null }, registradoEn: { lt: hasta }, lote: { insumo: { establecimientoId } } },
    select: { cantidad: true, registradoEn: true, lote: { select: { insumoId: true } }, traslado: { select: { ubicacionId: true } } },
  });
  return filas.map((m) => ({
    ubicacionId: m.traslado.ubicacionId,
    insumoId: m.lote.insumoId,
    cantidad: -m.cantidad,
    periodo: periodoDe(new Date(new Date(m.registradoEn).getTime() - 6 * 3600000)),
  }));
}

/**
 * Saldo anterior y entradas de cada servicio e insumo para un periodo.
 *
 * Saldo anterior: el saldo siguiente del ultimo reporte del servicio, mas lo
 * que se le traslado despues de ese reporte y antes del periodo. Si nunca ha
 * reportado, todo lo que se le traslado antes del periodo.
 * Entradas: lo trasladado dentro del periodo (precargado, no se pregunta).
 */
async function arranqueServicios(establecimientoId, periodo) {
  const { hasta } = limitesDePeriodo(periodo);
  const [traslados, reportes] = await Promise.all([
    trasladosHasta(establecimientoId, hasta),
    prisma.reporteServicio.findMany({
      where: { ubicacion: { establecimientoId }, periodo: { lt: periodo } },
      select: { ubicacionId: true, periodo: true, renglones: { select: { insumoId: true, saldoSiguiente: true } } },
      orderBy: { periodo: 'desc' },
    }),
  ]);

  // El ultimo reporte de cada servicio antes del periodo.
  const ultimo = new Map();
  for (const r of reportes) if (!ultimo.has(r.ubicacionId)) ultimo.set(r.ubicacionId, r);

  const saldoAnterior = new Map();
  const entradas = new Map();
  for (const [ubicacionId, r] of ultimo) {
    for (const ren of r.renglones) sumar(saldoAnterior, clave2(ubicacionId, ren.insumoId), ren.saldoSiguiente);
  }
  for (const t of traslados) {
    const k = clave2(t.ubicacionId, t.insumoId);
    if (t.periodo === periodo) {
      sumar(entradas, k, t.cantidad);
    } else if (t.periodo < periodo) {
      const desdeReporte = ultimo.get(t.ubicacionId)?.periodo;
      if (!desdeReporte || t.periodo > desdeReporte) sumar(saldoAnterior, k, t.cantidad);
    }
  }
  return { saldoAnterior, entradas };
}

/**
 * Formulario del reporte mensual de un servicio: todos los insumos activos,
 * con saldo anterior y entradas ya calculados, y lo que ya se haya capturado.
 */
async function formularioReporte(establecimientoId, ubicacionId, periodo) {
  const ubicacion = await prisma.ubicacion.findFirst({ where: { id: ubicacionId, establecimientoId } });
  if (!ubicacion) return null;

  const [insumos, arranque, reporte, alguna] = await Promise.all([
    prisma.insumo.findMany({ where: { establecimientoId, activo: true }, orderBy: { nombreGenerico: 'asc' } }),
    arranqueServicios(establecimientoId, periodo),
    prisma.reporteServicio.findUnique({
      where: { ubicacionId_periodo: { ubicacionId, periodo } },
      include: { renglones: true, usuario: { select: { nombre: true } } },
    }),
    // Insumos que el servicio maneja: alguna vez se le trasladaron o los reporto.
    prisma.reporteServicioRenglon.findMany({
      where: { reporte: { ubicacionId } },
      select: { insumoId: true },
      distinct: ['insumoId'],
    }),
  ]);

  const capturado = new Map((reporte?.renglones ?? []).map((r) => [r.insumoId, r]));
  const maneja = new Set(alguna.map((a) => a.insumoId));

  const renglones = insumos.map((i) => {
    const k = clave2(ubicacionId, i.id);
    const previo = capturado.get(i.id);
    // Un reporte importado del Excel trae su propio saldo anterior y sus
    // entradas: esos meses no tienen traslados en el sistema.
    const delExcel = reporte?.importado && previo;
    const saldoAnterior = delExcel ? previo.saldoAnterior : (arranque.saldoAnterior.get(k) ?? 0);
    const entradas = delExcel ? previo.entradas : (arranque.entradas.get(k) ?? 0);
    if (saldoAnterior || entradas) maneja.add(i.id);
    return {
      insumoId: i.id,
      codigoInterno: i.codigoInterno,
      nombre: i.nombreGenerico,
      concentracion: i.concentracion,
      unidadEntrega: i.unidadEntrega,
      categoria: i.categoria,
      maneja: maneja.has(i.id),
      ...filaReporte({
        saldoAnterior,
        entradas,
        entregado: previo?.entregado ?? 0,
        noEntregado: previo?.noEntregado ?? 0,
        saldoReportado: previo?.saldoReportado ?? null,
        entradasReportadas: previo?.entradasReportadas ?? null,
      }),
      capturado: Boolean(previo),
    };
  });

  return {
    ubicacion,
    periodo,
    reporte: reporte
      ? { id: reporte.id, capturadoEn: reporte.capturadoEn, capturadoPor: reporte.usuario?.nombre, revisado: reporte.revisado, observacion: reporte.observacion, importado: reporte.importado }
      : null,
    renglones,
  };
}

/**
 * Guarda el reporte de un servicio. Solo se capturan entregado, no
 * entregado y, si se tienen, el saldo y las entradas que reporta el servicio;
 * el resto se recalcula aqui.
 */
async function guardarReporte(establecimientoId, ubicacionId, periodo, { renglones, observacion }, usuarioId) {
  const form = await formularioReporte(establecimientoId, ubicacionId, periodo);
  if (!form) return null;

  const base = new Map(form.renglones.map((r) => [r.insumoId, r]));
  const filas = [];
  for (const r of renglones) {
    const b = base.get(r.insumoId);
    if (!b) continue;
    const f = filaReporte({
      saldoAnterior: b.saldoAnterior,
      entradas: b.entradas,
      entregado: r.entregado ?? 0,
      noEntregado: r.noEntregado ?? 0,
      saldoReportado: r.saldoReportado,
      entradasReportadas: r.entradasReportadas,
    });
    filas.push({ insumoId: r.insumoId, ...f });
  }
  // Los insumos que no se tocaron pero tienen movimiento quedan con su saldo.
  for (const b of form.renglones) {
    if (!filas.some((f) => f.insumoId === b.insumoId) && (b.saldoAnterior || b.entradas)) {
      filas.push({ insumoId: b.insumoId, ...filaReporte({ saldoAnterior: b.saldoAnterior, entradas: b.entradas }) });
    }
  }

  const diferencias = filas.filter((f) => f.diferenciaSaldo || f.diferenciaEntradas).length;

  await prisma.$transaction(async (tx) => {
    const reporte = await tx.reporteServicio.upsert({
      where: { ubicacionId_periodo: { ubicacionId, periodo } },
      create: { ubicacionId, periodo, capturadoPor: usuarioId, observacion: observacion ?? null, revisado: diferencias === 0 },
      // Volver a capturar deja el reporte por revisar otra vez.
      update: { capturadoPor: usuarioId, capturadoEn: new Date(), observacion: observacion ?? null, revisado: diferencias === 0 },
    });
    await tx.reporteServicioRenglon.deleteMany({ where: { reporteId: reporte.id } });
    await tx.reporteServicioRenglon.createMany({
      data: filas.map((f) => ({
        reporteId: reporte.id,
        insumoId: f.insumoId,
        saldoAnterior: f.saldoAnterior,
        entradas: f.entradas,
        entradasReportadas: f.entradasReportadas,
        entregado: f.entregado,
        noEntregado: f.noEntregado,
        saldoSiguiente: f.saldoSiguiente,
        saldoReportado: f.saldoReportado,
      })),
    });
  });

  return { renglones: filas.length, diferencias };
}

/** Que servicios ya reportaron el mes y cuales faltan. */
async function estadoReportes(establecimientoId, periodo) {
  const [lista, reportes] = await Promise.all([
    ubicaciones(establecimientoId),
    prisma.reporteServicio.findMany({
      where: { ubicacion: { establecimientoId }, periodo },
      include: { renglones: true, usuario: { select: { nombre: true } } },
    }),
  ]);
  const porUbicacion = new Map(reportes.map((r) => [r.ubicacionId, r]));
  return lista.filter(esServicioQueReporta).map((u) => {
    const r = porUbicacion.get(u.id);
    const diferencias = r
      ? r.renglones.filter((x) => (x.saldoReportado !== null && x.saldoReportado !== x.saldoSiguiente)
        || (x.entradasReportadas !== null && x.entradasReportadas !== x.entradas)).length
      : 0;
    return {
      ubicacionId: u.id,
      nombre: u.nombre,
      tipo: u.tipo,
      reportado: Boolean(r),
      capturadoEn: r?.capturadoEn ?? null,
      capturadoPor: r?.usuario?.nombre ?? null,
      revisado: r?.revisado ?? false,
      diferencias,
      entregado: r ? r.renglones.reduce((s, x) => s + x.entregado, 0) : 0,
    };
  });
}

// --- Balance y BRES --------------------------------------------------------------------

/**
 * Demanda del municipio (entregado + no entregado, centro y servicios) de
 * cada periodo. Los meses anteriores al primer movimiento del sistema quedan
 * en null: no hay datos, no son ceros.
 */
async function demandaMunicipal(establecimientoId, periodos) {
  const [primero, primerReporte] = await Promise.all([
    prisma.movimientoInsumo.findFirst({
      where: { lote: { insumo: { establecimientoId } } },
      orderBy: { registradoEn: 'asc' },
      select: { registradoEn: true },
    }),
    // El historial importado de los Excel llega como reportes, sin movimientos.
    prisma.reporteServicio.findFirst({
      where: { ubicacion: { establecimientoId } },
      orderBy: { periodo: 'asc' },
      select: { periodo: true },
    }),
  ]);
  const candidatos = [
    primero ? periodoDe(new Date(new Date(primero.registradoEn).getTime() - 6 * 3600000)) : null,
    primerReporte?.periodo ?? null,
  ].filter(Boolean).sort();
  const inicio = candidatos[0] ?? null;

  const porPeriodo = new Map();
  for (const p of periodos) {
    if (!inicio || p < inicio) { porPeriodo.set(p, null); continue; }
    const { desde, hasta } = limitesDePeriodo(p);
    const [mov, dna, reportes] = await Promise.all([
      movimientosCentro(establecimientoId, desde, hasta),
      noEntregadoCentro(establecimientoId, desde, hasta),
      prisma.reporteServicioRenglon.findMany({
        where: { reporte: { periodo: p, ubicacion: { establecimientoId } } },
        select: { insumoId: true, entregado: true, noEntregado: true, reporte: { select: { ubicacionId: true } } },
      }),
    ]);
    // Total del municipio, lo del centro y lo de cada servicio, por insumo.
    const total = new Map();
    const centro = new Map();
    const porServicio = new Map();
    for (const [id, m] of mov) { sumar(total, id, m.entregado + m.consumo); sumar(centro, id, m.entregado + m.consumo); }
    for (const [id, n] of dna) { sumar(total, id, n); sumar(centro, id, n); }
    for (const r of reportes) {
      sumar(total, r.insumoId, r.entregado + r.noEntregado);
      sumar(porServicio, clave2(r.reporte.ubicacionId, r.insumoId), r.entregado + r.noEntregado);
    }
    porPeriodo.set(p, { total, centro, porServicio });
  }
  return porPeriodo;
}

/** Numero de un campo decimal de Prisma; null se queda null. */
const numero = (v) => (v === null || v === undefined ? null : Number(v));

/** Totales (B a M) de un renglon de BRES guardado: lo que se envio, tal cual. */
function bresGuardado(g) {
  const J = numero(g.pmdr) ?? 0;
  return {
    B: g.saldoInicial,
    C: g.entradas,
    D: g.entregado,
    E: g.noEntregado,
    F: g.demandaReal,
    G: g.reajustes,
    H: g.saldoFinal,
    I: g.existenciaBodega,
    J,
    K: numero(g.med),
    L: numero(g.cantidadMaxima),
    M: numero(g.cantidadSolicitar),
    minimo: g.cantidadMinima,
    saldoPorDemanda: g.saldoPorDemanda ?? g.saldoInicial + g.entradas - g.entregado,
    mesAnterior: g.existenciaMesAnterior,
    bajoMinimo: J > 0 && g.cantidadMinima !== null && g.saldoFinal < g.cantidadMinima,
    sinConsumo: J === 0,
    mesesConDatos: g.mesesHistoria,
  };
}

const BRES_VACIO = {
  saldoInicial: 0, entradas: 0, entregado: 0, noEntregado: 0, demandaReal: 0, reajustes: 0, saldoFinal: 0,
  existenciaBodega: 0, pmdr: 0, med: null, cantidadMaxima: 0, cantidadSolicitar: 0, cantidadMinima: 0,
  saldoPorDemanda: 0, existenciaMesAnterior: 0, mesesHistoria: 0,
};

/**
 * Balance consolidado del mes: insumos en filas, la bodega, post-consulta y
 * cada servicio en columnas, y al final los totales (B a M), como el Excel
 * del centro.
 *
 * Un mes con BRES cerrado (los importados del Excel y los que el sistema ya
 * envio) muestra lo que se guardo, cifra por cifra: no se recalcula nada. Un
 * mes abierto se calcula con las formulas del Excel (filaBres).
 */
async function balance(establecimientoId, periodo, { categoria = null, insumoId = null } = {}) {
  const { desde, hasta } = limitesDePeriodo(periodo);
  const config = await configuracion(establecimientoId);
  const p = parametrosBres(config);
  // El promedio incluye el mes que se cierra, como en el balance del centro.
  // Mientras el mes en curso no llega a su corte, sus pocas entregas bajarian
  // el promedio: se usan los meses completos anteriores.
  const finVentana = mesAbierto(periodo, config.diaCorteBres) ? periodoAnterior(periodo) : periodo;

  const [lista, movimientos, saldoInicio, saldoFin, farmaciaInicio, farmaciaFin, dna, arranque, reportes, demandas, cerrado, anterior] = await Promise.all([
    ubicaciones(establecimientoId),
    movimientosCentro(establecimientoId, desde, hasta),
    saldoCentro(establecimientoId, desde, 'bodega'),
    saldoCentro(establecimientoId, hasta, 'bodega'),
    saldoCentro(establecimientoId, desde, 'farmacia'),
    saldoCentro(establecimientoId, hasta, 'farmacia'),
    noEntregadoCentro(establecimientoId, desde, hasta),
    arranqueServicios(establecimientoId, periodo),
    prisma.reporteServicio.findMany({
      where: { ubicacion: { establecimientoId }, periodo },
      include: { renglones: true },
    }),
    demandaMunicipal(establecimientoId, ultimosPeriodos(finVentana, config.mesesPromedio)),
    prisma.bres.findUnique({ where: { establecimientoId_periodo: { establecimientoId, periodo } }, include: { renglones: true } }),
    prisma.bres.findUnique({
      where: { establecimientoId_periodo: { establecimientoId, periodo: periodoAnterior(periodo) } },
      include: { renglones: { select: { insumoId: true, saldoFinal: true } } },
    }),
  ]);
  const congelado = cerrado?.estado === 'cerrado' ? new Map(cerrado.renglones.map((r) => [r.insumoId, r])) : null;
  // B del mes abierto: el saldo siguiente (H) del mes anterior, si se cerro.
  const saldoAnteriorBres = anterior?.estado === 'cerrado'
    ? new Map(anterior.renglones.map((r) => [r.insumoId, r.saldoFinal]))
    : null;

  // Los insumos activos y los que tienen cifras en el mes, aunque hoy ya no
  // se usen: un mes viejo se ve con todos sus renglones.
  const conCifras = new Set([
    ...(congelado ? congelado.keys() : []),
    ...reportes.flatMap((r) => r.renglones.map((x) => x.insumoId)),
  ]);
  const insumos = await prisma.insumo.findMany({
    where: {
      establecimientoId,
      OR: [{ activo: true }, { id: { in: [...conCifras] } }],
      ...(categoria ? { categoria } : {}),
      ...(insumoId ? { id: insumoId } : {}),
    },
    orderBy: { nombreGenerico: 'asc' },
  });

  // Meses anteriores al sistema sin BRES: la bodega sale del inventario de
  // cierre que llevaba el centro.
  const historico = congelado ? [] : await prisma.inventarioCierreHistorico.findMany({ where: { establecimientoId, periodo } });
  const cierreExcel = new Map(historico.map((h) => [h.insumoId, h]));
  const centro = lista.find((u) => u.tipo === 'centro_salud');
  const reportePost = centro ? reportes.find((r) => r.ubicacionId === centro.id) : null;
  const postImportado = reportePost?.importado ? new Map(reportePost.renglones.map((r) => [r.insumoId, r])) : null;

  const servicios = lista.filter(esServicioQueReporta);
  const conTraslados = new Set((await prisma.traslado.findMany({
    where: { establecimientoId, registradoEn: { lt: hasta } },
    select: { ubicacionId: true },
    distinct: ['ubicacionId'],
  })).map((t) => t.ubicacionId));
  const reportado = new Map();
  const importado = new Set();
  for (const r of reportes) {
    if (r.importado) importado.add(r.ubicacionId);
    for (const ren of r.renglones) reportado.set(clave2(r.ubicacionId, ren.insumoId), ren);
  }
  const conReporte = new Set(reportes.map((r) => r.ubicacionId));

  // Promedio de cada servicio en un mes abierto: la demanda de los ultimos
  // meses, redondeada, como la anota cada servicio en su balance.
  const ventana = ultimosPeriodos(finVentana, config.mesesPromedio).map((per) => demandas.get(per)).filter(Boolean);
  const promedio = (fn) => (ventana.length ? Math.round(ventana.reduce((s, d) => s + fn(d), 0) / ventana.length) : 0);

  const filas = insumos.map((i) => {
    const m = movimientos.get(i.id) ?? MOVIMIENTOS_VACIOS;
    const g = congelado?.get(i.id);
    const h = cierreExcel.get(i.id);
    let bodega;
    if (congelado) {
      // Mes cerrado: la bodega es la del balance que se envio.
      bodega = {
        saldoAnterior: g?.existenciaMesAnterior ?? 0,
        entradas: g?.entradas ?? 0,
        trasladado: 0,
        reajustes: g?.reajustes ?? 0,
        saldoSiguiente: g?.existenciaBodega ?? 0,
      };
    } else if (h) {
      bodega = { saldoAnterior: h.saldoAnterior, entradas: h.entradas, trasladado: h.entregado, reajustes: 0, saldoSiguiente: h.saldoActual };
    } else {
      // La bodega: lo que recibe, lo que sale a los servicios y a la farmacia.
      bodega = {
        saldoAnterior: saldoInicio.get(i.id) ?? 0,
        entradas: m.entradas,
        trasladado: m.trasladado + m.aFarmacia + m.consumo,
        aFarmacia: m.aFarmacia,
        reajustes: m.reajustesBodega - m.bajas,
        saldoSiguiente: saldoFin.get(i.id) ?? 0,
      };
    }

    // Post-consulta: si el mes viene del Excel, sus seis cifras tal cual.
    let postConsulta;
    if (postImportado) {
      const rp = postImportado.get(i.id);
      postConsulta = {
        saldoAnterior: rp?.saldoAnterior ?? 0,
        entradas: rp?.entradas ?? 0,
        entregado: rp?.entregado ?? 0,
        noEntregado: rp?.noEntregado ?? 0,
        saldoSiguiente: rp?.saldoSiguiente ?? 0,
        promedio: numero(rp?.promedioAnotado) ?? 0,
      };
    } else {
      // La farmacia del centro: recibe de la bodega y entrega a los pacientes.
      postConsulta = {
        saldoAnterior: farmaciaInicio.get(i.id) ?? 0,
        entradas: m.aFarmacia,
        entregado: m.entregado,
        noEntregado: dna.get(i.id) ?? 0,
        saldoSiguiente: farmaciaFin.get(i.id) ?? 0,
        // El conteo del dia: faltantes y sobrantes encontrados al cerrar.
        ajuste: m.reajustesFarmacia,
        promedio: promedio((d) => (d.centro.get(i.id) ?? 0) + (centro ? d.porServicio.get(clave2(centro.id, i.id)) ?? 0 : 0)),
      };
    }

    const columnas = servicios.map((s) => {
      const k = clave2(s.id, i.id);
      const ren = reportado.get(k);
      if (importado.has(s.id)) {
        // Reporte del Excel: cada cifra como se anoto, aunque no cuadre.
        const saldoSiguiente = ren?.saldoSiguiente ?? 0;
        return {
          ubicacionId: s.id,
          reportado: true,
          ...filaReporte({ saldoAnterior: ren?.saldoAnterior ?? 0, entradas: ren?.entradas ?? 0, entregado: ren?.entregado ?? 0, noEntregado: ren?.noEntregado ?? 0 }),
          saldoSiguiente,
          negativo: saldoSiguiente < 0,
          promedio: numero(ren?.promedioAnotado) ?? 0,
        };
      }
      const f = ren
        ? filaReporte({ saldoAnterior: ren.saldoAnterior, entradas: ren.entradas, entregado: ren.entregado, noEntregado: ren.noEntregado, saldoReportado: ren.saldoReportado, entradasReportadas: ren.entradasReportadas })
        : filaReporte({ saldoAnterior: arranque.saldoAnterior.get(k) ?? 0, entradas: arranque.entradas.get(k) ?? 0 });
      return {
        ubicacionId: s.id,
        reportado: conReporte.has(s.id),
        ...f,
        promedio: promedio((d) => d.porServicio.get(k) ?? 0),
      };
    });

    const svc = (campo) => columnas.reduce((s, c) => s + c[campo], 0);
    let bres;
    if (g) {
      bres = bresGuardado(g);
    } else if (congelado) {
      // El insumo no estaba en el balance de ese mes: sin cifras.
      bres = bresGuardado(BRES_VACIO);
    } else {
      const saldoAnterior = bodega.saldoAnterior + postConsulta.saldoAnterior + svc('saldoAnterior');
      bres = filaBres({
        B: saldoAnteriorBres?.has(i.id) ? saldoAnteriorBres.get(i.id) : saldoAnterior,
        C: bodega.entradas,
        // El consumo interno sale de la bodega y el BRES lo cuenta como entregado.
        D: postConsulta.entregado + svc('entregado') + m.consumo,
        E: postConsulta.noEntregado + svc('noEntregado'),
        G: bodega.reajustes,
        I: bodega.saldoSiguiente,
        saldos: [postConsulta.saldoSiguiente, ...columnas.map((c) => c.saldoSiguiente)],
        promedios: [postConsulta.promedio, ...columnas.map((c) => c.promedio)],
        config: p,
      });
      bres.mesAnterior = bodega.saldoAnterior;
      bres.mesesConDatos = ventana.length;
    }

    return {
      insumoId: i.id,
      codigoInterno: i.codigoInterno,
      nombre: i.nombreGenerico,
      concentracion: i.concentracion,
      formaFarmaceutica: i.formaFarmaceutica,
      unidadEntrega: i.unidadEntrega,
      categoria: i.categoria,
      activo: i.activo,
      bodega,
      postConsulta,
      servicios: columnas,
      bres,
    };
  });

  return {
    periodo,
    cerrado: Boolean(congelado),
    servicios: servicios.map((s) => ({ id: s.id, nombre: s.nombre, tipo: s.tipo, reportado: conReporte.has(s.id) })),
    filas,
    configuracion: { ...p, semaforoRojoMeses: config.semaforoRojoMeses, semaforoAmarilloMeses: config.semaforoAmarilloMeses },
    firmas: {
      encargadoBodega: config.encargadoBodega,
      cargoEncargadoBodega: config.cargoEncargadoBodega,
      coordinadorMunicipal: config.coordinadorMunicipal,
      cargoCoordinador: config.cargoCoordinador,
    },
    categorias: CATEGORIAS,
    // Solo se espera reporte de quien ya recibe traslados por el sistema.
    pendientesDeReporte: servicios.filter((s) => !conReporte.has(s.id) && conTraslados.has(s.id)).length,
  };
}

/** El periodo es el mes en curso y todavia no llega al dia de corte. */
function mesAbierto(periodo, diaCorte, ahora = new Date()) {
  const local = new Date(ahora.getTime() - 6 * 3600000);
  const actual = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
  return periodo === actual && local.getUTCDate() < diaCorte;
}

/** Promedio mensual de entregas reportadas por cada servicio, para distribuir. */
async function promedioPorServicio(establecimientoId, insumoId, periodo, meses) {
  const periodos = ultimosPeriodos(periodoAnterior(periodo), meses);
  const filas = await prisma.reporteServicioRenglon.findMany({
    where: { insumoId, reporte: { periodo: { in: periodos }, ubicacion: { establecimientoId } } },
    select: { entregado: true, reporte: { select: { ubicacionId: true } } },
  });
  const suma = new Map();
  for (const f of filas) sumar(suma, f.reporte.ubicacionId, f.entregado);
  return new Map([...suma].map(([id, total]) => [id, total / meses]));
}

module.exports = {
  bresGuardado,
  mesAbierto,
  ubicaciones,
  esServicioQueReporta,
  parametrosBres,
  movimientosCentro,
  saldoCentro,
  noEntregadoCentro,
  arranqueServicios,
  formularioReporte,
  guardarReporte,
  estadoReportes,
  demandaMunicipal,
  balance,
  promedioPorServicio,
};
