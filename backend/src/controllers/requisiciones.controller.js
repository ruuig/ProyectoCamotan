/**
 * Requisicion Despacho de Almacen (FOR-ASE-01). Todo lo que sale de la
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
const { errorDestino, registrarTraslado } = require('../services/traslados.service');
const {
  TIPOS_REQUISICION, descripcionInsumo, tiposSugeridos, cantidadADespachar, ESTADOS_EDITABLES,
} = require('../services/requisiciones.service');

const NO_ENCONTRADA = { status: 404, codigo: 'no_encontrado', mensaje: 'Requisición no encontrada' };
const ALMACEN_SUPERIOR = 'Almacén DDRISS Chiquimula';
const SOLO_SERVICIO = { status: 409, codigo: 'es_hacia_arriba', mensaje: 'Esta requisición se pidió a la DDRISS: lo que llega se recibe, no se despacha' };
const NUMERO_REPETIDO = { status: 409, codigo: 'numero_repetido', mensaje: 'Ya hay una requisición registrada con ese número' };

// Farmacia hace las requisiciones de la farmacia; la bodega, las de todos.
const esFarmacia = (req) => req.usuario.rol === 'farmacia';
const permitida = (req, ubicacion) => !esFarmacia(req) || ubicacion?.tipo === 'centro_salud';

const INCLUIR = {
  ubicacion: { select: { id: true, nombre: true, tipo: true } },
  usuarioRegistro: { select: { nombre: true } },
  usuarioAutoriza: { select: { nombre: true } },
  usuarioDespacha: { select: { nombre: true } },
  usuarioAnula: { select: { nombre: true } },
  renglones: { orderBy: { orden: 'asc' }, include: { insumo: { select: { id: true, codigoInterno: true, categoria: true } } } },
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
      descripcion: g.descripcion,
      unidadMedida: g.unidadMedida,
      cantidadSolicitada: g.cantidadSolicitada,
      cantidadAutorizada: g.cantidadAutorizada,
      cantidadDespachada: g.cantidadDespachada,
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
    const enBodega = enUbicacion(lotes.filter((l) => l.insumoId === id), 'bodega')
      .filter((l) => l.estado === 'disponible' && l.cantidadActual > 0 && new Date(l.fechaVence) >= ahora)
      .reduce((s, l) => s + l.cantidadActual, 0);
    res[id] = { enBodega, aCadaLugar: Math.round(enBodega / config.lugaresReparto) };
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
      renglones: { select: { cantidadSolicitada: true, cantidadDespachada: true } },
    },
  });
  res.json({
    tipos: TIPOS_REQUISICION.map(([valor, etiqueta]) => ({ valor, etiqueta })),
    requisiciones: lista.map((r) => ({
      id: r.id,
      numero: r.numero,
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
    })),
  });
}

async function obtener(req, res, next) {
  const r = await cargar(req);
  if (!r || !permitida(req, r.ubicacion) || (esFarmacia(req) && r.direccion !== 'servicio')) return next(NO_ENCONTRADA);
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
    if (esFarmacia(req)) return { error: { status: 403, codigo: 'sin_permiso', mensaje: 'Las requisiciones a la DDRISS las hace bodega' } };
    const bodega = await prisma.ubicacion.findFirst({ where: { establecimientoId, tipo: 'bodega' } });
    if (!bodega) return { error: { status: 409, codigo: 'sin_bodega', mensaje: 'El centro no tiene bodega registrada' } };
    return { ubicacion: bodega };
  }
  const ubicacion = await prisma.ubicacion.findFirst({ where: { id: req.body.ubicacionId ?? 0, establecimientoId } });
  const falla = errorDestino(ubicacion);
  if (falla) return { error: { ...falla, mensaje: 'Las requisiciones son de la farmacia del centro, de los puestos de salud y de los centros comunitarios' } };
  if (!permitida(req, ubicacion)) return { error: { status: 403, codigo: 'sin_permiso', mensaje: 'Farmacia solo registra las requisiciones de la farmacia' } };
  return { ubicacion };
}

async function crear(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { ubicacion, error: fallaSolicitante } = await solicitante(req);
  if (fallaSolicitante) return next(fallaSolicitante);

  const { filas, insumos, error } = await prepararRenglones(establecimientoId, req.body.renglones);
  if (error) return next(error);

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
  const establecimientoId = req.usuario.establecimientoId;
  if ((req.body.direccion === 'superior') !== (r.direccion === 'superior')) {
    return next({ status: 409, codigo: 'otra_direccion', mensaje: 'No se cambia a quién se pide: anule esta y registre otra' });
  }
  const { ubicacion, error: fallaSolicitante } = await solicitante(req);
  if (fallaSolicitante) return next(fallaSolicitante);
  const { filas, insumos, error } = await prepararRenglones(establecimientoId, req.body.renglones);
  if (error) return next(error);

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
  const indicadas = new Map((req.body.renglones ?? []).map((g) => [g.id, g.cantidadAutorizada]));
  await prisma.$transaction([
    ...r.renglones.map((g) => prisma.requisicionRenglon.update({
      where: { id: g.id },
      data: { cantidadAutorizada: indicadas.get(g.id) ?? g.cantidadSolicitada },
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
  const porId = new Map(r.renglones.map((g) => [g.id, g]));
  const entradas = req.body.renglones ?? [];
  const vistos = new Set();
  for (const e of entradas) {
    const g = porId.get(e.id);
    if (!g) return next({ status: 404, codigo: 'renglon_no_encontrado', mensaje: 'Uno de los renglones no es de esta requisición' });
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

async function anular(req, res, next) {
  const r = await cargar(req);
  if (!r || !permitida(req, r.ubicacion)) return next(NO_ENCONTRADA);
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

module.exports = { listar, obtener, crear, actualizar, autorizar, despachar, recibir, anular, existencias, ALMACEN_SUPERIOR };
