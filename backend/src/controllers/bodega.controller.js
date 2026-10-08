/**
 * Bodega del centro (MD/Bodega.md): ubicaciones, traslados a los servicios,
 * reporte mensual de los servicios, balance consolidado, semaforo,
 * inventario de cierre y alias del catalogo.
 */

const ExcelJS = require('exceljs');
const prisma = require('../config/db');
const datos = require('../services/bodegaDatos.service');
const {
  CATEGORIAS, semaforoBodega, lotesPepe, propuestaDistribucion, ordenarInsumos,
  normalizarAlias, mesesParaVencer, ultimosPeriodos,
} = require('../services/bodega.service');
const { configuracion, rangosSemaforo, limitesDePeriodo } = require('../services/abastecimiento.service');
const { errorDestino, errorLotes, registrarTraslado } = require('../services/traslados.service');
const { enUbicacion } = require('../services/inventario.service');
const bresService = require('../services/bres.service');
const { kardexDe, encabezadoKardex } = require('../services/kardex.service');

const ETIQUETA_TIPO_UBICACION = {
  bodega: 'Bodega',
  centro_salud: 'Centro de salud',
  puesto_salud: 'Puesto de salud',
  centro_comunitario: 'Centro comunitario',
};

const periodoActual = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// --- Ubicaciones ------------------------------------------------------------------

async function listarUbicaciones(req, res) {
  const lista = await datos.ubicaciones(req.usuario.establecimientoId, { soloActivas: req.query.todas !== 'true' });
  res.json({
    ubicaciones: lista.map((u) => ({ ...u, tipoEtiqueta: ETIQUETA_TIPO_UBICACION[u.tipo], reporta: datos.esServicioQueReporta(u) })),
    tipos: Object.entries(ETIQUETA_TIPO_UBICACION).map(([valor, etiqueta]) => ({ valor, etiqueta })),
  });
}

async function crearUbicacion(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const repetida = await prisma.ubicacion.findFirst({ where: { establecimientoId, nombre: req.body.nombre } });
  if (repetida) return next({ status: 409, codigo: 'ubicacion_duplicada', mensaje: 'Ya existe una ubicación con ese nombre' });
  const ultima = await prisma.ubicacion.findFirst({ where: { establecimientoId }, orderBy: { orden: 'desc' } });
  const ubicacion = await prisma.ubicacion.create({
    data: { establecimientoId, ...req.body, orden: (ultima?.orden ?? 0) + 1 },
  });
  await req.bitacora({ accion: 'crear', entidad: 'ubicacion', entidadId: ubicacion.id, detalle: ubicacion.nombre });
  res.status(201).json({ ubicacion });
}

async function actualizarUbicacion(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const existente = await prisma.ubicacion.findFirst({ where: { id: req.params.id, establecimientoId } });
  if (!existente) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Ubicación no encontrada' });
  if (existente.tipo === 'bodega' && req.body.activo === false) {
    return next({ status: 409, codigo: 'bodega_requerida', mensaje: 'La bodega no se puede desactivar' });
  }
  const ubicacion = await prisma.ubicacion.update({ where: { id: existente.id }, data: req.body });
  await req.bitacora({
    accion: 'actualizar', entidad: 'ubicacion', entidadId: ubicacion.id,
    detalle: `${ubicacion.nombre}: ${Object.keys(req.body).join(', ')}`,
  });
  res.json({ ubicacion });
}

// --- Traslados ----------------------------------------------------------------------

/** Lotes que se proponen por PEPE para trasladar una cantidad de un insumo. */
async function propuestaLotes(req, res, next) {
  const { insumoId, cantidad } = req.query;
  const insumo = await prisma.insumo.findFirst({
    where: { id: insumoId, establecimientoId: req.usuario.establecimientoId },
    include: { lotes: true },
  });
  if (!insumo) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });
  // Se traslada desde la bodega: lo que esta en farmacia no cuenta.
  res.json(lotesPepe(enUbicacion(insumo.lotes, 'bodega'), cantidad));
}

