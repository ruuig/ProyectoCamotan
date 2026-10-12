/**
 * Triaje: de los datos de la preconsulta al nivel de prioridad.
 *
 * Capa 1 de la prioridad. Cada criterio clinico (tabla criterio_triaje, que
 * ajusta el personal medico) dice: para tal edad, si tal dato es mayor o
 * igual (o menor) que tal valor, el paciente es urgente o moderado, y por
 * que, en palabras. Los signos de peligro marcados suman su propio nivel.
 * Gana el nivel mas alto; sin nada, es leve.
 *
 * Funciones puras.
 */

const RANGO = { urgente: 2, moderado: 1, leve: 0 };
const NIVELES = ['leve', 'moderado', 'urgente'];

/** Nivel de conciencia (AVPU) como numero, para compararlo con un umbral. */
const CONCIENCIA = { alerta: 0, confuso: 1, voz: 2, dolor: 3, no_responde: 4 };
const ETIQUETA_CONCIENCIA = {
  alerta: 'Alerta',
  confuso: 'Confuso',
  voz: 'Responde a la voz',
  dolor: 'Responde solo al dolor',
  no_responde: 'No responde',
};

/** Clasificacion nutricional (puntaje Z) como numero. */
const DESNUTRICION = { desnutricion_aguda_moderada: 1, desnutricion_aguda_severa: 2 };

const UNIDAD = {
  temperatura: ' °C',
  satOxigeno: ' %',
  frecRespiratoria: ' por min',
  frecCardiaca: ' por min',
  presionSis: ' mmHg',
  presionDia: ' mmHg',
  dolor: '/10',
  glucosa: ' mg/dL',
};

const CAMPOS = ['temperatura', 'satOxigeno', 'frecRespiratoria', 'frecCardiaca', 'presionSis', 'presionDia', 'dolor', 'conciencia', 'glucosa', 'desnutricion'];

const vacio = (v) => v === null || v === undefined || v === '';

/** El valor numerico de un campo, o null si no se midio. */
function valorDe(campo, medicion) {
  if (campo === 'conciencia') return vacio(medicion.conciencia) ? null : CONCIENCIA[medicion.conciencia] ?? null;
  if (campo === 'desnutricion') return DESNUTRICION[medicion.clasificacionNutricional] ?? (vacio(medicion.clasificacionNutricional) ? null : 0);
  const v = medicion[campo];
  return vacio(v) ? null : Number(v);
}

function textoValor(campo, medicion) {
  if (campo === 'conciencia') return ETIQUETA_CONCIENCIA[medicion.conciencia] ?? '';
  if (campo === 'desnutricion') return '';
  if (campo === 'presionSis' || campo === 'presionDia') {
    return medicion.presionSis && medicion.presionDia ? `${medicion.presionSis}/${medicion.presionDia} mmHg` : `${medicion[campo]}${UNIDAD[campo]}`;
  }
  return `${medicion[campo]}${UNIDAD[campo] ?? ''}`;
}

function aplica(criterio, { edadMeses, embarazada }) {
  if (criterio.activo === false) return false;
  if (criterio.soloEmbarazo && !embarazada) return false;
  if (edadMeses == null) return !criterio.soloEmbarazo && criterio.edadDesdeMeses === 0 && criterio.edadHastaMeses == null;
  if (edadMeses < criterio.edadDesdeMeses) return false;
  if (criterio.edadHastaMeses != null && edadMeses >= criterio.edadHastaMeses) return false;
  return true;
}

function cumple(criterio, valor) {
  const umbral = Number(criterio.valor);
  return criterio.operador === 'menor' ? valor < umbral : valor >= umbral;
}

/**
 * Los criterios que cumple la medicion. De cada dato se queda solo el mas
 * grave: con 40.2 °C se dice "Fiebre muy alta", no tambien "Fiebre alta".
 */
function evaluarCriterios(medicion, contexto, criterios) {
  const porCampo = new Map();
  for (const c of criterios) {
    if (!aplica(c, contexto)) continue;
    const valor = valorDe(c.campo, medicion);
    if (valor === null || !cumple(c, valor)) continue;
    // Presion: sistolica y diastolica son un solo dato para quien lo lee.
    const clave = c.campo === 'presionDia' ? 'presionSis' : c.campo;
    const previo = porCampo.get(clave);
    if (!previo || RANGO[c.nivel] > RANGO[previo.nivel]) {
      const valorTexto = textoValor(c.campo, medicion);
      porCampo.set(clave, {
        campo: c.campo,
        nivel: c.nivel,
        etiqueta: c.etiqueta,
        texto: valorTexto ? `${c.etiqueta} (${valorTexto})` : c.etiqueta,
      });
    }
  }
  return [...porCampo.values()].sort((a, b) => RANGO[b.nivel] - RANGO[a.nivel]);
}

function nivelMayor(...niveles) {
  return niveles.filter(Boolean).reduce((a, b) => (RANGO[b] > RANGO[a] ? b : a), 'leve');
}

/**
 * Nivel sugerido y sus razones: criterios clinicos y signos de peligro.
 * signos: [{ descripcion, gravedadSugerida }] ya marcados.
 */
function triaje(medicion, contexto, criterios, signos = []) {
  const motivos = [
    ...evaluarCriterios(medicion, contexto, criterios),
    ...signos.map((s) => ({ campo: 'signo_peligro', nivel: s.gravedadSugerida, etiqueta: s.descripcion, texto: s.descripcion })),
  ].sort((a, b) => RANGO[b.nivel] - RANGO[a.nivel]);
  return { nivel: nivelMayor(...motivos.map((m) => m.nivel)), motivos };
}

/** Bajar el nivel sugerido exige escribir por que. */
const bajaDe = (sugerido, elegido) => RANGO[elegido] < RANGO[sugerido];

module.exports = {
  RANGO, NIVELES, CONCIENCIA, ETIQUETA_CONCIENCIA, DESNUTRICION, CAMPOS,
  valorDe, aplica, evaluarCriterios, triaje, nivelMayor, bajaDe,
};
