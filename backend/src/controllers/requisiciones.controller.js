/**
 * Requisicion Despacho de Almacen (FOR-ASB-01). Todo lo que sale de la
 * bodega a un servicio, a la farmacia incluida, sale por una requisicion:
 * el servicio pide (cantidad solicitada), la bodega autoriza (cantidad
 * autorizada) y despacha (cantidad despachada). El despacho es un traslado,
 * con sus lotes por PEPE, que deja la trazabilidad de cada unidad.
 *
 * El numero es el del formulario impreso que autoriza la Contraloria: el
 * sistema lo registra, no lo genera.
 */

const prisma = require('../config/db');
const { lotesPepe, validarFechasLote } = require('../services/bodega.service');
const { registrarIngreso } = require('../services/movimientos.service');
const { enUbicacion } = require('../services/inventario.service');
const { configuracion, limitesDePeriodo } = require('../services/abastecimiento.service');
const { sugerenciaServicio, sugerenciaDdriss } = require('../services/bodegaDatos.service');
const { numerosDe } = require('../services/hojasRequisicion');
const { errorDestino, registrarTraslado } = require('../services/traslados.service');
const {
  TIPOS_REQUISICION, descripcionInsumo, tiposSugeridos, cantidadADespachar, ESTADOS_EDITABLES,
} = require('../services/requisiciones.service');

const NO_ENCONTRADA = { status: 404, codigo: 'no_encontrado', mensaje: 'Requisición no encontrada' };
const ALMACEN_SUPERIOR = 'Almacén DDRISS Chiquimula';
const SOLO_SERVICIO = { status: 409, codigo: 'es_hacia_arriba', mensaje: 'Esta requisición se pidió a la DDRISS: lo que llega se recibe, no se despacha' };
const NUMERO_REPETIDO = { status: 409, codigo: 'numero_repetido', mensaje: 'Ya hay una requisición registrada con ese número' };

/**
 * Cada hoja del formulario trae su número: una requisición de 4 hojas que
 * empieza en 0156 usa 0156 a 0159. Si algún número ya lo usa otra
 * requisición, se avisa con cuál, para no repetir hojas.
 */
async function choqueDeNumeros(establecimientoId, idPropio, numero, descripciones) {
  if (!numero) return null;
  const propios = numerosDe(numero, descripciones);
  const otras = await prisma.requisicion.findMany({
    where: { establecimientoId, numero: { not: null }, estado: { not: 'anulada' }, ...(idPropio ? { NOT: { id: idPropio } } : {}) },
    select: { numero: true, unidadSeccion: true, renglones: { select: { descripcion: true }, orderBy: { orden: 'asc' } } },
  });
  for (const o of otras) {
    const usados = numerosDe(o.numero, o.renglones.map((g) => g.descripcion));
    const repetidos = propios.filter((n) => usados.includes(n));
    if (repetidos.length) {
      const rango = (l) => (l.length > 1 ? `${l[0]} a ${l[l.length - 1]}` : l[0]);
      return {
        status: 409,
        codigo: 'numero_repetido',
        mensaje: `${repetidos.length === 1 ? 'El número' : 'Los números'} ${rango(repetidos)} ya ${repetidos.length === 1 ? 'es' : 'son'} de la requisición de ${o.unidadSeccion} (${rango(usados)}). Esta ocupa ${propios.length} ${propios.length === 1 ? 'hoja' : 'hojas'}: ${rango(propios)}.`,
      };
    }
  }
  return null;
}

// Farmacia hace las requisiciones de la farmacia; la bodega, las de todos.
const esFarmacia = (req) => req.usuario.rol === 'farmacia';
// El encargado de un centro o puesto solo ve y pide para su ubicación.
const esServicio = (req) => req.usuario.rol === 'servicio';
const permitida = (req, ubicacion) => {
  if (esFarmacia(req)) return ubicacion?.tipo === 'centro_salud';
  if (esServicio(req)) return Boolean(ubicacion) && ubicacion.id === req.usuario.ubicacionId;
  return true;
};
/** Farmacia y los encargados solo manejan sus pedidos hacia la bodega. */
const soloPedidos = (req) => esFarmacia(req) || esServicio(req);
/** El encargado corrige o anula su requisición solo mientras bodega no la atiende. */
const SIN_ATENDER = { status: 409, codigo: 'ya_atendida', mensaje: 'Bodega ya atendió esta requisición: pida el cambio a bodega' };

const INCLUIR = {
  ubicacion: { select: { id: true, nombre: true, tipo: true } },
  usuarioRegistro: { select: { nombre: true } },
  usuarioAutoriza: { select: { nombre: true } },
  usuarioDespacha: { select: { nombre: true } },
  usuarioAnula: { select: { nombre: true } },
  renglones: { orderBy: { orden: 'asc' }, include: { insumo: { select: { id: true, codigoInterno: true, categoria: true, ubicacionFisica: true, ordenFormulario: true } } } },
  lotes: { orderBy: { id: 'asc' }, select: { id: true, insumoId: true, numeroLote: true, fechaVence: true, cantidadInicial: true } },
  traslado: {
    select: {
      id: true,
      numero: true,
      movimientos: {
        where: { ubicacion: 'bodega' },
        orderBy: { id: 'asc' },
        select: { cantidad: true, lote: { select: { id: true, insumoId: true, numeroLote: true, fechaVence: true } } },
      },
    },
  },
};

