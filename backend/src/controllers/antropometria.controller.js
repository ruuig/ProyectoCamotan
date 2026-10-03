const prisma = require('../config/db');
const { calcularEdad } = require('../services/pacientes.service');
const {
  compararConAnterior,
  detallarIndicadores,
} = require('../services/antropometria.service');
const {
  evaluarMedicion,
  bandasReferencia,
  indicadorPesoPorEstatura,
  referenciasDe,
} = require('../services/antropometriaDatos.service');
const { evaluarPlausibilidad } = require('../services/plausibilidad.service');

const ETIQUETA_CLASIFICACION = {
  normal: 'Normal',
  riesgo: 'Riesgo de desnutrición',
  desnutricion_aguda_moderada: 'Desnutrición aguda moderada',
  desnutricion_aguda_severa: 'Desnutrición aguda severa',
  desnutricion_cronica: 'Desnutrición crónica (retardo de talla)',
  sobrepeso: 'Sobrepeso',
};

async function buscarPaciente(req) {
  return prisma.paciente.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
  });
}

// Arma el mensaje que ve el medico, ya interpretado, no solo el numero.
function mensajeClinico(medicion, comparacion) {
  const partes = [];

  if (medicion.zPesoTalla != null && medicion.clasificacion && medicion.clasificacion !== 'normal') {
    partes.push(
      `Peso para la talla en ${medicion.zPesoTalla} DE, clasificacion de ${
        ETIQUETA_CLASIFICACION[medicion.clasificacion] ?? medicion.clasificacion
      }`,
    );
  } else if (medicion.clasificacion && medicion.clasificacion !== 'normal') {
    partes.push(ETIQUETA_CLASIFICACION[medicion.clasificacion] ?? medicion.clasificacion);
  }

  if (comparacion?.descensoRelevante) {
    partes.push(`descenso de ${Math.abs(comparacion.diferencia)} DE respecto a la medición anterior`);
  }

  return partes.length > 0 ? partes.join(', ') : null;
}

async function registrar(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const { atencionId, fecha, confirmarImprobable, ...medidas } = req.body;
  const momento = fecha ?? new Date();
  const { edadMeses } = calcularEdad(paciente.fechaNacimiento, momento);

  if (atencionId) {
    const atencion = await prisma.atencion.findFirst({
      where: { id: atencionId, pacienteId: paciente.id },
    });
    if (!atencion) {
      return next({
        status: 400,
        codigo: 'atencion_invalida',
        mensaje: 'La atención indicada no pertenece a este paciente',
      });
    }
  }

  const evaluacion = await evaluarMedicion({
    sexo: paciente.sexo,
    edadMeses,
    peso: medidas.peso,
    talla: medidas.talla,
    perimetroBraquial: medidas.perimetroBraquial,
  });

  // Antes de guardar se revisa que la medicion sea biologicamente posible.
  // Un peso de 60 kg en un nino de dos anos casi siempre es la talla escrita
  // en el campo equivocado.
  const [refPesoEdad, refTallaEdad] = await Promise.all([
    referenciasDe('peso_edad', paciente.sexo, edadMeses),
    referenciasDe('talla_edad', paciente.sexo, edadMeses),
  ]);

  const revision = evaluarPlausibilidad({
    edadMeses,
    peso: medidas.peso == null ? null : Number(medidas.peso),
    talla: medidas.talla == null ? null : Number(medidas.talla),
    perimetroBraquial:
      medidas.perimetroBraquial == null ? null : Number(medidas.perimetroBraquial),
    perimetroCefalico:
      medidas.perimetroCefalico == null ? null : Number(medidas.perimetroCefalico),
    puntajes: {
      pesoEdad: evaluacion.zPesoEdad,
      tallaEdad: evaluacion.zTallaEdad,
      pesoTalla: evaluacion.zPesoTalla,
      imcEdad: evaluacion.zImcEdad,
    },
    referencias: { pesoEdad: refPesoEdad, tallaEdad: refTallaEdad },
  });

  // No se bloquea en silencio: se explica y se pide confirmacion explicita.
  if (!revision.plausible && !confirmarImprobable) {
    return next({
      status: 409,
      codigo: 'medicion_improbable',
      mensaje: revision.avisos[0].mensaje,
      detalles: revision.avisos,
    });
  }

  const anterior = await prisma.antropometria.findFirst({
    where: { pacienteId: paciente.id, improbable: false },
    orderBy: { fecha: 'desc' },
  });

  const antropometria = await prisma.antropometria.create({
    data: {
      pacienteId: paciente.id,
      atencionId: atencionId ?? null,
      fecha: momento,
      edadMeses,
      peso: medidas.peso,
      talla: medidas.talla,
      perimetroCefalico: medidas.perimetroCefalico ?? null,
      perimetroBraquial: medidas.perimetroBraquial ?? null,
      zPesoEdad: evaluacion.zPesoEdad,
      zTallaEdad: evaluacion.zTallaEdad,
      zPesoTalla: evaluacion.zPesoTalla,
      zImcEdad: evaluacion.zImcEdad,
      // Una medicion improbable no clasifica: afirmar un estado nutricional
      // desde un dato que se sabe erroneo seria peor que no decir nada.
      clasificacion: revision.plausible ? evaluacion.clasificacion : null,
      improbable: !revision.plausible,
      motivoImprobable: revision.plausible
        ? null
        : revision.avisos.map((a) => a.mensaje).join(' '),
    },
  });

  const comparacion = compararConAnterior(evaluacion.zPesoTalla, anterior?.zPesoTalla);

  await req.bitacora({
    accion: 'crear',
    entidad: 'antropometria',
    entidadId: antropometria.id,
    detalle: evaluacion.clasificacion,
  });

  res.status(201).json({
    antropometria,
    clasificacion: evaluacion.clasificacion,
    etiquetaClasificacion: evaluacion.clasificacion
      ? ETIQUETA_CLASIFICACION[evaluacion.clasificacion]
      : null,
    comparacion,
    alertaClinica: mensajeClinico(evaluacion, comparacion),
    avisos: evaluacion.avisos,
  });
}

