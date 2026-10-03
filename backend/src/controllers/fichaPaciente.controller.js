/**
 * Ficha del paciente completa: identificacion, antecedentes y demas secciones
 * que son del paciente, tal como las trae la ficha oficial de su edad.
 *
 * Preconsulta la va pasando del papel al sistema, una seccion a la vez.
 */

const prisma = require('../config/db');
const { estructuraIdentificacion, faltantes } = require('../services/fichaIdentificacion.service');
const {
  seccionesDe,
  clavesSensibles,
  esquemaSeccion,
  normalizarDatos,
  avanceSeccion,
  calculados,
} = require('../services/fichaSecciones.service');
const {
  enmascarar,
  fusionarCambios,
  historialVisible,
  puedeVerSensibles,
  iguales,
} = require('../services/fichaPaciente.service');
const { calcularEdad } = require('../services/pacientes.service');
const { DEPARTAMENTOS, MUNICIPIOS } = require('../services/geografia.service');
const { CAMPOS_SENSIBLES } = require('../schemas/pacientes.schema');

const SENSIBLES_IDENTIFICACION = new Set(CAMPOS_SENSIBLES);
const TIPOS_ARCHIVO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const nombreDe = (u) => u?.nombre ?? null;

async function buscarPaciente(req) {
  return prisma.paciente.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    include: { lugarPoblado: true },
  });
}

/** Sexo y edad del paciente, que deciden que campos aplican. */
function perfil(paciente) {
  return { sexo: paciente.sexo, edadMeses: calcularEdad(paciente.fechaNacimiento).edadMeses };
}

/** Claves de la identificacion que se editan en la ficha. */
function clavesIdentificacion(estructura) {
  const claves = [];
  for (const c of [...estructura.campos, ...estructura.sigsa]) {
    if (['registrado', 'calculado'].includes(c.tipo)) continue;
    claves.push(c.clave);
    if (c.especifique) claves.push(c.especifique.clave);
  }
  return claves;
}