function vista(r) {
  // Hacia un servicio: los lotes que salieron. Hacia arriba: los que entraron.
  const lotesDe = (insumoId) => (r.direccion === 'superior'
    ? (r.lotes ?? []).filter((l) => l.insumoId === insumoId)
      .map((l) => ({ loteId: l.id, numeroLote: l.numeroLote, fechaVence: l.fechaVence, cantidad: l.cantidadInicial }))
    : (r.traslado?.movimientos ?? []).filter((m) => m.lote.insumoId === insumoId)
      .map((m) => ({ loteId: m.lote.id, numeroLote: m.lote.numeroLote, fechaVence: m.lote.fechaVence, cantidad: -m.cantidad })));
  return {
    id: r.id,
    numero: r.numero,
    // Un número por hoja del formulario: 0156, 0157…
    numeros: numerosDe(r.numero, r.renglones.map((g) => g.descripcion)),
    estado: r.estado,
    direccion: r.direccion,
    almacen: r.almacen,
    ubicacion: r.ubicacion,
    codigo: r.codigo,
    unidadSeccion: r.unidadSeccion,
    tipos: r.tipos,
    fechaSolicitud: r.fechaSolicitud,
    solicitante: r.solicitante,
    jefe: r.jefe,
    recepcionEn: r.recepcionEn,
    observaciones: r.observaciones,
    registradaEn: r.registradaEn,
    registradaPor: r.usuarioRegistro?.nombre ?? null,
    autorizadaEn: r.autorizadaEn,
    autorizadaPor: r.usuarioAutoriza?.nombre ?? null,
    despachadaEn: r.despachadaEn,
    despachadaPor: r.usuarioDespacha?.nombre ?? null,
    recibidoPor: r.recibidoPor,
    anuladaEn: r.anuladaEn,
    anuladaPor: r.usuarioAnula?.nombre ?? null,
    motivoAnulacion: r.motivoAnulacion,
    traslado: r.traslado ? { id: r.traslado.id, numero: r.traslado.numero } : null,
    renglones: r.renglones.map((g) => ({
      id: g.id,
      orden: g.orden,
      insumoId: g.insumoId,
      codigoInterno: g.insumo?.codigoInterno ?? null,
      // Dónde buscarlo en la bodega al despachar.
      ubicacionFisica: g.insumo?.ubicacionFisica ?? null,
      // Orden del balance y del BRES: la bodega despacha en ese orden.
      ordenFormulario: g.insumo?.ordenFormulario ?? null,
      descripcion: g.descripcion,
      unidadMedida: g.unidadMedida,
      cantidadSolicitada: g.cantidadSolicitada,
      cantidadAutorizada: g.cantidadAutorizada,
      cantidadDespachada: g.cantidadDespachada,
      motivo: g.motivo,
      lotes: g.insumoId ? lotesDe(g.insumoId) : [],
    })),
  };
}

async function cargar(req, id = req.params.id) {
  return prisma.requisicion.findFirst({
    where: { id: Number(id), establecimientoId: req.usuario.establecimientoId },
    include: INCLUIR,
  });
}

/** Lo que hay en bodega de cada insumo y cuanto le toca a cada lugar. */
async function existencias(establecimientoId, insumoIds) {
  if (!insumoIds.length) return {};
  const [lotes, config] = await Promise.all([
    prisma.lote.findMany({ where: { insumoId: { in: insumoIds }, insumo: { establecimientoId } } }),
    configuracion(establecimientoId),
  ]);
  const ahora = new Date();
  const res = {};
  for (const id of insumoIds) {
    const usables = enUbicacion(lotes.filter((l) => l.insumoId === id), 'bodega')
      .filter((l) => l.estado === 'disponible' && l.cantidadActual > 0 && new Date(l.fechaVence) >= ahora)
      .sort((a, b) => new Date(a.fechaVence) - new Date(b.fechaVence) || a.id - b.id);
    const enBodega = usables.reduce((s, l) => s + l.cantidadActual, 0);
    res[id] = {
      enBodega,
      aCadaLugar: Math.round(enBodega / config.lugaresReparto),
      // Los lotes que se pueden despachar, el que vence primero adelante.
      lotes: usables.map((l) => ({ loteId: l.id, numeroLote: l.numeroLote, fechaVence: l.fechaVence, cantidad: l.cantidadActual })),
    };
  }
  return res;
}

// --- Consultas ---------------------------------------------------------------------

