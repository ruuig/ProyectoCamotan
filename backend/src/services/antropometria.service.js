// Puntaje Z segun los patrones de crecimiento de la OMS (metodo LMS).
// Funciones puras: reciben la medicion y los parametros LMS, devuelven numeros.
// No acceden a la base de datos.

const INDICADORES = ['peso_edad', 'talla_edad', 'peso_talla', 'imc_edad'];

// Valor de la medicion que corresponde a un puntaje Z dado.
function valorEnZ(z, L, M, S) {
  if (L === 0) return M * Math.exp(S * z);
  return M * Math.pow(1 + L * S * z, 1 / L);
}

function calcularZ(valor, L, M, S) {
  if (L === 0) return Math.log(valor / M) / S;
  return (Math.pow(valor / M, L) - 1) / (L * S);
}

// La OMS corrige los extremos: mas alla de +-3 DE la distribucion LMS deja de
// ser fiable, y la norma indica extrapolar de forma lineal usando el ancho de
// la ultima desviacion conocida.
function ajustarZExtremo(z, valor, L, M, S) {
  if (z > 3) {
    const sd3 = valorEnZ(3, L, M, S);
    const sd23 = sd3 - valorEnZ(2, L, M, S);
    return 3 + (valor - sd3) / sd23;
  }
  if (z < -3) {
    const sd3neg = valorEnZ(-3, L, M, S);
    const sd23neg = valorEnZ(-2, L, M, S) - sd3neg;
    return -3 + (valor - sd3neg) / sd23neg;
  }
  return z;
}

function puntajeZ(valor, { l, m, s }) {
  const L = Number(l);
  const M = Number(m);
  const S = Number(s);
  return ajustarZExtremo(calcularZ(valor, L, M, S), valor, L, M, S);
}

// Las tablas OMS vienen en pasos discretos (meses enteros, o talla cada 0.5 cm)
// y las mediciones reales caen entre dos filas. Se interpolan L, M y S.
function interpolarLms(referencias, x) {
  if (!referencias || referencias.length === 0) return null;

  const ordenadas = [...referencias].sort((a, b) => Number(a.x) - Number(b.x));
  const primera = ordenadas[0];
  const ultima = ordenadas[ordenadas.length - 1];

  // Fuera del rango cubierto por la tabla no se extrapola: se devuelve null
  // en lugar de un valor inventado.
  if (x < Number(primera.x) || x > Number(ultima.x)) return null;

  const exacta = ordenadas.find((fila) => Number(fila.x) === x);
  if (exacta) return { l: Number(exacta.l), m: Number(exacta.m), s: Number(exacta.s) };

  const superiorIdx = ordenadas.findIndex((fila) => Number(fila.x) > x);
  const inferior = ordenadas[superiorIdx - 1];
  const superior = ordenadas[superiorIdx];

  const x0 = Number(inferior.x);
  const x1 = Number(superior.x);
  const proporcion = (x - x0) / (x1 - x0);
  const entre = (a, b) => Number(a) + (Number(b) - Number(a)) * proporcion;

  return {
    l: entre(inferior.l, superior.l),
    m: entre(inferior.m, superior.m),
    s: entre(inferior.s, superior.s),
  };
}

// --- Clasificacion -------------------------------------------------------

const MUAC_SEVERA = 115; // mm
const MUAC_MODERADA = 125; // mm
const EDAD_MAX_MUAC_MESES = 60;

// De mas grave a menos grave. La atencion se prioriza por el hallazgo peor.
const PRECEDENCIA = [
  'desnutricion_aguda_severa',
  'desnutricion_aguda_moderada',
  'desnutricion_cronica',
  'riesgo',
  'sobrepeso',
  'normal',
];

function peorClasificacion(clasificaciones) {
  const presentes = clasificaciones.filter(Boolean);
  if (presentes.length === 0) return null;
  return PRECEDENCIA.find((tipo) => presentes.includes(tipo)) ?? null;
}

function clasificarPorPesoTalla(z) {
  if (z === null || z === undefined) return null;
  if (z < -3) return 'desnutricion_aguda_severa';
  if (z < -2) return 'desnutricion_aguda_moderada';
  if (z < -1) return 'riesgo';
  return 'normal';
}

function clasificarPorTallaEdad(z) {
  if (z === null || z === undefined) return null;
  return z < -2 ? 'desnutricion_cronica' : null;
}

function clasificarPorImcEdad(z) {
  if (z === null || z === undefined) return null;
  return z > 2 ? 'sobrepeso' : null;
}

// El perimetro braquial es criterio independiente en menores de 5 anios:
// detecta desnutricion aguda aunque el peso para la talla no la muestre.
function clasificarPorMuac(perimetroBraquial, edadMeses) {
  if (perimetroBraquial == null || edadMeses >= EDAD_MAX_MUAC_MESES) return null;
  if (perimetroBraquial < MUAC_SEVERA) return 'desnutricion_aguda_severa';
  if (perimetroBraquial < MUAC_MODERADA) return 'desnutricion_aguda_moderada';
  return null;
}


