// Corazon de la cola de atencion. Funciones puras: reciben datos, devuelven
// datos. Sin acceso a base de datos, para poder probarse en aislamiento.
//
// La prioridad tiene tres capas:
//   1. El nivel (urgente, moderado, leve) lo deciden los criterios clinicos y
//      los signos de peligro en la preconsulta (triaje.service). El nivel manda:
//      un moderado pasa antes que cualquier leve.
//   2. Dentro de cada nivel ordenan los puntos: condicion del paciente, espera,
//      distancia y ausencias.
//   3. Quien pasa el tiempo maximo de su nivel sube un nivel (leve a moderado),
//      para que nadie se quede esperando indefinidamente.
// Los puntos y tiempos son parametros del establecimiento (puntos); si no se
// pasan, rigen los de la tesis.

const { RANGO } = require('./triaje.service');

const PUNTOS_INICIALES = {
  gravedad: { urgente: 40, moderado: 25, leve: 10 },
  condicion: { embarazo: 30, menor_5: 30, menor_2_meses: 10, adulto_mayor: 25, discapacidad: 25 },
  espera: [{ desde: 0, puntos: 5 }, { desde: 30, puntos: 15 }, { desde: 60, puntos: 25 }, { desde: 90, puntos: 30 }],
  distancia: [{ desde: 30, puntos: 5 }, { desde: 60, puntos: 10 }, { desde: 120, puntos: 15 }],
  ausencia: 10,
  tiempoMaximo: { moderado: 60, leve: 120 },
};

// Compatibilidad con quien lee las constantes de antes.
const PESO_GRAVEDAD = PUNTOS_INICIALES.gravedad;
const PESO_CONDICION = PUNTOS_INICIALES.condicion;
const PENALIZACION_AUSENCIA = PUNTOS_INICIALES.ausencia;

/** Une lo guardado con los valores iniciales, para que nunca falte un dato. */
function normalizarPuntos(guardado) {
  const g = guardado ?? {};
  return {
    gravedad: { ...PUNTOS_INICIALES.gravedad, ...g.gravedad },
    condicion: { ...PUNTOS_INICIALES.condicion, ...g.condicion },
    espera: Array.isArray(g.espera) && g.espera.length ? g.espera : PUNTOS_INICIALES.espera,
    distancia: Array.isArray(g.distancia) ? g.distancia : PUNTOS_INICIALES.distancia,
    ausencia: Number.isFinite(g.ausencia) ? g.ausencia : PUNTOS_INICIALES.ausencia,
    tiempoMaximo: { ...PUNTOS_INICIALES.tiempoMaximo, ...g.tiempoMaximo },
  };
}

/** El tramo que corresponde a un valor: el de mayor "desde" que no lo pase. */
function tramo(tramos, valor) {
  if (valor === null || valor === undefined) return null;
  return [...tramos].sort((a, b) => b.desde - a.desde).find((t) => valor >= t.desde) ?? null;
}