async function listar(req, res) {
  const where = { establecimientoId: req.usuario.establecimientoId };
  if (req.query.estado) where.estado = req.query.estado;
  if (req.query.ubicacionId) where.ubicacionId = req.query.ubicacionId;
  if (req.query.direccion) where.direccion = req.query.direccion;
  if (esFarmacia(req)) Object.assign(where, { ubicacion: { tipo: 'centro_salud' }, direccion: 'servicio' });
  if (esServicio(req)) Object.assign(where, { ubicacionId: req.usuario.ubicacionId ?? 0, direccion: 'servicio' });
  if (req.query.periodo) {
    const { desde, hasta } = limitesDePeriodo(req.query.periodo);
    where.fechaSolicitud = { gte: desde, lt: hasta };
  }
  const lista = await prisma.requisicion.findMany({
    where,
    orderBy: [{ fechaSolicitud: 'desc' }, { id: 'desc' }],
    take: 300,
    include: {
      ubicacion: { select: { nombre: true } },
      renglones: { select: { descripcion: true, cantidadSolicitada: true, cantidadAutorizada: true, cantidadDespachada: true }, orderBy: { orden: 'asc' } },
    },
  });
  res.json({
    tipos: TIPOS_REQUISICION.map(([valor, etiqueta]) => ({ valor, etiqueta })),
    requisiciones: lista.map((r) => ({
      id: r.id,
      numero: r.numero,
      numeros: numerosDe(r.numero, r.renglones.map((g) => g.descripcion)),
      estado: r.estado,
      direccion: r.direccion,
      almacen: r.almacen,
      fechaSolicitud: r.fechaSolicitud,
      ubicacion: r.ubicacion.nombre,
      unidadSeccion: r.unidadSeccion,
      solicitante: r.solicitante,
      renglones: r.renglones.length,
      solicitado: r.renglones.reduce((s, g) => s + g.cantidadSolicitada, 0),
      despachado: r.renglones.reduce((s, g) => s + (g.cantidadDespachada ?? 0), 0),
      autorizado: r.renglones.some((g) => g.cantidadAutorizada != null)
        ? r.renglones.reduce((s, g) => s + (g.cantidadAutorizada ?? 0), 0) : null,
      motivoAnulacion: r.motivoAnulacion,
    })),
  });
}

async function obtener(req, res, next) {
  const r = await cargar(req);
  if (!r || !permitida(req, r.ubicacion) || (soloPedidos(req) && r.direccion !== 'servicio')) return next(NO_ENCONTRADA);
  const ids = [...new Set(r.renglones.map((g) => g.insumoId).filter(Boolean))];
  res.json({
    requisicion: vista(r),
    existencias: await existencias(req.usuario.establecimientoId, ids),
    tipos: TIPOS_REQUISICION.map(([valor, etiqueta]) => ({ valor, etiqueta })),
  });
}

// --- Registro ----------------------------------------------------------------------

/** Renglones listos para guardar: los del catalogo toman su nombre y unidad. */
async function prepararRenglones(establecimientoId, renglones) {
  const ids = renglones.map((g) => g.insumoId).filter(Boolean);
  const insumos = await prisma.insumo.findMany({ where: { id: { in: ids }, establecimientoId } });
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const filas = [];
  for (const [i, g] of renglones.entries()) {
    const insumo = g.insumoId ? porId.get(g.insumoId) : null;
    if (g.insumoId && !insumo) return { error: { status: 404, codigo: 'insumo_no_encontrado', mensaje: 'Uno de los insumos no existe' } };
    if (!insumo && !g.descripcion) return { error: { status: 400, codigo: 'sin_descripcion', mensaje: `Renglón ${i + 1}: escriba qué se pide` } };
    filas.push({
      orden: i + 1,
      insumoId: insumo?.id ?? null,
      descripcion: g.descripcion || descripcionInsumo(insumo),
      unidadMedida: g.unidadMedida || insumo?.unidadEntrega || 'Unidad',
      cantidadSolicitada: g.cantidadSolicitada,
      cantidadAutorizada: g.cantidadAutorizada ?? null,
    });
  }
  return { filas, insumos };
}

function datosCabecera(body, ubicacion) {
  const superior = body.direccion === 'superior';
  return {
    direccion: superior ? 'superior' : 'servicio',
    almacen: superior ? (body.almacen || ALMACEN_SUPERIOR) : null,
    numero: body.numero || null,
    ubicacionId: ubicacion.id,
    codigo: body.codigo || null,
    unidadSeccion: body.unidadSeccion || ubicacion.nombre,
    fechaSolicitud: new Date(`${body.fechaSolicitud}T00:00:00Z`),
    solicitante: body.solicitante,
    jefe: body.jefe || null,
    recepcionEn: body.recepcionEn ? new Date(body.recepcionEn) : null,
    observaciones: body.observaciones || null,
  };
}

/**
 * Quien pide. Hacia arriba es la bodega del centro; hacia un servicio, el
 * servicio (o la farmacia). Devuelve { ubicacion } o { error }.
 */
