const prisma = require('../config/db');
const { aKilogramos, redondear: redondearPeso } = require('../services/unidadesPeso.service');
const { calcularEdad } = require('../services/pacientes.service');
const { sincronizarCondicionesPorEdad } = require('../services/condiciones.service');
const { evaluarSignosVitales } = require('../services/signosVitales.service');
const { compararConAnterior } = require('../services/antropometria.service');
const { evaluarMedicion } = require('../services/antropometriaDatos.service');
const { ETIQUETA_CLASIFICACION } = require('./antropometria.controller');

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
  const abierta = await prisma.atencion.findFirst({
    where: { pacienteId, estado: { in: ['en_espera', 'en_atencion'] } },
  });

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
  const hayUrgente = marcados.some((signo) => signo.gravedadSugerida === 'urgente');
  const gravedadSugerida = hayUrgente ? 'urgente' : marcados.length > 0 ? 'moderado' : null;

  // Si el sistema propone urgente y el personal elige algo menor, debe
  // justificarlo por escrito.
  const gravedadFinal = gravedad ?? gravedadSugerida ?? atencion.gravedad;
  const bajaLaGravedad = gravedadSugerida === 'urgente' && gravedadFinal !== 'urgente';

  if (bajaLaGravedad && !justificacionGravedad) {
    return next({
      status: 400,
      codigo: 'justificacion_requerida',
      mensaje: 'Se marco un signo de peligro urgente. Debe justificar por escrito una gravedad menor',
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
      data: { ...signosVitales, unidadPeso, atencionId: atencion.id, signosPeligro },
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
  // pantalla de reportes aparte.
  res.status(201).json({
    preconsulta,
    gravedad: gravedadFinal,
    gravedadSugerida,
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

module.exports = { crear, registrarPreconsulta };
