/**
 * Lecturas de la base para la bodega: existencia del centro, traslados a los
 * servicios, informes mensuales de los servicios, balance consolidado y BRES
 * del municipio. Las reglas de calculo viven en bodega.service.js.
 *
 * Como se reparte la existencia (MD/Bodega.md):
 *   - Bodega: los lotes del centro. Post-consulta entrega desde esos mismos
 *     lotes, asi que no tiene saldo propio; en el balance es la columna de
 *     lo entregado a pacientes en el centro.
 *   - Puestos y centros comunitarios: su saldo es lo que informan cada mes,
 *     partiendo de lo que la bodega les traslado.
 */

const prisma = require('../config/db');
const { limitesDePeriodo, configuracion } = require('./abastecimiento.service');
const { periodoDe } = require('./logistica.service');
const {
  filaInforme, filaBres, periodoAnterior, ultimosPeriodos, CATEGORIAS,
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

/** Servicios que reciben traslados y informan: ni la bodega ni post-consulta. */
const esServicioQueInforma = (u) => u.tipo === 'puesto_salud' || u.tipo === 'centro_comunitario';

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

/**
 * Traslados a servicios antes de una fecha, con su fecha, ubicacion e insumo.
 * Lo que la bodega pasa a la farmacia cuenta como traslado a post-consulta:
 * cuando la farmacia informa en papel, son sus entradas.
 */
async function trasladosHasta(establecimientoId, hasta) {
  const filas = await prisma.movimientoInsumo.findMany({
    where: {
      OR: [{ tipo: 'traslado' }, { tipo: 'paso_farmacia', ubicacion: 'farmacia' }],
      NOT: { trasladoId: null },
      registradoEn: { lt: hasta },
      lote: { insumo: { establecimientoId } },
    },
    select: { tipo: true, cantidad: true, registradoEn: true, lote: { select: { insumoId: true } }, traslado: { select: { ubicacionId: true } } },
  });
  return filas.map((m) => ({
    ubicacionId: m.traslado.ubicacionId,
    insumoId: m.lote.insumoId,
    cantidad: m.tipo === 'traslado' ? -m.cantidad : m.cantidad,
    periodo: periodoDe(m.registradoEn),
  }));
}

/**
 * Saldo anterior y entradas de cada servicio e insumo para un periodo.
 *
 * Saldo anterior: el saldo siguiente del ultimo informe del servicio, mas lo
 * que se le traslado despues de ese informe y antes del periodo. Si nunca ha
 * informado, todo lo que se le traslado antes del periodo.
 * Entradas: lo trasladado dentro del periodo (precargado, no se pregunta).
 */
async function arranqueServicios(establecimientoId, periodo) {
  const { hasta } = limitesDePeriodo(periodo);
  const [traslados, informes] = await Promise.all([
    trasladosHasta(establecimientoId, hasta),
    prisma.informeServicio.findMany({
      where: { ubicacion: { establecimientoId }, periodo: { lt: periodo } },
      select: { ubicacionId: true, periodo: true, renglones: { select: { insumoId: true, saldoSiguiente: true } } },
      orderBy: { periodo: 'desc' },
    }),
  ]);

  // El ultimo informe de cada servicio antes del periodo.
  const ultimo = new Map();
  for (const r of informes) if (!ultimo.has(r.ubicacionId)) ultimo.set(r.ubicacionId, r);

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
      const desdeInforme = ultimo.get(t.ubicacionId)?.periodo;
      if (!desdeInforme || t.periodo > desdeInforme) sumar(saldoAnterior, k, t.cantidad);
    }
  }
  return { saldoAnterior, entradas };
}

/**
 * Formulario del informe mensual de un servicio: todos los insumos activos,
 * con saldo anterior y entradas ya calculados, y lo que ya se haya capturado.
 */
