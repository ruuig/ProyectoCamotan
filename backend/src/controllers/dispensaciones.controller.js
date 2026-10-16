const { encabezadoEstablecimiento } = require('../services/encabezado.service');
const prisma = require('../config/db');
const { descontarDeLote, devolverEntrega } = require('../services/movimientos.service');
const { limitesDePeriodo } = require('../services/abastecimiento.service');
const { renglonesSigsa4 } = require('../services/sigsa4.service');
const { enUbicacion, existenciaTotal } = require('../services/inventario.service');
const { planEntrega, pendienteDe } = require('../services/dispensacion.service');
const { calcularEdad } = require('../services/pacientes.service');

/**
 * Farmacia (post-consulta): entrega a cada paciente lo que recetó el médico,
 * desde la existencia de la farmacia, y deja cada entrega ligada a su lote.
 * Eso es lo que permite responder, ante un retiro sanitario, a quién se le
 * dio cada lote.
 */

const INCLUIR_RECETA = {
  dispensaciones: true,
  demandaNoAtendida: { select: { cantidad: true } },
  insumo: { include: { lotes: { orderBy: { fechaVence: 'asc' } } } },
  atencion: { select: { id: true, pacienteId: true } },
};

/**
 * Registra lo que se entrega de una receta: demanda no atendida si falta,
 * la dispensacion y un movimiento de farmacia por cada lote. Todo en la
 * transaccion que recibe.
 */
async function registrarEntrega(tx, { prescripcion, plan, usuarioId, motivo, establecimientoId }) {
  if (plan.noAtendido > 0) {
    await tx.demandaNoAtendida.create({
      data: {
        establecimientoId,
        insumoId: prescripcion.insumoId,
        prescripcionId: prescripcion.id,
        pacienteId: prescripcion.atencion.pacienteId,
        cantidad: plan.noAtendido,
        registradaPor: usuarioId,
      },
    });
  }
  if (plan.aEntregar === 0) return { dispensacion: null, movimientos: [] };

  const dispensacion = await tx.dispensacion.create({
    data: {
      prescripcionId: prescripcion.id,
      cantidad: plan.aEntregar,
      parcial: plan.aEntregar < pendienteDe(prescripcion),
      usuarioId,
    },
  });
  const movimientos = [];
  for (const parte of plan.reparto) {
    const lote = await descontarDeLote(tx, {
      loteId: parte.loteId,
      cantidad: parte.cantidad,
      usuarioId,
      ubicacion: 'farmacia',
      dispensacionId: dispensacion.id,
      motivo: motivo ?? null,
    });
    movimientos.push({
      loteId: lote.id,
      numeroLote: lote.numeroLote,
      fechaVence: lote.fechaVence,
      cantidad: parte.cantidad,
      saldoResultante: lote.cantidadFarmacia,
    });
  }
  return { dispensacion, movimientos };
}

/** Lo que hay de un insumo en la bodega, para decirle a farmacia que lo pida. */
const enBodega = (lotes, ahora) => existenciaTotal(enUbicacion(lotes, 'bodega'), ahora);

