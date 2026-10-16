const prisma = require('../config/db');
const { aKilogramos, redondear: redondearPeso } = require('../services/unidadesPeso.service');
const { calcularEdad } = require('../services/pacientes.service');
const { sincronizarCondicionesPorEdad } = require('../services/condiciones.service');
const { evaluarSignosVitales } = require('../services/signosVitales.service');
const { compararConAnterior } = require('../services/antropometria.service');
const { evaluarMedicion } = require('../services/antropometriaDatos.service');
const { ETIQUETA_CLASIFICACION } = require('./antropometria.controller');
const { triaje, bajaDe } = require('../services/triaje.service');
const { parametros } = require('../services/parametrosPriorizacion.service');
const { HORAS_JORNADA } = require('../services/cola.service');

// Los patrones de crecimiento de la OMS cubren hasta los 5 anios.
const EDAD_MAX_ANTROPOMETRIA_MESES = 60;

async function crear(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { pacienteId, motivoConsulta, gravedad } = req.body;

  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, establecimientoId, activo: true },
  });

  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  // Un paciente no puede estar dos veces en la cola del mismo dia.
  const abierta = await atencionAbierta(req, pacienteId);

  if (abierta) {
    return next({
      status: 409,
      codigo: 'atencion_abierta',
      mensaje: 'El paciente ya tiene una atención en curso',
      detalles: { atencionId: abierta.id, estado: abierta.estado },
    });
  }

  const atencion = await prisma.$transaction(async (tx) => {
    await sincronizarCondicionesPorEdad(tx, paciente);
    return tx.atencion.create({
      data: { establecimientoId, pacienteId, motivoConsulta, gravedad },
    });
  });

  await req.bitacora({ accion: 'crear', entidad: 'atencion', entidadId: atencion.id });

  res.status(201).json({ atencion });
}

