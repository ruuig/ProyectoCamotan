// Estructura de las fichas clinicas del MSPAS por etapa de vida.
//
// Transcrita de las fichas oficiales publicadas por la USAC:
//   AII_015  Lactante, nina y nino (29 dias a < 10 anios)
//   AII_016  Adolescente y joven (10 a < 30 anios)
//   AII_017  Persona adulta (30 a 59) y persona mayor (60 y mas)
//   AII_013  Ficha clinica prenatal y puerperio
//
// Las secciones comunes viven aqui como estructura; lo propio de cada ficha
// (antecedentes, psicosociales, estilos de vida) se guarda en JSONB validado
// con Zod por tipo, para que un cambio del MSPAS no exija migracion.

// Sitios del examen fisico. Son los mismos en las tres fichas; la de persona
// adulta agrega pies, por el pie diabetico.
const SITIOS_EXAMEN = [
  { clave: 'piel', etiqueta: 'Piel, faneras y mucosas' },
  { clave: 'cabeza', etiqueta: 'Cabeza' },
  { clave: 'ojos', etiqueta: 'Ojos' },
  { clave: 'oidos', etiqueta: 'Oídos' },
  { clave: 'salud_bucal', etiqueta: 'Salud bucal' },
  { clave: 'cuello_tiroides', etiqueta: 'Cuello y tiroides' },
  { clave: 'torax', etiqueta: 'Tórax' },
  { clave: 'cardiopulmonar', etiqueta: 'Cardiopulmonar' },
  { clave: 'abdomen', etiqueta: 'Abdomen' },
  { clave: 'genitourinario', etiqueta: 'Genitourinario' },
  { clave: 'columna', etiqueta: 'Columna' },
  { clave: 'cadera', etiqueta: 'Cadera' },
  { clave: 'extremidades', etiqueta: 'Extremidades' },
  { clave: 'neurologico', etiqueta: 'Neurológico' },
];

const SITIO_PIES = { clave: 'pies', etiqueta: 'Pies' };
const SITIO_HUESOS = { clave: 'huesos_articulaciones', etiqueta: 'Huesos y articulaciones' };

/**
 * Secciones comunes a toda ficha, en el orden del formulario oficial.
 */