/** Propuesta de distribucion de un insumo entre los servicios. */
async function distribucion(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { insumoId, modo } = req.query;
  const insumo = await prisma.insumo.findFirst({ where: { id: insumoId, establecimientoId }, include: { lotes: true } });
  if (!insumo) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });

  const ahora = new Date();
  const existencia = enUbicacion(insumo.lotes, 'bodega')
    .filter((l) => l.estado === 'disponible' && new Date(l.fechaVence) >= ahora)
    .reduce((s, l) => s + l.cantidadActual, 0);
  const cantidad = Math.min(req.query.cantidad ?? existencia, existencia);

  const config = await configuracion(establecimientoId);
  const servicios = (await datos.ubicaciones(establecimientoId)).filter(datos.esServicioQueReporta)
    .filter((s) => !req.query.ubicaciones || req.query.ubicaciones.includes(s.id));
  const promedios = await datos.promedioPorServicio(establecimientoId, insumo.id, periodoActual(), config.mesesPromedio);

  res.json({
    insumo: { id: insumo.id, nombre: insumo.nombreGenerico, unidadEntrega: insumo.unidadEntrega, unidadesPorEmpaque: insumo.unidadesPorEmpaque },
    existencia,
    cantidad,
    lugares: config.lugaresReparto,
    ...propuestaDistribucion({
      cantidad,
      modo,
      empaque: insumo.unidadesPorEmpaque,
      lugares: config.lugaresReparto,
      servicios: servicios.map((s) => ({ id: s.id, nombre: s.nombre, promedio: Math.round((promedios.get(s.id) ?? 0) * 10) / 10 })),
    }),
  });
}

/**
 * Registra un traslado de la bodega a un servicio o a la farmacia del centro
 * (post-consulta), con el mismo documento de entrega.
 *
 * A un puesto o centro comunitario, cada renglon sale del inventario del
 * centro y queda ligado al traslado: un retiro sanitario sabe a que servicio
 * fue a parar cada lote. A la farmacia, el lote no sale del centro: pasa de
 * la bodega a la farmacia y desde ahi se entrega a cada paciente.
 */
async function crearTraslado(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { ubicacionId, recibidoPor, observacion, renglones } = req.body;

  const ubicacion = await prisma.ubicacion.findFirst({ where: { id: ubicacionId, establecimientoId } });
  const fallaDestino = errorDestino(ubicacion);
  if (fallaDestino) return next(fallaDestino);

  const lotes = await prisma.lote.findMany({
    where: { id: { in: renglones.map((r) => r.loteId) }, insumo: { establecimientoId } },
  });
  const fallaLotes = errorLotes(renglones, new Map(lotes.map((l) => [l.id, l])));
  if (fallaLotes) return next(fallaLotes);

  const traslado = await prisma.$transaction((tx) => registrarTraslado(tx, {
    establecimientoId, ubicacion, usuarioId: req.usuario.id, recibidoPor, observacion: observacion ?? null, renglones,
  }));

  await req.bitacora({
    accion: 'crear',
    entidad: 'traslado',
    entidadId: traslado.id,
    detalle: `${traslado.numero} a ${ubicacion.nombre}: ${renglones.length} renglón(es), recibe ${recibidoPor}`,
  });

  res.status(201).json({ traslado: await detalleTraslado(traslado.id, establecimientoId) });
}