async function registrarPreconsulta(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const {
    signosPeligro,
    gravedad,
    justificacionGravedad,
    unidadPeso,
    motivoConsulta,
    ...medicion
  } = req.body;

  /*
   * El peso se guarda SIEMPRE en kilogramos.
   *
   * No todas las basculas del centro son de kilogramos, y convertir de cabeza
   * con la fila esperando es donde aparecen los errores de un factor de diez.
   * La conversion la hace el servidor, no la pantalla: asi el valor grabado
   * no depende de que el navegador haya calculado bien.
   */
  if (medicion.peso != null) {
    const enKilogramos = aKilogramos(medicion.peso, unidadPeso);

    if (enKilogramos === null || enKilogramos < 0.5 || enKilogramos > 400) {
      return next({
        status: 400,
        codigo: 'peso_fuera_de_rango',
        mensaje: `${medicion.peso} ${unidadPeso} son ${redondearPeso(enKilogramos, 'kg')} kg, fuera de lo posible`,
        detalles: { peso: medicion.peso, unidadPeso, kilogramos: enKilogramos },
      });
    }

    medicion.peso = redondearPeso(enKilogramos, 'kg');
  }

  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId },
    include: {
      preconsulta: true,
      paciente: { include: { condiciones: { where: { vigenteHasta: null } } } },
    },
  });

  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }
  if (atencion.preconsulta) {
    return next({
      status: 409,
      codigo: 'preconsulta_registrada',
      mensaje: 'Esta atención ya tiene preconsulta registrada',
    });
  }
  if (atencion.estado !== 'en_espera') {
    return next({
      status: 409,
      codigo: 'estado_invalido',
      mensaje: `No se puede registrar preconsulta en una atención ${atencion.estado}`,
    });
  }

  // Los signos de peligro se validan contra el catalogo configurable, no
  // contra una lista fija en el codigo.
  const catalogo = await prisma.signoPeligro.findMany({
    where: { establecimientoId, activo: true },
  });
  const porCodigo = new Map(catalogo.map((signo) => [signo.codigo, signo]));

  const desconocidos = signosPeligro.filter((codigo) => !porCodigo.has(codigo));
  if (desconocidos.length > 0) {
    return next({
      status: 400,
      codigo: 'signo_desconocido',
      mensaje: 'Se marcaron signos de peligro que no existen en el catalogo',
      detalles: desconocidos,
    });
  }

  const marcados = signosPeligro.map((codigo) => porCodigo.get(codigo));

  // El nivel lo deciden los criterios clinicos (signos vitales por edad,
  // dolor, conciencia, glucosa, desnutricion) y los signos de peligro: gana el
  // mas grave. El personal puede elegir otro; si es menor, lo justifica.
  const { edadMeses: edadTriaje } = calcularEdad(atencion.paciente.fechaNacimiento);
  const embarazada = (await prisma.episodioEmbarazo.count({ where: { pacienteId: atencion.pacienteId, estado: 'activo' } })) > 0
    || atencion.paciente.condiciones.some((c) => c.tipo === 'embarazo');
  const { criterios } = await parametros(establecimientoId);
  // En menores de 5, la desnutricion aguda (puntaje Z) tambien sube el nivel.
  const nutricion = edadTriaje < EDAD_MAX_ANTROPOMETRIA_MESES && medicion.peso != null && medicion.talla != null
    ? await evaluarMedicion({ sexo: atencion.paciente.sexo, edadMeses: edadTriaje, peso: medicion.peso, talla: medicion.talla, perimetroBraquial: medicion.perimetroBraquial })
    : null;
  const resultadoTriaje = triaje(
    { ...medicion, clasificacionNutricional: nutricion?.clasificacion ?? null },
    { edadMeses: edadTriaje, embarazada },
    criterios,
    marcados,
  );
  const gravedadSugerida = resultadoTriaje.nivel;
  const gravedadFinal = gravedad ?? gravedadSugerida;
  const bajaLaGravedad = bajaDe(gravedadSugerida, gravedadFinal);

  if (bajaLaGravedad && !justificacionGravedad) {
    return next({
      status: 400,
      codigo: 'justificacion_requerida',
      mensaje: `El sistema sugiere ${gravedadSugerida} (${resultadoTriaje.motivos.map((m) => m.texto).join(', ')}). Para elegir una gravedad menor, justifíquelo por escrito`,
      detalles: { gravedadSugerida, gravedadSolicitada: gravedadFinal },
    });
  }

  const { edadMeses } = calcularEdad(atencion.paciente.fechaNacimiento);
  const condiciones = atencion.paciente.condiciones.map((c) => c.tipo);

  // Los perimetros no son columnas de preconsulta: pertenecen a antropometria.
  const { perimetroBraquial, perimetroCefalico, ...signosVitales } = medicion;
  const hallazgos = evaluarSignosVitales(signosVitales, { edadMeses, condiciones });

  // En menores de 5 anios, peso y talla generan ademas un registro de
  // antropometria con su puntaje Z, que es el momento en que se detecta la
  // desnutricion sin pedirle al personal una pantalla aparte.
  const correspondeAntropometria =
    edadMeses < EDAD_MAX_ANTROPOMETRIA_MESES &&
    signosVitales.peso != null &&
    signosVitales.talla != null;

  const evaluacion = correspondeAntropometria
    ? await evaluarMedicion({
        sexo: atencion.paciente.sexo,
        edadMeses,
        peso: signosVitales.peso,
        talla: signosVitales.talla,
        perimetroBraquial,
      })
    : null;

  const anterior = correspondeAntropometria
    ? await prisma.antropometria.findFirst({
        where: { pacienteId: atencion.pacienteId },
        orderBy: { fecha: 'desc' },
      })
    : null;

  const { preconsulta, antropometria } = await prisma.$transaction(async (tx) => {
    const creada = await tx.preconsulta.create({
      data: {
        ...signosVitales,
        unidadPeso,
        atencionId: atencion.id,
        signosPeligro,
        triaje: { sugerido: gravedadSugerida, elegido: gravedadFinal, motivos: resultadoTriaje.motivos, justificacion: bajaLaGravedad ? justificacionGravedad : null },
      },
    });

    await tx.atencion.update({
      where: { id: atencion.id },
      // El motivo se escribe aqui: es la pantalla donde se pregunta.
      data: { gravedad: gravedadFinal, motivoConsulta },
    });

    let medida = null;
    if (correspondeAntropometria) {
      medida = await tx.antropometria.create({
        data: {
          unidadPeso,
          pacienteId: atencion.pacienteId,
          atencionId: atencion.id,
          edadMeses,
          peso: signosVitales.peso,
          talla: signosVitales.talla,
          perimetroCefalico: perimetroCefalico ?? null,
          perimetroBraquial: perimetroBraquial ?? null,
          zPesoEdad: evaluacion.zPesoEdad,
          zTallaEdad: evaluacion.zTallaEdad,
          zPesoTalla: evaluacion.zPesoTalla,
          zImcEdad: evaluacion.zImcEdad,
          clasificacion: evaluacion.clasificacion,
        },
      });
    }

    return { preconsulta: creada, antropometria: medida };
  });

  const comparacion = evaluacion
    ? compararConAnterior(evaluacion.zPesoTalla, anterior?.zPesoTalla)
    : null;

  await req.bitacora({
    accion: 'crear',
    entidad: 'preconsulta',
    entidadId: preconsulta.id,
    detalle: bajaLaGravedad
      ? `Gravedad bajada de ${gravedadSugerida} a ${gravedadFinal}. Justificación: ${justificacionGravedad}`
      : null,
  });

  // La informacion derivada se devuelve en el momento de la accion, no en una
  // pantalla de informes aparte.
  res.status(201).json({
    preconsulta,
    gravedad: gravedadFinal,
    gravedadSugerida,
    motivosTriaje: resultadoTriaje.motivos,
    signosPeligroMarcados: marcados.map((s) => ({
      codigo: s.codigo,
      descripcion: s.descripcion,
      gravedadSugerida: s.gravedadSugerida,
    })),
    hallazgos,
    antropometria: antropometria
      ? {
          registro: antropometria,
          clasificacion: evaluacion.clasificacion,
          etiquetaClasificacion: evaluacion.clasificacion
            ? ETIQUETA_CLASIFICACION[evaluacion.clasificacion]
            : null,
          comparacion,
          avisos: evaluacion.avisos,
        }
      : null,
  });
}