const SECCIONES_COMUNES = [
  { clave: 'encabezado', etiqueta: 'Fecha, hora y número de expediente' },
  { clave: 'establecimiento', etiqueta: 'Datos del establecimiento' },
  { clave: 'identificacion', etiqueta: 'Identificación' },
  { clave: 'signos_peligro', etiqueta: 'Signos o síntomas de peligro' },
  { clave: 'motivo', etiqueta: 'Motivo de consulta' },
  { clave: 'referido', etiqueta: 'Referido y especificación' },
  { clave: 'historia', etiqueta: 'Historia de la enfermedad actual' },
  { clave: 'antecedentes', etiqueta: 'Antecedentes' },
  { clave: 'signos_vitales', etiqueta: 'Signos vitales' },
  { clave: 'antropometria', etiqueta: 'Antropometría' },
  { clave: 'estado_nutricional', etiqueta: 'Estado nutricional' },
  { clave: 'examen_fisico', etiqueta: 'Examen físico por sitio anatómico' },
  { clave: 'violencia', etiqueta: 'En caso de violencia' },
  { clave: 'impresion_clinica', etiqueta: 'Impresión clínica, CIE-10 y tratamiento' },
  { clave: 'otros_problemas', etiqueta: 'Otros problemas identificados' },
  { clave: 'laboratorios', etiqueta: 'Laboratorios y estudios complementarios' },
  { clave: 'orientacion', etiqueta: 'Orientación integral' },
  { clave: 'proxima_cita', etiqueta: 'Próxima cita' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
];

/**
 * Tipos de ficha. El recien nacido existe como etapa pero su ficha no esta
 * confirmada: se declara sin secciones propias en vez de inventarlas.
 */
const FICHAS = {
  recien_nacido: {
    clave: 'recien_nacido',
    etiqueta: 'Ficha de recién nacido (0 a 28 días)',
    documento: null,
    seccionesPropias: [],
    // Sin fuente confirmada no se declara ninguna lista.
    confirmada: false,
  },

  lactante_ninez: {
    clave: 'lactante_ninez',
    etiqueta: 'Ficha clínica para lactante, niña y niño (29 días a < 10 años)',
    documento: 'AII_015',
    confirmada: true,
    seccionesPropias: [
      { clave: 'antecedentes_perinatales', etiqueta: 'Antecedentes perinatales', momento: 'una_vez' },
      { clave: 'antecedentes_familiares', etiqueta: 'Antecedentes familiares', momento: 'una_vez' },
      { clave: 'antecedentes_medicos', etiqueta: 'Antecedentes médicos', momento: 'cuando_cambia' },
      { clave: 'psicosociales', etiqueta: 'Antecedentes psicosociales', momento: 'cuando_cambia' },
      { clave: 'alimentacion', etiqueta: 'Estilos de vida: alimentación según edad', momento: 'cuando_cambia' },
      { clave: 'acciones_preventivas', etiqueta: 'Acciones preventivas y vacunas', momento: 'cada_atencion' },
      { clave: 'maltrato_infantil', etiqueta: 'Maltrato infantil', momento: 'cada_atencion' },
    ],
  },

  adolescente_joven: {
    clave: 'adolescente_joven',
    etiqueta: 'Ficha clínica para adolescente y joven (10 a < 30 años)',
    documento: 'AII_016',
    confirmada: true,
    seccionesPropias: [
      { clave: 'antecedentes_personales', etiqueta: 'Antecedentes personales', momento: 'cuando_cambia' },
      { clave: 'antecedentes_medicos', etiqueta: 'Antecedentes médicos', momento: 'cuando_cambia' },
      { clave: 'psicosociales', etiqueta: 'Antecedentes psicosociales', momento: 'cuando_cambia' },
      { clave: 'factores_riesgo', etiqueta: 'Factores de riesgo', momento: 'cada_atencion' },
    ],
  },

  adulto: {
    clave: 'adulto',
    etiqueta: 'Ficha clínica para persona adulta (30 a 59 años)',
    documento: 'AII_017',
    confirmada: true,
    agregaPies: true,
    seccionesPropias: [
      { clave: 'antecedentes_personales', etiqueta: 'Antecedentes personales', momento: 'cuando_cambia' },
      { clave: 'antecedentes_medicos', etiqueta: 'Antecedentes médicos', momento: 'cuando_cambia' },
      { clave: 'psicosociales', etiqueta: 'Antecedentes psicosociales', momento: 'cuando_cambia' },
      { clave: 'estilos_vida', etiqueta: 'Estilos de vida', momento: 'cuando_cambia' },
    ],
  },

  persona_mayor: {
    clave: 'persona_mayor',
    etiqueta: 'Ficha clínica para persona mayor (60 años y más)',
    documento: 'AII_017',
    confirmada: true,
    agregaPies: true,
    seccionesPropias: [
      { clave: 'antecedentes_personales', etiqueta: 'Antecedentes personales', momento: 'cuando_cambia' },
      { clave: 'antecedentes_medicos', etiqueta: 'Antecedentes médicos', momento: 'cuando_cambia' },
      { clave: 'psicosociales', etiqueta: 'Antecedentes psicosociales', momento: 'cuando_cambia' },
      { clave: 'estilos_vida', etiqueta: 'Estilos de vida', momento: 'cuando_cambia' },
    ],
  },

  prenatal: {
    clave: 'prenatal',
    etiqueta: 'Ficha clínica prenatal y puerperio',
    documento: 'AII_013',
    confirmada: true,
    // Se habilita ademas de la ficha de la edad cuando hay embarazo activo.
    complementaria: true,
    seccionesPropias: [
      { clave: 'antecedentes_obstetricos', etiqueta: 'Antecedentes obstétricos', momento: 'cuando_cambia' },
      { clave: 'control_prenatal', etiqueta: 'Control prenatal', momento: 'cada_atencion' },
      { clave: 'puerperio', etiqueta: 'Puerperio', momento: 'cada_atencion' },
    ],
  },
};

/**
 * Sitios del examen fisico que corresponden a una ficha.
 */
function sitiosExamen(claveFicha) {
  // La ficha de neonato agrega huesos y articulaciones (MD/fichas.md 0.3).
  if (claveFicha === 'recien_nacido') return [...SITIOS_EXAMEN, SITIO_HUESOS];
  const ficha = FICHAS[claveFicha];
  if (!ficha) return SITIOS_EXAMEN;
  return ficha.agregaPies ? [...SITIOS_EXAMEN, SITIO_PIES] : SITIOS_EXAMEN;
}

/**
 * Fichas que aplican a una atencion.
 *
 * Devuelve la de la edad y, si hay embarazo activo, ademas la prenatal: asi lo
 * indican las propias fichas oficiales.
 */
function fichasParaAtencion({ etapa, embarazoActivo = false }) {
  const fichas = [];
  if (etapa && FICHAS[etapa]) fichas.push(FICHAS[etapa]);
  if (embarazoActivo) fichas.push(FICHAS.prenatal);
  return fichas;
}

module.exports = {
  SITIOS_EXAMEN,
  SITIO_PIES,
  SECCIONES_COMUNES,
  FICHAS,
  sitiosExamen,
  fichasParaAtencion,
};