async function formularioInforme(establecimientoId, ubicacionId, periodo) {
  const ubicacion = await prisma.ubicacion.findFirst({ where: { id: ubicacionId, establecimientoId } });
  if (!ubicacion) return null;

  const [insumos, arranque, informe, alguna] = await Promise.all([
    prisma.insumo.findMany({ where: { establecimientoId, activo: true }, orderBy: { nombreGenerico: 'asc' } }),
    arranqueServicios(establecimientoId, periodo),
    prisma.informeServicio.findUnique({
      where: { ubicacionId_periodo: { ubicacionId, periodo } },
      include: { renglones: true, usuario: { select: { nombre: true } } },
    }),
    // Insumos que el servicio maneja: alguna vez se le trasladaron o los informo.
    prisma.informeServicioRenglon.findMany({
      where: { informe: { ubicacionId } },
      select: { insumoId: true },
      distinct: ['insumoId'],
    }),
  ]);

  const capturado = new Map((informe?.renglones ?? []).map((r) => [r.insumoId, r]));
  const maneja = new Set(alguna.map((a) => a.insumoId));

  const renglones = insumos.map((i) => {
    const k = clave2(ubicacionId, i.id);
    const previo = capturado.get(i.id);
    // Un informe importado del Excel trae su propio saldo anterior y sus
    // entradas: esos meses no tienen traslados en el sistema.
    const delExcel = informe?.importado && previo;
    const saldoAnterior = delExcel ? previo.saldoAnterior : (arranque.saldoAnterior.get(k) ?? 0);
    const entradasBodega = delExcel ? previo.entradas : (arranque.entradas.get(k) ?? 0);
    // Lo que el encargado le dio de lo que la bodega entregó a su territorio:
    // eso solo lo sabe él y lo dice en su informe.
    const entradasTerritorio = delExcel ? 0 : (previo?.entradasTerritorio ?? 0);
    const entradas = entradasBodega + entradasTerritorio;
    if (saldoAnterior || entradas) maneja.add(i.id);
    return {
      insumoId: i.id,
      codigoInterno: i.codigoInterno,
      nombre: i.nombreGenerico,
      concentracion: i.concentracion,
      unidadEntrega: i.unidadEntrega,
      categoria: i.categoria,
      maneja: maneja.has(i.id),
      ordenFormulario: i.ordenFormulario,
      entradasBodega,
      entradasTerritorio,
      ...filaInforme({
        saldoAnterior,
        entradas,
        entregado: previo?.entregado ?? 0,
        noEntregado: previo?.noEntregado ?? 0,
        saldoInformado: previo?.saldoInformado ?? null,
        entradasInformadas: previo?.entradasInformadas ?? null,
      }),
      capturado: Boolean(previo),
    };
  });

  return {
    ubicacion,
    periodo,
    informe: informe
      ? { id: informe.id, capturadoEn: informe.capturadoEn, capturadoPor: informe.usuario?.nombre, revisado: informe.revisado, observacion: informe.observacion, importado: informe.importado, enviadoEn: informe.enviadoEn }
      : null,
    renglones,
  };
}

/**
 * Guarda el informe de un servicio. Solo se capturan entregado, no
 * entregado y, si se tienen, el saldo y las entradas que informa el servicio;
 * el resto se recalcula aqui.
 */