async function detalleTraslado(id, establecimientoId) {
  const t = await prisma.traslado.findFirst({
    where: { id, establecimientoId },
    include: {
      ubicacion: true,
      usuario: { select: { nombre: true } },
      requisicion: { select: { id: true, numero: true } },
      movimientos: {
        include: { lote: { include: { insumo: { select: { codigoInterno: true, nombreGenerico: true, concentracion: true, unidadEntrega: true, categoria: true } } } } },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    numero: t.numero,
    registradoEn: t.registradoEn,
    ubicacion: { id: t.ubicacion.id, nombre: t.ubicacion.nombre, tipo: t.ubicacion.tipo },
    entregadoPor: t.usuario.nombre,
    recibidoPor: t.recibidoPor,
    observacion: t.observacion,
    requisicion: t.requisicion,
    renglones: t.movimientos.filter((m) => m.ubicacion === 'bodega').map((m) => ({
      loteId: m.loteId,
      numeroLote: m.lote.numeroLote,
      fechaVence: m.lote.fechaVence,
      codigoInterno: m.lote.insumo.codigoInterno,
      insumo: m.lote.insumo.nombreGenerico,
      concentracion: m.lote.insumo.concentracion,
      unidadEntrega: m.lote.insumo.unidadEntrega,
      cantidad: -m.cantidad,
    })),
  };
}

async function obtenerTraslado(req, res, next) {
  const t = await detalleTraslado(Number(req.params.id), req.usuario.establecimientoId);
  if (!t) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Traslado no encontrado' });
  res.json({ traslado: t });
}

async function listarTraslados(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const where = { establecimientoId };
  if (req.query.ubicacionId) where.ubicacionId = req.query.ubicacionId;
  if (req.query.periodo) {
    const { desde, hasta } = limitesDePeriodo(req.query.periodo);
    where.registradoEn = { gte: desde, lt: hasta };
  }
  const lista = await prisma.traslado.findMany({
    where,
    orderBy: { registradoEn: 'desc' },
    take: 200,
    include: {
      ubicacion: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
      movimientos: { where: { ubicacion: 'bodega' }, select: { cantidad: true } },
    },
  });
  res.json({
    traslados: lista.map((t) => ({
      id: t.id,
      numero: t.numero,
      registradoEn: t.registradoEn,
      ubicacion: t.ubicacion.nombre,
      entregadoPor: t.usuario.nombre,
      recibidoPor: t.recibidoPor,
      renglones: t.movimientos.length,
      unidades: t.movimientos.reduce((s, m) => s - m.cantidad, 0),
    })),
  });
}

// --- Reportes de los servicios ------------------------------------------------------

async function estadoReportes(req, res) {
  const periodo = req.query.periodo ?? periodoActual();
  const servicios = await datos.estadoReportes(req.usuario.establecimientoId, periodo);
  res.json({
    periodo,
    servicios,
    reportados: servicios.filter((s) => s.reportado).length,
    faltan: servicios.filter((s) => !s.reportado).length,
  });
}

async function obtenerReporte(req, res, next) {
  const form = await datos.formularioReporte(req.usuario.establecimientoId, Number(req.params.ubicacionId), req.params.periodo);
  if (!form) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Servicio no encontrado' });
  if (!datos.esServicioQueReporta(form.ubicacion)) {
    return next({ status: 400, codigo: 'no_reporta', mensaje: 'Esa ubicación no envía reporte mensual' });
  }
  res.json(form);
}

async function guardarReporte(req, res, next) {
  const ubicacionId = Number(req.params.ubicacionId);
  const resultado = await datos.guardarReporte(
    req.usuario.establecimientoId, ubicacionId, req.params.periodo, req.body, req.usuario.id,
  );
  if (!resultado) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Servicio no encontrado' });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'reporte_servicio',
    entidadId: ubicacionId,
    detalle: `Reporte de ${req.params.periodo}: ${resultado.renglones} insumo(s), ${resultado.diferencias} con diferencia`,
  });
  res.json(resultado);
}

/** Aceptar las diferencias de un reporte despues de revisarlas. */
async function revisarReporte(req, res, next) {
  const reporte = await prisma.reporteServicio.findFirst({
    where: { ubicacionId: Number(req.params.ubicacionId), periodo: req.params.periodo, ubicacion: { establecimientoId: req.usuario.establecimientoId } },
  });
  if (!reporte) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Ese reporte no se ha capturado' });
  await prisma.reporteServicio.update({ where: { id: reporte.id }, data: { revisado: true, observacion: req.body.observacion ?? reporte.observacion } });
  await req.bitacora({ accion: 'actualizar', entidad: 'reporte_servicio', entidadId: reporte.id, detalle: `Diferencias revisadas y aceptadas: ${req.body.observacion ?? ''}` });
  res.json({ revisado: true });
}

// --- Balance, semaforo e inventario de cierre -------------------------------------------

async function balance(req, res) {
  const periodo = req.query.periodo ?? periodoActual();
  const resultado = await datos.balance(req.usuario.establecimientoId, periodo, { categoria: req.query.categoria });
  resultado.filas = ordenarInsumos(resultado.filas, req.query.orden ?? 'alfabetico');
  res.json(resultado);
}

async function semaforo(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const config = await configuracion(establecimientoId);
  const rangos = rangosSemaforo(config);
  const ahora = new Date();
  const insumos = await prisma.insumo.findMany({
    where: { establecimientoId, activo: true, ...(req.query.categoria ? { categoria: req.query.categoria } : {}) },
    include: { lotes: { where: { cantidadActual: { gt: 0 } }, orderBy: { fechaVence: 'asc' } } },
  });

  let filas = insumos.map((i) => {
    const lotes = i.lotes.map((l) => ({
      id: l.id,
      numeroLote: l.numeroLote,
      fechaVence: l.fechaVence,
      cantidad: l.cantidadActual,
      enFarmacia: l.cantidadFarmacia,
      estado: l.estado,
      ubicacion: l.ubicacion,
      mesesParaVencer: Number(mesesParaVencer(l.fechaVence, ahora).toFixed(1)),
      // El saldo importado sin lote no tiene vencimiento conocido: no entra al semaforo.
      semaforo: l.numeroLote === 'SIN-LOTE' ? 'sin_fecha' : semaforoBodega(l.fechaVence, ahora, rangos),
    }));
    const peor = ['vencido', 'rojo', 'amarillo', 'verde'].find((c) => lotes.some((l) => l.semaforo === c)) ?? 'sin_lotes';
    return {
      insumoId: i.id,
      codigoInterno: i.codigoInterno,
      nombre: i.nombreGenerico,
      concentracion: i.concentracion,
      unidadEntrega: i.unidadEntrega,
      categoria: i.categoria,
      saldo: lotes.reduce((s, l) => s + l.cantidad, 0),
      semaforo: peor,
      lotes,
    };
  }).filter((f) => f.lotes.length > 0);

  // El resumen cuenta todo, antes del filtro de color, para que los demas colores sigan a la vista.
  const cuenta = (c) => filas.reduce((s, f) => s + f.lotes.filter((l) => l.semaforo === c).length, 0);
  const resumen = { vencido: cuenta('vencido'), rojo: cuenta('rojo'), amarillo: cuenta('amarillo'), verde: cuenta('verde'), sinFecha: cuenta('sin_fecha') };
  if (req.query.color) {
    filas = filas
      .map((f) => ({ ...f, lotes: f.lotes.filter((l) => l.semaforo === req.query.color) }))
      .filter((f) => f.lotes.length > 0);
  }
  filas = ordenarInsumos(filas, req.query.orden ?? 'alfabetico');
  res.json({
    rangos,
    resumen,
    filas,
    categorias: CATEGORIAS,
  });
}

/**
 * Ficha de un insumo con las mismas cifras del balance: saldo, consumo,
 * cobertura y pedido; la demanda de los ultimos 12 meses y sus lotes.
 */
async function fichaInsumo(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const id = Number(req.params.id);
  const insumo = await prisma.insumo.findFirst({ where: { id, establecimientoId } });
  if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado' });
  const periodo = periodoActual();
  const config = await configuracion(establecimientoId);
  const [b, demandas, lotes] = await Promise.all([
    datos.balance(establecimientoId, periodo, { insumoId: id }),
    datos.demandaMunicipal(establecimientoId, ultimosPeriodos(periodo, 12)),
    prisma.lote.findMany({ where: { insumoId: id }, orderBy: [{ fechaVence: 'asc' }] }),
  ]);
  const rangos = rangosSemaforo(config);
  const ahora = new Date();
  const abierto = datos.mesAbierto(periodo, config.diaCorteBres);
  res.json({
    insumo,
    fila: b.filas[0] ?? null,
    configuracion: b.configuracion,
    demanda: ultimosPeriodos(periodo, 12).map((per) => {
      const d = demandas.get(per);
      if (!d) return { periodo: per, total: null, centro: null, servicios: null, abierto: false };
      const total = d.total.get(id) ?? 0;
      const centro = d.centro.get(id) ?? 0;
      return { periodo: per, total, centro, servicios: total - centro, abierto: abierto && per === periodo };
    }),
    lotes: lotes.map((l) => ({
      id: l.id,
      numeroLote: l.numeroLote,
      fechaVence: l.fechaVence,
      cantidadActual: l.cantidadActual,
      // Donde esta: lo de farmacia se entrega a pacientes, lo de bodega se traslada.
      enBodega: l.cantidadActual - l.cantidadFarmacia,
      enFarmacia: l.cantidadFarmacia,
      cantidadInicial: l.cantidadInicial,
      estado: l.estado,
      motivoEstado: l.motivoEstado,
      ubicacion: l.ubicacion,
      fabricante: l.fabricante,
      sinFecha: l.numeroLote === 'SIN-LOTE',
      mesesParaVencer: Number(mesesParaVencer(l.fechaVence, ahora).toFixed(1)),
      semaforo: l.numeroLote === 'SIN-LOTE' ? 'sin_fecha' : semaforoBodega(l.fechaVence, ahora, rangos),
    })),
  });
}

/**
 * Busca lotes por numero o por insumo, incluidos los agotados: la
 * trazabilidad se pide justo cuando el lote ya no esta en el estante.
 */
async function buscarLotes(req, res) {
  const texto = (req.query.buscar ?? '').trim();
  if (texto.length < 2) return res.json({ lotes: [] });
  const lotes = await prisma.lote.findMany({
    where: {
      insumo: { establecimientoId: req.usuario.establecimientoId },
      OR: [
        { numeroLote: { contains: texto, mode: 'insensitive' } },
        { insumo: { nombreGenerico: { contains: texto, mode: 'insensitive' } } },
      ],
    },
    include: { insumo: { select: { id: true, nombreGenerico: true, categoria: true } }, _count: { select: { movimientos: true } } },
    orderBy: [{ cantidadActual: 'desc' }, { fechaVence: 'asc' }],
    take: 30,
  });
  res.json({
    lotes: lotes.map((l) => ({
      id: l.id,
      numeroLote: l.numeroLote,
      fechaVence: l.fechaVence,
      cantidadInicial: l.cantidadInicial,
      cantidadActual: l.cantidadActual,
      // Donde esta: lo de farmacia se entrega a pacientes, lo de bodega se traslada.
      enBodega: l.cantidadActual - l.cantidadFarmacia,
      enFarmacia: l.cantidadFarmacia,
      estado: l.estado,
      movimientos: l._count.movimientos,
      insumo: l.insumo,
    })),
  });
}

/** Inventario de cierre de la bodega: saldo anterior, entradas, entregado, saldo actual. */
async function inventarioCierre(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const periodo = req.query.periodo ?? periodoActual();
  const config = await configuracion(establecimientoId);
  const firmas = {
    encargadoBodega: config.encargadoBodega,
    cargoEncargadoBodega: config.cargoEncargadoBodega,
    coordinadorMunicipal: config.coordinadorMunicipal,
    cargoCoordinador: config.cargoCoordinador,
  };

  // Antes del sistema: el inventario de cierre tal como lo llevaba el centro.
  const historico = await prisma.inventarioCierreHistorico.findMany({
    where: { establecimientoId, periodo, ...(req.query.categoria ? { insumo: { categoria: req.query.categoria } } : {}) },
    include: { insumo: true },
    orderBy: { orden: 'asc' },
  });
  if (historico.length) {
    const filasHist = historico.map((h) => ({
      insumoId: h.insumoId,
      codigoInterno: h.insumo.codigoInterno,
      nombre: h.insumo.nombreGenerico,
      nombreOriginal: h.nombreOriginal,
      concentracion: h.insumo.concentracion,
      unidadEntrega: h.insumo.unidadEntrega,
      categoria: h.insumo.categoria,
      saldoAnterior: h.saldoAnterior,
      entradas: h.entradas,
      entregado: h.entregado,
      reajustes: 0,
      saldoActual: h.saldoActual,
      porLugar: Math.round(h.saldoActual / config.lugaresReparto),
    }));
    return res.json({
      periodo,
      diaCorte: config.diaCorteBres,
      fuente: 'excel',
      lugaresReparto: config.lugaresReparto,
      firmas,
      filas: req.query.orden && req.query.orden !== 'excel' ? ordenarInsumos(filasHist, req.query.orden) : filasHist,
      categorias: CATEGORIAS,
    });
  }

  const { desde, hasta } = limitesDePeriodo(periodo);
  const [insumos, inicio, fin, mov] = await Promise.all([
    prisma.insumo.findMany({ where: { establecimientoId, activo: true, ...(req.query.categoria ? { categoria: req.query.categoria } : {}) } }),
    // Es el inventario de la bodega: lo de farmacia lo lleva farmacia.
    datos.saldoCentro(establecimientoId, desde, 'bodega'),
    datos.saldoCentro(establecimientoId, hasta, 'bodega'),
    datos.movimientosCentro(establecimientoId, desde, hasta),
  ]);
  const filas = insumos.map((i) => {
    const m = mov.get(i.id) ?? { entradas: 0, consumo: 0, trasladado: 0, aFarmacia: 0, reajustesBodega: 0, bajas: 0 };
    const saldoActual = fin.get(i.id) ?? 0;
    return {
      insumoId: i.id,
      codigoInterno: i.codigoInterno,
      nombre: i.nombreGenerico,
      concentracion: i.concentracion,
      unidadEntrega: i.unidadEntrega,
      categoria: i.categoria,
      saldoAnterior: inicio.get(i.id) ?? 0,
      entradas: m.entradas,
      // Lo que salio de la bodega: a farmacia, a los servicios y consumo interno.
      entregado: m.aFarmacia + m.trasladado + m.consumo,
      reajustes: m.reajustesBodega - m.bajas,
      saldoActual,
      porLugar: Math.round(saldoActual / config.lugaresReparto),
    };
  });
  res.json({
    periodo, diaCorte: config.diaCorteBres, fuente: 'sistema', lugaresReparto: config.lugaresReparto, firmas,
    filas: ordenarInsumos(filas, req.query.orden ?? 'alfabetico'), categorias: CATEGORIAS,
  });
}

// --- Alias del catalogo ----------------------------------------------------------------

async function agregarAlias(req, res, next) {
  const insumo = await prisma.insumo.findFirst({ where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId } });
  if (!insumo) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });
  const aliasNormalizado = normalizarAlias(req.body.alias);
  const repetido = await prisma.insumoAlias.findUnique({ where: { aliasNormalizado }, include: { insumo: { select: { nombreGenerico: true } } } });
  if (repetido) {
    return next({ status: 409, codigo: 'alias_duplicado', mensaje: `Ese nombre ya es alias de ${repetido.insumo.nombreGenerico}` });
  }
  const alias = await prisma.insumoAlias.create({ data: { insumoId: insumo.id, alias: req.body.alias, aliasNormalizado } });
  await req.bitacora({ accion: 'crear', entidad: 'insumo', entidadId: insumo.id, detalle: `Alias: ${req.body.alias}` });
  res.status(201).json({ alias });
}