const horas = (min) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10} h` : `${min} min`);

/** "1 a 2 h de viaje", "más de 2 h de viaje": el tramo dicho en palabras. */
function etiquetaDistancia(tramos, t) {
  const siguiente = [...tramos].sort((a, b) => a.desde - b.desde).find((x) => x.desde > t.desde);
  if (!siguiente) return `Viene de lejos: más de ${horas(t.desde)} de viaje`;
  const rango = t.desde >= 60 && siguiente.desde >= 60
    ? `${t.desde / 60} a ${siguiente.desde / 60} h`
    : siguiente.desde <= 60 ? `${t.desde} a ${siguiente.desde} min` : `${horas(t.desde)} a ${horas(siguiente.desde)}`;
  return `Viene de lejos: ${rango} de viaje`;
}

// Quien viene de lejos pierde el dia si no lo atienden: el tiempo de viaje de
// su comunidad, registrado por el personal, suma puntos por tramos.
const TRAMOS_DISTANCIA = PUNTOS_INICIALES.distancia
  .map((t) => ({ ...t, etiqueta: etiquetaDistancia(PUNTOS_INICIALES.distancia, t) }))
  .sort((a, b) => b.desde - a.desde);

/** Puntos por el tiempo de viaje; sin dato registrado no suma. */
function tramoDistancia(minutos, tramos = PUNTOS_INICIALES.distancia) {
  const t = tramo(tramos, minutos);
  return t ? { desde: t.desde, puntos: t.puntos, etiqueta: etiquetaDistancia(tramos, t) } : null;
}

// A la segunda ausencia el paciente sale del sistema y debe registrarse de nuevo.
const MAX_AUSENCIAS = 2;

const UMBRAL_ESPERA_LARGA_MIN = 90;

/** Puntos por el tiempo de espera: a mas minutos esperando, mas puntos. */
function puntosPorEspera(minutosEsperando, tramos = PUNTOS_INICIALES.espera) {
  return tramo(tramos, Math.max(0, minutosEsperando))?.puntos ?? 0;
}

function puntosCondicion(condiciones, edadMeses, puntos) {
  const base = condiciones?.length ? Math.max(...condiciones.map((c) => puntos.condicion[c] ?? 0)) : 0;
  // El menor de 2 meses pesa mas que cualquier otro menor de 5.
  const extra = edadMeses != null && edadMeses < 2 ? puntos.condicion.menor_2_meses ?? 0 : 0;
  return base + extra;
}

/**
 * Puntaje de prioridad de un paciente: suma gravedad, condicion, espera y
 * distancia, y resta las ausencias. Nunca es negativo. Ordena dentro de cada
 * nivel.
 */
function calcularPuntaje({ gravedad, condiciones, inicioEspera, ausencias, tiempoViaje = null, edadMeses = null }, ahora, puntos = PUNTOS_INICIALES) {
  const minutos = (ahora - inicioEspera) / 60000;
  return Math.max(
    0,
    (puntos.gravedad[gravedad] ?? 0)
      + puntosCondicion(condiciones, edadMeses, puntos)
      + puntosPorEspera(minutos, puntos.espera)
      + (tramo(puntos.distancia, tiempoViaje)?.puntos ?? 0)
      - ausencias * puntos.ausencia,
  );
}

// --- Explicacion del puntaje ---------------------------------------------

// El personal no debe obedecer un numero que no entiende: para confiar en el
// orden necesita ver por que cada paciente esta donde esta. Estas etiquetas
// traducen los factores del puntaje a lenguaje comun.
const ETIQUETA_GRAVEDAD = {
  urgente: 'Caso urgente',
  moderado: 'Caso moderado',
  leve: 'Caso leve',
};

const ETIQUETA_CONDICION = {
  embarazo: 'Embarazada',
  menor_5: 'Menor de 5 años',
  adulto_mayor: 'Adulto mayor',
  discapacidad: 'Con discapacidad',
};

function etiquetaEspera(minutos) {
  if (minutos >= 90) return 'Más de 90 min esperando';
  if (minutos >= 60) return 'Más de 1 hora esperando';
  if (minutos >= 30) return 'Más de 30 min esperando';
  return 'Recién llegado';
}

/**
 * Desglosa el puntaje en los factores que lo formaron, cada uno con su
 * nombre en palabras y los puntos que aporto.
 */
function explicarPuntaje({ gravedad, condiciones, inicioEspera: inicio, ausencias, tiempoViaje = null, edadMeses = null }, ahora, puntos = PUNTOS_INICIALES) {
  const factores = [];

  const g = puntos.gravedad[gravedad] ?? 0;
  if (g > 0) factores.push({ etiqueta: ETIQUETA_GRAVEDAD[gravedad] ?? gravedad, puntos: g, tipo: 'gravedad' });

  // Solo cuenta la condicion de mayor peso, y es esa la que se explica.
  const conPuntos = (condiciones ?? [])
    .map((tipo) => ({ tipo, puntos: puntos.condicion[tipo] ?? 0 }))
    .filter((c) => c.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos);
  if (conPuntos.length > 0) {
    const mayor = conPuntos[0];
    factores.push({ etiqueta: ETIQUETA_CONDICION[mayor.tipo] ?? mayor.tipo, puntos: mayor.puntos, tipo: 'condicion' });
  }
  if (edadMeses != null && edadMeses < 2 && puntos.condicion.menor_2_meses) {
    factores.push({ etiqueta: 'Menor de 2 meses', puntos: puntos.condicion.menor_2_meses, tipo: 'condicion' });
  }

  const min = Math.max(0, Math.floor((new Date(ahora) - new Date(inicio)) / 60000));
  factores.push({ etiqueta: etiquetaEspera(min), puntos: puntosPorEspera(min, puntos.espera), tipo: 'espera' });

  const t = tramoDistancia(tiempoViaje, puntos.distancia);
  if (t) factores.push({ etiqueta: t.etiqueta, puntos: t.puntos, tipo: 'distancia' });

  if (ausencias > 0) {
    factores.push({ etiqueta: `${ausencias} ausencia(s)`, puntos: -(ausencias * puntos.ausencia), tipo: 'ausencia' });
  }

  return factores;
}

// Cuando un paciente vuelve de ausente su cronometro se reinicia: cuenta
// desde el reingreso, no desde el registro original.
function inicioEspera(atencion) {
  return new Date(atencion.reingresoEn ?? atencion.registradaEn);
}

function minutosEsperando(atencion, ahora = new Date()) {
  return Math.max(0, Math.floor((new Date(ahora) - inicioEspera(atencion)) / 60000));
}

function edadEnMeses(fechaNacimiento, ahora) {
  if (!fechaNacimiento) return null;
  const n = new Date(fechaNacimiento);
  const a = new Date(ahora);
  let meses = (a.getUTCFullYear() - n.getUTCFullYear()) * 12 + (a.getUTCMonth() - n.getUTCMonth());
  if (a.getUTCDate() < n.getUTCDate()) meses -= 1;
  return Math.max(0, meses);
}

// Convierte una atencion de base de datos en la entrada que espera
// calcularPuntaje, resolviendo las condiciones vigentes del paciente.
function datosDePuntaje(atencion, ahora = new Date()) {
  const condiciones = (atencion.paciente?.condiciones ?? [])
    .filter((c) => !c.vigenteHasta)
    .map((c) => c.tipo);

  // El embarazo vive en su propio episodio: pesa mientras esta activo y deja
  // de pesar cuando se cierra o se vence, sin tocar el expediente.
  if ((atencion.paciente?.embarazos ?? []).length > 0 && !condiciones.includes('embarazo')) {
    condiciones.push('embarazo');
  }

  return {
    gravedad: atencion.gravedad,
    condiciones,
    inicioEspera: inicioEspera(atencion),
    ausencias: atencion.ausencias ?? 0,
    tiempoViaje: atencion.paciente?.lugarPoblado?.tiempoViajeMinutos ?? null,
    edadMeses: edadEnMeses(atencion.paciente?.fechaNacimiento, ahora),
  };
}

function puntajeDeAtencion(atencion, ahora = new Date(), puntos = PUNTOS_INICIALES) {
  return calcularPuntaje(datosDePuntaje(atencion, ahora), new Date(ahora), puntos);
}

/**
 * Nivel con el que se ordena: el de la preconsulta, salvo que un leve haya
 * pasado su tiempo maximo, que entonces sube a moderado. "Excedido" avisa
 * que ya paso el tiempo de su nivel.
 */
function nivelEnCola(gravedad, minutos, puntos = PUNTOS_INICIALES) {
  const maximo = puntos.tiempoMaximo[gravedad];
  const excedido = maximo != null && minutos >= maximo;
  if (gravedad === 'leve' && excedido) return { nivel: 'moderado', subio: true, excedido };
  return { nivel: gravedad, subio: false, excedido };
}

/**
 * Ordena la cola. El nivel manda: urgentes, luego moderados, luego leves.
 * Dentro del nivel, mas puntos primero; entre iguales, el que mas espera.
 */
function ordenarCola(atenciones, ahora = new Date(), puntos = PUNTOS_INICIALES) {
  const momento = new Date(ahora);

  return atenciones
    .map((atencion) => {
      const datos = datosDePuntaje(atencion, momento);
      const espera = minutosEsperando(atencion, momento);
      const { nivel, subio, excedido } = nivelEnCola(atencion.gravedad, espera, puntos);
      // Por que esta donde esta: primero lo clinico, despues los puntos.
      const clinicos = (atencion.preconsulta?.triaje?.motivos ?? [])
        .map((m) => ({ etiqueta: m.texto ?? m.etiqueta, puntos: 0, tipo: 'clinico', nivel: m.nivel }));
      const factores = [
        ...clinicos,
        ...(subio ? [{ etiqueta: `Pasó ${puntos.tiempoMaximo.leve} min esperando: sube a moderado`, puntos: 0, tipo: 'espera_excedida' }] : []),
        ...explicarPuntaje(datos, momento, puntos),
      ];
      return {
        atencion,
        nivel,
        subio,
        excedido,
        puntaje: calcularPuntaje(datos, momento, puntos),
        factores,
        minutosEsperando: espera,
        urgente: nivel === 'urgente',
      };
    })
    .sort((a, b) => RANGO[b.nivel] - RANGO[a.nivel] || b.puntaje - a.puntaje || b.minutosEsperando - a.minutosEsperando);
}

// El siguiente a pasar cuando se libere la clinica.
function siguienteEnCola(atenciones, ahora = new Date(), puntos = PUNTOS_INICIALES) {
  return ordenarCola(atenciones, ahora, puntos)[0] ?? null;
}

// --- Jornada -------------------------------------------------------------

// Una jornada es un dia calendario. El conteo de ausencias se reinicia con el
// cambio de dia, no con el fin del horario de atencion.
const ZONA = 'America/Guatemala';

function diaCalendario(fecha, zona = ZONA) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(fecha));
}

function mismaJornada(a, b, zona = ZONA) {
  return diaCalendario(a, zona) === diaCalendario(b, zona);
}

/**
 * Resumen que necesitan los paneles: cuantos esperan, cuanto llevan y si
 * alguno supero el umbral que obliga a avisar.
 */
function resumenCola(cola) {
  if (cola.length === 0) {
    return { enEspera: 0, esperaPromedio: 0, esperaMaxima: 0, masAntiguo: null, superan90: [] };
  }

  const esperas = cola.map((e) => e.minutosEsperando);
  const masAntiguo = cola.reduce((a, b) => (a.minutosEsperando >= b.minutosEsperando ? a : b));

  return {
    enEspera: cola.length,
    esperaPromedio: Math.round(esperas.reduce((s, n) => s + n, 0) / cola.length),
    esperaMaxima: Math.max(...esperas),
    masAntiguo,
    superan90: cola.filter((e) => e.minutosEsperando >= UMBRAL_ESPERA_LARGA_MIN),
  };
}

module.exports = {
  PUNTOS_INICIALES,
  normalizarPuntos,
  nivelEnCola,
  puntosPorEspera,
  TRAMOS_DISTANCIA,
  tramoDistancia,
  PESO_GRAVEDAD,
  PESO_CONDICION,
  PENALIZACION_AUSENCIA,
  MAX_AUSENCIAS,
  UMBRAL_ESPERA_LARGA_MIN,
  ZONA,
  calcularPuntaje,
  explicarPuntaje,
  ETIQUETA_GRAVEDAD,
  ETIQUETA_CONDICION,
  inicioEspera,
  minutosEsperando,
  datosDePuntaje,
  puntajeDeAtencion,
  ordenarCola,
  siguienteEnCola,
  diaCalendario,
  mismaJornada,
  resumenCola,
};