async function crear(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { prescripcionId, cantidad, loteId, motivo } = req.body;
  const ahora = new Date();

  const prescripcion = await prisma.prescripcion.findFirst({
    where: { id: prescripcionId, atencion: { establecimientoId } },
    include: INCLUIR_RECETA,
  });
  if (!prescripcion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Prescripción no encontrada' });
  }

  const lotes = prescripcion.insumo.lotes;
  const plan = planEntrega({
    lotes: enUbicacion(lotes, 'farmacia'), cantidad, pendiente: pendienteDe(prescripcion), loteId, motivo, ahora,
  });
  if (plan.error) return next(plan.error);

  const resultado = await prisma.$transaction((tx) => registrarEntrega(tx, {
    prescripcion, plan, usuarioId: req.usuario.id, motivo, establecimientoId,
  }));

  const nombre = prescripcion.insumo.nombreGenerico;
  if (plan.noAtendido > 0) {
    await req.bitacora({
      accion: 'crear',
      entidad: 'demanda_no_atendida',
      entidadId: prescripcion.insumoId,
      detalle: `${nombre}: faltaron ${plan.noAtendido} en farmacia para completar la receta`,
    });
  }

  // Sin nada en farmacia no hay entrega, pero el faltante ya quedo contado.
  if (!resultado.dispensacion) {
    const bodega = enBodega(lotes, ahora);
    return next({
      status: 409,
      codigo: 'existencia_insuficiente',
      mensaje: `No hay existencia de ${nombre} en farmacia. Quedó registrada la demanda no atendida de ${plan.noAtendido}${bodega ? `. En bodega hay ${bodega}: pídalo a bodega` : ''}`,
      detalles: { disponible: 0, solicitado: cantidad, noAtendido: plan.noAtendido, enBodega: bodega },
    });
  }

  await req.bitacora({
    accion: 'crear',
    entidad: 'dispensacion',
    entidadId: resultado.dispensacion.id,
    detalle: `${nombre} x${plan.aEntregar}${plan.noAtendido > 0 ? `, ${plan.noAtendido} sin entregar por falta de existencia` : ''}${motivo ? `. Motivo: ${motivo}` : ''}`,
  });

  res.status(201).json({
    dispensacion: resultado.dispensacion,
    movimientos: resultado.movimientos,
    fraccionada: resultado.movimientos.length > 1,
    entregado: plan.aEntregar,
    noAtendido: plan.noAtendido,
    pendiente: pendienteDe(prescripcion) - plan.aEntregar,
    avisoFefo: plan.avisoFefo,
    aviso: plan.noAtendido > 0
      ? `Solo había ${plan.aEntregar} de ${cantidad} en farmacia. Se entregó lo disponible y quedaron ${plan.noAtendido} registrados como demanda no atendida.`
      : null,
  });
}

// --- Entrega por paciente --------------------------------------------------------

// Lo que se aplica en el centro en vez de llevarse: inyectables, implantes, DIU.
const SE_APLICA = /ampolla|\bamp\b|vial|inyect|jeringa|implante|dispositivo intrauterino|\bdiu\b/i;

const INCLUIR_ATENCION = {
  paciente: true,
  medico: { select: { nombre: true, cargo: true } },
  diagnosticos: { orderBy: { orden: 'asc' } },
  recetasExternas: { orderBy: { creadaEn: 'asc' } },
  prescripciones: { include: INCLUIR_RECETA, orderBy: { creadaEn: 'asc' } },
};

/** Pacientes que esperan en farmacia: atenciones con algo por entregar. */
async function porAtender(req, res) {
  const atenciones = await prisma.atencion.findMany({
    // Una receta de hace más de 7 días ya no se espera: queda como no recogida.
    where: { establecimientoId: req.usuario.establecimientoId, prescripciones: { some: {} }, registradaEn: { gte: new Date(Date.now() - 7 * 86400000) } },
    orderBy: { registradaEn: 'desc' },
    take: 150,
    include: {
      paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true, expedientePapel: true } },
      medico: { select: { nombre: true } },
      prescripciones: { include: { dispensaciones: true, demandaNoAtendida: { select: { cantidad: true } }, insumo: { select: { nombreGenerico: true } } } },
    },
  });
  const lista = atenciones
    .map((a) => ({
      atencionId: a.id,
      registradaEn: a.registradaEn,
      paciente: { ...a.paciente, nombreCompleto: `${a.paciente.apellidos}, ${a.paciente.nombres}` },
      medico: a.medico?.nombre ?? null,
      medicamentos: a.prescripciones.filter((p) => pendienteDe(p) > 0).map((p) => p.insumo.nombreGenerico),
    }))
    .filter((a) => a.medicamentos.length)
    // El que espera desde antes va primero.
    .reverse();
  res.json({ porAtender: lista });
}

/**
 * La hoja de entrega de un paciente: todo lo que farmacia copia al formato
 * en papel, con los lotes que el sistema propone (el que vence primero) desde
 * la existencia de la farmacia.
 */