async function quitarAlias(req, res, next) {
  const alias = await prisma.insumoAlias.findFirst({
    where: { id: Number(req.params.aliasId), insumoId: Number(req.params.id), insumo: { establecimientoId: req.usuario.establecimientoId } },
  });
  if (!alias) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Alias no encontrado' });
  await prisma.insumoAlias.delete({ where: { id: alias.id } });
  await req.bitacora({ accion: 'eliminar', entidad: 'insumo', entidadId: alias.insumoId, detalle: `Alias quitado: ${alias.alias}` });
  res.json({ ok: true });
}

/** Si el medico puede recetar este insumo (aparece en su lista de medicamentos). */
async function cambiarPrescribible(req, res, next) {
  const insumo = await prisma.insumo.findFirst({
    where: { id: Number(req.params.id), establecimientoId: req.usuario.establecimientoId },
  });
  if (!insumo) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Insumo no encontrado' });
  const actualizado = await prisma.insumo.update({
    where: { id: insumo.id },
    data: { prescribible: req.body.prescribible },
  });
  await req.bitacora({
    accion: 'actualizar',
    entidad: 'insumo',
    entidadId: insumo.id,
    detalle: `${insumo.nombreGenerico}: ${req.body.prescribible ? 'se puede recetar' : 'ya no se puede recetar'}`,
  });
  res.json({ insumo: { id: actualizado.id, prescribible: actualizado.prescribible } });
}