function avanceIdentificacion(estructura, valores) {
  const editables = estructura.campos.filter((c) => !['registrado', 'calculado'].includes(c.tipo));
  const vistos = editables.filter((c) => !c.mostrarSi || valores[c.mostrarSi.campo] === c.mostrarSi.igual);
  const lleno = (v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');
  return { respondidas: vistos.filter((c) => lleno(valores[c.clave])).length, total: vistos.length };
}

/** Estado de una seccion para quien la pide: datos (ocultando lo sensible) y avance. */
function estadoSeccion(seccion, fila, paciente, verSensibles) {
  const datos = fila?.datos ?? {};
  const sensibles = clavesSensibles(seccion);
  const { datos: visibles, registrados } = verSensibles
    ? { datos, registrados: [] }
    : enmascarar(datos, sensibles);
  return {
    clave: seccion.clave,
    titulo: seccion.titulo,
    subtitulo: seccion.subtitulo ?? null,
    grupo: seccion.grupo,
    campos: seccion.campos,
    datos: visibles,
    sensiblesRegistrados: registrados,
    calculados: calculados(seccion, datos),
    avance: avanceSeccion(seccion, datos, perfil(paciente)),
    estado: fila ? 'registrado' : 'sin_registrar',
    actualizadoEn: fila?.actualizadoEn ?? null,
    actualizadoPor: nombreDe(fila?.usuario),
  };
}

function sensiblesConValor(datos, sensibles) {
  return [...sensibles].filter((k) => datos[k] !== null && datos[k] !== undefined && datos[k] !== '');
}

// --- GET /pacientes/:id/ficha ----------------------------------------------

async function obtener(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const verSensibles = puedeVerSensibles(req.usuario);
  const estructura = estructuraIdentificacion(paciente.fechaNacimiento);
  const secciones = seccionesDe(estructura.ficha.clave, perfil(paciente));

  const [filas, ultimoCambioIdentificacion, archivos] = await Promise.all([
    prisma.seccionPaciente.findMany({
      where: { pacienteId: paciente.id },
      include: { usuario: { select: { nombre: true } } },
    }),
    prisma.cambioFicha.findFirst({
      where: { pacienteId: paciente.id, seccion: 'identificacion' },
      orderBy: { registradoEn: 'desc' },
      include: { usuario: { select: { nombre: true } } },
    }),
    prisma.archivoPaciente.findMany({
      where: { pacienteId: paciente.id },
      orderBy: { subidoEn: 'desc' },
      select: { id: true, tipo: true, nombre: true, tipoMime: true, tamano: true, subidoEn: true, usuario: { select: { nombre: true } } },
    }),
  ]);
  const porClave = new Map(filas.map((f) => [f.seccion, f]));

  // Identificacion: vive en columnas del paciente.
  const valores = Object.fromEntries(clavesIdentificacion(estructura).map((k) => [k, paciente[k] ?? null]));
  const identificacion = verSensibles
    ? { datos: valores, registrados: [] }
    : enmascarar(valores, SENSIBLES_IDENTIFICACION);

  const estados = secciones.map((s) => estadoSeccion(s, porClave.get(s.clave), paciente, verSensibles));

  // Leer datos sensibles queda en bitacora, con cuales se mostraron.
  if (verSensibles) {
    const leidos = [
      ...sensiblesConValor(valores, SENSIBLES_IDENTIFICACION),
      ...secciones.flatMap((s) => sensiblesConValor(porClave.get(s.clave)?.datos ?? {}, clavesSensibles(s))
        .map((k) => `${s.clave}.${k}`)),
    ];
    if (leidos.length > 0) {
      await req.bitacora({
        accion: 'leer',
        entidad: 'paciente_datos_sensibles',
        entidadId: paciente.id,
        detalle: `Ficha completa. Campos: ${leidos.join(', ')}`,
      });
    }
  }
  await req.bitacora({ accion: 'leer', entidad: 'paciente', entidadId: paciente.id });

  const edad = calcularEdad(paciente.fechaNacimiento);
  res.json({
    paciente: {
      id: paciente.id,
      nombres: paciente.nombres,
      apellidos: paciente.apellidos,
      expediente: paciente.expediente,
      expedientePapel: paciente.expedientePapel,
      sexo: paciente.sexo,
      fechaNacimiento: paciente.fechaNacimiento,
      fechaNacimientoEstimada: paciente.fechaNacimientoEstimada,
      comunidad: paciente.comunidad,
      lugarPobladoId: paciente.lugarPobladoId,
      edad,
    },
    ficha: estructura.ficha,
    identificacion: {
      titulo: estructura.seccion,
      campos: estructura.campos,
      sigsa: estructura.sigsa,
      datos: identificacion.datos,
      sensiblesRegistrados: identificacion.registrados,
      avance: avanceIdentificacion(estructura, valores),
      actualizadoEn: ultimoCambioIdentificacion?.registradoEn ?? null,
      actualizadoPor: nombreDe(ultimoCambioIdentificacion?.usuario),
    },
    secciones: estados,
    // Solo los minimos del SIGSA: el resto se ve como "sin registrar".
    faltantes: faltantes(paciente, estructura),
    archivos: archivos.map((a) => ({ ...a, subidoPor: nombreDe(a.usuario), usuario: undefined })),
    departamentos: DEPARTAMENTOS,
    municipios: MUNICIPIOS,
    puedeVerSensibles: verSensibles,
  });
}

// --- PUT /pacientes/:id/ficha/:seccion -------------------------------------------

async function guardarSeccion(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const estructura = estructuraIdentificacion(paciente.fechaNacimiento);
  const seccion = seccionesDe(estructura.ficha.clave, perfil(paciente)).find((s) => s.clave === req.params.seccion);
  if (!seccion) {
    return next({
      status: 404,
      codigo: 'seccion_inexistente',
      mensaje: 'Esa sección no es parte de la ficha que corresponde a este paciente',
    });
  }

  const validacion = esquemaSeccion(seccion).safeParse(req.body.datos ?? {});
  if (!validacion.success) {
    return next({
      status: 400,
      codigo: 'validacion',
      mensaje: 'Revise los datos de la sección',
      detalles: validacion.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    });
  }

  const fila = await prisma.seccionPaciente.findUnique({
    where: { pacienteId_seccion: { pacienteId: paciente.id, seccion: seccion.clave } },
  });
  const anteriores = fila?.datos ?? {};

  // Lo que depende de otra respuesta se limpia ya junto con lo anterior:
  // un "especifique" sin su Si no queda guardado.
  const juntos = normalizarDatos(seccion, { ...anteriores, ...validacion.data });
  const nuevos = Object.fromEntries(Object.entries(juntos).filter(([k, v]) => !iguales(anteriores[k], v)));

  const sensibles = clavesSensibles(seccion);
  const verSensibles = puedeVerSensibles(req.usuario);
  const fusion = fusionarCambios({ anteriores, nuevos, sensibles, puedeVerSensibles: verSensibles });
  if (fusion.error) {
    return next({
      status: 403,
      codigo: 'sensible_registrado',
      mensaje: 'Ese dato sensible ya está registrado. Solo el personal médico o el administrador puede cambiarlo',
      detalles: { campos: fusion.campos },
    });
  }

  if (fusion.cambios.length > 0 || !fila) {
    await prisma.$transaction(async (tx) => {
      await tx.seccionPaciente.upsert({
        where: { pacienteId_seccion: { pacienteId: paciente.id, seccion: seccion.clave } },
        create: { pacienteId: paciente.id, seccion: seccion.clave, datos: fusion.datos, actualizadoPor: req.usuario.id },
        update: { datos: fusion.datos, actualizadoPor: req.usuario.id, actualizadoEn: new Date() },
      });
      if (fusion.cambios.length > 0) {
        await tx.cambioFicha.createMany({
          data: fusion.cambios.map((c) => ({
            pacienteId: paciente.id,
            seccion: seccion.clave,
            campo: c.campo,
            valorAnterior: c.anterior ?? undefined,
            valorNuevo: c.nuevo ?? undefined,
            sensible: c.sensible,
            usuarioId: req.usuario.id,
          })),
        });
      }
    });

    await req.bitacora({
      accion: fila ? 'actualizar' : 'crear',
      entidad: 'paciente_ficha',
      entidadId: paciente.id,
      detalle: `${seccion.grupo} · ${seccion.titulo}: ${fusion.cambios.length} dato(s)`,
    });

    const escritos = fusion.cambios.filter((c) => c.sensible).map((c) => c.campo);
    if (escritos.length > 0) {
      await req.bitacora({
        accion: 'actualizar',
        entidad: 'paciente_datos_sensibles',
        entidadId: paciente.id,
        detalle: `Escritura en ${seccion.clave}. Campos: ${escritos.join(', ')}`,
      });
    }
  }

  const guardada = await prisma.seccionPaciente.findUnique({
    where: { pacienteId_seccion: { pacienteId: paciente.id, seccion: seccion.clave } },
    include: { usuario: { select: { nombre: true } } },
  });
  res.json({ seccion: estadoSeccion(seccion, guardada, paciente, verSensibles), cambios: fusion.cambios.length });
}

// --- GET /pacientes/:id/ficha/:seccion/historial -------------------------------

async function historial(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const cambios = await prisma.cambioFicha.findMany({
    where: { pacienteId: paciente.id, seccion: req.params.seccion },
    orderBy: { registradoEn: 'desc' },
    take: 200,
    include: { usuario: { select: { nombre: true } } },
  });

  const verSensibles = puedeVerSensibles(req.usuario);
  const visibles = historialVisible(
    cambios.map((c) => ({
      id: c.id,
      campo: c.campo,
      anterior: c.valorAnterior,
      nuevo: c.valorNuevo,
      sensible: c.sensible,
      usuario: nombreDe(c.usuario),
      registradoEn: c.registradoEn,
    })),
    verSensibles,
  );

  const sensiblesLeidos = cambios.filter((c) => c.sensible).map((c) => c.campo);
  if (verSensibles && sensiblesLeidos.length > 0) {
    await req.bitacora({
      accion: 'leer',
      entidad: 'paciente_datos_sensibles',
      entidadId: paciente.id,
      detalle: `Historial de ${req.params.seccion}. Campos: ${[...new Set(sensiblesLeidos)].join(', ')}`,
    });
  }

  res.json({ cambios: visibles });
}

// --- Familiograma ---------------------------------------------------------------

async function subirArchivo(req, res, next) {
  const paciente = await buscarPaciente(req);
  if (!paciente) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });
  }

  const tipoMime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  if (!TIPOS_ARCHIVO.includes(tipoMime)) {
    return next({ status: 400, codigo: 'archivo_invalido', mensaje: 'El familiograma debe ser una foto (JPG, PNG) o un PDF' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return next({ status: 400, codigo: 'archivo_vacio', mensaje: 'No llegó ningún archivo' });
  }

  let nombre = 'familiograma';
  try {
    nombre = decodeURIComponent(String(req.headers['x-nombre-archivo'] ?? nombre)).slice(0, 200) || nombre;
  } catch {
    // Un nombre mal codificado no impide guardar el archivo.
  }

  const estructura = estructuraIdentificacion(paciente.fechaNacimiento);
  const seccion = seccionesDe(estructura.ficha.clave, perfil(paciente)).find((s) => s.clave === 'familiograma');
  if (!seccion) {
    return next({ status: 400, codigo: 'seccion_inexistente', mensaje: 'La ficha de este paciente no lleva familiograma' });
  }

  const archivo = await prisma.$transaction(async (tx) => {
    const creado = await tx.archivoPaciente.create({
      data: {
        pacienteId: paciente.id,
        tipo: 'familiograma',
        nombre,
        tipoMime,
        tamano: req.body.length,
        contenido: req.body,
        subidoPor: req.usuario.id,
      },
      select: { id: true, nombre: true, tipoMime: true, tamano: true, subidoEn: true },
    });

    // La seccion apunta al familiograma vigente; el anterior queda guardado.
    const fila = await tx.seccionPaciente.findUnique({
      where: { pacienteId_seccion: { pacienteId: paciente.id, seccion: 'familiograma' } },
    });
    await tx.seccionPaciente.upsert({
      where: { pacienteId_seccion: { pacienteId: paciente.id, seccion: 'familiograma' } },
      create: { pacienteId: paciente.id, seccion: 'familiograma', datos: { familiograma: creado.id }, actualizadoPor: req.usuario.id },
      update: { datos: { familiograma: creado.id }, actualizadoPor: req.usuario.id, actualizadoEn: new Date() },
    });
    await tx.cambioFicha.create({
      data: {
        pacienteId: paciente.id,
        seccion: 'familiograma',
        campo: 'familiograma',
        valorAnterior: fila?.datos?.familiograma ?? undefined,
        valorNuevo: creado.id,
        usuarioId: req.usuario.id,
      },
    });
    return creado;
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'archivo_paciente',
    entidadId: archivo.id,
    detalle: `Familiograma del paciente ${paciente.id}: ${nombre} (${archivo.tamano} bytes)`,
  });

  res.status(201).json({ archivo });
}

async function descargarArchivo(req, res, next) {
  const archivo = await prisma.archivoPaciente.findFirst({
    where: {
      id: Number(req.params.archivoId),
      pacienteId: Number(req.params.id),
      paciente: { establecimientoId: req.usuario.establecimientoId },
    },
  });
  if (!archivo) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Archivo no encontrado' });
  }

  await req.bitacora({ accion: 'leer', entidad: 'archivo_paciente', entidadId: archivo.id });

  res.setHeader('Content-Type', archivo.tipoMime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(archivo.nombre)}"`);
  res.send(Buffer.from(archivo.contenido));
}

module.exports = {
  obtener,
  guardarSeccion,
  historial,
  subirArchivo,
  descargarArchivo,
  // Para el resumen del medico y la impresion.
  estadoSeccion,
  perfil,
};