async function listar(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const mediciones = await prisma.antropometria.findMany({
    where: { pacienteId: paciente.id },
    orderBy: { fecha: 'asc' },
  });

  await req.bitacora({ accion: 'leer', entidad: 'antropometria', entidadId: paciente.id });

  // Cada indicador viaja con su propio puntaje y su propia clasificacion: la
  // tarjeta mostraba una etiqueta junto al puntaje de otro indicador.
  res.json({
    mediciones: mediciones.map((m) => ({
      ...m,
      etiquetaClasificacion: m.clasificacion ? ETIQUETA_CLASIFICACION[m.clasificacion] : null,
      indicadores: detallarIndicadores({
        zPesoTalla: m.zPesoTalla === null ? null : Number(m.zPesoTalla),
        zTallaEdad: m.zTallaEdad === null ? null : Number(m.zTallaEdad),
        zPesoEdad: m.zPesoEdad === null ? null : Number(m.zPesoEdad),
        zImcEdad: m.zImcEdad === null ? null : Number(m.zImcEdad),
        improbable: m.improbable,
        edadMeses: m.edadMeses,
        talla: m.talla === null ? null : Number(m.talla),
      }).map((i) => ({
        ...i,
        etiquetaClasificacion: i.clasificacion ? ETIQUETA_CLASIFICACION[i.clasificacion] : null,
      })),
    })),
  });
}

async function curva(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  let { indicador } = req.query;
  const mediciones = await prisma.antropometria.findMany({
    where: { pacienteId: paciente.id },
    orderBy: { fecha: 'asc' },
  });

  // Para el peso segun estatura, el estandar depende de la edad del paciente.
  if (indicador === 'peso_talla' || indicador === 'peso_longitud') {
    const { edadMeses } = calcularEdad(paciente.fechaNacimiento);
    indicador = indicadorPesoPorEstatura(edadMeses);
  }

  const bandas = await bandasReferencia(indicador, paciente.sexo);

  // El eje X es la talla para peso/estatura, y la edad en meses para el resto.
  const ejeEsEstatura = indicador === 'peso_talla' || indicador === 'peso_longitud';
  const campoValor = {
    peso_edad: 'peso',
    talla_edad: 'talla',
    peso_talla: 'peso',
    peso_longitud: 'peso',
    imc_edad: null,
  }[indicador];

  const puntos = mediciones
    .map((m) => ({
      x: ejeEsEstatura ? Number(m.talla) : m.edadMeses,
      y: campoValor ? Number(m[campoValor]) : null,
      fecha: m.fecha,
      clasificacion: m.clasificacion,
    }))
    .filter((p) => p.y != null);

  res.json({
    indicador,
    sexo: paciente.sexo,
    ejeX: ejeEsEstatura ? 'talla_cm' : 'edad_meses',
    bandas,
    puntos,
    aviso: bandas ? null : 'Tablas de referencia OMS no cargadas',
  });
}

module.exports = { registrar, listar, curva, ETIQUETA_CLASIFICACION };