async function hojaDeEntrega(req, res, next) {
  const ahora = new Date();
  const atencion = await prisma.atencion.findFirst({
    where: { id: Number(req.params.id), establecimientoId: req.usuario.establecimientoId },
    include: {
      ...INCLUIR_ATENCION,
      // Lo ya entregado, lote por lote, para leer la entrega despues.
      prescripciones: {
        orderBy: { creadaEn: 'asc' },
        include: {
          ...INCLUIR_RECETA,
          dispensaciones: {
            include: {
              usuario: { select: { nombre: true } },
              movimientos: { include: { lote: { select: { numeroLote: true, fechaVence: true } } } },
            },
          },
        },
      },
    },
  });
  if (!atencion) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });

  const p = atencion.paciente;
  const edad = calcularEdad(p.fechaNacimiento, ahora);
  const renglones = atencion.prescripciones.map((r) => {
    const pendiente = pendienteDe(r);
    const lotesFarmacia = enUbicacion(r.insumo.lotes, 'farmacia');
    const plan = pendiente > 0 ? planEntrega({ lotes: lotesFarmacia, cantidad: pendiente, pendiente, ahora }) : null;
    return {
      prescripcionId: r.id,
      insumoId: r.insumoId,
      medicamento: r.insumo.nombreGenerico,
      presentacion: r.insumo.presentacion,
      unidad: r.insumo.unidadEntrega,
      recetado: r.cantidad,
      yaEntregado: r.cantidad - pendiente,
      pendiente,
      indicaciones: r.indicaciones,
      // Se pone en el centro (inyección, implante, DIU): se marca como aplicado.
      aplicable: SE_APLICA.test(`${r.insumo.nombreGenerico} ${r.insumo.presentacion ?? ''} ${r.insumo.formaFarmaceutica ?? ''}`),
      aplicada: r.dispensaciones.some((d) => !d.anulada && d.aplicadaEnServicio),
      enFarmacia: existenciaTotal(lotesFarmacia, ahora),
      enBodega: enBodega(r.insumo.lotes, ahora),
      aEntregar: plan?.aEntregar ?? 0,
      noAlcanza: plan?.noAtendido ?? 0,
      lotes: plan?.reparto ?? [],
      // Lo que de verdad se llevó, sin contar lo que quedó como "no había".
      entregado: r.dispensaciones.filter((d) => !d.anulada).reduce((t, d) => t + d.cantidad, 0),
      noHabia: r.demandaNoAtendida.reduce((t, d) => t + d.cantidad, 0),
      entregas: r.dispensaciones.filter((d) => !d.anulada).flatMap((d) => d.movimientos.map((m) => ({
        numeroLote: m.lote.numeroLote,
        fechaVence: m.lote.fechaVence,
        cantidad: Math.abs(m.cantidad),
        registradaEn: d.registradaEn,
        usuario: d.usuario.nombre,
      }))),
    };
  });

  await req.bitacora({ accion: 'leer', entidad: 'paciente', entidadId: p.id, detalle: `Hoja de entrega de la atención ${atencion.id}` });
  res.json({
    atencionId: atencion.id,
    fecha: atencion.registradaEn,
    paciente: {
      id: p.id,
      nombreCompleto: `${p.nombres} ${p.apellidos}`,
      expediente: p.expediente,
      expedientePapel: p.expedientePapel,
      cui: p.cui,
      sexo: p.sexo,
      edad,
      comunidad: p.comunidad,
      responsableNombre: p.responsableNombre,
    },
    medico: atencion.medico,
    diagnosticos: atencion.diagnosticos.map((d) => ({ descripcion: d.descripcion, cie: d.cie })),
    diagnosticoCie: atencion.diagnosticoCie,
    proximaCita: atencion.proximaCita,
    orientadoEn: atencion.orientadoEn,
    renglones,
    recetasExternas: atencion.recetasExternas.map((x) => ({ medicamento: x.medicamento, cantidad: x.cantidad, indicaciones: x.indicaciones })),
  });
}

/**
 * Termina la dispensacion de un paciente: registra de una vez lo que se
 * entrega de cada receta (por defecto, todo lo pendiente) desde la farmacia.
 * Es una sola transaccion: o queda toda la entrega, o nada.
 */
