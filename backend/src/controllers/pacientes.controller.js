const { Prisma } = require('@prisma/client');
const prisma = require('../config/db');
const {
  asegurarContador,
  siguienteExpediente,
} = require('../services/expediente.service');
const {
  detectarDuplicados,
  tokensDeBusqueda,
  calcularEdad,
} = require('../services/pacientes.service');
const {
  sincronizarCondicionesPorEdad,
  DERIVADAS_DE_EDAD,
} = require('../services/condiciones.service');
const { fechaDesdeEdad, validarEdadDeclarada } = require('../services/edadEstimada.service');
const { evaluarFicha } = require('../services/ficha.service');
const { escolaridadSigsa, estructuraIdentificacion } = require('../services/fichaIdentificacion.service');
const { fusionarCambios } = require('../services/fichaPaciente.service');
const { etapaDeVida, camposVisibles } = require('../services/etapaVida.service');
const { describirEpisodio, fechaProbableParto } = require('../services/embarazo.service');
const { CAMPOS_SENSIBLES } = require('../schemas/pacientes.schema');
const { analizarCui } = require('../services/cui.service');

const MOTIVO_CUI = {
  verificador: 'El CUI no es válido: el dígito verificador no corresponde. Revise los números.',
  departamento: 'El CUI no es válido: los dígitos del departamento no existen.',
  municipio: 'El CUI no es válido: los dígitos del municipio no existen en ese departamento.',
};

/**
 * Lo que se deduce sin preguntar: la comunidad del catalogo es del municipio
 * del centro, y el CUI dice donde se inscribio el nacimiento. Solo llena lo
 * que no se escribio a mano. Devuelve un error si el CUI no es valido.
 */
const vacio = (v) => v === undefined || v === null || v === '';

async function completarDerivados(datos, establecimientoId, { conLugar }) {
  if (datos.cui) {
    const cui = analizarCui(datos.cui);
    if (!cui.valido && cui.motivo !== 'incompleto') {
      return { status: 400, codigo: 'cui_invalido', mensaje: MOTIVO_CUI[cui.motivo] };
    }
    if (cui.valido) {
      if (vacio(datos.departamentoNacimiento)) datos.departamentoNacimiento = cui.departamento;
      if (vacio(datos.municipioNacimiento) && cui.municipio) datos.municipioNacimiento = cui.municipio;
    }
  }
  if (conLugar) {
    const est = await prisma.establecimiento.findUnique({ where: { id: establecimientoId }, select: { municipio: true, departamento: true } });
    if (vacio(datos.municipioResidencia)) datos.municipioResidencia = est.municipio;
    if (vacio(datos.departamentoResidencia)) datos.departamentoResidencia = est.departamento;
  }
  return null;
}
const {
  SIMILITUD_MINIMA,
  interpretarTexto,
  rangoEdadMeses,
  rangoNacimiento,
  razonDeCoincidencia,
} = require('../services/busquedaPacientes.service');

// Cuantos candidatos se traen de la base antes de compararlos en memoria.
const MAX_CANDIDATOS = 200;

const SELECCION_LISTA = {
  id: true,
  cui: true,
  expediente: true,
  nombres: true,
  apellidos: true,
  fechaNacimiento: true,
  sexo: true,
  comunidad: true,
  lugarPobladoId: true,
  telefono: true,
  activo: true,
  fichaCompleta: true,
  fechaNacimientoEstimada: true,
  expedientePapel: true,
  responsableNombre: true,
  responsableParentesco: true,
  responsableDpi: true,
};

/**
 * Campos que revisa la ficha para decir qué falta, en cualquier edad. La lista
 * los lee para contar lo mismo que el expediente: con solo SELECCION_LISTA,
 * todo campo no leído contaba como faltante (la lista decía 5 y la ficha 3).
 */