// Edad maxima que cubren los patrones de crecimiento de la OMS.
const EDAD_MAX_TABLAS_MESES = 60;

const ETIQUETA_INDICADOR = {
  peso_talla: 'Peso para la talla',
  talla_edad: 'Talla para la edad',
  peso_edad: 'Peso para la edad',
  imc_edad: 'IMC para la edad',
};

/**
 * Detalle por indicador: su puntaje Z, su clasificacion y, cuando no se pudo
 * calcular, el motivo.
 *
 * Existe porque la tarjeta mostraba una clasificacion junto al puntaje de otro
 * indicador: decia "Sobrepeso" (que sale del IMC) al lado de un peso para la
 * talla en blanco. Sin puntaje calculado no hay clasificacion que mostrar.
 */
function detallarIndicadores({
  zPesoTalla = null,
  zTallaEdad = null,
  zPesoEdad = null,
  zImcEdad = null,
  improbable = false,
  edadMeses = null,
  talla = null,
  tablasCargadas = true,
} = {}) {
  const motivoGeneral = (() => {
    if (improbable) return 'La medición está marcada como improbable';
    if (!tablasCargadas) return 'Las tablas de la OMS no están cargadas';
    if (edadMeses != null && edadMeses > EDAD_MAX_TABLAS_MESES) {
      return `La edad supera los ${EDAD_MAX_TABLAS_MESES} meses que cubren las tablas de la OMS`;
    }
    return null;
  })();

  const necesitaTalla = { peso_talla: true, talla_edad: true, imc_edad: true, peso_edad: false };

  const puntajes = {
    peso_talla: zPesoTalla,
    talla_edad: zTallaEdad,
    peso_edad: zPesoEdad,
    imc_edad: zImcEdad,
  };

  const clasificadores = {
    peso_talla: clasificarPorPesoTalla,
    talla_edad: clasificarPorTallaEdad,
    imc_edad: clasificarPorImcEdad,
    // Para peso/edad no se declara una regla propia: se muestra el puntaje sin
    // etiqueta antes que inventar un criterio clinico.
    peso_edad: () => null,
  };

  return Object.keys(puntajes).map((clave) => {
    const z = puntajes[clave];
    const calculable = !improbable && z !== null && z !== undefined;

    let motivo = null;
    if (!calculable) {
      if (motivoGeneral) motivo = motivoGeneral;
      else if (necesitaTalla[clave] && talla == null) motivo = 'Falta la talla';
      else motivo = 'El valor queda fuera del rango que cubre la tabla de la OMS';
    }

    return {
      clave,
      etiqueta: ETIQUETA_INDICADOR[clave],
      z: calculable ? Number(z) : null,
      clasificacion: calculable ? clasificadores[clave](Number(z)) : null,
      calculable,
      motivo,
    };
  });
}

/**
 * Clasificacion final a partir de los puntajes Z y el MUAC.
 * Devuelve null si no hay ningun criterio evaluable (sin tablas OMS
 * cargadas y sin MUAC), nunca un valor inventado.
 */
function clasificar({ zPesoTalla, zTallaEdad, zImcEdad, perimetroBraquial, edadMeses }) {
  const hallazgos = [
    clasificarPorPesoTalla(zPesoTalla),
    clasificarPorTallaEdad(zTallaEdad),
    clasificarPorImcEdad(zImcEdad),
    clasificarPorMuac(perimetroBraquial, edadMeses),
  ];

  return peorClasificacion(hallazgos);
}

// Indice de masa corporal. La talla llega en centimetros.
function calcularImc(pesoKg, tallaCm) {
  if (!pesoKg || !tallaCm) return null;
  const metros = Number(tallaCm) / 100;
  return Number(pesoKg) / (metros * metros);
}

// Diferencia contra la medicion anterior, para avisar de un descenso.
const DESCENSO_RELEVANTE = 0.5;

function compararConAnterior(zActual, zAnterior) {
  if (zActual == null || zAnterior == null) return null;
  const diferencia = Number(zActual) - Number(zAnterior);
  return {
    diferencia: Number(diferencia.toFixed(2)),
    descensoRelevante: diferencia <= -DESCENSO_RELEVANTE,
  };
}

module.exports = {
  EDAD_MAX_TABLAS_MESES,
  ETIQUETA_INDICADOR,
  detallarIndicadores,
  INDICADORES,
  MUAC_SEVERA,
  MUAC_MODERADA,
  EDAD_MAX_MUAC_MESES,
  PRECEDENCIA,
  DESCENSO_RELEVANTE,
  valorEnZ,
  calcularZ,
  ajustarZExtremo,
  puntajeZ,
  interpolarLms,
  clasificar,
  clasificarPorPesoTalla,
  clasificarPorTallaEdad,
  clasificarPorImcEdad,
  clasificarPorMuac,
  peorClasificacion,
  calcularImc,
  compararConAnterior,
};