async function listarAlias(req, res) {
  const alias = await prisma.insumoAlias.findMany({
    where: { insumoId: Number(req.params.id), insumo: { establecimientoId: req.usuario.establecimientoId } },
    orderBy: { alias: 'asc' },
  });
  res.json({ alias });
}

// --- Exportacion a Excel ----------------------------------------------------------------

function hojaConEncabezado(libro, nombre, titulo, columnas) {
  const hoja = libro.addWorksheet(nombre);
  hoja.addRow([titulo]).font = { bold: true, size: 13 };
  hoja.addRow([]);
  hoja.addRow(columnas).font = { bold: true };
  return hoja;
}

async function enviarLibro(res, libro, nombre) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  await libro.xlsx.write(res);
  res.end();
}

/**
 * Balance consolidado en Excel, con la misma estructura que el "BALANCE" del
 * centro: título, fecha, nombres de los servicios en la fila 3, seis columnas
 * por servicio empezando por post-consulta, la existencia física del mes
 * anterior y el bloque de totales (saldo anterior a cantidad a solicitar).
 */
// Formato de cada columna de totales, como en el Excel del centro (B a M).
const FORMATO_TOTALES = ['#,##0', '#,##0', '#,##0', '#,##0', '#,##0', '#,##0', '#,##0', '#,##0', '0', '0.0;[Red]0.0', 'General', '#,##0'];

