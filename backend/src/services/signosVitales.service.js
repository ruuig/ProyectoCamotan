// Evaluacion de signos vitales fuera de rango para la edad.
// Funcion pura: recibe la medicion y la edad, devuelve los hallazgos.
//
// ATENCION CLINICA: los rangos de referencia siguen los valores pediatricos
// de uso corriente y los umbrales de respiracion rapida de AIEPI. Deben ser
// revisados y firmados por el personal medico del establecimiento antes de
// usarse en produccion. Estan concentrados aqui, en una sola tabla, para que
// ese ajuste sea un cambio de datos y no de logica.

// Limite superior por tramo de edad. hastaMeses es exclusivo.
const RANGOS_POR_EDAD = [
  { hastaMeses: 2, frecCardiaca: [100, 180], frecRespiratoria: [30, 60] },
  { hastaMeses: 12, frecCardiaca: [100, 180], frecRespiratoria: [30, 50] },
  { hastaMeses: 36, frecCardiaca: [98, 140], frecRespiratoria: [22, 40] },
  { hastaMeses: 60, frecCardiaca: [80, 120], frecRespiratoria: [20, 40] },
  { hastaMeses: 144, frecCardiaca: [75, 118], frecRespiratoria: [18, 25] },
  { hastaMeses: 216, frecCardiaca: [60, 100], frecRespiratoria: [12, 20] },
  { hastaMeses: Infinity, frecCardiaca: [60, 100], frecRespiratoria: [12, 20] },
];

// Umbrales de respiracion rapida de AIEPI para menores de 5 anios.
// Son criterio de neumonia, por eso se marcan con severidad alta.
const RESPIRACION_RAPIDA_AIEPI = [
  { hastaMeses: 2, limite: 60 },
  { hastaMeses: 12, limite: 50 },
  { hastaMeses: 60, limite: 40 },
];

const TEMPERATURA = {
  hipotermiaGrave: 35.5,
  hipotermia: 36,
  normalMax: 37.5,
  fiebre: 38,
  fiebreAlta: 39, // coincide con el signo de peligro fiebre_alta
};

const SATURACION = { critica: 90, baja: 94 };

// La presion en menores se evalua por percentiles de talla y edad, que no
// estan en este sistema. Se evalua solo en adultos, y aparte en embarazadas.
const EDAD_ADULTO_MESES = 216;
const PRESION_ADULTO = { sisMin: 90, sisMax: 139, diaMin: 60, diaMax: 89 };
const PRESION_EMBARAZO = { sis: 140, dia: 90 };

function rangoParaEdad(tabla, edadMeses) {
  return tabla.find((tramo) => edadMeses < tramo.hastaMeses);
}

function hallazgo(campo, valor, severidad, mensaje) {
  return { campo, valor, severidad, mensaje };
}

/**
 * @param {object} medicion  peso, talla, temperatura, presionSis, presionDia,
 *                           frecCardiaca, frecRespiratoria, satOxigeno
 * @param {object} contexto  { edadMeses, condiciones: string[] }
 * @returns {Array} hallazgos, vacio si todo esta dentro de rango
 */