async function dispensarAtencion(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const ahora = new Date();
  const atencion = await prisma.atencion.findFirst({
    where: { id: Number(req.params.id), establecimientoId },
    include: { prescripciones: { include: INCLUIR_RECETA }, paciente: { select: { id: true, nombres: true, apellidos: true } } },
  });
  if (!atencion) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });

  const pedidas = new Map((req.body.renglones ?? []).map((r) => [r.prescripcionId, r]));
  const planes = [];
  for (const p of atencion.prescripciones) {
    const pendiente = pendienteDe(p);
    if (pendiente <= 0) continue;
    const pedido = pedidas.get(p.id);
    // Lo que no se manda se entrega completo; con cantidad 0 se deja pendiente.
    const cantidad = pedido ? pedido.cantidad : pendiente;
    if (cantidad === 0) continue;
    const plan = planEntrega({ lotes: enUbicacion(p.insumo.lotes, 'farmacia'), cantidad, pendiente, ahora });
    if (plan.error) return next({ ...plan.error, mensaje: `${p.insumo.nombreGenerico}: ${plan.error.mensaje}` });
    planes.push({ prescripcion: p, plan });
  }
  if (!planes.length) {
    return next({ status: 409, codigo: 'sin_pendientes', mensaje: 'Este paciente no tiene medicamentos por entregar' });
  }

  const resultados = await prisma.$transaction(async (tx) => {
    const salida = [];
    for (const { prescripcion, plan } of planes) {
      const r = await registrarEntrega(tx, { prescripcion, plan, usuarioId: req.usuario.id, establecimientoId });
      salida.push({
        prescripcionId: prescripcion.id,
        medicamento: prescripcion.insumo.nombreGenerico,
        entregado: plan.aEntregar,
        noEntregado: plan.noAtendido,
        dispensacionId: r.dispensacion?.id ?? null,
        lotes: r.movimientos,
      });
    }
    return salida;
  }, { timeout: 30000 });

  // Lo que se puso aquí (inyección, método de planificación) y la orientación.
  const aplicadas = resultados
    .filter((r) => r.dispensacionId && pedidas.get(r.prescripcionId)?.aplicada)
    .map((r) => r.dispensacionId);
  if (aplicadas.length) {
    await prisma.dispensacion.updateMany({ where: { id: { in: aplicadas } }, data: { aplicadaEnServicio: true } });
  }
  if (req.body.orientado) {
    await prisma.atencion.update({ where: { id: atencion.id }, data: { orientadoEn: new Date() } });
  }

  const entregados = resultados.filter((r) => r.entregado > 0);
  const faltaron = resultados.filter((r) => r.noEntregado > 0);
  await req.bitacora({
    accion: 'crear',
    entidad: 'dispensacion',
    entidadId: atencion.id,
    detalle: `Entrega a ${atencion.paciente.apellidos}, ${atencion.paciente.nombres} (atención ${atencion.id}): `
      + `${entregados.map((r) => `${r.medicamento} x${r.entregado}`).join(', ') || 'nada'}`
      + `${faltaron.length ? `. Sin existencia en farmacia: ${faltaron.map((r) => `${r.medicamento} x${r.noEntregado}`).join(', ')}` : ''}`,
  });
  res.status(201).json({ atencionId: atencion.id, renglones: resultados });
}