async function solicitante(req) {
  const establecimientoId = req.usuario.establecimientoId;
  if (req.body.direccion === 'superior') {
    if (soloPedidos(req)) return { error: { status: 403, codigo: 'sin_permiso', mensaje: 'Las requisiciones a la DDRISS las hace bodega' } };
    const bodega = await prisma.ubicacion.findFirst({ where: { establecimientoId, tipo: 'bodega' } });
    if (!bodega) return { error: { status: 409, codigo: 'sin_bodega', mensaje: 'El centro no tiene bodega registrada' } };
    return { ubicacion: bodega };
  }
  const ubicacionId = esServicio(req) ? req.usuario.ubicacionId : req.body.ubicacionId;
  const ubicacion = await prisma.ubicacion.findFirst({ where: { id: ubicacionId ?? 0, establecimientoId } });
  const falla = errorDestino(ubicacion);
  if (falla) return { error: { ...falla, mensaje: 'Las requisiciones son de la farmacia del centro, de los puestos de salud y de los centros comunitarios' } };
  if (!permitida(req, ubicacion)) {
    return { error: { status: 403, codigo: 'sin_permiso', mensaje: esServicio(req) ? 'Solo puede pedir para su centro o puesto' : 'Farmacia solo registra las requisiciones de la farmacia' } };
  }
  return { ubicacion };
}

async function crear(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { ubicacion, error: fallaSolicitante } = await solicitante(req);
  if (fallaSolicitante) return next(fallaSolicitante);

  const { filas, insumos, error } = await prepararRenglones(establecimientoId, req.body.renglones);
  if (error) return next(error);
  const choque = await choqueDeNumeros(establecimientoId, null, req.body.numero, filas.map((f) => f.descripcion));
  if (choque) return next(choque);

  let creada;
  try {
    creada = await prisma.requisicion.create({
      data: {
        ...datosCabecera(req.body, ubicacion),
        establecimientoId,
        tipos: req.body.tipos?.length ? req.body.tipos : tiposSugeridos(insumos),
        registradaPor: req.usuario.id,
        renglones: { create: filas.map(({ cantidadAutorizada, ...f }) => f) },
      },
    });
  } catch (e) {
    if (e.code === 'P2002') return next(NUMERO_REPETIDO);
    throw e;
  }
  await req.bitacora({
    accion: 'crear',
    entidad: 'requisicion',
    entidadId: creada.id,
    detalle: `Requisición ${creada.numero ?? 'sin número'} de ${creada.unidadSeccion}: ${filas.length} renglón(es)`,
  });
  res.status(201).json({ requisicion: vista(await cargar(req, creada.id)) });
}

/** Corregir antes de despachar: cabecera y renglones completos. */
async function actualizar(req, res, next) {
  const r = await cargar(req);
  if (!r || !permitida(req, r.ubicacion)) return next(NO_ENCONTRADA);
  if (!ESTADOS_EDITABLES.includes(r.estado)) {
    return next({ status: 409, codigo: 'no_editable', mensaje: `Una requisición ${r.estado} ya no se corrige` });
  }
  if (esServicio(req) && r.estado !== 'solicitada') return next(SIN_ATENDER);
  const establecimientoId = req.usuario.establecimientoId;
  if ((req.body.direccion === 'superior') !== (r.direccion === 'superior')) {
    return next({ status: 409, codigo: 'otra_direccion', mensaje: 'No se cambia a quién se pide: anule esta y registre otra' });
  }
  const { ubicacion, error: fallaSolicitante } = await solicitante(req);
  if (fallaSolicitante) return next(fallaSolicitante);
  const { filas, insumos, error } = await prepararRenglones(establecimientoId, req.body.renglones);
  if (error) return next(error);
  const choque = await choqueDeNumeros(establecimientoId, r.id, req.body.numero, filas.map((f) => f.descripcion));
  if (choque) return next(choque);

  try {
    await prisma.$transaction([
      prisma.requisicionRenglon.deleteMany({ where: { requisicionId: r.id } }),
      prisma.requisicion.update({
        where: { id: r.id },
        data: {
          ...datosCabecera(req.body, ubicacion),
          tipos: req.body.tipos?.length ? req.body.tipos : tiposSugeridos(insumos),
          renglones: { create: filas.map((f) => (r.estado === 'autorizada' ? f : { ...f, cantidadAutorizada: null })) },
        },
      }),
    ]);
  } catch (e) {
    if (e.code === 'P2002') return next(NUMERO_REPETIDO);
    throw e;
  }
  await req.bitacora({ accion: 'actualizar', entidad: 'requisicion', entidadId: r.id, detalle: `Requisición ${req.body.numero || r.numero || r.id} corregida` });
  res.json({ requisicion: vista(await cargar(req)) });
}

// --- Autorizar, despachar, anular ---------------------------------------------------

