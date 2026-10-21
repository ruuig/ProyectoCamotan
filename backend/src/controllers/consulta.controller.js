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
const { enUbicacion, existenciaTotal } = require('../services/inventario.service');
const {
  CATALOGOS_3CS,
  sugerirTipoConsulta,
  diagnosticosDe,
} = require('../services/hojaEvolucion.service');
const { semanasDeGestacion } = require('../services/embarazo.service');
const { resumenAntecedentes } = require('../services/resumenFicha.service');
const { sitiosExamen, SITIOS_EXAMEN, SITIO_PIES } = require('../services/fichaClinica.service');
const { ETIQUETA_CONCIENCIA } = require('../services/triaje.service');

const SITIO_HUESOS = { clave: 'huesos_articulaciones', etiqueta: 'Huesos y articulaciones' };

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
      recetasExternas: { orderBy: { creadaEn: 'asc' } },
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
        medico: { select: { nombre: true } },
        prescripciones: { select: { id: true } },
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
  const codigosPeligro = atencion.preconsulta?.signosPeligro ?? [];
  const [secciones, previos, embarazo, signosPeligro] = await Promise.all([
    prisma.seccionPaciente.findMany({ where: { pacienteId: atencion.pacienteId } }),
    diagnosticosPrevios(atencion.pacienteId, atencion.id),
    prisma.episodioEmbarazo.findFirst({ where: { pacienteId: atencion.pacienteId, estado: 'activo' } }),
    codigosPeligro.length
      ? prisma.signoPeligro.findMany({
        where: { establecimientoId: atencion.establecimientoId, codigo: { in: codigosPeligro } },
        select: { descripcion: true, gravedadSugerida: true },
      })
      : [],
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
    signosPeligro,
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

/** La atencion en la que se receta, si admite receta; si no, el error. */
async function atencionParaRecetar(req) {
  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
  });

  if (!atencion) {
    return { error: { status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' } };
  }

  if (!['en_atencion', 'atendido'].includes(atencion.estado)) {
    return {
      error: {
        status: 409,
        codigo: 'estado_invalido',
        mensaje: 'Solo se puede prescribir durante o después de la consulta',
      },
    };
  }

  return { atencion };
}

async function crearPrescripcion(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;

  const { atencion, error } = await atencionParaRecetar(req);
  if (error) return next(error);

  const insumo = await prisma.insumo.findFirst({
    where: { id: req.body.insumoId, establecimientoId, activo: true },
  });

  if (!insumo) {
    return next({ status: 404, codigo: 'insumo_no_encontrado', mensaje: 'Insumo no encontrado' });
  }

  if (!insumo.prescribible) {
    return next({
      status: 400,
      codigo: 'insumo_no_prescribible',
      mensaje: `${insumo.nombreGenerico} es de uso del servicio y no se entrega al paciente`,
    });
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
  // Lo que importa al paciente es lo que hay en farmacia, que es de donde se le entrega.
  const lotes = await prisma.lote.findMany({ where: { insumoId: insumo.id } });
  const enFarmacia = existenciaTotal(enUbicacion(lotes, 'farmacia'));
  const enBodega = existenciaTotal(enUbicacion(lotes, 'bodega'));

  if (enFarmacia < req.body.cantidad) {
    avisos.push(
      `En farmacia quedan ${enFarmacia} ${insumo.unidadMedida}(s) y se prescriben ${req.body.cantidad}`
      + (enBodega > 0 ? `; en bodega hay ${enBodega}` : ''),
    );
  }
  if (cobertura) {
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
      ? { saldoTotal: cobertura.saldoTotal, enFarmacia, enBodega, cobertura: cobertura.cobertura }
      : { saldoTotal: enFarmacia + enBodega, enFarmacia, enBodega, cobertura: null },
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

/**
 * Medicamento que el centro no tiene: queda en la receta para que el
 * paciente lo consiga fuera. No pasa por farmacia ni toca el inventario.
 */
async function crearRecetaExterna(req, res, next) {
  const { atencion, error } = await atencionParaRecetar(req);
  if (error) return next(error);

  const receta = await prisma.recetaExterna.create({
    data: { ...req.body, atencionId: atencion.id, registradaPor: req.usuario.id },
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'receta_externa',
    entidadId: receta.id,
    detalle: `${receta.medicamento}${receta.cantidad ? ` x${receta.cantidad}` : ''} (conseguir fuera del centro)`,
  });

  res.status(201).json({ receta });
}


// --- Hoja de una consulta anterior ----------------------------------------------

const etiquetaDe3cs = (lista, valor) => (valor == null ? null : lista.find((o) => o.valor === valor)?.etiqueta ?? String(valor));

/** Estado de entrega de una receta: lo que el paciente se llevo. */
function estadoReceta(p) {
  const validas = p.dispensaciones.filter((d) => !d.anulada);
  const entregado = validas.reduce((t, d) => t + d.cantidad, 0);
  const noHabia = p.demandaNoAtendida.reduce((t, d) => t + d.cantidad, 0);
  let estado = 'sin_entregar';
  if (entregado >= p.cantidad) estado = 'entregada';
  else if (entregado > 0) estado = 'parcial';
  else if (noHabia > 0) estado = 'no_habia';
  return {
    id: p.id,
    medicamento: [p.insumo.nombreGenerico, p.insumo.concentracion, p.insumo.formaFarmaceutica].filter(Boolean).join(' '),
    cantidad: p.cantidad,
    indicaciones: p.indicaciones,
    entregado,
    noHabia,
    estado,
    entregadaEn: validas.at(-1)?.registradaEn ?? null,
  };
}

/**
 * Todo lo que el medico escribio en una consulta, tal como lo dejo, para
 * leerlo en la siguiente visita. Solo lectura.
 */
async function hoja(req, res, next) {
  const a = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    include: {
      preconsulta: true,
      diagnosticos: { orderBy: { orden: 'asc' } },
      prescripciones: {
        orderBy: { creadaEn: 'asc' },
        include: { insumo: true, dispensaciones: true, demandaNoAtendida: true },
      },
      recetasExternas: { orderBy: { creadaEn: 'asc' } },
      referencia: true,
      medico: { select: { nombre: true } },
      clinica: { select: { nombre: true } },
      paciente: { select: { nombres: true, apellidos: true, expediente: true, expedientePapel: true, fechaNacimiento: true, sexo: true } },
    },
  });
  if (!a) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });

  const signos = a.preconsulta?.signosPeligro?.length
    ? await prisma.signoPeligro.findMany({
      where: { establecimientoId: a.establecimientoId, codigo: { in: a.preconsulta.signosPeligro } },
      select: { codigo: true, descripcion: true },
    })
    : [];
  const sitios = [...SITIOS_EXAMEN, SITIO_PIES, SITIO_HUESOS];
  const examen = a.examenSitios ?? null;
  const p = a.preconsulta;

  await req.bitacora({ accion: 'leer', entidad: 'atencion', entidadId: a.id, detalle: 'Hoja de consulta anterior' });

  res.json({
    id: a.id,
    estado: a.estado,
    paciente: a.paciente,
    registradaEn: a.registradaEn,
    cerradaEn: a.cerradaEn,
    medico: a.medico?.nombre ?? null,
    clinica: a.clinica?.nombre ?? null,
    gravedad: a.gravedad,
    acompanante: a.acompanante,
    preconsulta: p && {
      peso: p.peso, unidadPeso: p.unidadPeso, talla: p.talla, temperatura: p.temperatura,
      presion: p.presionSis && p.presionDia ? `${p.presionSis}/${p.presionDia}` : null,
      frecCardiaca: p.frecCardiaca, frecRespiratoria: p.frecRespiratoria, satOxigeno: p.satOxigeno,
      dolor: p.dolor, conciencia: p.conciencia ? ETIQUETA_CONCIENCIA[p.conciencia] : null, glucosa: p.glucosa,
      signosPeligro: signos.map((x) => x.descripcion),
      triaje: p.triaje ?? null,
    },
    motivoConsulta: a.motivoConsulta,
    historiaEnfermedad: a.historiaEnfermedad,
    examenFisico: a.examenFisico,
    examenSitios: examen && {
      anormales: sitios.filter((x) => examen.sitios?.[x.clave] === false).map((x) => x.etiqueta),
      normales: sitios.filter((x) => examen.sitios?.[x.clave] === true).map((x) => x.etiqueta),
      hallazgosAnormales: examen.hallazgosAnormales ?? null,
      otrosHallazgos: examen.otrosHallazgos ?? null,
    },
    diagnosticos: a.diagnosticos.length
      ? a.diagnosticos.map((d) => ({ descripcion: d.descripcion, cie: d.cie }))
      : (a.diagnosticoTxt ? [{ descripcion: a.diagnosticoTxt, cie: a.diagnosticoCie }] : []),
    otrosProblemas: a.otrosProblemas,
    tratamiento: a.tratamiento,
    recetas: a.prescripciones.map(estadoReceta),
    recetasExternas: a.recetasExternas.map((r) => ({ medicamento: r.medicamento, cantidad: r.cantidad, indicaciones: r.indicaciones })),
    laboratorios: a.laboratorios,
    orientacion: a.orientacionIntegral,
    proximaCita: a.proximaCita,
    referencia: a.referencia && {
      servicioDestino: a.referencia.servicioDestino,
      motivo: a.referencia.motivo,
      contrarreferencia: a.referencia.contraRecibidaEn ? {
        recibidaEn: a.referencia.contraRecibidaEn,
        diagnostico: a.referencia.contraDiagnostico,
        tratamiento: a.referencia.contraTratamiento,
        recomendaciones: a.referencia.contraRecomendaciones,
      } : null,
    },
    sigsa: {
      tipoConsulta: etiquetaDe3cs(CATALOGOS_3CS.tipoConsulta, a.tipoConsulta),
      control: etiquetaDe3cs(CATALOGOS_3CS.controlSigsa, a.controlSigsa),
      semanasGestacion: a.semanasGestacion,
      referenciaViene: etiquetaDe3cs(CATALOGOS_3CS.referenciaViene, a.referenciaViene),
      referenciaFue: etiquetaDe3cs(CATALOGOS_3CS.referenciaFue, a.referenciaFue),
      referidoA: a.referidoA,
    },
    correcciones: await historial(a.id),
  });
}

/**
 * Quitar un medicamento de la receta (por ejemplo, una cantidad mal escrita).
 * Solo mientras farmacia no lo haya atendido: lo entregado ya es un movimiento.
 */
async function quitarPrescripcion(req, res, next) {
  const { atencion, error } = await atencionParaRecetar(req);
  if (error) return next(error);
  const p = await prisma.prescripcion.findFirst({
    where: { id: req.params.recetaId, atencionId: atencion.id },
    include: { insumo: { select: { nombreGenerico: true } }, _count: { select: { dispensaciones: true, demandaNoAtendida: true } } },
  });
  if (!p) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Ese medicamento no está en la receta' });
  if (p._count.dispensaciones || p._count.demandaNoAtendida) {
    return next({ status: 409, codigo: 'ya_entregado', mensaje: 'Farmacia ya atendió este medicamento: no se puede quitar' });
  }
  await prisma.prescripcion.delete({ where: { id: p.id } });
  await req.bitacora({
    accion: 'eliminar', entidad: 'prescripcion', entidadId: p.id,
    detalle: `Quitado de la receta de la atención ${atencion.id}: ${p.insumo.nombreGenerico} x${p.cantidad}`,
  });
  res.json({ ok: true });
}

/** Quitar un medicamento recetado para conseguir fuera del centro. */
async function quitarRecetaExterna(req, res, next) {
  const { atencion, error } = await atencionParaRecetar(req);
  if (error) return next(error);
  const r = await prisma.recetaExterna.findFirst({ where: { id: req.params.recetaId, atencionId: atencion.id } });
  if (!r) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Ese medicamento no está en la receta' });
  await prisma.recetaExterna.delete({ where: { id: r.id } });
  await req.bitacora({
    accion: 'eliminar', entidad: 'receta_externa', entidadId: r.id,
    detalle: `Quitado de la receta de la atención ${atencion.id}: ${r.medicamento}`,
  });
  res.json({ ok: true });
}

module.exports = { hoja, sugerenciaTipo, obtener, registrarConsulta, codificar, crearPrescripcion, crearRecetaExterna, quitarPrescripcion, quitarRecetaExterna, alertasPaciente, corregirConsulta, correccionesDe, corregirSignosVitales };
