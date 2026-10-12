/**
 * Triaje y parametros de la prioridad.
 *
 * evaluar: lo que la preconsulta va mostrando mientras se escriben los signos.
 * parametros: criterios clinicos, puntos y tiempos, que solo se cambian con la
 *   autorizacion del director, y quedan en la bitacora con el antes y despues.
 * probar: "si llega un nino de 8 meses con 39 °C, ¿que nivel le da?".
 */

const prisma = require('../config/db');
const { calcularEdad } = require('../services/pacientes.service');
const { evaluarSignosVitales } = require('../services/signosVitales.service');
const { triaje } = require('../services/triaje.service');
const { parametros, olvidar } = require('../services/parametrosPriorizacion.service');
const { calcularPuntaje, explicarPuntaje, nivelEnCola, normalizarPuntos } = require('../services/priorizacion.service');

const MEDICION = ['temperatura', 'presionSis', 'presionDia', 'frecCardiaca', 'frecRespiratoria', 'satOxigeno', 'dolor', 'conciencia', 'glucosa'];
const soloMedicion = (b) => Object.fromEntries(MEDICION.filter((k) => b[k] !== undefined && b[k] !== null && b[k] !== '').map((k) => [k, b[k]]));

async function signosMarcados(establecimientoId, codigos) {
  if (!codigos?.length) return [];
  const signos = await prisma.signoPeligro.findMany({ where: { establecimientoId, activo: true, codigo: { in: codigos } } });
  return signos.map((s) => ({ codigo: s.codigo, descripcion: s.descripcion, gravedadSugerida: s.gravedadSugerida }));
}

/** POST /atenciones/triaje/evaluar */
async function evaluar(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  let pacienteId = req.body.pacienteId;
  if (req.body.atencionId) {
    const a = await prisma.atencion.findFirst({ where: { id: req.body.atencionId, establecimientoId }, select: { pacienteId: true } });
    pacienteId = a?.pacienteId;
  }
  const paciente = pacienteId
    ? await prisma.paciente.findFirst({
      where: { id: pacienteId, establecimientoId },
      include: { condiciones: { where: { vigenteHasta: null } }, embarazos: { where: { estado: 'activo' }, select: { id: true } } },
    })
    : null;
  if (!paciente) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Paciente no encontrado' });

  const { edadMeses } = calcularEdad(paciente.fechaNacimiento);
  const embarazada = paciente.embarazos.length > 0 || paciente.condiciones.some((c) => c.tipo === 'embarazo');
  const medicion = soloMedicion(req.body);
  const [{ criterios }, marcados] = await Promise.all([parametros(establecimientoId), signosMarcados(establecimientoId, req.body.signosPeligro)]);
  const resultado = triaje(medicion, { edadMeses, embarazada }, criterios, marcados);
  const hallazgos = evaluarSignosVitales(medicion, { edadMeses, condiciones: paciente.condiciones.map((c) => c.tipo) });

  res.json({ nivel: resultado.nivel, motivos: resultado.motivos, hallazgos, edadMeses, embarazada });
}

/** GET /admin/priorizacion */
async function obtener(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const [fila, criterios] = await Promise.all([
    prisma.parametroPriorizacion.findUnique({ where: { establecimientoId }, include: { usuario: { select: { nombre: true } } } }),
    prisma.criterioTriaje.findMany({ where: { establecimientoId }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] }),
  ]);
  res.json({
    puntos: normalizarPuntos(fila?.puntos),
    actualizadoEn: fila?.actualizadoEn ?? null,
    actualizadoPor: fila?.usuario?.nombre ?? null,
    criterios: criterios.map((c) => ({ ...c, valor: Number(c.valor) })),
  });
}

