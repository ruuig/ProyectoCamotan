const prisma = require('../config/db');
const {
  puntajeZ,
  interpolarLms,
  clasificar,
  calcularImc,
} = require('./antropometria.service');

// Mensaje exacto que exige la especificacion cuando faltan las tablas.
const AVISO_SIN_TABLAS = 'Tablas de referencia OMS no cargadas';

// Los patrones de la OMS solo cubren de 0 a 60 meses.
const EDAD_MAX_MESES = 60;
// Desde los 24 meses la estatura se mide de pie; antes, acostado.
const MESES_MEDICION_DE_PIE = 24;

let hayTablas = null;

async function tablasCargadas() {
  if (hayTablas === null) {
    hayTablas = (await prisma.referenciaOms.count()) > 0;
  }
  return hayTablas;
}

// Permite que las pruebas y el seed reevaluen tras cargar datos.
function olvidarCache() {
  hayTablas = null;
}

function indicadorPesoPorEstatura(edadMeses) {
  return edadMeses < MESES_MEDICION_DE_PIE ? 'peso_longitud' : 'peso_talla';
}

/**
 * Filas de un indicador alrededor de un valor, para calcular el rango
 * plausible sin traer la tabla entera.
 */
async function referenciasDe(indicador, sexo, x) {
  const [inferior, superior] = await Promise.all([
    prisma.referenciaOms.findFirst({
      where: { indicador, sexo, x: { lte: x } },
      orderBy: { x: 'desc' },
    }),
    prisma.referenciaOms.findFirst({
      where: { indicador, sexo, x: { gte: x } },
      orderBy: { x: 'asc' },
    }),
  ]);

  if (!inferior || !superior) return [];
  return [inferior, superior];
}

async function lmsPara(indicador, sexo, x) {
  // Se traen solo las dos filas que rodean al valor buscado, no la tabla entera.
  const [inferior, superior] = await Promise.all([
    prisma.referenciaOms.findFirst({
      where: { indicador, sexo, x: { lte: x } },
      orderBy: { x: 'desc' },
    }),
    prisma.referenciaOms.findFirst({
      where: { indicador, sexo, x: { gte: x } },
      orderBy: { x: 'asc' },
    }),
  ]);

  if (!inferior || !superior) return null;
  return interpolarLms([inferior, superior], x);
}

/**
 * Calcula los cuatro puntajes Z y la clasificacion de una medicion.
 * Devuelve los puntajes en null cuando no hay tablas o la edad queda fuera
 * del rango cubierto por la OMS. Nunca devuelve valores inventados.
 */
async function evaluarMedicion({ sexo, edadMeses, peso, talla, perimetroBraquial }) {
  const base = {
    zPesoEdad: null,
    zTallaEdad: null,
    zPesoTalla: null,
    zImcEdad: null,
    clasificacion: null,
    avisos: [],
  };

  const pesoNum = peso == null ? null : Number(peso);
  const tallaNum = talla == null ? null : Number(talla);
  const muacNum = perimetroBraquial == null ? null : Number(perimetroBraquial);

  if (!(await tablasCargadas())) {
    base.avisos.push(AVISO_SIN_TABLAS);
    // El MUAC es criterio independiente: sigue sirviendo sin tablas OMS.
    base.clasificacion = clasificar({ perimetroBraquial: muacNum, edadMeses });
    return base;
  }

  if (edadMeses > EDAD_MAX_MESES) {
    base.avisos.push('Los patrones de la OMS cubren solo de 0 a 60 meses');
    base.clasificacion = clasificar({ perimetroBraquial: muacNum, edadMeses });
    return base;
  }

  const calcular = async (indicador, x, valor) => {
    if (valor == null || x == null) return null;
    const lms = await lmsPara(indicador, sexo, x);
    if (!lms) return null;
    return Number(puntajeZ(valor, lms).toFixed(2));
  };

  const imc = calcularImc(pesoNum, tallaNum);
  const indicadorEstatura = indicadorPesoPorEstatura(edadMeses);

  const [zPesoEdad, zTallaEdad, zPesoTalla, zImcEdad] = await Promise.all([
    calcular('peso_edad', edadMeses, pesoNum),
    calcular('talla_edad', edadMeses, tallaNum),
    calcular(indicadorEstatura, tallaNum, pesoNum),
    calcular('imc_edad', edadMeses, imc),
  ]);

  if (tallaNum != null && pesoNum != null && zPesoTalla === null) {
    base.avisos.push('La talla queda fuera del rango cubierto por la tabla de la OMS');
  }

  return {
    zPesoEdad,
    zTallaEdad,
    zPesoTalla,
    zImcEdad,
    clasificacion: clasificar({
      zPesoTalla,
      zTallaEdad,
      zImcEdad,
      perimetroBraquial: muacNum,
      edadMeses,
    }),
    avisos: base.avisos,
  };
}

/**
 * Bandas de referencia (-3, -2, -1, 0, +1, +2, +3 DE) para dibujar la curva
 * de crecimiento debajo de las mediciones del paciente.
 */
async function bandasReferencia(indicador, sexo) {
  const filas = await prisma.referenciaOms.findMany({
    where: { indicador, sexo },
    orderBy: { x: 'asc' },
  });

  if (filas.length === 0) return null;

  const { valorEnZ } = require('./antropometria.service');
  const desviaciones = [-3, -2, -1, 0, 1, 2, 3];

  return {
    indicador,
    sexo,
    desviaciones,
    puntos: filas.map((fila) => {
      const l = Number(fila.l);
      const m = Number(fila.m);
      const s = Number(fila.s);
      return {
        x: Number(fila.x),
        valores: desviaciones.map((z) => Number(valorEnZ(z, l, m, s).toFixed(3))),
      };
    }),
  };
}

module.exports = {
  referenciasDe,
  AVISO_SIN_TABLAS,
  EDAD_MAX_MESES,
  MESES_MEDICION_DE_PIE,
  indicadorPesoPorEstatura,
  tablasCargadas,
  olvidarCache,
  lmsPara,
  evaluarMedicion,
  bandasReferencia,
};
