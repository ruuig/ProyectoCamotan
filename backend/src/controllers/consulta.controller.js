const prisma = require('../config/db');
const {
  corregir,
  corregirPreconsulta,
  registrarNota,
  historial,
} = require('../services/correccion.service');
const { alertasDeAtencion } = require('../services/alertasClinicas.service');
const { INCLUIR_PACIENTE } = require('../services/cola.service');
const { coberturaDeInsumo } = require('../services/consumo.service');
const {
  CATALOGOS_3CS,
  sugerirTipoConsulta,
  diagnosticosDe,
} = require('../services/hojaEvolucion.service');
const { semanasDeGestacion } = require('../services/embarazo.service');
const { resumenAntecedentes } = require('../services/resumenFicha.service');
const { sitiosExamen } = require('../services/fichaClinica.service');

/** Diagnosticos de consultas cerradas del paciente, para sugerir el tipo. */
async function diagnosticosPrevios(pacienteId, excluirId) {
  const filas = await prisma.diagnosticoAtencion.findMany({
    where: { atencion: { pacienteId, estado: 'atendido', NOT: { id: excluirId } } },
    select: { cie: true, descripcion: true, atencion: { select: { registradaEn: true } } },
  });
  return filas.map((f) => ({ cie: f.cie, descripcion: f.descripcion, fecha: f.atencion.registradaEn }));
}

async function buscarAtencion(req) {
  return prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    include: {
      ...INCLUIR_PACIENTE,
      prescripciones: { include: { insumo: true } },
      diagnosticos: { orderBy: { orden: 'asc' } },
    },
  });
}

// Lo que el medico necesita ver antes de escribir el diagnostico.
async function obtener(req, res, next) {
  const atencion = await buscarAtencion(req);
  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  const [{ alertas }, historial, antropometria] = await Promise.all([
    alertasDeAtencion(atencion),
    prisma.atencion.findMany({
      where: { pacienteId: atencion.pacienteId, estado: 'atendido', NOT: { id: atencion.id } },
      orderBy: { registradaEn: 'desc' },
      take: 10,
      select: {
        id: true,
        registradaEn: true,
        motivoConsulta: true,
        diagnosticoCie: true,
        diagnosticoTxt: true,
        tratamiento: true,
      },
    }),
    prisma.antropometria.findFirst({
      where: { pacienteId: atencion.pacienteId },
      orderBy: { fecha: 'desc' },
    }),
  ]);

  // Si falta algo de la ficha, el medico es quien tiene al paciente enfrente
  // para preguntarlo. Enterarse despues no sirve de nada.
  const { evaluarFicha } = require('../services/ficha.service');
  const pacienteCompleto = await prisma.paciente.findUnique({
    where: { id: atencion.pacienteId },
  });
  const ficha = evaluarFicha(pacienteCompleto);

  // Resumen de antecedentes: el medico lo ve en la consulta, aunque llenarlos
  // no es parte de su flujo.
  const [secciones, previos, embarazo] = await Promise.all([
    prisma.seccionPaciente.findMany({ where: { pacienteId: atencion.pacienteId } }),
    diagnosticosPrevios(atencion.pacienteId, atencion.id),
    prisma.episodioEmbarazo.findFirst({ where: { pacienteId: atencion.pacienteId, estado: 'activo' } }),
  ]);
  const antecedentes = resumenAntecedentes(pacienteCompleto, secciones);

  if (antecedentes.sensibles.length > 0) {
    await req.bitacora({
      accion: 'leer',
      entidad: 'paciente_datos_sensibles',
      entidadId: atencion.pacienteId,
      detalle: `Resumen de antecedentes en la consulta. Campos: ${antecedentes.sensibles.join(', ')}`,
    });
  }
  await req.bitacora({ accion: 'leer', entidad: 'paciente', entidadId: atencion.pacienteId });

  res.json({
    atencion,
    alertas,
    historial,
    antropometria,
    ficha,
    fichaPaciente: antecedentes.ficha,
    antecedentes: antecedentes.secciones,
    sitiosExamen: sitiosExamen(antecedentes.ficha.clave),
    diagnosticosPrevios: previos,
    semanasGestacion: embarazo ? semanasDeGestacion(embarazo, atencion.registradaEn) : null,
    catalogos3cs: CATALOGOS_3CS,
  });
}