/** PUT /admin/priorizacion/puntos (con autorizacion del director) */
async function guardarPuntos(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const antes = await prisma.parametroPriorizacion.findUnique({ where: { establecimientoId } });
  const puntos = normalizarPuntos(req.body.puntos);
  await prisma.parametroPriorizacion.upsert({
    where: { establecimientoId },
    create: { establecimientoId, puntos, actualizadoPor: req.usuario.id, actualizadoEn: new Date() },
    update: { puntos, actualizadoPor: req.usuario.id, actualizadoEn: new Date() },
  });
  olvidar(establecimientoId);
  await req.bitacora({
    accion: 'actualizar',
    entidad: 'parametro_priorizacion',
    entidadId: establecimientoId,
    detalle: `Puntos y tiempos de la prioridad. Autorizó ${req.director?.nombre ?? 'director'}. Antes: ${JSON.stringify(normalizarPuntos(antes?.puntos))}. Ahora: ${JSON.stringify(puntos)}`,
  });
  res.json({ puntos });
}

/** PUT /admin/priorizacion/criterios: reemplaza la tabla (con autorizacion del director) */
async function guardarCriterios(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const antes = await prisma.criterioTriaje.count({ where: { establecimientoId } });
  await prisma.$transaction([
    prisma.criterioTriaje.deleteMany({ where: { establecimientoId } }),
    prisma.criterioTriaje.createMany({
      data: req.body.criterios.map((c, i) => ({
        establecimientoId,
        campo: c.campo,
        edadDesdeMeses: c.edadDesdeMeses ?? 0,
        edadHastaMeses: c.edadHastaMeses ?? null,
        soloEmbarazo: c.soloEmbarazo ?? false,
        operador: c.operador,
        valor: c.valor,
        nivel: c.nivel,
        etiqueta: c.etiqueta,
        activo: c.activo ?? true,
        orden: i,
      })),
    }),
  ]);
  olvidar(establecimientoId);
  await req.bitacora({
    accion: 'actualizar',
    entidad: 'criterio_triaje',
    entidadId: establecimientoId,
    detalle: `Criterios clínicos de la prioridad: ${antes} antes, ${req.body.criterios.length} ahora. Autorizó ${req.director?.nombre ?? 'director'}. ${JSON.stringify(req.body.criterios).slice(0, 3500)}`,
  });
  res.json({ criterios: req.body.criterios.length });
}

/** POST /admin/priorizacion/probar */
async function probar(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const b = req.body;
  const [{ criterios, puntos }, marcados] = await Promise.all([parametros(establecimientoId), signosMarcados(establecimientoId, b.signosPeligro)]);
  const contexto = { edadMeses: b.edadMeses, embarazada: Boolean(b.embarazada) };
  const resultado = triaje({ ...soloMedicion(b), clasificacionNutricional: b.desnutricion ?? null }, contexto, criterios, marcados);
  const ahora = new Date();
  const datos = {
    gravedad: resultado.nivel,
    // Lo que la edad ya dice no hace falta marcarlo.
    condiciones: [...new Set([
      ...(b.condiciones ?? []),
      ...(b.edadMeses < 60 ? ['menor_5'] : []),
      ...(b.edadMeses >= 720 ? ['adulto_mayor'] : []),
      ...(b.embarazada ? ['embarazo'] : []),
    ])],
    inicioEspera: new Date(ahora.getTime() - (b.minutosEsperando ?? 0) * 60000),
    ausencias: b.ausencias ?? 0,
    tiempoViaje: b.tiempoViajeMinutos ?? null,
    edadMeses: b.edadMeses,
  };
  const enCola = nivelEnCola(resultado.nivel, b.minutosEsperando ?? 0, puntos);
  res.json({
    nivel: resultado.nivel,
    nivelEnCola: enCola.nivel,
    subio: enCola.subio,
    motivos: resultado.motivos,
    puntaje: calcularPuntaje(datos, ahora, puntos),
    factores: explicarPuntaje(datos, ahora, puntos),
  });
}

module.exports = { evaluar, obtener, guardarPuntos, guardarCriterios, probar };