async function autorizar(req, res, next) {
  const r = await cargar(req);
  if (!r) return next(NO_ENCONTRADA);
  if (r.direccion === 'superior') return next(SOLO_SERVICIO);
  if (!ESTADOS_EDITABLES.includes(r.estado)) {
    return next({ status: 409, codigo: 'no_editable', mensaje: `La requisición ya está ${r.estado}` });
  }
  const indicadas = new Map((req.body.renglones ?? []).map((g) => [g.id, g]));
  await prisma.$transaction([
    ...r.renglones.map((g) => prisma.requisicionRenglon.update({
      where: { id: g.id },
      data: {
        cantidadAutorizada: indicadas.get(g.id)?.cantidadAutorizada ?? g.cantidadSolicitada,
        motivo: indicadas.get(g.id)?.motivo ?? null,
      },
    })),
    prisma.requisicion.update({
      where: { id: r.id },
      data: { estado: 'autorizada', autorizadaPor: req.usuario.id, autorizadaEn: new Date() },
    }),
  ]);
  await req.bitacora({ accion: 'actualizar', entidad: 'requisicion', entidadId: r.id, detalle: `Requisición ${r.numero ?? r.id} autorizada` });
  res.json({ requisicion: vista(await cargar(req)) });
}

/**
 * Despacha la requisicion: cada renglon del catalogo sale de los lotes
 * indicados o, si no se indican, de los que vencen primero (PEPE). Si no
 * alcanza, no se despacha nada y se dice que falta.
 */
async function despachar(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const r = await cargar(req);
  if (!r) return next(NO_ENCONTRADA);
  if (r.direccion === 'superior') return next(SOLO_SERVICIO);
  if (!ESTADOS_EDITABLES.includes(r.estado)) {
    return next({ status: 409, codigo: 'no_despachable', mensaje: `La requisición ya está ${r.estado}` });
  }
  if (!r.numero && !req.body.numero) {
    return next({ status: 400, codigo: 'sin_numero', mensaje: 'Anote el número del formulario de la requisición antes de despachar' });
  }
  if (req.body.numero && req.body.numero !== r.numero) {
    const choque = await choqueDeNumeros(establecimientoId, r.id, req.body.numero, r.renglones.map((g) => g.descripcion));
    if (choque) return next(choque);
  }
  const ubicacion = await prisma.ubicacion.findUnique({ where: { id: r.ubicacionId } });
  const fallaDestino = errorDestino(ubicacion);
  if (fallaDestino) return next(fallaDestino);

  const indicadas = new Map((req.body.renglones ?? []).map((g) => [g.id, g]));
  const ids = [...new Set(r.renglones.map((g) => g.insumoId).filter(Boolean))];
  const lotes = await prisma.lote.findMany({ where: { insumoId: { in: ids }, insumo: { establecimientoId } } });
  const enBodega = enUbicacion(lotes, 'bodega');
  const ahora = new Date();

  const cantidades = new Map();
  const movimientos = [];
  const faltan = [];
  for (const g of r.renglones) {
    const ind = indicadas.get(g.id) ?? {};
    const { cantidad, error } = cantidadADespachar(g, ind.cantidadDespachada);
    if (error) return next({ status: 400, codigo: 'mas_de_lo_autorizado', mensaje: error });
    cantidades.set(g.id, cantidad);
    if (!g.insumoId || cantidad === 0) continue;

    const propios = enBodega.filter((l) => l.insumoId === g.insumoId);
    if (ind.lotes?.length) {
      const suma = ind.lotes.reduce((s, l) => s + l.cantidad, 0);
      if (suma !== cantidad) return next({ status: 400, codigo: 'lotes_no_cuadran', mensaje: `${g.descripcion}: los lotes suman ${suma} y se despachan ${cantidad}` });
      for (const l of ind.lotes) {
        const lote = propios.find((p) => p.id === l.loteId);
        if (!lote) return next({ status: 404, codigo: 'lote_no_encontrado', mensaje: `${g.descripcion}: el lote no es de este insumo` });
        if (new Date(lote.fechaVence) < ahora) return next({ status: 409, codigo: 'lote_vencido', mensaje: `El lote ${lote.numeroLote} está vencido` });
        if (lote.cantidadActual < l.cantidad) faltan.push(`${g.descripcion}, lote ${lote.numeroLote}: hay ${lote.cantidadActual}`);
        movimientos.push(l);
      }
    } else {
      const { propuesta, faltante } = lotesPepe(propios, cantidad, ahora);
      if (faltante > 0) faltan.push(`${g.descripcion}: hay ${cantidad - faltante} en bodega, se piden ${cantidad}`);
      movimientos.push(...propuesta.map((p) => ({ loteId: p.loteId, cantidad: p.cantidad })));
    }
  }
  if (faltan.length) {
    return next({ status: 409, codigo: 'sin_existencia', mensaje: `No alcanza la existencia en bodega. ${faltan.join('; ')}` });
  }

  const recibidoPor = req.body.recibidoPor;
  try {
    await prisma.$transaction(async (tx) => {
      const numero = req.body.numero || r.numero;
      if (numero !== r.numero) await tx.requisicion.update({ where: { id: r.id }, data: { numero } });
      if (movimientos.length) {
        await registrarTraslado(tx, {
          establecimientoId, ubicacion, usuarioId: req.usuario.id, recibidoPor, renglones: movimientos,
          observacion: r.observaciones, requisicion: { id: r.id, numero },
        });
      }
      for (const g of r.renglones) {
        await tx.requisicionRenglon.update({
          where: { id: g.id },
          data: { cantidadAutorizada: g.cantidadAutorizada ?? cantidades.get(g.id), cantidadDespachada: cantidades.get(g.id) },
        });
      }
      await tx.requisicion.update({
        where: { id: r.id },
        data: {
          estado: 'despachada',
          autorizadaPor: r.autorizadaPor ?? req.usuario.id,
          autorizadaEn: r.autorizadaEn ?? new Date(),
          despachadaPor: req.usuario.id,
          despachadaEn: req.body.fechaEntrega ? new Date(req.body.fechaEntrega) : new Date(),
          recibidoPor,
        },
      });
    });
  } catch (e) {
    if (e.code === 'P2002') return next(NUMERO_REPETIDO);
    throw e;
  }

  const despachada = await cargar(req);
  await req.bitacora({
    accion: 'crear',
    entidad: 'requisicion',
    entidadId: r.id,
    detalle: `Requisición ${despachada.numero} despachada a ${ubicacion.nombre}${despachada.traslado ? ` (${despachada.traslado.numero})` : ''}, recibe ${recibidoPor}`,
  });
  res.json({ requisicion: vista(despachada) });
}