const CAMPOS_PACIENTE = new Set(
  Prisma.dmmf.datamodel.models.find((m) => m.name === 'Paciente').fields
    .filter((f) => f.kind === 'scalar').map((f) => f.name),
);
const SELECCION_FICHA = (() => {
  const claves = new Set();
  // Una fecha de nacimiento por cada ficha: neonato, niñez, adolescencia y juventud, adultez y persona mayor.
  for (const dias of [5, 200, 4000, 6000, 15000, 30000]) {
    const e = estructuraIdentificacion(new Date(Date.now() - dias * 86400000));
    for (const c of [...e.campos, ...e.sigsa]) {
      claves.add(c.clave);
      if (c.mostrarSi) claves.add(c.mostrarSi.campo);
    }
  }
  return Object.fromEntries([...claves].filter((c) => CAMPOS_PACIENTE.has(c)).map((c) => [c, true]));
})();

/** Lo que viaja en la lista: SELECCION_LISTA y lo calculado, no los campos de la ficha. */
function soloDeLista(p) {
  const extra = Object.keys(SELECCION_FICHA).filter((c) => !(c in SELECCION_LISTA));
  const copia = { ...p };
  for (const c of extra) delete copia[c];
  return copia;
}

/**
 * Quita los campos sensibles a quien no debe verlos.
 *
 * No aparecen en listados ni en busquedas, y en la ficha solo los ve el medico
 * y el administrador. Cada lectura queda en bitacora, en el controlador.
 */
function sinCamposSensibles(paciente) {
  if (!paciente) return paciente;
  const copia = { ...paciente };
  for (const campo of CAMPOS_SENSIBLES) delete copia[campo];
  return copia;
}

function puedeVerSensibles(usuario) {
  return usuario.rol === 'medico' || usuario.rol === 'admin';
}

/**
 * Resuelve la fecha de nacimiento: la declarada, o la calculada desde la edad
 * aproximada de quien no la conoce.
 */
function resolverNacimiento(datos) {
  if (datos.fechaNacimiento) {
    return { fechaNacimiento: datos.fechaNacimiento, estimada: false, error: null };
  }

  const { valor, unidad } = datos.edadDeclarada;
  const revision = validarEdadDeclarada(valor, unidad);
  if (!revision.valida) return { error: revision.mensaje };

  return { fechaNacimiento: fechaDesdeEdad(valor, unidad), estimada: true, error: null };
}

function conEdad(paciente) {
  if (!paciente) return paciente;

  const edad = calcularEdad(paciente.fechaNacimiento);
  const etapa = etapaDeVida(edad.edadMeses, edad.anios === 0 && edad.meses === 0 ? edad.dias : null);
  const ficha = evaluarFicha(paciente);
  const embarazo = (paciente.embarazos ?? []).find((e) => e.estado === 'activo');

  return {
    ...paciente,
    edad,
    edadEstimada: paciente.fechaNacimientoEstimada,
    etapa: etapa ? { clave: etapa.clave, etiqueta: etapa.etiqueta } : null,
    camposVisibles: camposVisibles(edad.edadMeses),
    ficha,
    embarazo: embarazo ? describirEpisodio(embarazo) : null,
  };
}

// Busca candidatos a duplicado usando los indices de la base y deja el
// ranking fino a la funcion pura, que si tiene pruebas.
async function buscarPosiblesDuplicados(establecimientoId, datos, idExcluido = null) {
  const tokens = tokensDeBusqueda(`${datos.apellidos ?? ''} ${datos.nombres ?? ''}`);

  const condicionesOr = tokens.flatMap((token) => [
    { apellidos: { contains: token, mode: 'insensitive' } },
    { nombres: { contains: token, mode: 'insensitive' } },
  ]);

  if (datos.cui) condicionesOr.push({ cui: datos.cui });
  if (condicionesOr.length === 0) return [];

  const candidatos = await prisma.paciente.findMany({
    where: {
      establecimientoId,
      activo: true,
      ...(idExcluido ? { NOT: { id: idExcluido } } : {}),
      OR: condicionesOr,
    },
    select: SELECCION_LISTA,
    take: MAX_CANDIDATOS,
  });

  return detectarDuplicados(candidatos, datos);
}