/**
 * Abre la atencion al guardar la toma de signos, no antes.
 *
 * Antes se abria con solo tocar "Atender" y quedaba en la cola aunque no se
 * llenara nada. Ahora la atencion y su preconsulta se crean juntas: si los
 * datos no pasan, la atencion se borra y no queda nada a medias.
 */
async function crearConPreconsulta(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { pacienteId, ...preconsulta } = req.body;

  const paciente = await prisma.paciente.findFirst({ where: { id: pacienteId, establecimientoId, activo: true } });
  if (!paciente) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });

  const abierta = await atencionAbierta(req, pacienteId);
  if (abierta) {
    return next({
      status: 409,
      codigo: 'atencion_abierta',
      mensaje: 'El paciente ya tiene una atención en curso',
      detalles: { atencionId: abierta.id, estado: abierta.estado },
    });
  }

  const atencion = await prisma.$transaction(async (tx) => {
    await sincronizarCondicionesPorEdad(tx, paciente);
    // La gravedad final la pone la preconsulta, con los signos de peligro.
    return tx.atencion.create({ data: { establecimientoId, pacienteId, motivoConsulta: preconsulta.motivoConsulta, gravedad: 'leve' } });
  });

  // Se registra la preconsulta sobre la atencion recien abierta. Si algo no
  // pasa (un dato fuera de rango, una gravedad sin justificar), se borra.
  let fallo = null;
  const deshacer = async (error) => {
    fallo = error;
    await prisma.atencion.delete({ where: { id: atencion.id } }).catch(() => {});
  };
  req.params.id = atencion.id;
  req.body = preconsulta;
  try {
    await registrarPreconsulta(req, res, deshacer);
  } catch (error) {
    await deshacer(error);
  }
  if (fallo) return next(fallo);
  await req.bitacora({ accion: 'crear', entidad: 'atencion', entidadId: atencion.id, detalle: 'Abierta al registrar la preconsulta' });
  return undefined;
}

// Se puede cancelar mientras el medico no haya escrito nada de la consulta.
const CANCELABLES = ['en_espera', 'ausente', 'en_atencion'];

/**
 * La atención en curso del paciente, si la hay. Si es una espera de otra
 * jornada (el paciente no fue atendido y se fue), se cierra sola con su
 * motivo: el paciente que vuelve al día siguiente se registra de nuevo sin
 * que alguien tenga que buscar y cancelar la de ayer.
 */
async function atencionAbierta(req, pacienteId) {
  const abierta = await prisma.atencion.findFirst({
    where: { pacienteId, estado: { in: ['en_espera', 'en_atencion'] } },
  });
  if (!abierta || abierta.estado !== 'en_espera') return abierta;
  const desde = new Date(abierta.reingresoEn ?? abierta.registradaEn);
  if (Date.now() - desde.getTime() <= HORAS_JORNADA * 3600000) return abierta;
  const motivo = 'Quedó en espera de una jornada anterior y no fue atendido';
  await prisma.atencion.update({
    where: { id: abierta.id },
    data: { estado: 'cancelada', clinicaId: null, canceladaEn: new Date(), canceladaPor: req.usuario.id, motivoCancelacion: motivo },
  });
  await req.bitacora({ accion: 'actualizar', entidad: 'atencion', entidadId: abierta.id, detalle: `Atención cancelada al registrar una nueva. Motivo: ${motivo}` });
  return null;
}

/**
 * Cancela una atencion abierta por error. No se borra: queda con su motivo,
 * quien la cancelo y cuando, y sale de la cola. Lo que ya se midio en la
 * preconsulta se conserva en el historial del paciente.
 */
async function cancelar(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId },
    include: {
      _count: { select: { prescripciones: true, recetasExternas: true, diagnosticos: true } },
    },
  });
  if (!atencion) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  if (!CANCELABLES.includes(atencion.estado)) {
    return next({
      status: 409,
      codigo: 'no_cancelable',
      mensaje: atencion.estado === 'cancelada' ? 'Esta atención ya está cancelada' : 'Una atención ya atendida no se cancela: se corrige',
    });
  }
  const c = atencion._count;
  if (atencion.diagnosticoTxt || c.prescripciones || c.recetasExternas || c.diagnosticos) {
    return next({
      status: 409,
      codigo: 'consulta_iniciada',
      mensaje: 'El médico ya registró parte de la consulta: no se puede cancelar',
    });
  }

  const cancelada = await prisma.atencion.update({
    where: { id: atencion.id },
    data: {
      estado: 'cancelada',
      clinicaId: null,
      canceladaEn: new Date(),
      canceladaPor: req.usuario.id,
      motivoCancelacion: req.body.motivo,
    },
  });
  await req.bitacora({
    accion: 'actualizar',
    entidad: 'atencion',
    entidadId: atencion.id,
    detalle: `Atención cancelada (estaba ${atencion.estado}). Motivo: ${req.body.motivo}`,
  });
  res.json({ atencion: cancelada });
}

module.exports = { crear, registrarPreconsulta, crearConPreconsulta, cancelar };