// Prescripciones pendientes de entrega, que es lo que farmacia necesita ver.
async function pendientes(req, res) {
  const establecimientoId = req.usuario.establecimientoId;

  const prescripciones = await prisma.prescripcion.findMany({
    where: { atencion: { establecimientoId } },
    orderBy: { creadaEn: 'desc' },
    take: 100,
    include: {
      dispensaciones: true,
      demandaNoAtendida: { select: { cantidad: true } },
      insumo: { select: { id: true, nombreGenerico: true, presentacion: true, unidadMedida: true } },
      atencion: {
        select: {
          id: true,
          registradaEn: true,
          paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true } },
        },
      },
    },
  });

  const conPendiente = prescripciones
    .map((p) => ({ prescripcion: p, pendiente: pendienteDe(p) }))
    .filter((p) => p.pendiente > 0);

  res.json({
    pendientes: conPendiente.map(({ prescripcion, pendiente }) => ({
      id: prescripcion.id,
      atencionId: prescripcion.atencion.id,
      cantidad: prescripcion.cantidad,
      pendiente,
      indicaciones: prescripcion.indicaciones,
      creadaEn: prescripcion.creadaEn,
      insumo: prescripcion.insumo,
      paciente: {
        id: prescripcion.atencion.paciente.id,
        expediente: prescripcion.atencion.paciente.expediente,
        nombreCompleto: `${prescripcion.atencion.paciente.apellidos}, ${prescripcion.atencion.paciente.nombres}`,
      },
    })),
  });
}

async function anular(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  const dispensacion = await prisma.dispensacion.findFirst({
    where: { id: req.params.id, prescripcion: { atencion: { establecimientoId } } },
    include: { movimientos: true },
  });

  if (!dispensacion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Dispensación no encontrada' });
  }

  if (dispensacion.anulada) {
    return next({ status: 409, codigo: 'ya_anulada', mensaje: 'Esta dispensación ya fue anulada' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.dispensacion.update({ where: { id: dispensacion.id }, data: { anulada: true } });

    // Se devuelve lo entregado a su lote y a la farmacia, con movimiento
    // propio: la anulacion no borra nada, deja rastro.
    for (const movimiento of dispensacion.movimientos.filter((m) => m.cantidad < 0)) {
      await devolverEntrega(tx, {
        movimiento,
        usuarioId: req.usuario.id,
        dispensacionId: dispensacion.id,
        motivo: `Anulación de dispensación ${dispensacion.id}`,
      });
    }
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'dispensacion',
    entidadId: dispensacion.id,
    detalle: 'Dispensación anulada, existencia devuelta al lote en farmacia',
  });

  res.json({ mensaje: 'Dispensación anulada y existencia devuelta' });
}

// --- Constancia de entrega y SIGSA-4 ------------------------------------------

const DIAS_POR_FIRMAR = 3;

/**
 * Pacientes a quienes ya se les entrego y falta su firma o huella: la
 * ultima entrega es posterior a la ultima constancia de esa atencion.
 */
async function porFirmar(req, res) {
  const desde = new Date(Date.now() - DIAS_POR_FIRMAR * 86400000);
  const atenciones = await prisma.atencion.findMany({
    where: {
      establecimientoId: req.usuario.establecimientoId,
      prescripciones: { some: { dispensaciones: { some: { anulada: false, registradaEn: { gte: desde } } } } },
    },
    include: {
      paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true, expedientePapel: true, responsableNombre: true } },
      constancias: { select: { registradaEn: true }, orderBy: { registradaEn: 'desc' }, take: 1 },
      prescripciones: {
        include: {
          insumo: { select: { nombreGenerico: true } },
          dispensaciones: { where: { anulada: false }, select: { cantidad: true, registradaEn: true } },
        },
      },
    },
  });
  const lista = atenciones.map((a) => {
    const entregas = a.prescripciones.flatMap((p) => p.dispensaciones.map((d) => ({ ...d, insumo: p.insumo.nombreGenerico })));
    const ultimaFirma = a.constancias[0]?.registradaEn ?? null;
    const sinFirma = entregas.filter((e) => !ultimaFirma || new Date(e.registradaEn) > new Date(ultimaFirma));
    return {
      atencionId: a.id,
      paciente: a.paciente,
      entregas: sinFirma.map((e) => ({ insumo: e.insumo, cantidad: e.cantidad, registradaEn: e.registradaEn })),
    };
  }).filter((a) => a.entregas.length);
  res.json({ porFirmar: lista });
}