async function registrarConsulta(req, res, next) {
  const atencion = await buscarAtencion(req);
  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  if (atencion.estado !== 'en_atencion') {
    return next({
      status: 409,
      codigo: 'estado_invalido',
      mensaje: `Solo se puede cerrar una atención en curso. Estado actual: ${atencion.estado}`,
    });
  }

  const ahora = new Date();
  const { diagnosticos: _filas, diagnosticoTxt: _txt, diagnosticoCie: _cie, ...resto } = req.body;
  const diagnosticos = diagnosticosDe(req.body);
  const [principal] = diagnosticos;

  // El tipo de consulta lo sugiere el sistema; el medico puede cambiarlo.
  const tipoConsulta = resto.tipoConsulta
    ?? sugerirTipoConsulta(principal, await diagnosticosPrevios(atencion.pacienteId, atencion.id), ahora).valor;

  // La semana de gestacion se calcula del episodio activo, no se pregunta.
  const embarazo = await prisma.episodioEmbarazo.findFirst({
    where: { pacienteId: atencion.pacienteId, estado: 'activo' },
  });

  const cerrada = await prisma.$transaction(async (tx) => {
    const resultado = await tx.atencion.update({
      where: { id: atencion.id },
      data: {
        ...resto,
        tipoConsulta,
        controlSigsa: resto.controlSigsa ?? 0,
        referenciaViene: resto.referenciaViene ?? 0,
        referenciaFue: resto.referenciaFue ?? 0,
        lugarNotificacion: resto.lugarNotificacion ?? 0,
        semanasGestacion: embarazo ? semanasDeGestacion(embarazo, ahora) : null,
        // El primer diagnostico se copia en la atencion: es el que leen los informes.
        diagnosticoTxt: principal.descripcion,
        diagnosticoCie: principal.cie,
        estado: 'atendido',
        cerradaEn: ahora,
        atendidaPor: req.usuario.id,
      },
    });

    await tx.diagnosticoAtencion.deleteMany({ where: { atencionId: atencion.id } });
    await tx.diagnosticoAtencion.createMany({
      data: diagnosticos.map((d, orden) => ({ atencionId: atencion.id, orden, descripcion: d.descripcion, cie: d.cie })),
    });

    // Al cerrar se libera la clinica para el siguiente de la cola.
    if (atencion.clinicaId) {
      await tx.clinica.update({ where: { id: atencion.clinicaId }, data: { disponible: true } });
    }

    return resultado;
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'atencion',
    entidadId: atencion.id,
    detalle: `Consulta cerrada con ${diagnosticos.length} diagnóstico(s): `
      + diagnosticos.map((d) => d.cie ?? `sin código (${d.descripcion})`).join(', '),
  });

  // El lugar de notificacion de un caso de violencia es dato sensible.
  if (resto.lugarNotificacion > 0) {
    await req.bitacora({
      accion: 'actualizar',
      entidad: 'paciente_datos_sensibles',
      entidadId: atencion.pacienteId,
      detalle: `Notificación registrada en la atención ${atencion.id}. Campos: lugarNotificacion, numeroNotificacion`,
    });
  }

  const duracionMin = atencion.iniciadaEn
    ? Math.round((ahora - new Date(atencion.iniciadaEn)) / 60000)
    : null;

  res.json({ atencion: cerrada, duracionMin });
}

async function crearPrescripcion(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId },
  });

  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  if (!['en_atencion', 'atendido'].includes(atencion.estado)) {
    return next({
      status: 409,
      codigo: 'estado_invalido',
      mensaje: 'Solo se puede prescribir durante o después de la consulta',
    });
  }

  const insumo = await prisma.insumo.findFirst({
    where: { id: req.body.insumoId, establecimientoId, activo: true },
  });

  if (!insumo) {
    return next({ status: 404, codigo: 'insumo_no_encontrado', mensaje: 'Insumo no encontrado' });
  }

  const prescripcion = await prisma.prescripcion.create({
    data: { ...req.body, atencionId: atencion.id },
    include: { insumo: { select: { id: true, nombreGenerico: true, presentacion: true } } },
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'prescripcion',
    entidadId: prescripcion.id,
    detalle: `${insumo.nombreGenerico} x${req.body.cantidad}`,
  });

  // Aviso en el momento de prescribir: si no hay con que cumplir la receta,
  // el medico debe saberlo ahora, no la farmacia al intentar entregarla.
  const cobertura = await coberturaDeInsumo(insumo.id, establecimientoId);
  const avisos = [];

  if (cobertura) {
    if (cobertura.saldoTotal < req.body.cantidad) {
      avisos.push(
        `Quedan ${cobertura.saldoTotal} ${insumo.unidadMedida}(s) y se prescriben ${req.body.cantidad}`,
      );
    }
    if (cobertura.cobertura.calculable && cobertura.cobertura.critica) {
      avisos.push(`De este insumo quedan para unos ${cobertura.cobertura.dias} días`);
    }
    if (cobertura.bajoMinimo) {
      avisos.push(`Existencia bajo el mínimo definido (${cobertura.insumo.stockMinimo})`);
    }
  }

  res.status(201).json({
    prescripcion,
    existencia: cobertura
      ? { saldoTotal: cobertura.saldoTotal, cobertura: cobertura.cobertura }
      : null,
    avisos,
  });
}

async function alertasPaciente(req, res, next) {
  const { alertasDePaciente } = require('../services/alertasClinicas.service');

  const resultado = await alertasDePaciente(
    Number(req.params.id),
    req.usuario.establecimientoId,
  );

  if (!resultado) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  res.json({ alertas: resultado.alertas });
}