async function exportarBalance(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const periodo = req.params.periodo;
  const b = await datos.balance(establecimientoId, periodo);
  const filas = ordenarInsumos(b.filas, req.query.orden ?? 'alfabetico');
  const [anio, mes] = periodo.split('-').map(Number);

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(`${['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'][mes - 1]}${String(anio).slice(2)}`);
  const BLOQUE = ['Saldo anterior', 'Entradas', 'Entregado Usu', 'No entregado', 'Saldo siguiente', 'Promedio'];
  const servicios = [{ nombre: 'POST CONSULTA' }, ...b.servicios.map((s) => ({ nombre: s.nombre.toUpperCase() }))];
  const inicioTotales = 3 + servicios.length * 6 + 1;

  hoja.getCell(1, 2).value = 'INFORME BALANCE MEDICAMENTOS';
  hoja.getCell(1, 2).font = { bold: true, size: 13 };
  hoja.getCell(2, 7).value = new Date(Date.UTC(anio, mes - 1, 1));
  hoja.getCell(2, 7).numFmt = 'mmmm yyyy';
  // Nivel maximo en la fila 2, encima de "cantidad max", como en el Excel.
  hoja.getCell(2, inicioTotales + 10).value = b.configuracion.nivelMaximoMeses;

  servicios.forEach((s, k) => {
    hoja.getCell(3, 3 + k * 6).value = s.nombre;
    BLOQUE.forEach((t, c) => { hoja.getCell(4, 3 + k * 6 + c).value = t; });
  });
  hoja.getCell(3, inicioTotales - 1).value = 'existen fisica';
  hoja.getCell(4, inicioTotales - 1).value = 'mes anterior';
  hoja.getCell(3, inicioTotales).value = 'Totales';
  ['saldo anterior', 'Entradas', 'Entregado Usu', 'No entregado', 'demanda', 'Saldo x demanda', 'saldo  siguiente',
    'Exis Fisic', 'Promedio', 'meses exist', 'cantidad max', 'cantidad solicitar']
    .forEach((t, c) => { hoja.getCell(4, inicioTotales + c).value = t; });
  hoja.getCell(4, 1).value = 'N0';
  hoja.getCell(4, 2).value = 'MEDICAMENTOS';
  hoja.getRow(3).font = { bold: true };
  hoja.getRow(4).font = { bold: true };

  filas.forEach((f, n) => {
    const fila = hoja.getRow(5 + n);
    fila.getCell(1).value = n + 1;
    fila.getCell(2).value = [f.nombre, f.formaFarmaceutica, f.concentracion].filter(Boolean).join(' ');
    const p = f.postConsulta;
    const bloques = [
      [p.saldoAnterior, p.entradas, p.entregado, p.noEntregado, p.saldoSiguiente, p.promedio],
      ...f.servicios.map((s) => [s.saldoAnterior, s.entradas, s.entregado, s.noEntregado, s.saldoSiguiente, s.promedio]),
    ];
    bloques.forEach((valores, k) => valores.forEach((v, c) => { if (v !== null) fila.getCell(3 + k * 6 + c).value = v; }));
    fila.getCell(inicioTotales - 1).value = f.bodega.saldoAnterior;
    const r = f.bres;
    [r.B, r.C, r.D, r.E, r.F, r.saldoPorDemanda, r.H, r.I, r.J, r.K, r.L, r.M].forEach((v, c) => {
      const celda = fila.getCell(inicioTotales + c);
      celda.value = v ?? (c === 9 ? '#DIV/0!' : null);
      // Los formatos del balance del centro.
      celda.numFmt = FORMATO_TOTALES[c];
    });
  });
  hoja.getColumn(2).width = 40;
  hoja.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];

  await req.bitacora({ accion: 'exportar', entidad: 'balance', detalle: `Balance ${periodo} en Excel` });
  await enviarLibro(res, libro, `balance-${periodo}.xlsx`);
}