function evaluarSignosVitales(medicion = {}, contexto = {}) {
  const { edadMeses } = contexto;
  const condiciones = contexto.condiciones ?? [];
  const hallazgos = [];

  if (edadMeses === undefined || edadMeses === null) {
    throw new Error('Se requiere la edad en meses para evaluar los signos vitales');
  }

  const rango = rangoParaEdad(RANGOS_POR_EDAD, edadMeses);

  // --- Temperatura -------------------------------------------------------
  const temp = medicion.temperatura;
  if (temp !== null && temp !== undefined) {
    if (temp < TEMPERATURA.hipotermiaGrave) {
      hallazgos.push(hallazgo('temperatura', temp, 'alta', `Hipotermia grave (${temp} °C)`));
    } else if (temp < TEMPERATURA.hipotermia) {
      hallazgos.push(hallazgo('temperatura', temp, 'media', `Temperatura baja para la edad (${temp} °C)`));
    } else if (temp >= TEMPERATURA.fiebreAlta) {
      hallazgos.push(hallazgo('temperatura', temp, 'alta', `Fiebre alta (${temp} °C)`));
    } else if (temp >= TEMPERATURA.fiebre) {
      hallazgos.push(hallazgo('temperatura', temp, 'media', `Fiebre (${temp} °C)`));
    } else if (temp > TEMPERATURA.normalMax) {
      hallazgos.push(hallazgo('temperatura', temp, 'media', `Temperatura sobre lo normal (${temp} °C)`));
    }
  }

  // --- Frecuencia respiratoria ------------------------------------------
  const fr = medicion.frecRespiratoria;
  if (fr !== null && fr !== undefined) {
    const aiepi = rangoParaEdad(RESPIRACION_RAPIDA_AIEPI, edadMeses);

    if (aiepi && fr >= aiepi.limite) {
      hallazgos.push(
        hallazgo('frecRespiratoria', fr, 'alta',
          `Respiracion rapida para la edad (${fr} por minuto, limite AIEPI ${aiepi.limite})`),
      );
    } else if (fr > rango.frecRespiratoria[1]) {
      hallazgos.push(
        hallazgo('frecRespiratoria', fr, 'media',
          `Frecuencia respiratoria sobre el rango para la edad (${fr}, esperado ${rango.frecRespiratoria.join(' a ')})`),
      );
    } else if (fr < rango.frecRespiratoria[0]) {
      hallazgos.push(
        hallazgo('frecRespiratoria', fr, 'alta',
          `Frecuencia respiratoria baja para la edad (${fr}, esperado ${rango.frecRespiratoria.join(' a ')})`),
      );
    }
  }

  // --- Frecuencia cardiaca ----------------------------------------------
  const fc = medicion.frecCardiaca;
  if (fc !== null && fc !== undefined) {
    if (fc > rango.frecCardiaca[1]) {
      hallazgos.push(
        hallazgo('frecCardiaca', fc, 'media',
          `Frecuencia cardiaca sobre el rango para la edad (${fc}, esperado ${rango.frecCardiaca.join(' a ')})`),
      );
    } else if (fc < rango.frecCardiaca[0]) {
      hallazgos.push(
        hallazgo('frecCardiaca', fc, 'alta',
          `Frecuencia cardiaca baja para la edad (${fc}, esperado ${rango.frecCardiaca.join(' a ')})`),
      );
    }
  }

  // --- Saturacion de oxigeno --------------------------------------------
  const sat = medicion.satOxigeno;
  if (sat !== null && sat !== undefined) {
    if (sat < SATURACION.critica) {
      hallazgos.push(hallazgo('satOxigeno', sat, 'alta', `Saturacion critica (${sat} por ciento)`));
    } else if (sat < SATURACION.baja) {
      hallazgos.push(hallazgo('satOxigeno', sat, 'media', `Saturacion baja (${sat} por ciento)`));
    }
  }

  // --- Presion arterial --------------------------------------------------
  const { presionSis: sis, presionDia: dia } = medicion;
  const embarazada = condiciones.includes('embarazo');

  if (sis != null || dia != null) {
    if (embarazada && (sis >= PRESION_EMBARAZO.sis || dia >= PRESION_EMBARAZO.dia)) {
      hallazgos.push(
        hallazgo('presion', `${sis}/${dia}`, 'alta',
          `Presion elevada en embarazo (${sis}/${dia}). Descartar preeclampsia`),
      );
    } else if (edadMeses >= EDAD_ADULTO_MESES) {
      if (sis > PRESION_ADULTO.sisMax || dia > PRESION_ADULTO.diaMax) {
        hallazgos.push(hallazgo('presion', `${sis}/${dia}`, 'media', `Presion elevada (${sis}/${dia})`));
      } else if (sis < PRESION_ADULTO.sisMin || dia < PRESION_ADULTO.diaMin) {
        hallazgos.push(hallazgo('presion', `${sis}/${dia}`, 'media', `Presion baja (${sis}/${dia})`));
      }
    }
    // En menores de 18 no se evalua: requiere percentiles por talla y edad.
  }

  return hallazgos;
}

module.exports = {
  evaluarSignosVitales,
  RANGOS_POR_EDAD,
  RESPIRACION_RAPIDA_AIEPI,
  TEMPERATURA,
  SATURACION,
  EDAD_ADULTO_MESES,
};