/**
 * Asigna el codigo CIE-10 a una consulta que se cerro sin el.
 *
 * Cerrar la consulta no exige el codigo, para no detener la atencion cuando no
 * se tiene a mano. Pero el consolidado SIGSA si lo necesita, asi que queda
 * pendiente y se completa desde la lista de Direccion.
 */
async function codificar(req, res, next) {
  const atencion = await buscarAtencion(req);

  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  if (atencion.estado !== 'atendido') {
    return next({
      status: 409,
      codigo: 'estado_invalido',
      mensaje: 'Solo se codifica una consulta ya cerrada',
    });
  }

  /*
   * Poner un codigo que faltaba es completar; reemplazar uno que ya estaba es
   * corregir. Lo segundo cambia lo que dice una consulta cerrada, asi que
   * deja nota: sin ella, nadie podria saber con que diagnostico se receto.
   */
  const reemplaza =
    Boolean(atencion.diagnosticoCie) && atencion.diagnosticoCie !== req.body.diagnosticoCie;

  if (reemplaza && !req.body.motivo) {
    return next({
      status: 400,
      codigo: 'motivo_requerido',
      mensaje: `Esta consulta ya tiene el código ${atencion.diagnosticoCie}. Para cambiarlo debe explicar por qué`,
      detalles: { codigoActual: atencion.diagnosticoCie },
    });
  }

  const actualizada = await prisma.$transaction(async (tx) => {
    const resultado = await tx.atencion.update({
      where: { id: atencion.id },
      data: { diagnosticoCie: req.body.diagnosticoCie },
    });
    // La fila principal de la impresion clinica lleva el mismo codigo.
    await tx.diagnosticoAtencion.updateMany({
      where: { atencionId: atencion.id, orden: 0 },
      data: { cie: req.body.diagnosticoCie },
    });

    if (reemplaza) {
      await registrarNota(
        {
          atencionId: atencion.id,
          campo: 'diagnosticoCie',
          valorAnterior: atencion.diagnosticoCie,
          valorNuevo: req.body.diagnosticoCie,
          motivo: req.body.motivo,
          usuarioId: req.usuario.id,
        },
        tx,
      );
    }

    return resultado;
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'atencion',
    entidadId: atencion.id,
    detalle: `Código CIE-10 asignado: ${req.body.diagnosticoCie}`
      + (atencion.diagnosticoCie ? ` (antes ${atencion.diagnosticoCie})` : ''),
  });

  res.json({ atencion: actualizada, corregido: reemplaza });
}

/**
 * Corrige un dato de una consulta ya cerrada.
 *
 * No sobrescribe en silencio: deja constancia de que se corrigio, quien y por
 * que, conservando el valor anterior.
 */
async function corregirConsulta(req, res, next) {
  const atencion = await buscarAtencion(req);
  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  const { atencion: actualizada, nota } = await corregir(atencion, {
    campo: req.body.campo,
    valorNuevo: req.body.valorNuevo,
    motivo: req.body.motivo,
    usuarioId: req.usuario.id,
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'atencion',
    entidadId: atencion.id,
    detalle: `Corrección de ${nota.campo}: "${nota.valorAnterior ?? 'vacío'}" → "${nota.valorNuevo}". ${nota.motivo}`,
  });

  res.json({ atencion: actualizada, nota });
}

/**
 * Corrige un signo vital mal digitado.
 *
 * Preconsulta corrige lo suyo mientras nadie lo haya leido. Despues de que el
 * medico llama al paciente, el dato queda congelado para preconsulta y solo
 * el medico lo toca, dejando nota.
 */
async function corregirSignosVitales(req, res, next) {
  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    include: { preconsulta: true },
  });

  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  const { preconsulta, nota } = await corregirPreconsulta(atencion, {
    campo: req.body.campo,
    valorNuevo: req.body.valorNuevo,
    motivo: req.body.motivo,
    usuario: req.usuario,
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'preconsulta',
    entidadId: preconsulta.id,
    detalle: nota
      ? `Corrección de ${nota.campo}: "${nota.valorAnterior ?? 'vacío'}" → "${nota.valorNuevo}". ${nota.motivo}`
      : `Corrección de ${req.body.campo} antes de la consulta`,
  });

  res.json({ preconsulta, nota });
}

/** Las correcciones que se le han hecho a una consulta. */
async function correccionesDe(req, res, next) {
  const atencion = await buscarAtencion(req);
  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  res.json({ correcciones: await historial(atencion.id) });
}

/**
 * Tipo de consulta sugerido para un diagnostico, segun el historial del
 * paciente. La pantalla lo pide al elegir el diagnostico principal.
 */
async function sugerenciaTipo(req, res, next) {
  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    select: { id: true, pacienteId: true, registradaEn: true },
  });
  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }
  const previos = await diagnosticosPrevios(atencion.pacienteId, atencion.id);
  const { cie, descripcion } = req.query;
  res.json(sugerirTipoConsulta({ cie: cie || null, descripcion: descripcion || null }, previos, new Date()));
}

module.exports = { sugerenciaTipo, obtener, registrarConsulta, codificar, crearPrescripcion, alertasPaciente, corregirConsulta, correccionesDe, corregirSignosVitales };
