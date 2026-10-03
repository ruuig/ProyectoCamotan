// Corazon de la cola de atencion. Funciones puras: reciben datos, devuelven
// datos. Sin acceso a base de datos, para poder probarse en aislamiento.

const PESO_GRAVEDAD = { urgente: 40, moderado: 25, leve: 10 };
const PESO_CONDICION = { embarazo: 30, menor_5: 30, adulto_mayor: 25, discapacidad: 25 };
const PENALIZACION_AUSENCIA = 10;

// Quien viene de lejos pierde el dia si no lo atienden: el tiempo de viaje de
// su comunidad, registrado por el personal, suma puntos por tramos.
const TRAMOS_DISTANCIA = [
  { desde: 120, puntos: 15, etiqueta: 'Viene de lejos: más de 2 h de viaje' },
  { desde: 60, puntos: 10, etiqueta: 'Viene de lejos: 1 a 2 h de viaje' },
  { desde: 30, puntos: 5, etiqueta: 'Viene de lejos: 30 a 60 min de viaje' },
];

/** Puntos por el tiempo de viaje; sin dato registrado no suma. */
function tramoDistancia(minutos) {
  if (minutos === null || minutos === undefined) return null;
  return TRAMOS_DISTANCIA.find((t) => minutos >= t.desde) ?? null;
}

// A la segunda ausencia el paciente sale del sistema y debe registrarse de nuevo.
const MAX_AUSENCIAS = 2;

const UMBRAL_ESPERA_LARGA_MIN = 90;

function calcularPuntaje({ gravedad, condiciones, inicioEspera, ausencias, tiempoViaje = null }, ahora) {
  const g = PESO_GRAVEDAD[gravedad] ?? 0;

  // Si coexisten varias condiciones se toma SOLO la de mayor puntaje
  const c = condiciones?.length
    ? Math.max(...condiciones.map((x) => PESO_CONDICION[x] ?? 0))
    : 0;

  const min = (ahora - inicioEspera) / 60000;
  const e = min >= 90 ? 30 : min >= 60 ? 25 : min >= 30 ? 15 : 5;

  const d = tramoDistancia(tiempoViaje)?.puntos ?? 0;

  return Math.max(0, g + c + e + d - (ausencias * PENALIZACION_AUSENCIA));
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
  return 'Recien llegado';
}

/**
 * Desglosa el puntaje en los factores que lo formaron, cada uno con su
 * nombre en palabras y los puntos que aporto.
 */
function explicarPuntaje({ gravedad, condiciones, inicioEspera: inicio, ausencias, tiempoViaje = null }, ahora) {
  const factores = [];

  const g = PESO_GRAVEDAD[gravedad] ?? 0;
  if (g > 0) {
    factores.push({ etiqueta: ETIQUETA_GRAVEDAD[gravedad] ?? gravedad, puntos: g, tipo: 'gravedad' });
  }

  // Solo cuenta la condicion de mayor peso, y es esa la que se explica.
  const conPuntos = (condiciones ?? [])
    .map((tipo) => ({ tipo, puntos: PESO_CONDICION[tipo] ?? 0 }))
    .filter((c) => c.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos);

  if (conPuntos.length > 0) {
    const mayor = conPuntos[0];
    factores.push({
      etiqueta: ETIQUETA_CONDICION[mayor.tipo] ?? mayor.tipo,
      puntos: mayor.puntos,
      tipo: 'condicion',
    });
  }

  const min = Math.max(0, Math.floor((new Date(ahora) - new Date(inicio)) / 60000));
  const e = min >= 90 ? 30 : min >= 60 ? 25 : min >= 30 ? 15 : 5;
  factores.push({ etiqueta: etiquetaEspera(min), puntos: e, tipo: 'espera' });

  const tramo = tramoDistancia(tiempoViaje);
  if (tramo) factores.push({ etiqueta: tramo.etiqueta, puntos: tramo.puntos, tipo: 'distancia' });

  if (ausencias > 0) {
    factores.push({
      etiqueta: `${ausencias} ausencia(s)`,
      puntos: -(ausencias * PENALIZACION_AUSENCIA),
      tipo: 'ausencia',
    });
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

// Convierte una atencion de base de datos en la entrada que espera
// calcularPuntaje, resolviendo las condiciones vigentes del paciente.
function datosDePuntaje(atencion) {
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
  };
}

function puntajeDeAtencion(atencion, ahora = new Date()) {
  return calcularPuntaje(datosDePuntaje(atencion), new Date(ahora));
}

/**
 * Ordena la cola. La urgencia manda sobre el puntaje: un caso urgente pasa
 * antes que cualquier otro aunque otro acumule mas puntos por espera.
 * Entre iguales, primero el que lleva mas tiempo esperando.
 */
function ordenarCola(atenciones, ahora = new Date()) {
  const momento = new Date(ahora);

  return atenciones
    .map((atencion) => ({
      atencion,
      puntaje: puntajeDeAtencion(atencion, momento),
      // Por que esta donde esta: el personal debe poder verlo, no deducirlo.
      factores: explicarPuntaje(datosDePuntaje(atencion), momento),
      minutosEsperando: minutosEsperando(atencion, momento),
      urgente: atencion.gravedad === 'urgente',
    }))
    .sort((a, b) => {
      if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
      if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje;
      return b.minutosEsperando - a.minutosEsperando;
    });
}

// El siguiente a pasar cuando se libere la clinica.
function siguienteEnCola(atenciones, ahora = new Date()) {
  return ordenarCola(atenciones, ahora)[0] ?? null;
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
