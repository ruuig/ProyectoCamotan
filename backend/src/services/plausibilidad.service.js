// Plausibilidad biologica de una medicion antropometrica.
//
// Existe porque en la base habia un nino de 2 anos con 60 kg: casi siempre es
// la talla escrita en el campo del peso. El sistema no lo bloquea en silencio,
// avisa y exige confirmacion; lo confirmado queda marcado y no clasifica.
//
// Todas las funciones son puras: reciben las referencias OMS ya cargadas.

const { puntajeZ, interpolarLms } = require('./antropometria.service');

// Fuera de este rango la OMS considera el valor biologicamente improbable.
const Z_MINIMO = -5;
const Z_MAXIMO = 5;

// Limites absolutos, para edades sin tablas OMS (mayores de cinco anos).
// Son los mismos que ya validaba el esquema de preconsulta.
const LIMITES_ABSOLUTOS = {
  peso: { min: 0.5, max: 400, unidad: 'kg', etiqueta: 'peso' },
  talla: { min: 20, max: 250, unidad: 'cm', etiqueta: 'talla' },
  perimetroBraquial: { min: 50, max: 400, unidad: 'mm', etiqueta: 'perímetro braquial' },
  perimetroCefalico: { min: 20, max: 70, unidad: 'cm', etiqueta: 'perímetro cefálico' },
};

/**
 * Anios cumplidos, para redactar el aviso en el lenguaje de quien lo lee.
 */
function edadLegible(edadMeses) {
  if (edadMeses < 1) return `${edadMeses} mes`;
  if (edadMeses < 12) return `${edadMeses} meses`;
  const anios = Math.floor(edadMeses / 12);
  return anios === 1 ? '1 año' : `${anios} años`;
}

/**
 * Indica si un puntaje Z cae fuera del rango que la OMS considera posible.
 * Un Z ausente no es improbable: simplemente no se pudo calcular.
 */
function zFueraDeRango(z) {
  if (z === null || z === undefined) return false;
  return z < Z_MINIMO || z > Z_MAXIMO;
}

/**
 * Valor esperado de un indicador para un Z dado, segun las tablas OMS.
 * Sirve para decir "a esa edad el peso va de X a Y", que es mas util que
 * repetir el limite del Z.
 */
function valorEsperado(referencias, x, z) {
  const lms = interpolarLms(referencias, x);
  if (!lms) return null;

  const { l, m, s } = lms;
  if (l === 0) return m * Math.exp(s * z);
  return m * (1 + l * s * z) ** (1 / l);
}

/**
 * Rango plausible de un indicador a esa edad, entre Z minimo y Z maximo.
 * Devuelve null cuando no hay tablas para esa edad.
 */
function rangoPlausible(referencias, x) {
  if (!referencias || referencias.length === 0) return null;

  const min = valorEsperado(referencias, x, Z_MINIMO);
  const max = valorEsperado(referencias, x, Z_MAXIMO);
  if (min === null || max === null) return null;

  return { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10 };
}

/**
 * Detecta el error mas frecuente: la talla escrita en el campo del peso, o al
 * reves. Solo lo sugiere si el valor cruzado si cae en el rango del otro campo.
 */
function sugerirIntercambio({ peso, talla, rangoPeso, rangoTalla }) {
  if (peso == null || talla == null || !rangoPeso || !rangoTalla) return false;

  const pesoParecaTalla = peso >= rangoTalla.min && peso <= rangoTalla.max;
  const tallaParecePeso = talla >= rangoPeso.min && talla <= rangoPeso.max;

  return pesoParecaTalla && tallaParecePeso;
}

/**
 * Evalua una medicion completa.
 *
 * Devuelve { plausible, avisos }. Cada aviso trae el campo, el mensaje que se
 * muestra tal cual y el rango esperado, para que quien captura pueda corregir
 * sin adivinar.
 */
function evaluarPlausibilidad({
  edadMeses,
  peso,
  talla,
  perimetroBraquial,
  perimetroCefalico,
  puntajes = {},
  referencias = {},
}) {
  const avisos = [];
  const edad = edadLegible(edadMeses);

  const rangoPeso = rangoPlausible(referencias.pesoEdad, edadMeses);
  const rangoTalla = rangoPlausible(referencias.tallaEdad, edadMeses);

  const medidas = { peso, talla, perimetroBraquial, perimetroCefalico };
  const rangos = { peso: rangoPeso, talla: rangoTalla };

  for (const [campo, valor] of Object.entries(medidas)) {
    if (valor == null) continue;

    const limite = LIMITES_ABSOLUTOS[campo];
    const rango = rangos[campo];

    // Primero el limite duro: un valor imposible no merece hablar de Z.
    if (limite && (valor < limite.min || valor > limite.max)) {
      avisos.push({
        campo,
        mensaje: `El valor de ${limite.etiqueta} (${valor} ${limite.unidad}) está fuera de lo `
          + `posible en una persona (${limite.min} a ${limite.max} ${limite.unidad}).`,
        rango: { min: limite.min, max: limite.max, unidad: limite.unidad },
      });
      continue;
    }

    // Luego el rango por edad, cuando hay tablas.
    if (rango && (valor < rango.min || valor > rango.max)) {
      avisos.push({
        campo,
        mensaje: `El ${limite.etiqueta} de ${valor} ${limite.unidad} no es plausible para `
          + `una persona de ${edad}. A esa edad va de ${rango.min} a ${rango.max} `
          + `${limite.unidad}.`,
        rango: { ...rango, unidad: limite.unidad },
      });
    }
  }

  // Los puntajes Z fuera de rango son improbables aunque el valor absoluto
  // parezca posible: es la regla de la OMS.
  for (const [indicador, z] of Object.entries(puntajes)) {
    if (!zFueraDeRango(z)) continue;
    avisos.push({
      campo: indicador,
      mensaje: `El puntaje Z de ${indicador} (${z}) queda fuera del rango que la OMS `
        + `considera posible (${Z_MINIMO} a ${Z_MAXIMO}).`,
      rango: { min: Z_MINIMO, max: Z_MAXIMO, unidad: 'DE' },
    });
  }

  if (avisos.length > 0 && sugerirIntercambio({ peso, talla, rangoPeso, rangoTalla })) {
    avisos.push({
      campo: 'intercambio',
      mensaje: 'Verifique que no haya capturado la talla en el campo del peso.',
      rango: null,
    });
  }

  return { plausible: avisos.length === 0, avisos };
}

module.exports = {
  Z_MINIMO,
  Z_MAXIMO,
  LIMITES_ABSOLUTOS,
  edadLegible,
  zFueraDeRango,
  valorEsperado,
  rangoPlausible,
  sugerirIntercambio,
  evaluarPlausibilidad,
};
