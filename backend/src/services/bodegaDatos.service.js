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

/** Movimientos del centro en un rango, por insumo y tipo. */
async function movimientosCentro(establecimientoId, desde, hasta) {
  const filas = await prisma.movimientoInsumo.findMany({
    where: { lote: { insumo: { establecimientoId } }, registradoEn: { gte: desde, lt: hasta } },
    select: { tipo: true, cantidad: true, lote: { select: { insumoId: true } } },
  });
  const salida = new Map();
  for (const m of filas) {
    const id = m.lote.insumoId;
    const fila = salida.get(id) ?? { entradas: 0, entregado: 0, consumo: 0, trasladado: 0, reajustes: 0, bajas: 0 };
    if (m.tipo === 'ingreso') fila.entradas += m.cantidad;
    else if (m.tipo === 'entrega') fila.entregado -= m.cantidad;
    else if (m.tipo === 'consumo_interno') fila.consumo -= m.cantidad;
    else if (m.tipo === 'traslado') fila.trasladado -= m.cantidad;
    else if (m.tipo === 'reajuste') fila.reajustes += m.cantidad;
    else if (m.tipo === 'baja') fila.bajas -= m.cantidad;
    salida.set(id, fila);
  }
  return salida;
}

/** Existencia fisica de la bodega por insumo antes de una fecha. */
async function saldoCentro(establecimientoId, hasta) {
  const filas = await prisma.movimientoInsumo.findMany({
    where: { lote: { insumo: { establecimientoId } }, registradoEn: { lt: hasta } },
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

/**
 * Balance consolidado del mes: insumos en filas, la bodega, post-consulta y
 * cada servicio en columnas, y al final las columnas del BRES (B a M).
 */
/** Columnas B a M de un renglon de BRES guardado. */
function bresGuardado(g) {
  const J = Number(g.pmdr) || 0;
  return {
    B: g.saldoInicial, C: g.entradas, D: g.entregado, E: g.noEntregado, F: g.demandaReal, G: g.reajustes,
    H: g.saldoFinal, I: g.existenciaBodega, J, K: g.med === null ? null : Number(g.med),
    L: g.cantidadMaxima, M: g.cantidadSolicitar, minimo: g.cantidadMinima,
    bajoMinimo: J > 0 && g.saldoFinal < g.cantidadMinima, sinConsumo: J === 0, mesesConDatos: g.mesesHistoria,
  };
}

async function balance(establecimientoId, periodo, { categoria = null, insumoId = null } = {}) {
  const { desde, hasta } = limitesDePeriodo(periodo);
  const config = await configuracion(establecimientoId);
  const p = parametrosBres(config);
  // El promedio incluye el mes que se cierra, como en el balance del centro.
  // Mientras el mes en curso no llega a su corte, sus pocas entregas bajarian
  // el promedio: se usan los meses completos anteriores.
  const finVentana = mesAbierto(periodo, config.diaCorteBres) ? periodoAnterior(periodo) : periodo;

  const [insumos, lista, movimientos, saldoInicio, saldoFin, dna, arranque, reportes, demandas] = await Promise.all([
    prisma.insumo.findMany({
      where: { establecimientoId, activo: true, ...(categoria ? { categoria } : {}), ...(insumoId ? { id: insumoId } : {}) },
      orderBy: { nombreGenerico: 'asc' },
    }),
    ubicaciones(establecimientoId),
    movimientosCentro(establecimientoId, desde, hasta),
    saldoCentro(establecimientoId, desde),
    saldoCentro(establecimientoId, hasta),
    noEntregadoCentro(establecimientoId, desde, hasta),
    arranqueServicios(establecimientoId, periodo),
    prisma.reporteServicio.findMany({
      where: { ubicacion: { establecimientoId }, periodo },
      include: { renglones: true },
    }),
    demandaMunicipal(establecimientoId, ultimosPeriodos(finVentana, config.mesesPromedio)),
  ]);

  // Meses anteriores al sistema: el BRES cerrado tiene las cifras que se
  // enviaron, la bodega sale del inventario de cierre del centro y
  // post-consulta de su reporte importado.
  const [cerrado, historico] = await Promise.all([
    prisma.bres.findUnique({ where: { establecimientoId_periodo: { establecimientoId, periodo } }, include: { renglones: true } }),
    prisma.inventarioCierreHistorico.findMany({ where: { establecimientoId, periodo } }),
  ]);
  const congelado = cerrado?.estado === 'cerrado' ? new Map(cerrado.renglones.map((r) => [r.insumoId, r])) : null;
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
  for (const r of reportes) for (const ren of r.renglones) reportado.set(clave2(r.ubicacionId, ren.insumoId), ren);
  const conReporte = new Set(reportes.map((r) => r.ubicacionId));

  const filas = insumos.map((i) => {
    const m = movimientos.get(i.id) ?? { entradas: 0, entregado: 0, consumo: 0, trasladado: 0, reajustes: 0, bajas: 0 };
    const h = cierreExcel.get(i.id);
    const bodega = h
      ? { saldoAnterior: h.saldoAnterior, entradas: h.entradas, trasladado: h.entregado, reajustes: 0, saldoSiguiente: h.saldoActual }
      : {
        saldoAnterior: saldoInicio.get(i.id) ?? 0,
        entradas: m.entradas,
        trasladado: m.trasladado,
        reajustes: m.reajustes - m.bajas,
        saldoSiguiente: saldoFin.get(i.id) ?? 0,
      };
    const rp = postImportado?.get(i.id);
    const postConsulta = rp
      ? { entregado: rp.entregado, noEntregado: rp.noEntregado, saldoSiguiente: rp.saldoSiguiente }
      : { entregado: m.entregado + m.consumo, noEntregado: dna.get(i.id) ?? 0 };

    const columnas = servicios.map((s) => {
      const k = clave2(s.id, i.id);
      const ren = reportado.get(k);
      const f = ren
        ? filaReporte({ saldoAnterior: ren.saldoAnterior, entradas: ren.entradas, entregado: ren.entregado, noEntregado: ren.noEntregado, saldoReportado: ren.saldoReportado, entradasReportadas: ren.entradasReportadas })
        : filaReporte({ saldoAnterior: arranque.saldoAnterior.get(k) ?? 0, entradas: arranque.entradas.get(k) ?? 0 });
      return { ubicacionId: s.id, reportado: conReporte.has(s.id), ...f };
    });

    const svc = (campo) => columnas.reduce((s, c) => s + c[campo], 0);
    const ventana = ultimosPeriodos(finVentana, config.mesesPromedio).map((per) => demandas.get(per)).filter(Boolean);
    const historial = ultimosPeriodos(finVentana, config.mesesPromedio).map((per) => {
      const d = demandas.get(per);
      return d === null ? null : (d.total.get(i.id) ?? 0);
    });
    // Promedio de cada servicio, como la columna "Promedio" del balance.
    const promedio = (fn) => (ventana.length ? Math.round(ventana.reduce((s, d) => s + fn(d), 0) / ventana.length) : 0);
    postConsulta.promedio = promedio((d) => (d.centro.get(i.id) ?? 0) + (centro ? d.porServicio.get(clave2(centro.id, i.id)) ?? 0 : 0));
    for (const c of columnas) c.promedio = promedio((d) => d.porServicio.get(clave2(c.ubicacionId, i.id)) ?? 0);
    const g = congelado?.get(i.id);
    const bres = g ? bresGuardado(g) : filaBres({
      B: bodega.saldoAnterior + svc('saldoAnterior'),
      C: bodega.entradas,
      D: postConsulta.entregado + svc('entregado'),
      E: postConsulta.noEntregado + svc('noEntregado'),
      G: bodega.reajustes,
      I: bodega.saldoSiguiente,
      demandas: historial,
      config: p,
    });

    return {
      insumoId: i.id,
      codigoInterno: i.codigoInterno,
      nombre: i.nombreGenerico,
      concentracion: i.concentracion,
      formaFarmaceutica: i.formaFarmaceutica,
      unidadEntrega: i.unidadEntrega,
      categoria: i.categoria,
      bodega,
      postConsulta,
      servicios: columnas,
      bres,
    };
  });

  return {
    periodo,
    servicios: servicios.map((s) => ({ id: s.id, nombre: s.nombre, tipo: s.tipo, reportado: conReporte.has(s.id) })),
    filas,
    configuracion: { ...p, semaforoRojoMeses: config.semaforoRojoMeses, semaforoAmarilloMeses: config.semaforoAmarilloMeses },
    firmas: { encargadoBodega: config.encargadoBodega, cargoEncargadoBodega: config.cargoEncargadoBodega, coordinadorMunicipal: config.coordinadorMunicipal, cargoCoordinador: config.cargoCoordinador },
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