async function guardarInforme(establecimientoId, ubicacionId, periodo, { renglones, observacion }, usuarioId, { enviar = true, sinNegativos = false } = {}) {
  const form = await formularioInforme(establecimientoId, ubicacionId, periodo);
  if (!form) return null;

  const base = new Map(form.renglones.map((r) => [r.insumoId, r]));
  const filas = [];
  for (const r of renglones) {
    const b = base.get(r.insumoId);
    if (!b) continue;
    // Las entradas que dice el lugar: lo que pase de lo que la bodega le
    // registró se suma (se lo dio el encargado o llegó por otro lado); si dice
    // menos, queda lo de bodega y la diferencia para que bodega la revise.
    const dice = r.entradas ?? null;
    const entradasTerritorio = dice !== null ? Math.max(0, dice - b.entradasBodega) : (r.entradasTerritorio ?? b.entradasTerritorio);
    const f = filaInforme({
      saldoAnterior: b.saldoAnterior,
      entradas: b.entradasBodega + entradasTerritorio,
      entregado: r.entregado ?? 0,
      noEntregado: r.noEntregado ?? 0,
      saldoInformado: r.saldoInformado,
      entradasInformadas: dice !== null && dice < b.entradasBodega ? dice : r.entradasInformadas,
    });
    filas.push({ insumoId: r.insumoId, ...f, entradasTerritorio });
  }
  // Los insumos que no se tocaron pero tienen movimiento quedan con su saldo.
  for (const b of form.renglones) {
    if (!filas.some((f) => f.insumoId === b.insumoId) && (b.saldoAnterior || b.entradas)) {
      filas.push({ insumoId: b.insumoId, ...filaInforme({ saldoAnterior: b.saldoAnterior, entradas: b.entradas }), entradasTerritorio: b.entradasTerritorio });
    }
  }

  // No se entrega más de lo que se tenía: un saldo negativo es un dato que falta o está mal.
  if (sinNegativos) {
    const nombres = new Map(form.renglones.map((r) => [r.insumoId, r.nombre]));
    const negativos = filas.filter((f) => f.saldoSiguiente < 0).map((f) => nombres.get(f.insumoId));
    if (negativos.length) return { negativos };
  }
  const diferencias = filas.filter((f) => f.diferenciaSaldo || f.diferenciaEntradas).length;

  await prisma.$transaction(async (tx) => {
    const informe = await tx.informeServicio.upsert({
      where: { ubicacionId_periodo: { ubicacionId, periodo } },
      create: { ubicacionId, periodo, capturadoPor: usuarioId, observacion: observacion ?? null, revisado: diferencias === 0, enviadoEn: enviar ? new Date() : null },
      // Volver a capturar deja el informe por revisar otra vez.
      update: { capturadoPor: usuarioId, capturadoEn: new Date(), observacion: observacion ?? null, revisado: diferencias === 0, enviadoEn: enviar ? new Date() : null },
    });
    await tx.informeServicioRenglon.deleteMany({ where: { informeId: informe.id } });
    await tx.informeServicioRenglon.createMany({
      data: filas.map((f) => ({
        informeId: informe.id,
        insumoId: f.insumoId,
        saldoAnterior: f.saldoAnterior,
        entradas: f.entradas,
        entradasInformadas: f.entradasInformadas,
        entradasTerritorio: f.entradasTerritorio ?? 0,
        entregado: f.entregado,
        noEntregado: f.noEntregado,
        saldoSiguiente: f.saldoSiguiente,
        saldoInformado: f.saldoInformado,
      })),
    });
  });

  return { renglones: filas.length, diferencias };
}

/**
 * Lo que la bodega entregó a un territorio y lo que el encargado ya repartió
 * entre sus lugares (lo que dicen sus informes), por insumo, hasta el fin del
 * periodo. La diferencia la tiene el encargado sin repartir o sin informar.
 */
async function repartoDelTerritorio(establecimientoId, territorioId, periodo) {
  const destino = await prisma.ubicacion.findFirst({ where: { establecimientoId, territorioId, tipo: 'territorio' } });
  if (!destino) return new Map();
  const { hasta } = limitesDePeriodo(periodo);
  const [movimientos, repartido] = await Promise.all([
    prisma.movimientoInsumo.findMany({
      where: { tipo: 'traslado', registradoEn: { lt: hasta }, traslado: { is: { ubicacionId: destino.id } } },
      select: { cantidad: true, registradoEn: true, lote: { select: { insumoId: true } } },
    }),
    prisma.informeServicioRenglon.findMany({
      where: { entradasTerritorio: { gt: 0 }, informe: { periodo: { lte: periodo }, ubicacion: { territorioId } } },
      select: { insumoId: true, entradasTerritorio: true },
    }),
  ]);
  const salida = new Map();
  const de = (id) => salida.get(id) ?? salida.set(id, { entregadoMes: 0, entregado: 0, repartido: 0 }).get(id);
  for (const m of movimientos) {
    const f = de(m.lote.insumoId);
    f.entregado -= m.cantidad;
    if (periodoDe(m.registradoEn) === periodo) f.entregadoMes -= m.cantidad;
  }
  for (const r of repartido) de(r.insumoId).repartido += r.entradasTerritorio;
  return salida;
}