async function registrarConstancia(req, res, next) {
  const { atencionId, tipo, quienRecibe, nombreRecibe, imagen } = req.body;
  const atencion = await prisma.atencion.findFirst({ where: { id: atencionId, establecimientoId: req.usuario.establecimientoId } });
  if (!atencion) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  let bytes = null;
  if (tipo !== 'papel') {
    const base64 = String(imagen ?? '').replace(/^data:image\/png;base64,/, '');
    bytes = Buffer.from(base64, 'base64');
    // Un PNG empieza con 89 50 4E 47; cualquier otra cosa se rechaza.
    if (bytes.length < 45 || bytes.readUInt32BE(0) !== 0x89504e47) {
      return next({ status: 400, codigo: 'imagen_invalida', mensaje: 'La firma o huella no es una imagen válida' });
    }
  }
  const constancia = await prisma.constanciaEntrega.create({
    data: { atencionId, tipo, quienRecibe, nombreRecibe: nombreRecibe || null, imagen: bytes, registradaPor: req.usuario.id },
    select: { id: true, tipo: true, quienRecibe: true, registradaEn: true },
  });
  await req.bitacora({
    accion: 'crear',
    entidad: 'constancia_entrega',
    entidadId: constancia.id,
    detalle: `Constancia de entrega (${tipo}) de la atención ${atencionId}, recibe ${quienRecibe}${nombreRecibe ? `: ${nombreRecibe}` : ''}`,
  });
  res.status(201).json({ constancia });
}

/** Imagen de una constancia (firma o huella), para la pantalla y la hoja impresa. */
async function imagenConstancia(req, res, next) {
  const c = await prisma.constanciaEntrega.findFirst({
    where: { id: Number(req.params.id), atencion: { establecimientoId: req.usuario.establecimientoId } },
    select: { imagen: true },
  });
  if (!c?.imagen) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Sin imagen' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(c.imagen));
}

/** SIGSA-4 del mes: un renglon por medicamento entregado o no entregado. */
async function sigsa4(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const { periodo } = req.query;
  const { desde, hasta } = limitesDePeriodo(periodo);
  const prescripciones = await prisma.prescripcion.findMany({
    where: {
      atencion: { establecimientoId },
      OR: [
        { dispensaciones: { some: { anulada: false, registradaEn: { gte: desde, lt: hasta } } } },
        { demandaNoAtendida: { some: { registradaEn: { gte: desde, lt: hasta } } } },
      ],
    },
    include: {
      insumo: { select: { nombreGenerico: true, presentacion: true } },
      dispensaciones: { where: { registradaEn: { gte: desde, lt: hasta } } },
      demandaNoAtendida: { where: { registradaEn: { gte: desde, lt: hasta } } },
      atencion: {
        select: {
          id: true,
          diagnosticoCie: true,
          diagnosticoTxt: true,
          medico: { select: { nombre: true } },
          paciente: { select: { nombres: true, apellidos: true, cui: true, expediente: true, expedientePapel: true } },
          constancias: { select: { id: true, tipo: true, quienRecibe: true, nombreRecibe: true, registradaEn: true } },
        },
      },
    },
  });
  const establecimiento = await prisma.establecimiento.findUnique({ where: { id: establecimientoId } });
  await req.bitacora({ accion: 'leer', entidad: 'sigsa4', detalle: `SIGSA-4 de ${periodo}` });
  res.json({
    periodo,
    encabezado: encabezadoEstablecimiento(establecimiento),
    renglones: renglonesSigsa4(prescripciones),
  });
}


/**
 * Recetas ya atendidas en farmacia: las de un día, o las de un paciente que se
 * busca. Cada una con su estado (entregada, incompleta, no recogida) y lo que
 * salió de cada lote. Es el registro de a quién se le dio qué.
 */