/**
 * Lo que llega de la DDRISS por una requisicion: cada renglon del catalogo
 * entra con sus lotes (numero, vencimiento, cantidad, precio), ligados a la
 * requisicion. El equipo que no esta en el catalogo solo anota lo recibido.
 * Se puede recibir en partes; con "completa" se cierra.
 */
async function recibir(req, res, next) {
  const r = await cargar(req);
  if (!r) return next(NO_ENCONTRADA);
  if (r.direccion !== 'superior') {
    return next({ status: 409, codigo: 'es_de_servicio', mensaje: 'Esta requisición es de un servicio: se despacha' });
  }
  if (!['solicitada', 'autorizada', 'parcial'].includes(r.estado)) {
    return next({ status: 409, codigo: 'no_recibible', mensaje: `La requisición ya está ${r.estado}` });
  }
  const porId = new Map(r.renglones.map((g) => ({ ...g })).map((g) => [g.id, g]));
  const entradas = req.body.renglones ?? [];
  const vistos = new Set();
  const enlazados = [];
  for (const e of entradas) {
    const g = porId.get(e.id);
    if (!g) return next({ status: 404, codigo: 'renglon_no_encontrado', mensaje: 'Uno de los renglones no es de esta requisición' });
    // Se pidió escrito a mano y al llegar bodega lo creó: entra con su lote.
    if (!g.insumoId && e.insumoId) {
      const insumo = await prisma.insumo.findFirst({ where: { id: e.insumoId, establecimientoId: req.usuario.establecimientoId } });
      if (!insumo) return next({ status: 404, codigo: 'insumo_no_encontrado', mensaje: `${g.descripcion}: el producto no existe` });
      g.insumoId = insumo.id;
      enlazados.push(g);
    }
    for (const l of e.lotes ?? []) {
      if (!g.insumoId) return next({ status: 400, codigo: 'sin_catalogo', mensaje: `${g.descripcion} no está en el catálogo: anote solo la cantidad` });
      const fechas = validarFechasLote(l);
      if (fechas.errores.length) return next({ status: 400, codigo: 'fechas_invalidas', mensaje: `${g.descripcion}: ${fechas.errores[0]}` });
      const clave = `${g.insumoId}|${l.numeroLote}`;
      const repetido = vistos.has(clave) || await prisma.lote.findFirst({ where: { insumoId: g.insumoId, numeroLote: l.numeroLote } });
      if (repetido) return next({ status: 409, codigo: 'lote_duplicado', mensaje: `${g.descripcion}: el lote ${l.numeroLote} ya fue recibido` });
      vistos.add(clave);
    }
  }

  const recibido = new Map();
  await prisma.$transaction(async (tx) => {
    for (const g of enlazados) {
      await tx.requisicionRenglon.update({ where: { id: g.id }, data: { insumoId: g.insumoId } });
    }
    for (const e of entradas) {
      const g = porId.get(e.id);
      let suma = 0;
      for (const l of e.lotes ?? []) {
        await registrarIngreso(tx, {
          insumoId: g.insumoId,
          numeroLote: l.numeroLote,
          fechaVence: new Date(`${l.fechaVence}T00:00:00Z`),
          cantidad: l.cantidad,
          costoUnitario: l.costoUnitario ?? null,
          fabricante: l.fabricante ?? null,
          origen: 'despacho',
          usuarioId: req.usuario.id,
          motivo: `Recepción de la requisición ${r.numero ?? r.id} (${r.almacen ?? ALMACEN_SUPERIOR})`,
          requisicionId: r.id,
        });
        suma += l.cantidad;
      }
      if (!g.insumoId) suma = e.cantidad ?? 0;
      if (suma > 0) recibido.set(g.id, suma);
    }
    for (const [id, suma] of recibido) {
      const g = porId.get(id);
      await tx.requisicionRenglon.update({ where: { id }, data: { cantidadDespachada: (g.cantidadDespachada ?? 0) + suma } });
    }
    await tx.requisicion.update({
      where: { id: r.id },
      data: {
        estado: req.body.completa ? 'recibida' : 'parcial',
        despachadaPor: req.usuario.id,
        despachadaEn: new Date(),
        ...(req.body.numero ? { numero: req.body.numero } : {}),
        ...(req.body.recibidoPor ? { recibidoPor: req.body.recibidoPor } : {}),
      },
    });
  });

  const total = [...recibido.values()].reduce((suma, v) => suma + v, 0);
  await req.bitacora({
    accion: 'crear',
    entidad: 'requisicion',
    entidadId: r.id,
    detalle: `Recepción de la requisición ${r.numero ?? r.id}: ${recibido.size} renglón(es), ${total} unidades${req.body.completa ? ', completa' : ', parcial'}`,
  });
  res.json({ requisicion: vista(await cargar(req)) });
}

