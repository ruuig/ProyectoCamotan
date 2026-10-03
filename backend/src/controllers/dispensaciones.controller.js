const prisma = require('../config/db');
const { descontarDeLote } = require('../services/movimientos.service');
const { saldoUtilizable, limitesDePeriodo } = require('../services/abastecimiento.service');
const { renglonesSigsa4 } = require('../services/sigsa4.service');
const {
  seleccionarLoteFEFO,
  planFraccionamiento,
  esLoteFEFO,
  lotesDisponibles,
  existenciaTotal,
} = require('../services/inventario.service');

// Cuanto queda por entregar de una prescripcion.
function pendienteDe(prescripcion) {
  const entregado = prescripcion.dispensaciones
    .filter((d) => !d.anulada)
    .reduce((suma, d) => suma + d.cantidad, 0);
  return prescripcion.cantidad - entregado;
}

async function crear(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { prescripcionId, cantidad, loteId, motivo } = req.body;
  const ahora = new Date();

  const prescripcion = await prisma.prescripcion.findFirst({
    where: { id: prescripcionId, atencion: { establecimientoId } },
    include: {
      dispensaciones: true,
      insumo: { include: { lotes: { orderBy: { fechaVence: 'asc' } } } },
      atencion: { select: { id: true, pacienteId: true } },
    },
  });

  if (!prescripcion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Prescripción no encontrada' });
  }

  const pendiente = pendienteDe(prescripcion);

  if (pendiente <= 0) {
    return next({
      status: 409,
      codigo: 'ya_entregada',
      mensaje: 'Esta prescripción ya fue entregada por completo',
    });
  }

  if (cantidad > pendiente) {
    return next({
      status: 400,
      codigo: 'cantidad_excede',
      mensaje: `Solo quedan ${pendiente} por entregar de esta prescripción`,
    });
  }

  const lotes = prescripcion.insumo.lotes;
  const disponible = saldoUtilizable(lotes, ahora);

  /*
   * Demanda no atendida.
   *
   * Si no alcanza, se entrega lo que hay y lo que falta se registra. Son las
   * dos cosas a la vez: al paciente no se le manda con las manos vacias
   * habiendo existencia, y el faltante queda contado.
   *
   * Este es el dato que hace que el sistema pida bien. Contando solo lo
   * entregado, un insumo que se agoto el dia 3 aparece con consumo bajo y el
   * mes siguiente se vuelve a pedir de menos. Contando lo que no se pudo
   * entregar, sube en la lista.
   */
  let noAtendido = 0;
  let aEntregar = cantidad;

  if (disponible < cantidad) {
    noAtendido = cantidad - disponible;
    aEntregar = disponible;

    await prisma.demandaNoAtendida.create({
      data: {
        establecimientoId,
        insumoId: prescripcion.insumoId,
        prescripcionId: prescripcion.id,
        pacienteId: prescripcion.atencion.pacienteId,
        cantidad: noAtendido,
        registradaPor: req.usuario.id,
      },
    });

    await req.bitacora({
      accion: 'crear',
      entidad: 'demanda_no_atendida',
      entidadId: prescripcion.insumoId,
      detalle: `${prescripcion.insumo.nombreGenerico}: faltaron ${noAtendido} para completar la receta`,
    });

    // Sin nada en existencia no hay entrega que registrar, pero el faltante
    // ya quedo contado arriba.
    if (disponible === 0) {
      return next({
        status: 409,
        codigo: 'existencia_insuficiente',
        mensaje: `No hay existencia de ${prescripcion.insumo.nombreGenerico}. Quedó registrada la demanda no atendida de ${noAtendido}`,
        detalles: { disponible: 0, solicitado: cantidad, noAtendido },
      });
    }
  }

  // --- Que lotes se usan ---------------------------------------------------
  let reparto;
  let avisoFefo = null;

  if (loteId) {
    const elegido = lotesDisponibles(lotes, ahora).find((l) => l.id === loteId);

    if (!elegido) {
      return next({
        status: 400,
        codigo: 'lote_invalido',
        mensaje: 'El lote indicado no existe, esta vencido o no tiene existencia',
      });
    }

    if (elegido.cantidadActual < aEntregar) {
      return next({
        status: 409,
        codigo: 'existencia_insuficiente',
        mensaje: `El lote ${elegido.numeroLote} solo tiene ${elegido.cantidadActual}`,
      });
    }

    // Si no es el de vencimiento mas proximo, se exige motivo por escrito.
    if (!esLoteFEFO(loteId, lotes, aEntregar, ahora)) {
      if (!motivo) {
        const propuesta = seleccionarLoteFEFO(lotes, aEntregar, ahora);
        const sugerido = propuesta.requiereFraccionamiento
          ? propuesta.lotes[0]
          : propuesta.lote;

        return next({
          status: 400,
          codigo: 'motivo_requerido',
          mensaje: 'Este no es el lote de vencimiento más próximo. Indique motivo',
          detalles: {
            loteSugerido: sugerido && {
              id: sugerido.id,
              numeroLote: sugerido.numeroLote,
              fechaVence: sugerido.fechaVence,
            },
          },
        });
      }
      avisoFefo = `Se dispenso un lote distinto al de vencimiento más próximo. Motivo: ${motivo}`;
    }

    reparto = [{ loteId, cantidad: aEntregar }];
  } else {
    // Sin lote indicado, el sistema reparte por PEPE.
    reparto = planFraccionamiento(lotes, aEntregar, ahora);

    if (!reparto) {
      return next({
        status: 409,
        codigo: 'existencia_insuficiente',
        mensaje: 'No hay existencia vigente suficiente',
      });
    }
  }

  // --- Escritura -----------------------------------------------------------
  const resultado = await prisma.$transaction(async (tx) => {
    const dispensacion = await tx.dispensacion.create({
      data: {
        prescripcionId,
        cantidad: aEntregar,
        parcial: aEntregar < pendiente,
        usuarioId: req.usuario.id,
      },
    });

    const movimientos = [];
    for (const parte of reparto) {
      const lote = await descontarDeLote(tx, {
        loteId: parte.loteId,
        cantidad: parte.cantidad,
        usuarioId: req.usuario.id,
        dispensacionId: dispensacion.id,
        motivo: motivo ?? null,
      });
      movimientos.push({
        loteId: lote.id,
        numeroLote: lote.numeroLote,
        cantidad: parte.cantidad,
        saldoResultante: lote.cantidadActual,
      });
    }

    return { dispensacion, movimientos };
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'dispensacion',
    entidadId: resultado.dispensacion.id,
    detalle: `${prescripcion.insumo.nombreGenerico} x${aEntregar}${noAtendido > 0 ? `, ${noAtendido} sin entregar por falta de existencia` : ''}${motivo ? `. Motivo: ${motivo}` : ''}`,
  });

  const quedaPendiente = pendiente - aEntregar;

  res.status(201).json({
    dispensacion: resultado.dispensacion,
    movimientos: resultado.movimientos,
    fraccionada: resultado.movimientos.length > 1,
    entregado: aEntregar,
    noAtendido,
    pendiente: quedaPendiente,
    avisoFefo,
    aviso:
      noAtendido > 0
        ? `Solo había ${aEntregar} de ${cantidad}. Se entregó lo disponible y quedaron ${noAtendido} registrados como demanda no atendida.`
        : null,
  });
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

    // Se devuelve lo entregado a su lote, con movimiento propio: la anulacion
    // no borra nada, deja rastro.
    for (const movimiento of dispensacion.movimientos) {
      const devolver = Math.abs(movimiento.cantidad);
      const lote = await tx.lote.update({
        where: { id: movimiento.loteId },
        data: { cantidadActual: { increment: devolver } },
      });

      await tx.movimientoInsumo.create({
        data: {
          loteId: movimiento.loteId,
          tipo: 'ajuste',
          cantidad: devolver,
          saldoResultante: lote.cantidadActual,
          dispensacionId: dispensacion.id,
          usuarioId: req.usuario.id,
          motivo: `Anulación de dispensación ${dispensacion.id}`,
        },
      });
    }
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'dispensacion',
    entidadId: dispensacion.id,
    detalle: 'Dispensación anulada, existencia devuelta al lote',
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
    encabezado: {
      areaSalud: establecimiento.departamento,
      distrito: establecimiento.municipio,
      municipio: establecimiento.municipio,
      servicio: establecimiento.nombre,
    },
    renglones: renglonesSigsa4(prescripciones),
  });
}

module.exports = { crear, pendientes, anular, pendienteDe, porFirmar, registrarConstancia, imagenConstancia, sigsa4 };