/** Que servicios ya informaron el mes y cuales faltan. */
async function estadoInformes(establecimientoId, periodo) {
  const [lista, informes] = await Promise.all([
    ubicaciones(establecimientoId),
    prisma.informeServicio.findMany({
      where: { ubicacion: { establecimientoId }, periodo },
      include: { renglones: true, usuario: { select: { nombre: true } } },
    }),
  ]);
  const porUbicacion = new Map(informes.map((r) => [r.ubicacionId, r]));
  return lista.filter(esServicioQueInforma).map((u) => {
    const r = porUbicacion.get(u.id);
    const diferencias = r
      ? r.renglones.filter((x) => (x.saldoInformado !== null && x.saldoInformado !== x.saldoSiguiente)
        || (x.entradasInformadas !== null && x.entradasInformadas !== x.entradas)).length
      : 0;
    return {
      ubicacionId: u.id,
      nombre: u.nombre,
      tipo: u.tipo,
      // Guardado a medias por el encargado todavía no cuenta como informado.
      informado: Boolean(r?.enviadoEn),
      borrador: Boolean(r) && !r.enviadoEn,
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
  const [primero, primerInforme] = await Promise.all([
    prisma.movimientoInsumo.findFirst({
      where: { lote: { insumo: { establecimientoId } } },
      orderBy: { registradoEn: 'asc' },
      select: { registradoEn: true },
    }),
    // El historial importado de los Excel llega como informes, sin movimientos.
    prisma.informeServicio.findFirst({
      where: { ubicacion: { establecimientoId } },
      orderBy: { periodo: 'asc' },
      select: { periodo: true },
    }),
  ]);
  const candidatos = [
    primero ? periodoDe(primero.registradoEn) : null,
    primerInforme?.periodo ?? null,
  ].filter(Boolean).sort();
  const inicio = candidatos[0] ?? null;

  const porPeriodo = new Map();
  for (const p of periodos) {
    if (!inicio || p < inicio) { porPeriodo.set(p, null); continue; }
    const { desde, hasta } = limitesDePeriodo(p);
    const [mov, dna, informes] = await Promise.all([
      movimientosCentro(establecimientoId, desde, hasta),
      noEntregadoCentro(establecimientoId, desde, hasta),
      prisma.informeServicioRenglon.findMany({
        where: { informe: { periodo: p, ubicacion: { establecimientoId } } },
        select: { insumoId: true, entregado: true, noEntregado: true, informe: { select: { ubicacionId: true } } },
      }),
    ]);
    // Total del municipio, lo del centro y lo de cada servicio, por insumo.
    const total = new Map();
    const centro = new Map();
    const porServicio = new Map();
    for (const [id, m] of mov) { sumar(total, id, m.entregado + m.consumo); sumar(centro, id, m.entregado + m.consumo); }
    for (const [id, n] of dna) { sumar(total, id, n); sumar(centro, id, n); }
    for (const r of informes) {
      sumar(total, r.insumoId, r.entregado + r.noEntregado);
      sumar(porServicio, clave2(r.informe.ubicacionId, r.insumoId), r.entregado + r.noEntregado);
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

  const [lista, movimientos, saldoInicio, saldoFin, farmaciaInicio, farmaciaFin, dna, arranque, informes, demandas, cerrado, anterior] = await Promise.all([
    ubicaciones(establecimientoId),
    movimientosCentro(establecimientoId, desde, hasta),
    saldoCentro(establecimientoId, desde, 'bodega'),
    saldoCentro(establecimientoId, hasta, 'bodega'),
    saldoCentro(establecimientoId, desde, 'farmacia'),
    saldoCentro(establecimientoId, hasta, 'farmacia'),
    noEntregadoCentro(establecimientoId, desde, hasta),
    arranqueServicios(establecimientoId, periodo),
    prisma.informeServicio.findMany({
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
    ...informes.flatMap((r) => r.renglones.map((x) => x.insumoId)),
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
  const informePost = centro ? informes.find((r) => r.ubicacionId === centro.id) : null;
  const postImportado = informePost?.importado ? new Map(informePost.renglones.map((r) => [r.insumoId, r])) : null;

  const servicios = lista.filter(esServicioQueInforma);
  const conTraslados = new Set((await prisma.traslado.findMany({
    where: { establecimientoId, registradoEn: { lt: hasta } },
    select: { ubicacionId: true },
    distinct: ['ubicacionId'],
  })).map((t) => t.ubicacionId));
  const informado = new Map();
  const importado = new Set();
  for (const r of informes) {
    if (r.importado) importado.add(r.ubicacionId);
    for (const ren of r.renglones) informado.set(clave2(r.ubicacionId, ren.insumoId), ren);
  }
  const conInforme = new Set(informes.map((r) => r.ubicacionId));

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
    // Farmacia que informa en papel (bodega lo pasa): sus cifras del informe.
    const enPapel = informePost && !postImportado ? informado.get(clave2(centro.id, i.id)) : null;
    if (informePost && !postImportado) {
      const f = enPapel
        ? filaInforme({ saldoAnterior: enPapel.saldoAnterior, entradas: enPapel.entradas, entregado: enPapel.entregado, noEntregado: enPapel.noEntregado })
        : filaInforme({ saldoAnterior: arranque.saldoAnterior.get(clave2(centro.id, i.id)) ?? 0, entradas: arranque.entradas.get(clave2(centro.id, i.id)) ?? 0 });
      postConsulta = {
        saldoAnterior: f.saldoAnterior,
        entradas: f.entradas,
        entregado: f.entregado,
        noEntregado: f.noEntregado,
        saldoSiguiente: f.saldoSiguiente,
        promedio: promedio((d) => (d.centro.get(i.id) ?? 0) + (d.porServicio.get(clave2(centro.id, i.id)) ?? 0)),
      };
    } else if (postImportado) {
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
      const ren = informado.get(k);
      if (importado.has(s.id)) {
        // Informe del Excel: cada cifra como se anoto, aunque no cuadre.
        const saldoSiguiente = ren?.saldoSiguiente ?? 0;
        return {
          ubicacionId: s.id,
          informado: true,
          ...filaInforme({ saldoAnterior: ren?.saldoAnterior ?? 0, entradas: ren?.entradas ?? 0, entregado: ren?.entregado ?? 0, noEntregado: ren?.noEntregado ?? 0 }),
          saldoSiguiente,
          negativo: saldoSiguiente < 0,
          promedio: numero(ren?.promedioAnotado) ?? 0,
        };
      }
      const f = ren
        ? filaInforme({ saldoAnterior: ren.saldoAnterior, entradas: ren.entradas, entregado: ren.entregado, noEntregado: ren.noEntregado, saldoInformado: ren.saldoInformado, entradasInformadas: ren.entradasInformadas })
        : filaInforme({ saldoAnterior: arranque.saldoAnterior.get(k) ?? 0, entradas: arranque.entradas.get(k) ?? 0 });
      return {
        ubicacionId: s.id,
        informado: conInforme.has(s.id),
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
      ubicacionFisica: i.ubicacionFisica ?? null,
      bodega,
      postConsulta,
      servicios: columnas,
      bres,
    };
  });

  return {
    periodo,
    cerrado: Boolean(congelado),
    servicios: servicios.map((s) => ({ id: s.id, nombre: s.nombre, tipo: s.tipo, informado: conInforme.has(s.id) })),
    filas,
    configuracion: { ...p, semaforoRojoMeses: config.semaforoRojoMeses, semaforoAmarilloMeses: config.semaforoAmarilloMeses },
    firmas: {
      encargadoBodega: config.encargadoBodega,
      cargoEncargadoBodega: config.cargoEncargadoBodega,
      coordinadorMunicipal: config.coordinadorMunicipal,
      cargoCoordinador: config.cargoCoordinador,
    },
    categorias: CATEGORIAS,
    // Solo se espera informe de quien ya recibe traslados por el sistema.
    pendientesDeInforme: servicios.filter((s) => !conInforme.has(s.id) && conTraslados.has(s.id)).length,
  };
}

/** El periodo es el mes en curso: todavia no llega a su cierre (el 25). */
function mesAbierto(periodo, diaCorte, ahora = new Date()) {
  return periodo === periodoDe(ahora);
}

/** El BRES con que se pide a la DDRISS: el del último mes cerrado. */
function periodoDelPedido(diaCorte, ahora = new Date()) {
  return periodoAnterior(periodoDe(ahora));
}

/**
 * Requisición sugerida de un centro o puesto: lo que necesita para quedar en el
 * nivel máximo. La demanda mensual es el promedio de sus informes de los
 * últimos meses (lo entregado más lo que no hubo); lo que tiene es su saldo al
 * cierre del último informe más lo que la bodega le trasladó después. Sirve
 * para llenar la requisición: el encargado corrige cantidades o quita renglones.
 */
async function sugerenciaServicio(establecimientoId, ubicacionId, ahora = new Date()) {
  const ubicacion = await prisma.ubicacion.findFirst({ where: { id: ubicacionId, establecimientoId } });
  if (!ubicacion) return null;
  if (ubicacion.tipo === 'territorio') return sugerenciaTerritorio(establecimientoId, ubicacion, ahora);
  const params = parametrosBres(await configuracion(establecimientoId));
  const actual = periodoDe(ahora);
  const periodos = ultimosPeriodos(periodoAnterior(actual), params.mesesPromedio);
  const [form, filas] = await Promise.all([
    formularioInforme(establecimientoId, ubicacionId, actual),
    prisma.informeServicioRenglon.findMany({
      where: { informe: { ubicacionId, periodo: { in: periodos } } },
      select: { insumoId: true, entregado: true, noEntregado: true },
    }),
  ]);
  const demanda = new Map();
  for (const f of filas) sumar(demanda, f.insumoId, f.entregado + f.noEntregado);
  const renglones = form.renglones
    .map((r) => {
      const mensual = (demanda.get(r.insumoId) ?? 0) / params.mesesPromedio;
      // Lo que tiene ahora: saldo al cierre del mes pasado más lo recibido este mes.
      const tiene = r.saldoAnterior + r.entradas;
      const sugerido = Math.max(0, Math.ceil(mensual * params.nivelMaximoMeses - tiene));
      return {
        insumoId: r.insumoId,
        nombre: [r.nombre, r.concentracion].filter(Boolean).join(' '),
        unidad: r.unidadEntrega,
        categoria: r.categoria,
        demandaMensual: Math.round(mensual * 10) / 10,
        tiene,
        sugerido,
        maneja: r.maneja || mensual > 0,
      };
    })
    .filter((r) => r.maneja);
  // Todo el catálogo, para agregar algo que el centro no ha manejado.
  const catalogo = form.renglones.map((r) => ({ insumoId: r.insumoId, nombre: [r.nombre, r.concentracion].filter(Boolean).join(' '), unidad: r.unidadEntrega }));
  return { ubicacion, periodos, nivelMaximoMeses: params.nivelMaximoMeses, renglones, catalogo };
}

/**
 * Lo de todos los lugares del territorio junto, menos lo que el encargado
 * todavía tiene sin repartir de entregas anteriores.
 */
async function sugerenciaTerritorio(establecimientoId, ubicacion, ahora) {
  const lugares = (await prisma.ubicacion.findMany({ where: { establecimientoId, territorioId: ubicacion.territorioId, activo: true } }))
    .filter(esServicioQueInforma);
  const [partes, reparto] = await Promise.all([
    Promise.all(lugares.map((l) => sugerenciaServicio(establecimientoId, l.id, ahora))),
    repartoDelTerritorio(establecimientoId, ubicacion.territorioId, periodoDe(ahora)),
  ]);
  const junto = new Map();
  for (const p of partes) {
    for (const r of p.renglones) {
      const j = junto.get(r.insumoId) ?? { ...r, demandaMensual: 0, tiene: 0, sugerido: 0 };
      j.demandaMensual = Math.round((j.demandaMensual + r.demandaMensual) * 10) / 10;
      j.tiene += r.tiene;
      j.sugerido += r.sugerido;
      junto.set(r.insumoId, j);
    }
  }
  const renglones = [...junto.values()].map((r) => {
    const sinRepartir = Math.max(0, (reparto.get(r.insumoId)?.entregado ?? 0) - (reparto.get(r.insumoId)?.repartido ?? 0));
    return { ...r, tiene: r.tiene + sinRepartir, sugerido: Math.max(0, r.sugerido - sinRepartir) };
  });
  const params = parametrosBres(await configuracion(establecimientoId));
  return { ubicacion, periodos: partes[0]?.periodos ?? [], nivelMaximoMeses: params.nivelMaximoMeses, renglones, catalogo: partes[0]?.catalogo ?? [] };
}

/**
 * Requisición sugerida de la bodega a la DDRISS: la columna M (cantidad a
 * pedir) del BRES del período. Bodega corrige, quita o agrega antes de enviarla.
 */
async function sugerenciaDdriss(establecimientoId, pedido) {
  const config = await configuracion(establecimientoId);
  // Sin periodo pedido, el que corresponde por la fecha: no se elige a mano.
  const periodo = pedido ?? periodoDelPedido(config.diaCorteBres);
  const b = await balance(establecimientoId, periodo);
  const nombre = (f) => [f.nombre, f.concentracion].filter(Boolean).join(' ');
  const renglones = b.filas
    .filter((f) => f.activo !== false && f.bres?.M > 0)
    .map((f) => ({
      insumoId: f.insumoId,
      nombre: nombre(f),
      unidad: f.unidadEntrega,
      categoria: f.categoria,
      existencia: f.bres.I,
      promedio: Math.round((f.bres.J ?? 0) * 10) / 10,
      meses: f.bres.K == null ? null : Math.round(f.bres.K * 10) / 10,
      sugerido: Math.ceil(f.bres.M),
    }));
  const catalogo = b.filas.filter((f) => f.activo !== false).map((f) => ({
    insumoId: f.insumoId, nombre: nombre(f), unidad: f.unidadEntrega, existencia: f.bres?.I ?? 0,
    promedio: Math.round((f.bres?.J ?? 0) * 10) / 10,
  }));
  // Las firmas del formulario ya están en la configuración, como en el BRES.
  const firmas = { solicita: config.encargadoBodega ?? null, vistoBueno: config.coordinadorMunicipal ?? null };
  return { periodo, nivelMaximoMeses: b.configuracion.nivelMaximoMeses, renglones, catalogo, firmas };
}

/** Promedio mensual de entregas informadas por cada servicio, para distribuir. */
async function promedioPorServicio(establecimientoId, insumoId, periodo, meses) {
  const periodos = ultimosPeriodos(periodoAnterior(periodo), meses);
  const filas = await prisma.informeServicioRenglon.findMany({
    where: { insumoId, informe: { periodo: { in: periodos }, ubicacion: { establecimientoId } } },
    select: { entregado: true, informe: { select: { ubicacionId: true } } },
  });
  const suma = new Map();
  for (const f of filas) sumar(suma, f.informe.ubicacionId, f.entregado);
  return new Map([...suma].map(([id, total]) => [id, total / meses]));
}

module.exports = {
  sugerenciaServicio,
  sugerenciaDdriss,
  bresGuardado,
  mesAbierto,
  periodoDelPedido,
  ubicaciones,
  esServicioQueInforma,
  parametrosBres,
  movimientosCentro,
  saldoCentro,
  noEntregadoCentro,
  arranqueServicios,
  formularioInforme,
  guardarInforme,
  estadoInformes,
  demandaMunicipal,
  balance,
  promedioPorServicio,
  repartoDelTerritorio,
};