/**
 * Entregar en un solo paso: la bodega registra lo que entrega y eso genera la
 * requisicion (solicitada = autorizada = despachada). Los lotes salen por PEPE.
 * El numero del formulario puede quedar para despues.
 */
async function entregar(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { ubicacion, error: fallaSolicitante } = await solicitante({ ...req, body: { ...req.body, direccion: 'servicio' } });
  if (fallaSolicitante) return next(fallaSolicitante);
  const { filas, insumos, error } = await prepararRenglones(establecimientoId, req.body.renglones.map((g) => ({ ...g, cantidadSolicitada: g.cantidad })));
  if (error) return next(error);
  const choque = await choqueDeNumeros(establecimientoId, null, req.body.numero, filas.map((f) => f.descripcion));
  if (choque) return next(choque);

  const ids = [...new Set(filas.map((f) => f.insumoId).filter(Boolean))];
  const lotes = await prisma.lote.findMany({ where: { insumoId: { in: ids }, insumo: { establecimientoId } } });
  const enBodega = enUbicacion(lotes, 'bodega');
  const movimientos = [];
  const faltan = [];
  // Los lotes que se eligieron a mano; si no, salen por PEPE (el que vence primero).
  const elegidos = new Map(req.body.renglones.filter((g) => g.insumoId && g.lotes?.length).map((g) => [g.insumoId, g.lotes]));
  const hoy = new Date();
  for (const f of filas.filter((x) => x.insumoId)) {
    const propios = enBodega.filter((l) => l.insumoId === f.insumoId);
    const aMano = elegidos.get(f.insumoId);
    if (aMano) {
      const suma = aMano.reduce((s, l) => s + l.cantidad, 0);
      if (suma !== f.cantidadSolicitada) return next({ status: 400, codigo: 'lotes_no_cuadran', mensaje: `${f.descripcion}: los lotes suman ${suma} y se entregan ${f.cantidadSolicitada}` });
      for (const l of aMano) {
        const lote = propios.find((p) => p.id === l.loteId);
        if (!lote) return next({ status: 404, codigo: 'lote_no_encontrado', mensaje: `${f.descripcion}: el lote no es de este insumo` });
        if (lote.estado !== 'disponible') return next({ status: 409, codigo: 'lote_no_disponible', mensaje: `El lote ${lote.numeroLote} no está disponible para entregar` });
        if (new Date(lote.fechaVence) < hoy) return next({ status: 409, codigo: 'lote_vencido', mensaje: `El lote ${lote.numeroLote} está vencido` });
        if (lote.cantidadActual < l.cantidad) faltan.push(`${f.descripcion}, lote ${lote.numeroLote}: hay ${lote.cantidadActual}`);
        movimientos.push({ loteId: l.loteId, cantidad: l.cantidad });
      }
      continue;
    }
    const { propuesta, faltante } = lotesPepe(propios, f.cantidadSolicitada);
    if (faltante > 0) faltan.push(`${f.descripcion}: hay ${f.cantidadSolicitada - faltante}`);
    movimientos.push(...propuesta.map((p) => ({ loteId: p.loteId, cantidad: p.cantidad })));
  }
  if (faltan.length) return next({ status: 409, codigo: 'sin_existencia', mensaje: `No alcanza en bodega. ${faltan.join('; ')}` });

  const ahora = new Date();
  let creada;
  try {
    creada = await prisma.$transaction(async (tx) => {
      const r = await tx.requisicion.create({
        data: {
          ...datosCabecera({ ...req.body, direccion: 'servicio', fechaSolicitud: req.body.fechaSolicitud ?? new Date(ahora.getTime() - 6 * 3600000).toISOString().slice(0, 10) }, ubicacion),
          establecimientoId,
          tipos: req.body.tipos?.length ? req.body.tipos : tiposSugeridos(insumos),
          estado: 'despachada',
          registradaPor: req.usuario.id,
          autorizadaPor: req.usuario.id,
          autorizadaEn: ahora,
          despachadaPor: req.usuario.id,
          despachadaEn: ahora,
          recibidoPor: req.body.solicitante,
          renglones: {
            create: filas.map(({ cantidadAutorizada, ...f }) => ({ ...f, cantidadAutorizada: f.cantidadSolicitada, cantidadDespachada: f.cantidadSolicitada })),
          },
        },
      });
      if (movimientos.length) {
        await registrarTraslado(tx, {
          establecimientoId, ubicacion, usuarioId: req.usuario.id, recibidoPor: req.body.solicitante, renglones: movimientos,
          observacion: req.body.observaciones ?? null, requisicion: { id: r.id, numero: r.numero },
        });
      }
      return r;
    });
  } catch (e) {
    if (e.code === 'P2002') return next(NUMERO_REPETIDO);
    throw e;
  }
  await req.bitacora({
    accion: 'crear',
    entidad: 'requisicion',
    entidadId: creada.id,
    detalle: `Entrega a ${ubicacion.nombre} con requisición ${creada.numero ?? 'sin número'}: ${filas.length} renglón(es)`,
  });
  res.status(201).json({ requisicion: vista(await cargar(req, creada.id)) });
}

