const prisma = require('../config/db');
const { calcularEdad } = require('../services/pacientes.service');
const { estructuraIdentificacion } = require('../services/fichaIdentificacion.service');
const { seccionesDe } = require('../services/fichaSecciones.service');
const { borradorReferencia, numeroReferencia } = require('../services/referencia.service');

/**
 * Boleta de Referencia y Contrarreferencia del MSPAS: una por atencion.
 * El numero correlativo se asigna al guardarla por primera vez y no cambia.
 */

function edadTexto(fechaNacimiento, fecha) {
  if (!fechaNacimiento) return '';
  const e = calcularEdad(fechaNacimiento, fecha);
  if (e.anios >= 1) return `${e.anios} ${e.anios === 1 ? 'año' : 'años'}`;
  if (e.meses >= 1) return `${e.meses} ${e.meses === 1 ? 'mes' : 'meses'}`;
  return `${e.dias} ${e.dias === 1 ? 'día' : 'días'}`;
}

async function cargarAtencion(req) {
  return prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    include: {
      paciente: true,
      preconsulta: true,
      diagnosticos: true,
      prescripciones: { include: { insumo: true } },
      recetasExternas: true,
      referencia: { include: { usuario: { select: { nombre: true } }, usuarioContra: { select: { nombre: true } } } },
    },
  });
}

const NO_ENCONTRADA = { status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' };

/** GET /atenciones/:id/referencia: lo guardado y el borrador para llenarla. */
async function obtener(req, res, next) {
  const atencion = await cargarAtencion(req);
  if (!atencion) return next(NO_ENCONTRADA);
  const { paciente, referencia } = atencion;

  const secciones = await prisma.seccionPaciente.findMany({ where: { pacienteId: paciente.id } });
  const ficha = estructuraIdentificacion(paciente.fechaNacimiento).ficha;
  const perfil = { sexo: paciente.sexo, edadMeses: calcularEdad(paciente.fechaNacimiento).edadMeses };
  const borrador = borradorReferencia({ atencion, paciente, secciones, seccionesDef: seccionesDe(ficha.clave, perfil) });

  const establecimiento = await prisma.establecimiento.findUnique({ where: { id: req.usuario.establecimientoId } });

  await req.bitacora({ accion: 'leer', entidad: 'referencia', entidadId: referencia?.id ?? null, detalle: `Atención ${atencion.id}` });

  res.json({
    atencion: {
      id: atencion.id,
      estado: atencion.estado,
      registradaEn: atencion.registradaEn,
      referenciaFue: atencion.referenciaFue,
    },
    paciente: {
      id: paciente.id,
      nombres: paciente.nombres,
      apellidos: paciente.apellidos,
      sexo: paciente.sexo,
      expediente: paciente.expedientePapel || paciente.expediente,
      edad: edadTexto(paciente.fechaNacimiento, referencia?.creadaEn ?? new Date()),
      residencia: [paciente.comunidad, paciente.municipioResidencia].filter(Boolean).join(', '),
    },
    establecimiento,
    referencia: referencia ? { ...referencia, numero: numeroReferencia(referencia) } : null,
    borrador,
  });
}

const CAMPOS = ['tipo', 'servicioDestino', 'telefono', 'horaTraslado', 'historia', 'antecedentes', 'examenFisico', 'examenes', 'impresionClinica', 'motivo', 'tratamiento'];

/**
 * PUT /atenciones/:id/referencia. La primera vez asigna el correlativo del
 * anio (el mayor + 1); si dos se guardan al mismo tiempo, el indice unico
 * lo impide y se reintenta con el siguiente.
 */
async function guardar(req, res, next) {
  const atencion = await cargarAtencion(req);
  if (!atencion) return next(NO_ENCONTRADA);
  if (atencion.estado === 'cancelada') {
    return next({ status: 409, codigo: 'atencion_cancelada', mensaje: 'La atención está cancelada' });
  }
  const datos = Object.fromEntries(CAMPOS.filter((c) => c in req.body).map((c) => [c, req.body[c] === '' ? null : req.body[c]]));

  if (atencion.referencia) {
    const r = await prisma.referencia.update({
      where: { id: atencion.referencia.id },
      data: { ...datos, actualizadaEn: new Date() },
    });
    await req.bitacora({ accion: 'actualizar', entidad: 'referencia', entidadId: r.id, detalle: `Boleta ${numeroReferencia(r)}` });
    return res.json({ referencia: { ...r, numero: numeroReferencia(r) } });
  }

  const establecimientoId = req.usuario.establecimientoId;
  const anio = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' }).slice(0, 4));
  let creada = null;
  for (let intento = 0; intento < 5 && !creada; intento += 1) {
    const max = await prisma.referencia.aggregate({ where: { establecimientoId, anio }, _max: { correlativo: true } });
    try {
      creada = await prisma.referencia.create({
        data: {
          ...datos,
          atencionId: atencion.id,
          establecimientoId,
          anio,
          correlativo: (max._max.correlativo ?? 0) + 1,
          creadaPor: req.usuario.id,
        },
      });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
      // Otra boleta tomo el numero, o la de esta atencion se guardo en paralelo.
      if (await prisma.referencia.findUnique({ where: { atencionId: atencion.id } })) {
        return next({ status: 409, codigo: 'referencia_existente', mensaje: 'La boleta ya se guardó; recargue la página' });
      }
    }
  }
  if (!creada) return next({ status: 503, codigo: 'correlativo_ocupado', mensaje: 'No se pudo asignar el número; intente de nuevo' });

  await req.bitacora({ accion: 'crear', entidad: 'referencia', entidadId: creada.id, detalle: `Boleta ${numeroReferencia(creada)} a ${creada.servicioDestino}` });
  res.status(201).json({ referencia: { ...creada, numero: numeroReferencia(creada) } });
}

/** PUT /atenciones/:id/contrarreferencia: lo que trae el paciente de regreso. */
async function guardarContrarreferencia(req, res, next) {
  const atencion = await cargarAtencion(req);
  if (!atencion) return next(NO_ENCONTRADA);
  if (!atencion.referencia) {
    return next({ status: 409, codigo: 'sin_referencia', mensaje: 'Primero se guarda la boleta de referencia' });
  }
  const b = req.body;
  const r = await prisma.referencia.update({
    where: { id: atencion.referencia.id },
    data: {
      contraRecibidaEn: atencion.referencia.contraRecibidaEn ?? new Date(),
      contraServicio: b.servicio || null,
      contraResumen: b.resumen || null,
      contraTratamiento: b.tratamiento || null,
      contraDiagnostico: b.diagnostico || null,
      contraRecomendaciones: b.recomendaciones || null,
      contraResponsable: b.responsable || null,
      contraFechaAlta: b.fechaAlta ? new Date(`${b.fechaAlta}T00:00:00Z`) : null,
      contraRegistradaPor: req.usuario.id,
    },
  });
  await req.bitacora({ accion: 'actualizar', entidad: 'referencia', entidadId: r.id, detalle: `Contrarreferencia de la boleta ${numeroReferencia(r)}` });
  res.json({ referencia: { ...r, numero: numeroReferencia(r) } });
}

module.exports = { obtener, guardar, guardarContrarreferencia, edadTexto };