/** BRES en Excel con las mismas columnas que el impreso. */
async function exportarBres(req, res) {
  const periodo = req.params.periodo;
  const bres = await bresService.calcular(req.usuario.establecimientoId, periodo);
  const libro = new ExcelJS.Workbook();
  const hoja = hojaConEncabezado(libro, 'BRES', `BRES ${periodo}`, bres.columnas.map((c) => (c.letra ? `${c.letra} ${c.etiqueta}` : c.etiqueta)));
  for (const r of ordenarInsumos(bres.renglones, req.query.orden ?? 'alfabetico')) {
    hoja.addRow(bres.columnas.map((c) => (c.clave === 'med' && r.med === null ? 'sin consumo' : r[c.clave])));
  }
  hoja.getColumn(2).width = 40;
  await req.bitacora({ accion: 'exportar', entidad: 'bres', detalle: `BRES ${periodo} en Excel` });
  await enviarLibro(res, libro, `bres-${periodo}.xlsx`);
}

// --- Kardex ------------------------------------------------------------------------

/**
 * Kardex de la bodega: de un insumo, o de todos los que se movieron en el
 * periodo para imprimirlos juntos. Sin periodo, la historia completa.
 */
async function kardex(req, res) {
  const { periodo, insumoId } = req.query;
  const rango = periodo ? limitesDePeriodo(periodo) : {};
  const tarjetas = await kardexDe(req.usuario.establecimientoId, {
    insumoIds: insumoId ? [insumoId] : null,
    desde: rango.desde ?? null,
    hasta: rango.hasta ?? null,
    soloConMovimiento: !insumoId,
  });
  await req.bitacora({
    accion: 'leer',
    entidad: 'kardex',
    entidadId: insumoId ?? null,
    detalle: `Kardex${periodo ? ` ${periodo}` : ''}: ${tarjetas.length} producto(s)`,
  });
  res.json({ periodo: periodo ?? null, encabezado: await encabezadoKardex(req.usuario.establecimientoId), tarjetas });
}

module.exports = {
  kardex,
  listarUbicaciones,
  crearUbicacion,
  actualizarUbicacion,
  propuestaLotes,
  distribucion,
  crearTraslado,
  obtenerTraslado,
  listarTraslados,
  estadoReportes,
  obtenerReporte,
  guardarReporte,
  revisarReporte,
  balance,
  semaforo,
  fichaInsumo,
  buscarLotes,
  inventarioCierre,
  agregarAlias,
  quitarAlias,
  listarAlias,
  cambiarPrescribible,
  exportarBalance,
  exportarBres,
};