/** Anotar o corregir el numero del formulario despues de entregar. */
async function anotarNumero(req, res, next) {
  const r = await cargar(req);
  if (!r || !permitida(req, r.ubicacion)) return next(NO_ENCONTRADA);
  const choque = await choqueDeNumeros(req.usuario.establecimientoId, r.id, req.body.numero, r.renglones.map((g) => g.descripcion));
  if (choque) return next(choque);
  try {
    await prisma.requisicion.update({ where: { id: r.id }, data: { numero: req.body.numero } });
  } catch (e) {
    if (e.code === 'P2002') return next(NUMERO_REPETIDO);
    throw e;
  }
  await req.bitacora({ accion: 'actualizar', entidad: 'requisicion', entidadId: r.id, detalle: `Número del formulario: ${r.numero ?? '(vacío)'} → ${req.body.numero}` });
  res.json({ requisicion: vista(await cargar(req)) });
}

/** Quien firmo la ultima requisicion de cada servicio: se propone en la siguiente. */
async function solicitantes(req, res) {
  const ultimas = await prisma.requisicion.findMany({
    where: {
      establecimientoId: req.usuario.establecimientoId,
      direccion: 'servicio',
      ...(esServicio(req) ? { ubicacionId: req.usuario.ubicacionId ?? 0 } : {}),
    },
    orderBy: { registradaEn: 'desc' },
    distinct: ['ubicacionId'],
    select: { ubicacionId: true, solicitante: true, jefe: true, unidadSeccion: true },
  });
  res.json({ solicitantes: Object.fromEntries(ultimas.map((u) => [u.ubicacionId, u])) });
}

/**
 * La requisición ya llena para un centro o puesto: lo que le falta para llegar
 * al nivel máximo según sus informes. El encargado solo pide para el suyo.
 */
async function sugerida(req, res, next) {
  const ubicacionId = esServicio(req) ? req.usuario.ubicacionId : req.query.ubicacionId;
  const s = await sugerenciaServicio(req.usuario.establecimientoId, ubicacionId ?? 0);
  if (!s || !permitida(req, s.ubicacion)) return next(NO_ENCONTRADA);
  res.json(s);
}

/** La requisición a la DDRISS ya llena con lo que el BRES dice que hay que pedir. */
async function sugeridaDdriss(req, res) {
  res.json(await sugerenciaDdriss(req.usuario.establecimientoId, req.query.periodo));
}

async function anular(req, res, next) {
  const r = await cargar(req);
  if (!r || !permitida(req, r.ubicacion)) return next(NO_ENCONTRADA);
  if (esServicio(req) && r.estado !== 'solicitada') return next(SIN_ATENDER);
  if (!ESTADOS_EDITABLES.includes(r.estado)) {
    const motivos = {
      despachada: 'Ya se despachó: lo que regrese entra como devolución',
      parcial: 'Ya se recibió una parte: ciérrela como recibida',
      recibida: 'Ya se recibió',
      anulada: 'Ya está anulada',
    };
    return next({ status: 409, codigo: 'no_anulable', mensaje: motivos[r.estado] });
  }
  await prisma.requisicion.update({
    where: { id: r.id },
    data: { estado: 'anulada', anuladaPor: req.usuario.id, anuladaEn: new Date(), motivoAnulacion: req.body.motivo },
  });
  await req.bitacora({ accion: 'actualizar', entidad: 'requisicion', entidadId: r.id, detalle: `Requisición ${r.numero ?? r.id} anulada: ${req.body.motivo}` });
  res.json({ requisicion: vista(await cargar(req)) });
}

module.exports = {
  listar, obtener, crear, actualizar, autorizar, despachar, recibir, anular, entregar, anotarNumero, solicitantes, sugerida, sugeridaDdriss, existencias, ALMACEN_SUPERIOR,
};
