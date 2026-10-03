const prisma = require('../config/db');
const { calcularEdad } = require('./pacientes.service');
const { evaluarSignosVitales } = require('./signosVitales.service');

// "Consultas repetidas por el mismo diagnostico (3 o mas en 60 dias)".
const DIAS_VENTANA_REPETICION = 60;
const MIN_REPETICIONES = 3;

function alerta(tipo, severidad, mensaje, detalle = null) {
  return { tipo, severidad, mensaje, detalle };
}

// Parte pura: dado el historial ya cargado, cuenta repeticiones por
// diagnostico dentro de la ventana.
function diagnosticosRepetidos(atenciones, ahora = new Date(), dias = DIAS_VENTANA_REPETICION) {
  const limite = new Date(ahora).getTime() - dias * 86400000;

  const conteo = new Map();
  for (const a of atenciones) {
    if (!a.diagnosticoCie) continue;
    if (new Date(a.registradaEn).getTime() < limite) continue;

    const actual = conteo.get(a.diagnosticoCie) ?? { veces: 0, texto: a.diagnosticoTxt };
    actual.veces += 1;
    conteo.set(a.diagnosticoCie, actual);
  }

  return [...conteo.entries()]
    .filter(([, datos]) => datos.veces >= MIN_REPETICIONES)
    .map(([codigo, datos]) => ({ codigo, veces: datos.veces, texto: datos.texto }));
}

/**
 * Alertas clinicas derivadas de un paciente. Se calculan al momento de
 * abrir la consulta, no en una bandeja aparte.
 */
async function alertasDePaciente(pacienteId, establecimientoId, ahora = new Date()) {
  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, establecimientoId },
    include: { condiciones: { where: { vigenteHasta: null } } },
  });

  if (!paciente) return null;

  const [atenciones, ultimaAntropometria] = await Promise.all([
    prisma.atencion.findMany({
      where: { pacienteId, estado: 'atendido' },
      orderBy: { registradaEn: 'desc' },
      take: 50,
    }),
    prisma.antropometria.findFirst({
      where: { pacienteId },
      orderBy: { fecha: 'desc' },
    }),
  ]);

  const alertas = [];
  const { edadMeses } = calcularEdad(paciente.fechaNacimiento, ahora);
  const condiciones = paciente.condiciones.map((c) => c.tipo);

  // 1. Consultas repetidas por el mismo diagnostico.
  for (const repetido of diagnosticosRepetidos(atenciones, ahora)) {
    alertas.push(
      alerta(
        'patron_clinico',
        'media',
        `${repetido.veces} consultas por el mismo diagnóstico (${repetido.codigo}) en ${DIAS_VENTANA_REPETICION} días`,
        repetido,
      ),
    );
  }

  // 2. Peso fuera del rango esperado en menores de 5 anios.
  if (ultimaAntropometria?.clasificacion && ultimaAntropometria.clasificacion !== 'normal') {
    const severidad = ultimaAntropometria.clasificacion.includes('severa') ? 'alta' : 'media';
    const z = ultimaAntropometria.zPesoTalla;
    alertas.push(
      alerta(
        'desnutricion',
        severidad,
        z != null
          ? `Peso para la talla en ${Number(z)} DE, clasificacion de ${ultimaAntropometria.clasificacion.replace(/_/g, ' ')}`
          : `Clasificacion nutricional: ${ultimaAntropometria.clasificacion.replace(/_/g, ' ')}`,
        { antropometriaId: ultimaAntropometria.id, fecha: ultimaAntropometria.fecha },
      ),
    );
  }

  return { paciente, edadMeses, condiciones, alertas };
}

/**
 * Alertas de una atencion concreta: suma a las del paciente los signos
 * vitales fuera de rango tomados en su preconsulta.
 */
async function alertasDeAtencion(atencion, ahora = new Date()) {
  const base = await alertasDePaciente(atencion.pacienteId, atencion.establecimientoId, ahora);
  if (!base) return { alertas: [] };

  const alertas = [...base.alertas];

  if (atencion.preconsulta) {
    const hallazgos = evaluarSignosVitales(atencion.preconsulta, {
      edadMeses: base.edadMeses,
      condiciones: base.condiciones,
    });

    for (const hallazgo of hallazgos) {
      alertas.push(alerta('signo_vital', hallazgo.severidad, hallazgo.mensaje, { campo: hallazgo.campo }));
    }
  }

  // Lo mas grave primero: es lo que el medico debe ver de un vistazo.
  const orden = { alta: 0, media: 1, baja: 2 };
  alertas.sort((a, b) => (orden[a.severidad] ?? 9) - (orden[b.severidad] ?? 9));

  return { alertas };
}

module.exports = {
  DIAS_VENTANA_REPETICION,
  MIN_REPETICIONES,
  diagnosticosRepetidos,
  alertasDePaciente,
  alertasDeAtencion,
};