async function entregas(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const buscar = (req.query.buscar ?? '').trim();
  const fecha = req.query.fecha ?? new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  const desde = new Date(Date.parse(`${fecha}T00:00:00Z`) + 6 * 3600000);
  const hasta = new Date(desde.getTime() + 86400000);
  const limiteNoRecogida = new Date(Date.now() - 7 * 86400000);

  const palabras = buscar.split(/\s+/).filter(Boolean);
  const where = {
    establecimientoId,
    prescripciones: { some: {} },
    ...(palabras.length
      ? { paciente: { AND: palabras.map((w) => ({ OR: [{ nombres: { contains: w, mode: 'insensitive' } }, { apellidos: { contains: w, mode: 'insensitive' } }, { expediente: { contains: w } }, { expedientePapel: { contains: w, mode: 'insensitive' } }] })) } }
      : {
        OR: [
          { prescripciones: { some: { dispensaciones: { some: { registradaEn: { gte: desde, lt: hasta } } } } } },
          { prescripciones: { some: { demandaNoAtendida: { some: { registradaEn: { gte: desde, lt: hasta } } } } } },
          // Las que se vencieron sin que el paciente pasara: se ven el día que vencieron.
          { registradaEn: { gte: new Date(desde.getTime() - 7 * 86400000), lt: new Date(hasta.getTime() - 7 * 86400000) } },
        ],
      }),
  };
  const atenciones = await prisma.atencion.findMany({
    where,
    orderBy: { registradaEn: 'desc' },
    take: 100,
    include: {
      paciente: { select: { id: true, nombres: true, apellidos: true, expediente: true, expedientePapel: true } },
      medico: { select: { nombre: true } },
      prescripciones: {
        include: {
          insumo: { select: { nombreGenerico: true } },
          demandaNoAtendida: { select: { cantidad: true, registradaEn: true } },
          dispensaciones: { include: { usuario: { select: { nombre: true } }, movimientos: { include: { lote: { select: { numeroLote: true, fechaVence: true } } } } } },
        },
      },
    },
  });

  const lista = atenciones.map((a) => {
    const renglones = a.prescripciones.map((p) => {
      const validas = p.dispensaciones.filter((d) => !d.anulada);
      const entregado = validas.reduce((t, d) => t + d.cantidad, 0);
      const noHabia = p.demandaNoAtendida.reduce((t, d) => t + d.cantidad, 0);
      return {
        medicamento: p.insumo.nombreGenerico,
        recetado: p.cantidad,
        entregado,
        noHabia,
        pendiente: pendienteDe(p),
        lotes: validas.flatMap((d) => d.movimientos.map((m) => ({ numeroLote: m.lote.numeroLote, fechaVence: m.lote.fechaVence, cantidad: Math.abs(m.cantidad) }))),
      };
    });
    const fechas = a.prescripciones.flatMap((p) => [...p.dispensaciones.map((d) => d.registradaEn), ...p.demandaNoAtendida.map((d) => d.registradaEn)]);
    const ultima = fechas.sort((x, y) => new Date(y) - new Date(x))[0] ?? null;
    const quien = a.prescripciones.flatMap((p) => p.dispensaciones).sort((x, y) => new Date(y.registradaEn) - new Date(x.registradaEn))[0]?.usuario?.nombre ?? null;
    const algoPendiente = renglones.some((r) => r.pendiente > 0);
    const nadaEntregado = renglones.every((r) => r.entregado === 0);
    let estado = 'entregada';
    if (algoPendiente) estado = a.registradaEn < limiteNoRecogida ? 'no_recogida' : 'por_entregar';
    else if (nadaEntregado) estado = 'no_habia';
    else if (renglones.some((r) => r.noHabia > 0)) estado = 'incompleta';
    const delDia = fechas.some((f) => f >= desde && f < hasta);
    return {
      delDia,
      atencionId: a.id,
      registradaEn: a.registradaEn,
      entregadaEn: ultima,
      entregadaPor: quien,
      estado,
      medico: a.medico?.nombre ?? null,
      paciente: { ...a.paciente, nombreCompleto: `${a.paciente.apellidos}, ${a.paciente.nombres}` },
      renglones,
    };
  });
  // Del día: lo que se atendió ese día y lo que ese día quedó como no recogido.
  const delDia = lista.filter((x) => x.delDia || x.estado === 'no_recogida');
  res.json({ fecha, entregas: (palabras.length ? lista : delDia).map(({ delDia: _, ...x }) => x) });
}

module.exports = {
  entregas,
  crear, pendientes, anular, pendienteDe, porFirmar, registrarConstancia, imagenConstancia, sigsa4,
  porAtender, hojaDeEntrega, dispensarAtencion,
};