async function listar(req, res) {
  const {
    buscar, comunidad, lugarPobladoId, sexo, edadMinima, edadMaxima, etapa,
    embarazoActivo, fichaIncompleta, conAlertas, pagina, limite,
  } = req.query;
  const establecimientoId = req.usuario.establecimientoId;
  const ahora = new Date();

  const interpretado = interpretarTexto(buscar);
  const nacimiento = rangoNacimiento(rangoEdadMeses({ edadMinima, edadMaxima, etapa }), ahora);

  // --- Filtros que no dependen del texto ------------------------------------
  const filtros = {
    establecimientoId,
    activo: true,
    ...(comunidad ? { comunidad: { equals: comunidad, mode: 'insensitive' } } : {}),
    ...(lugarPobladoId ? { lugarPobladoId } : {}),
    ...(sexo ? { sexo } : {}),
    ...(fichaIncompleta !== undefined ? { fichaCompleta: !fichaIncompleta } : {}),
    ...(nacimiento
      ? {
        fechaNacimiento: {
          ...(nacimiento.desde ? { gt: nacimiento.desde } : {}),
          ...(nacimiento.hasta ? { lte: nacimiento.hasta } : {}),
        },
      }
      : {}),
    ...(embarazoActivo !== undefined
      ? (embarazoActivo
        ? { embarazos: { some: { estado: 'activo' } } }
        : { embarazos: { none: { estado: 'activo' } } })
      : {}),
  };

  // --- Filtro por texto -----------------------------------------------------
  let idsPorSimilitud = null;

  if (interpretado.tipo === 'numero' || interpretado.tipo === 'expediente') {
    const v = interpretado.valor;
    filtros.OR = [
      { cui: v },
      { expediente: v },
      { expedientePapel: v },
      { telefono: { contains: v } },
      { responsableDpi: v },
      { expediente: { startsWith: v } },
    ];
  } else if (interpretado.tipo === 'texto') {
    // La similitud por trigramas es lo unico que no se puede expresar con el
    // constructor de consultas: se resuelve aparte y se filtra por id.
    await prisma.$executeRawUnsafe(`SET pg_trgm.similarity_threshold = ${SIMILITUD_MINIMA}`);

    const filas = await prisma.$queryRaw`
      SELECT id,
             GREATEST(
               similarity(nombre_busqueda, ${interpretado.valor}),
               similarity(responsable_busqueda, ${interpretado.valor})
             ) AS puntaje
      FROM paciente
      WHERE establecimiento_id = ${establecimientoId}
        AND activo = TRUE
        AND (nombre_busqueda % ${interpretado.valor}
             OR nombre_busqueda LIKE ${'%' + interpretado.valor + '%'}
             OR responsable_busqueda % ${interpretado.valor}
             OR responsable_busqueda LIKE ${'%' + interpretado.valor + '%'})
      ORDER BY puntaje DESC
      LIMIT 500`;

    // Un expediente puede tener letras (los de papel las tienen), asi que
    // tambien se busca por identificador aunque el texto no sea numerico.
    const porIdentificador = await prisma.paciente.findMany({
      where: {
        establecimientoId,
        activo: true,
        OR: [
          { expediente: { contains: buscar.trim(), mode: 'insensitive' } },
          { expedientePapel: { contains: buscar.trim(), mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    idsPorSimilitud = new Map(filas.map((f) => [f.id, Number(f.puntaje)]));
    // La coincidencia de identificador manda sobre la similitud de nombre.
    for (const { id } of porIdentificador) idsPorSimilitud.set(id, 1);

    filtros.id = { in: [...idsPorSimilitud.keys()] };
  }

  // --- Alertas abiertas -----------------------------------------------------
  let idsConAlertas = null;
  if (conAlertas !== undefined) {
    const alertas = await prisma.alerta.findMany({
      where: { establecimientoId, estado: { not: 'resuelta' }, entidadTipo: 'paciente' },
      select: { entidadId: true },
    });
    idsConAlertas = new Set(alertas.map((a) => a.entidadId));

    const lista = [...idsConAlertas];
    if (conAlertas) {
      filtros.id = filtros.id
        ? { in: (filtros.id.in ?? []).filter((id) => idsConAlertas.has(id)) }
        : { in: lista };
    } else if (lista.length > 0) {
      filtros.NOT = { ...(filtros.NOT ?? {}), id: { in: lista } };
    }
  }

  const [total, pacientes] = await Promise.all([
    prisma.paciente.count({ where: filtros }),
    prisma.paciente.findMany({
      where: filtros,
      select: { ...SELECCION_LISTA, ...SELECCION_FICHA, embarazos: { where: { estado: 'activo' }, select: { id: true } } },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
      // Con similitud se ordena por relevancia, asi que se traen todos los
      // candidatos y se pagina despues de ordenar.
      ...(idsPorSimilitud ? {} : { skip: (pagina - 1) * limite, take: limite }),
    }),
  ]);

  let resultado = pacientes;

  if (idsPorSimilitud) {
    resultado = [...pacientes]
      .sort((a, b) => (idsPorSimilitud.get(b.id) ?? 0) - (idsPorSimilitud.get(a.id) ?? 0))
      .slice((pagina - 1) * limite, pagina * limite);
  }

  res.json({
    pacientes: resultado.map((p) => {
      const { embarazos, ...datos } = p;
      return sinCamposSensibles({
        ...soloDeLista(conEdad(datos)),
        embarazoActivo: embarazos.length > 0,
        conAlertas: idsConAlertas ? idsConAlertas.has(p.id) : undefined,
        // Por que aparecio: sin esto, encontrar a una nina buscando el nombre
        // de su madre resulta desconcertante.
        razonCoincidencia: razonDeCoincidencia(p, interpretado),
        similitud: idsPorSimilitud ? Number((idsPorSimilitud.get(p.id) ?? 0).toFixed(2)) : undefined,
      });
    }),
    paginacion: {
      pagina,
      limite,
      total: idsPorSimilitud ? idsPorSimilitud.size : total,
      paginas: Math.max(1, Math.ceil((idsPorSimilitud ? idsPorSimilitud.size : total) / limite)),
    },
    umbralSimilitud: SIMILITUD_MINIMA,
  });
}

async function obtener(req, res, next) {
  const paciente = await prisma.paciente.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    include: {
      condiciones: {
        where: { vigenteHasta: null },
        select: { id: true, tipo: true, vigenteDesde: true },
      },
      embarazos: { where: { estado: 'activo' } },
      lugarPoblado: true,
    },
  });

  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  // Leer un expediente clinico queda registrado, no solo las escrituras.
  await req.bitacora({ accion: 'leer', entidad: 'paciente', entidadId: paciente.id });

  const verSensibles = puedeVerSensibles(req.usuario);
  const tieneSensibles = CAMPOS_SENSIBLES.some((c) => paciente[c] != null);

  // La consulta de datos sensibles se registra aparte: no basta con saber que
  // alguien abrio el expediente.
  if (verSensibles && tieneSensibles) {
    await req.bitacora({
      accion: 'leer',
      entidad: 'paciente_datos_sensibles',
      entidadId: paciente.id,
      detalle: 'Consulta de datos sensibles del expediente',
    });
  }

  const salida = conEdad(paciente);

  res.json({ paciente: verSensibles ? salida : sinCamposSensibles(salida) });
}

/**
 * El CUI es unico en todo el sistema. Si ya lo tiene otro paciente, se dice
 * quien es en vez de dejar que la base rechace el registro sin explicacion.
 */
async function errorCuiRegistrado(cui, establecimientoId, idExcluido = null) {
  if (!cui) return null;
  const otro = await prisma.paciente.findFirst({
    where: { cui, ...(idExcluido ? { NOT: { id: idExcluido } } : {}) },
    select: { id: true, expediente: true, nombres: true, apellidos: true, establecimientoId: true },
  });
  if (!otro) return null;
  const aqui = otro.establecimientoId === establecimientoId;
  return {
    status: 409,
    codigo: 'cui_registrado',
    mensaje: aqui
      ? `El CUI ${cui} ya está registrado en el expediente ${otro.expediente} (${otro.apellidos} ${otro.nombres})`
      : `El CUI ${cui} ya está registrado en otro establecimiento`,
    detalles: aqui ? [{ id: otro.id, expediente: otro.expediente, nombreCompleto: `${otro.apellidos} ${otro.nombres}` }] : null,
  };
}

async function crear(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { condiciones, confirmarDuplicado, edadDeclarada, ...datos } = req.body;

  // Quien no conoce su fecha de nacimiento declara su edad y el sistema
  // calcula una aproximada, marcada como tal.
  const nacimiento = resolverNacimiento({ ...datos, edadDeclarada });
  if (nacimiento.error) {
    return next({ status: 400, codigo: 'edad_invalida', mensaje: nacimiento.error });
  }

  datos.fechaNacimiento = nacimiento.fechaNacimiento;

  const edad = calcularEdad(datos.fechaNacimiento);
  const visibles = camposVisibles(edad.edadMeses);

  // En menores de 18 el responsable no es opcional.
  if (visibles.responsable && !datos.responsableNombre) {
    return next({
      status: 400,
      codigo: 'responsable_requerido',
      mensaje: visibles.referenteAdulto
        ? 'En pacientes de 10 a 17 años debe indicar el referente adulto'
        : 'En menores de 18 años debe indicar el responsable',
    });
  }

  // La comunidad viene del catalogo: se toma su nombre para el texto libre,
  // que se conserva por compatibilidad con lo ya registrado.
  if (datos.lugarPobladoId) {
    const lugar = await prisma.lugarPoblado.findFirst({
      where: { id: datos.lugarPobladoId, establecimientoId },
    });

    if (!lugar) {
      return next({
        status: 400,
        codigo: 'lugar_invalido',
        mensaje: 'El lugar poblado indicado no existe en este establecimiento',
      });
    }

    datos.comunidad = lugar.nombre;
  }

  const errorDerivado = await completarDerivados(datos, establecimientoId, { conLugar: Boolean(datos.lugarPobladoId) });
  if (errorDerivado) return next(errorDerivado);

  const cuiRegistrado = await errorCuiRegistrado(datos.cui, establecimientoId);
  if (cuiRegistrado) return next(cuiRegistrado);

  const duplicados = await buscarPosiblesDuplicados(establecimientoId, datos);

  // No se bloquea el registro: se advierte y se exige confirmacion explicita,
  // porque solo la persona que atiende sabe si es el mismo paciente.
  if (duplicados.length > 0 && !confirmarDuplicado) {
    return next({
      status: 409,
      codigo: 'posible_duplicado',
      mensaje: 'Existe un expediente con nombre similar. Confirme si es la misma persona',
      detalles: duplicados.map(({ paciente, puntaje, razones }) => ({
        id: paciente.id,
        expediente: paciente.expediente,
        nombreCompleto: `${paciente.apellidos} ${paciente.nombres}`,
        fechaNacimiento: paciente.fechaNacimiento,
        comunidad: paciente.comunidad,
        puntaje,
        razones,
      })),
    });
  }

  // La fila del contador se asegura fuera de la transaccion: un choque por
  // clave duplicada dentro de ella la invalidaria entera.
  const ahora = new Date();
  await asegurarContador(establecimientoId, ahora.getUTCFullYear());

  const paciente = await prisma.$transaction(async (tx) => {
    // El numero se toma dentro de la transaccion: si el registro falla, el
    // correlativo se devuelve y no queda un hueco en la numeracion.
    const expediente = await siguienteExpediente(tx, establecimientoId, ahora);

    const creado = await tx.paciente.create({
      data: {
        ...datos,
        expediente,
        establecimientoId,
        fechaNacimientoEstimada: nacimiento.estimada,
        // El registro rapido nunca deja la ficha completa: falta lo demas.
        fichaCompleta: false,
        // El embarazo ya no es una condicion del paciente: es un episodio.
        condiciones: {
          create: condiciones.filter((t) => t !== 'embarazo').map((tipo) => ({ tipo })),
        },
      },
    });

    // menor_5 y adulto_mayor quedan visibles en el expediente desde el alta,
    // sin esperar a que se abra la primera atencion.
    await sincronizarCondicionesPorEdad(tx, creado);

    return tx.paciente.findUnique({
      where: { id: creado.id },
      include: {
        condiciones: { where: { vigenteHasta: null } },
        embarazos: { where: { estado: 'activo' } },
      },
    });
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'paciente',
    entidadId: paciente.id,
    detalle: confirmarDuplicado ? 'Registrado tras confirmar posible duplicado' : null,
  });

  res.status(201).json({ paciente: sinCamposSensibles(conEdad(paciente)) });
}

async function actualizar(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const { condiciones, edadDeclarada, ...datos } = req.body;

  const sensiblesEnviados = CAMPOS_SENSIBLES.filter((c) => c in datos);

  // La ficha de adulto pregunta la escolaridad con sus propias opciones; el
  // codigo SIGSA se deriva de esa respuesta y no se pregunta dos veces.
  if ('nivelEscolar' in datos) {
    datos.escolaridad = escolaridadSigsa(datos.nivelEscolar) ?? datos.escolaridad ?? null;
  }

  // Sin trabajo no hay nada que especificar.
  if (datos.trabaja === false) datos.trabajoEspecifique = null;

  if (edadDeclarada) {
    const nacimiento = resolverNacimiento({ ...datos, edadDeclarada });
    if (nacimiento.error) {
      return next({ status: 400, codigo: 'edad_invalida', mensaje: nacimiento.error });
    }
    datos.fechaNacimiento = nacimiento.fechaNacimiento;
    datos.fechaNacimientoEstimada = true;
  } else if (datos.fechaNacimiento) {
    // Al corregirla con la fecha real deja de ser aproximada.
    datos.fechaNacimientoEstimada = false;
  }

  if (datos.lugarPobladoId) {
    const lugar = await prisma.lugarPoblado.findFirst({
      where: { id: datos.lugarPobladoId, establecimientoId },
    });
    if (!lugar) {
      return next({
        status: 400,
        codigo: 'lugar_invalido',
        mensaje: 'El lugar poblado indicado no existe en este establecimiento',
      });
    }
    datos.comunidad = lugar.nombre;
  }

  const errorDerivado = await completarDerivados(datos, establecimientoId, { conLugar: Boolean(datos.lugarPobladoId) });
  if (errorDerivado) return next(errorDerivado);

  const existente = await prisma.paciente.findFirst({
    where: { id: req.params.id, establecimientoId },
    include: { condiciones: { where: { vigenteHasta: null } } },
  });

  if (!existente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  // Preconsulta registra un dato sensible al pasar la ficha de papel, pero
  // una vez guardado no lo puede cambiar: no sabe que dice.
  const anteriores = Object.fromEntries(Object.keys(datos).map((k) => [k, existente[k] ?? null]));
  const fusion = fusionarCambios({
    anteriores,
    nuevos: datos,
    sensibles: new Set(CAMPOS_SENSIBLES),
    puedeVerSensibles: puedeVerSensibles(req.usuario),
  });
  if (fusion.error) {
    return next({
      status: 403,
      codigo: 'sensible_registrado',
      mensaje: 'Ese dato sensible ya está registrado. Solo el personal médico o el administrador puede cambiarlo',
      detalles: { campos: fusion.campos },
    });
  }

  if (datos.cui && datos.cui !== existente.cui) {
    const cuiRegistrado = await errorCuiRegistrado(datos.cui, req.usuario.establecimientoId, existente.id);
    if (cuiRegistrado) return next(cuiRegistrado);
  }

  const paciente = await prisma.$transaction(async (tx) => {
    if (condiciones) {
      // Solo se tocan las condiciones que registra el personal. menor_5 y
      // adulto_mayor las deriva el sistema de la fecha de nacimiento, y no
      // deben cerrarse porque no vinieran en el formulario.
      const manuales = condiciones.filter((tipo) => !DERIVADAS_DE_EDAD.includes(tipo));
      const vigentesManuales = existente.condiciones
        .map((c) => c.tipo)
        .filter((tipo) => !DERIVADAS_DE_EDAD.includes(tipo));

      const porCerrar = vigentesManuales.filter((tipo) => !manuales.includes(tipo));
      const porAbrir = manuales.filter((tipo) => !vigentesManuales.includes(tipo));

      // Las condiciones no se borran: se cierran con fecha, para conservar el
      // historial de por que un paciente tuvo prioridad en su momento.
      if (porCerrar.length > 0) {
        await tx.condicionPaciente.updateMany({
          where: { pacienteId: existente.id, tipo: { in: porCerrar }, vigenteHasta: null },
          data: { vigenteHasta: new Date() },
        });
      }
      if (porAbrir.length > 0) {
        await tx.condicionPaciente.createMany({
          data: porAbrir.map((tipo) => ({ pacienteId: existente.id, tipo })),
        });
      }
    }

    const actualizado = await tx.paciente.update({ where: { id: existente.id }, data: datos });

    // Cada cambio de la identificacion queda con quien, cuando y el valor
    // anterior, igual que las demas secciones de la ficha.
    // Las fechas se guardan como texto ISO dentro del JSON del historial.
    const json = (v) => (v === null || v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    if (fusion.cambios.length > 0) {
      await tx.cambioFicha.createMany({
        data: fusion.cambios.map((c) => ({
          pacienteId: existente.id,
          seccion: 'identificacion',
          campo: c.campo,
          valorAnterior: json(c.anterior),
          valorNuevo: json(c.nuevo),
          sensible: c.sensible,
          usuarioId: req.usuario.id,
        })),
      });
    }

    // Si se corrigio la fecha de nacimiento, las condiciones por edad cambian.
    await sincronizarCondicionesPorEdad(tx, actualizado);

    // La marca de ficha completa se recalcula: es una consecuencia de lo
    // guardado, no algo que el formulario declare.
    const ficha = evaluarFicha(actualizado);

    if (ficha.completa !== actualizado.fichaCompleta) {
      await tx.paciente.update({
        where: { id: actualizado.id },
        data: { fichaCompleta: ficha.completa },
      });
    }

    return tx.paciente.findUnique({
      where: { id: actualizado.id },
      include: {
        condiciones: { where: { vigenteHasta: null } },
        embarazos: { where: { estado: 'activo' } },
        lugarPoblado: true,
      },
    });
  });

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'paciente',
    entidadId: paciente.id,
    detalle: `Campos modificados: ${Object.keys(req.body).join(', ')}`
      + (sensiblesEnviados.length > 0
        ? `. Datos sensibles: ${sensiblesEnviados.join(', ')}`
        : ''),
  });

  const salida = conEdad(paciente);
  res.json({ paciente: puedeVerSensibles(req.usuario) ? salida : sinCamposSensibles(salida) });
}

// Consulta previa al alta: permite avisar del duplicado mientras se escribe,
// sin tener que intentar guardar primero.
async function revisarDuplicados(req, res) {
  const duplicados = await buscarPosiblesDuplicados(req.usuario.establecimientoId, req.body);

  res.json({
    posiblesDuplicados: duplicados.map(({ paciente, puntaje, razones }) => ({
      id: paciente.id,
      expediente: paciente.expediente,
      nombreCompleto: `${paciente.apellidos} ${paciente.nombres}`,
      fechaNacimiento: paciente.fechaNacimiento,
      comunidad: paciente.comunidad,
      puntaje,
      razones,
    })),
  });
}

async function historial(req, res, next) {
  const paciente = await prisma.paciente.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    select: { id: true },
  });

  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const atenciones = await prisma.atencion.findMany({
    where: { pacienteId: paciente.id },
    orderBy: { registradaEn: 'desc' },
    include: { preconsulta: true },
  });

  await req.bitacora({ accion: 'leer', entidad: 'paciente_historial', entidadId: paciente.id });

  res.json({ atenciones });
}

module.exports = { listar, obtener, crear, actualizar, revisarDuplicados, historial };
