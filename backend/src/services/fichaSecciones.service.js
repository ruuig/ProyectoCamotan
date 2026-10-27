/**
 * Secciones de la ficha clinica que son del paciente, ademas de la
 * identificacion: antecedentes, alimentacion y estilos de vida, vacunacion,
 * suplementacion y familiograma.
 *
 * Transcritas de MD/fichas.md: mismos nombres de seccion y subseccion, mismo
 * orden que el papel, mismos tipos de campo. Las llena preconsulta al ir
 * pasando la ficha de papel al sistema; se guardan una por una.
 *
 * Lo que es de cada visita (signos de peligro, motivo, signos vitales,
 * historia de la enfermedad, examen fisico, diagnostico, cierre) no esta aqui.
 *
 * Funciones puras.
 */

const { z } = require('zod');

// --- Tipos de campo -----------------------------------------------------------
//
// siNo            tres estados: null (sin registrar), true, false
// siNoEspecifique siNo + texto en <clave>Detalle, que solo vale si es Si
// siNoNumero      siNo + numero en <clave>Detalle (horas al dia, edad de inicio)
// lista           varias casillas Si/No, cada una con tres estados
// numero          con unidad visible
// libraOnza       dos numeros: <clave>Lb y <clave>Onz
// fecha, texto, textoLargo
// seleccion       una opcion; si tiene la opcion "otro", el texto va en <clave>Otro
// calculado       no se escribe
// archivo         foto o PDF adjunto

const siNo = (clave, etiqueta, extra = {}) => ({ clave, etiqueta, tipo: 'siNo', ...extra });
const especifique = (clave, etiqueta, extra = {}) => ({ clave, etiqueta, tipo: 'siNoEspecifique', ...extra });
const siNoNumero = (clave, etiqueta, unidad, extra = {}) => ({ clave, etiqueta, tipo: 'siNoNumero', unidad, ...extra });
const numero = (clave, etiqueta, unidad, extra = {}) => ({ clave, etiqueta, tipo: 'numero', unidad, ...extra });
const texto = (clave, etiqueta, extra = {}) => ({ clave, etiqueta, tipo: 'texto', ...extra });
const textoLargo = (clave, etiqueta, extra = {}) => ({ clave, etiqueta, tipo: 'textoLargo', ...extra });
const seleccion = (clave, etiqueta, opciones, extra = {}) => ({ clave, etiqueta, tipo: 'seleccion', opciones, ...extra });
const lista = (clave, etiqueta, items, extra = {}) => ({ clave, etiqueta, tipo: 'lista', items, ...extra });
const item = (clave, etiqueta, extra = {}) => ({ clave, etiqueta, ...extra });
const op = (valor, etiqueta) => ({ valor, etiqueta });
const OTRO = op('otro', 'Otro');

// --- Opciones que se repiten --------------------------------------------------

const PARTO = [op('vaginal', 'Vaginal'), op('cesarea', 'Cesárea')];

const ATENDIDO_POR = [
  op('medico', 'Médico/a'),
  op('enfermero', 'Enfermero/a'),
  op('aux_enfermeria', 'Aux. enf.'),
  op('comadrona', 'Comadrona'),
  OTRO,
];

const VIVE_CON_NINEZ = [
  op('ambos_padres', 'Ambos padres'),
  op('uno_de_los_padres', 'Uno de los padres'),
  op('familiar', 'Familiar'),
  OTRO,
];

const VIVE_CON_ADULTO = [
  op('familia', 'Familia'),
  op('conocido', 'Conocido/amigo'),
  op('institucion', 'Institución protectora'),
  op('privado_libertad', 'Privado de libertad'),
  op('situacion_calle', 'Situación de calle'),
  OTRO,
];

// --- Calculos ----------------------------------------------------------------

/**
 * Clasificacion del peso al nacer, con los cortes del papel: menor de
 * 2,500 g (5 lb 4 onz), de 2,500 a 4,000 g (5 lb 4 onz a 8 lb), mayor de
 * 4,000 g (8 lb).
 *
 * El papel da los cortes en libras y onzas con una equivalencia redondeada
 * (5 lb 4 onz son en realidad 2,381 g). Como en el centro se pesa en libras,
 * se usan los cortes en libras tal como estan impresos: asi el sistema
 * clasifica igual que la persona que mira la ficha.
 */
const ONZAS_POR_LIBRA = 16;
const CORTE_BAJO = 5 * ONZAS_POR_LIBRA + 4; // 5 lb 4 onz
const CORTE_ALTO = 8 * ONZAS_POR_LIBRA; // 8 lb

function clasificacionPesoNacer(libras, onzas) {
  if (libras === null || libras === undefined || libras === '') return null;
  const total = Number(libras) * ONZAS_POR_LIBRA + Number(onzas || 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (total < CORTE_BAJO) return 'Menor de 2,500 g';
  if (total <= CORTE_ALTO) return 'De 2,500 a 4,000 g';
  return 'Mayor de 4,000 g';
}

const CALCULOS = {
  clasificacionPesoNacer: (datos) => clasificacionPesoNacer(datos.pesoNacerLb, datos.pesoNacerOnz),
};

// Elaborado en hoja aparte (neonato y adolescente).
const FAMILIOGRAMA = {
  clave: 'familiograma',
  titulo: 'Familiograma',
  campos: [
    { clave: 'familiograma', etiqueta: 'Familiograma', tipo: 'archivo', ayuda: 'Foto o PDF del familiograma elaborado en hoja aparte' },
  ],
};

// --- Neonato (1.6 Antecedentes) ----------------------------------------------

const NEONATO = [
  {
    clave: 'perinatales_neonato',
    titulo: 'Perinatales',
    campos: [
      { clave: 'pesoNacer', etiqueta: 'Peso al nacer', tipo: 'libraOnza' },
      { clave: 'clasificacionPesoNacer', etiqueta: 'Clasificación del peso al nacer', tipo: 'calculado', calculo: 'clasificacionPesoNacer' },
      numero('longitud', 'Longitud', 'cm', { minimo: 20, maximo: 70, decimales: 1 }),
      numero('perimetroCefalico', 'P. cefálico', 'cm', { minimo: 20, maximo: 50, decimales: 1 }),
      seleccion('clasificacionPerimetroCefalico', 'Clasificación del perímetro cefálico', [
        op('normal', 'Normal (de −2 a menor de 2 DE)'),
        op('microcefalia', 'Microcefalia (menor de −2 DE)'),
        op('macrocefalia', 'Macrocefalia (mayor de 3 DE)'),
      ]),
      seleccion('parto', 'Parto', PARTO),
      siNo('usoForceps', 'Uso de fórceps'),
      especifique('complicacionesParto', 'Complicaciones durante el parto'),
      seleccion('atendidoPor', 'Atendido por', ATENDIDO_POR),
      seleccion('edadGestacional', 'Edad gestacional', [
        op('termino', 'Nació a término (37 a 40 semanas)'),
        op('pretermino', 'Nació pretérmino (menos de 37 semanas)'),
        op('postermino', 'Nació postérmino (más de 41 semanas)'),
      ]),
      siNo('lloroAlNacer', 'Lloró rápido y fuerte al nacer'),
      siNo('apegoInmediato', 'Apego inmediato'),
      siNo('labioHendido', 'Labio hendido'),
      siNo('paladarHendido', 'Paladar hendido'),
      siNo('anomaliasTuboNeural', 'Anomalías del tubo neural'),
      siNo('luxacionCadera', 'Luxación congénita de cadera'),
      siNo('quirurgicos', 'Quirúrgicos'),
      texto('otrosPerinatales', 'Otros'),
    ],
  },
  {
    clave: 'alimentacion_neonato',
    titulo: 'Alimentación',
    campos: [
      siNo('lecheMaterna30', 'Leche materna (primeros 30 minutos de vida)'),
      siNo('lactanciaExclusiva', 'Lactancia materna exclusiva'),
      especifique('otraAlimentacion', 'Otro, especifique'),
    ],
  },
  {
    clave: 'psicosociales_neonato',
    titulo: 'Psicosociales',
    campos: [
      siNo('apoyoSocial', 'Apoyo social'),
      siNo('coberturaIgss', 'Cobertura IGSS'),
      seleccion('viveCon', 'Vive con', VIVE_CON_NINEZ),
    ],
  },
  {
    clave: 'maternos',
    titulo: 'Maternos',
    campos: [
      lista('antecedentesMaternos', 'Antecedentes maternos', [
        item('desnutricion', 'Problemas de desnutrición'),
        item('diabetes', 'Diabetes'),
        item('hipertension', 'Hipertensión'),
        item('cancer', 'Cáncer'),
        item('transmisibles', 'Enfermedades transmisibles'),
        item('hipertensionEmbarazo', 'Hipertensión durante el embarazo'),
        item('psicologicos', 'Problemas psicológicos'),
        item('judiciales', 'Problemas judiciales', { sensible: true }),
        item('tb', 'TB'),
        item('torch', 'TORCH'),
        item('chagas', 'Chagas'),
        item('sifilis', 'Sífilis'),
        item('hepatitis', 'Hepatitis B o C'),
        item('zika', 'Zika'),
        item('its', 'ITS'),
        item('sustancias', 'Consumo de sustancias psicoactivas'),
        item('madreAdolescente', 'Madre adolescente'),
        item('madreFallecida', 'Madre fallecida'),
      ]),
      texto('grupoRh', 'Grupo y Rh de la madre'),
      texto('otrosMaternos', 'Otras, especificar'),
    ],
  },
  {
    clave: 'vacunacion_neonato',
    titulo: 'Vacunación',
    campos: [
      siNo('hepatitisB', 'Hepatitis B', { ayuda: 'RN, primeras 24 horas de vida' }),
      siNo('bcg', 'BCG', { ayuda: 'RN, hasta antes de cumplir 1 año' }),
    ],
  },
  FAMILIOGRAMA,
];

// --- Lactante, niña y niño (2.6 Antecedentes) ---------------------------------

const NINEZ = [
  {
    clave: 'perinatales_ninez',
    titulo: 'Perinatales',
    campos: [
      { clave: 'pesoNacer', etiqueta: 'Peso al nacer', tipo: 'libraOnza' },
      especifique('complicacionesParto', 'Complicaciones durante el parto'),
      numero('longitud', 'Longitud', 'cm', { minimo: 20, maximo: 70, decimales: 1 }),
      seleccion('parto', 'Parto', PARTO),
      siNo('usoForceps', 'Uso de fórceps'),
      seleccion('lugarParto', 'Lugar del parto', [op('institucional', 'Institucional'), op('comunitario', 'Comunitario'), OTRO]),
      seleccion('atendidoPor', 'Atendido por', ATENDIDO_POR),
    ],
  },
  {
    clave: 'medicos_ninez',
    titulo: 'Médicos',
    campos: [
      lista('antecedentesMedicos', 'Antecedentes médicos', [
        item('crecimiento', 'Problemas de crecimiento'),
        item('nutricionales', 'Problemas nutricionales'),
        item('desarrollo', 'Problemas de desarrollo'),
        item('transmisibles', 'Enfermedades transmisibles'),
        item('cronicas', 'Enfermedades crónicas'),
        item('vectoriales', 'Enfermedades vectoriales'),
        item('alergias', 'Alergias'),
        item('traumas', 'Traumas'),
        item('cirugias', 'Cirugías'),
        item('discapacidad', 'Discapacidad'),
        item('intoxicaciones', 'Intoxicaciones'),
        item('medicamentos', 'Uso de medicamentos'),
        item('asma', 'Asma'),
        item('hospitalizacion', 'Hospitalización'),
        item('accidentes', 'Accidentes'),
        item('maltratoInfantil', 'Maltrato infantil', { sensible: true }),
      ]),
      texto('otrosMedicos', 'Otros, especificar'),
    ],
  },
  {
    clave: 'familiares_ninez',
    titulo: 'Familiares',
    campos: [
      lista('antecedentesFamiliares', 'Antecedentes familiares', [
        item('diabetes', 'Diabetes'),
        item('hipertension', 'Hipertensión'),
        item('cancer', 'Cáncer'),
        item('transmisibles', 'Enfermedades transmisibles'),
        item('psicologicos', 'Problemas psicológicos'),
        item('judiciales', 'Problemas judiciales', { sensible: true }),
        item('sustancias', 'Consumo de sustancias psicoactivas'),
        item('violencia', 'Violencia', { sensible: true }),
      ]),
      texto('otrosFamiliares', 'Otras, especificar'),
    ],
  },
  {
    clave: 'psicosociales_ninez',
    titulo: 'Psicosociales',
    campos: [
      siNo('apoyoSocial', 'Apoyo social'),
      siNo('coberturaIgss', 'Cobertura IGSS'),
      texto('problemasFrecuentes', 'Problemas más frecuentes'),
      seleccion('viveCon', 'Vive con', VIVE_CON_NINEZ),
      especifique('problemasEscuela', 'Problemas en la escuela'),
      especifique('trabajoInfantil', 'Trabajo infantil'),
      siNo('trabajoPeligroso', '¿Es peligroso?', { mostrarSi: { campo: 'trabajoInfantil', igual: true } }),
      lista('estadoAnimo', 'Estado de ánimo', [
        item('triste', 'Triste'),
        item('alegre', 'Alegre'),
        item('ansioso', 'Ansioso'),
        item('violento', 'Violento/a'),
        item('ideasSuicidas', 'Ideas suicidas', { sensible: true }),
      ]),
    ],
  },
  {
    clave: 'estilos_vida_ninez',
    titulo: 'Estilos de vida: alimentación según edad',
    campos: [
      siNo('lmExclusiva', 'LM exclusiva (menores de 6 meses)', { edadMeses: { hasta: 6 } }),
      siNo('alimentacionMixta', 'Alimentación mixta (menores de 6 meses)', { edadMeses: { hasta: 6 } }),
      siNo('lm6Meses2Anios', 'LM de 6 meses a 2 años o más', { edadMeses: { desde: 6 } }),
      siNo('alimentacionComplementaria', 'Alimentación complementaria en mayores de 6 meses', { edadMeses: { desde: 6 } }),
      siNo('alimentacionAdecuada', 'Alimentación adecuada a su edad'),
      numero('comidasDia', 'Comidas por día', null, { minimo: 0, maximo: 12 }),
      lista('consumo', 'Consumo de', [
        item('cereales', 'Cereales'),
        item('verduras', 'Verduras'),
        item('frutas', 'Frutas'),
        item('carnes', 'Carnes'),
        item('lacteos', 'Lácteos'),
        item('azucares', 'Azúcares'),
        item('grasas', 'Grasas'),
        item('aguaPura', 'Agua pura'),
      ]),
      siNoNumero('actividadFisica', 'Actividad física', 'horas al día', { maximo: 24 }),
      siNo('videojuegos', 'Videojuegos'),
      siNo('tv', 'TV'),
      texto('otrasActividades', 'Otras actividades'),
      numero('horasSueno', 'Horas de sueño al día', 'horas', { minimo: 0, maximo: 24 }),
      siNo('higiene', 'Higiene'),
    ],
  },
];

// --- Persona adulta y persona mayor (4.6 Antecedentes) -------------------------

const SOLO_MUJERES = { soloSexo: 'F' };

const ADULTO = [
  {
    clave: 'personales_adulto',
    titulo: 'Personales',
    campos: [
      numero('menarquia', 'Menarquia/espermarquia', 'años de edad', { minimo: 6, maximo: 25 }),
      numero('embarazos', 'Número de embarazos', null, { minimo: 0, maximo: 30, ...SOLO_MUJERES }),
      numero('hijos', 'Número de hijos', null, { minimo: 0, maximo: 30 }),
      numero('hijosVivos', 'Hijos vivos', null, { minimo: 0, maximo: 30 }),
      numero('abortos', 'Número de abortos', null, { minimo: 0, maximo: 30, ...SOLO_MUJERES }),
      { clave: 'fur', etiqueta: 'FUR', tipo: 'fecha', ...SOLO_MUJERES, ayuda: 'Fecha de última regla; se actualiza en cada atención' },
      siNoNumero('vidaSexualActiva', 'Vida sexual activa', 'edad de inicio', { maximo: 99 }),
      siNo('variasParejas', 'Varias parejas'),
      especifique('anticonceptivos', 'Uso de métodos anticonceptivos'),
      siNo('ciclosIrregulares', 'Ciclos menstruales irregulares', SOLO_MUJERES),
      siNo('dismenorrea', 'Dismenorrea', SOLO_MUJERES),
    ],
  },
  {
    clave: 'medicos_adulto',
    titulo: 'Médicos',
    campos: [
      lista('antecedentesMedicos', 'Antecedentes médicos', [
        item('tb', 'TB'),
        item('alergias', 'Alergias'),
        item('asma', 'Asma'),
        item('its', 'ITS'),
        item('itu', 'ITU'),
        item('dislipidemias', 'Dislipidemias'),
        item('osteoartritis', 'Osteoartritis'),
        item('cancerCervix', 'Cáncer de cérvix'),
        item('cancerProstata', 'Cáncer de próstata'),
        item('infarto', 'Infarto del miocardio'),
        item('nutricionales', 'Problemas nutricionales'),
        item('diabetes', 'Diabetes'),
        item('ecv', 'ECV'),
        item('hipertension', 'Hipertensión'),
        item('medicamentos', 'Uso de medicamentos'),
        item('discapacidad', 'Discapacidad'),
        item('intoxicaciones', 'Intoxicaciones'),
        item('traumas', 'Traumas'),
        item('cirugias', 'Cirugías'),
        item('hospitalizaciones', 'Hospitalizaciones'),
        item('violencia', 'Violencia', { sensible: true }),
        item('caidas', 'Caídas frecuentes'),
        item('vectoriales', 'Enfermedades vectoriales'),
      ]),
      texto('otrosMedicos', 'Otros, especifique'),
    ],
  },
  {
    clave: 'psicosociales_adulto',
    titulo: 'Psicosociales',
    campos: [
      seleccion('viveCon', 'Vive con', VIVE_CON_ADULTO),
      siNo('alteracionesAnimo', 'Alteraciones del estado de ánimo'),
      textoLargo('maltratoAbuso', 'Es objeto de maltrato o abuso, describa', { sensible: true }),
    ],
  },
  {
    clave: 'estilos_vida_adulto',
    titulo: 'Estilos de vida',
    subtitulo: 'Alimentación y actividad física',
    campos: [
      numero('comidasDia', 'Comidas por día', null, { minimo: 0, maximo: 12 }),
      lista('consumo', 'Consumo de', [
        item('cereales', 'Cereales'),
        item('verduras', 'Verduras'),
        item('frutas', 'Frutas'),
        item('carnes', 'Carnes'),
        item('lacteos', 'Lácteos'),
        item('aguaSegura', 'Agua segura'),
      ]),
      siNoNumero('actividadFisica', 'Actividad física', 'horas al día', { maximo: 24 }),
      siNo('videojuegos', 'Videojuegos'),
      texto('otrasActividades', 'Otras actividades'),
      siNo('tv', 'TV'),
      numero('horasSueno', 'Horas de sueño al día', 'horas', { minimo: 0, maximo: 24 }),
      siNo('higieneDiaria', 'Higiene diaria'),
      siNo('gruposAutoayuda', 'Asiste a grupos de autoayuda'),
      siNo('conduceVehiculo', 'Conduce vehículo'),
      texto('especifiqueEstilos', 'Especifique'),
    ],
  },
  {
    clave: 'familiares_adulto',
    titulo: 'Familiares',
    campos: [
      lista('antecedentesFamiliares', 'Antecedentes familiares', [
        item('diabetes', 'Diabetes'),
        item('hipertension', 'Hipertensión'),
        item('cancer', 'Cáncer'),
        item('transmisibles', 'Enfermedades transmisibles'),
        item('its', 'ITS'),
        item('tb', 'TB'),
        item('violencia', 'Violencia', { sensible: true }),
        item('psicologicos', 'Problemas psicológicos'),
        item('judiciales', 'Problemas judiciales', { sensible: true }),
        item('sustancias', 'Consumo de sustancias psicoactivas'),
        item('demencia', 'Demencia'),
      ]),
    ],
  },
  {
    clave: 'vacunacion_adulto',
    titulo: 'Vacunación',
    campos: [
      siNo('td', 'Td'),
      siNo('tdap', 'TdAp'),
      siNo('influenza', 'Influenza'),
      texto('otrasVacunas', 'Otras, especifique'),
    ],
  },
  {
    clave: 'suplementacion_adulto',
    titulo: 'Suplementación',
    campos: [
      siNo('acidoFolico', 'Ácido fólico'),
      siNo('sulfatoFerroso', 'Sulfato ferroso'),
      texto('otrosSuplementos', 'Otros, especifique'),
    ],
  },
  {
    clave: 'habitos_adulto',
    titulo: 'Hábitos',
    campos: [
      siNo('alcohol', 'Consumo de alcohol'),
      siNo('tabaco', 'Consumo de tabaco'),
      texto('otrasSustancias', 'Consumo de otras sustancias, especifique'),
    ],
  },
  {
    clave: 'historia_abuso',
    titulo: 'Historia abuso y/o violencia',
    campos: [
      especifique('historiaAbuso', 'Historia abuso y/o violencia', { sensible: true }),
    ],
  },
];

// --- Adolescente y joven (AII_016: antecedentes y desarrollo puberal) ----------------

const MENOR_DE_19 = { edadMeses: { hasta: 228 } };

const ADOLESCENTE = [
  {
    clave: 'personales_adolescente',
    titulo: 'Personales',
    campos: [
      numero('menarquia', 'Menarquia/espermarquia', 'años de edad', { minimo: 6, maximo: 25 }),
      numero('embarazos', 'Número de embarazos', null, { minimo: 0, maximo: 30, ...SOLO_MUJERES }),
      numero('hijos', 'Número de hijos', null, { minimo: 0, maximo: 30 }),
      numero('abortos', 'Número de abortos', null, { minimo: 0, maximo: 30, ...SOLO_MUJERES }),
      { clave: 'fur', etiqueta: 'FUR', tipo: 'fecha', ...SOLO_MUJERES },
      siNoNumero('vidaSexualActiva', 'Vida sexual activa', 'edad de inicio', { maximo: 99 }),
      siNo('conSuVoluntad', 'Con su voluntad', { sensible: true, mostrarSi: { campo: 'vidaSexualActiva', igual: true } }),
      siNo('variasParejas', 'Varias parejas'),
      especifique('anticonceptivos', 'Uso de métodos anticonceptivos'),
      siNo('ciclosIrregulares', 'Ciclos menstruales irregulares', SOLO_MUJERES),
      siNo('dismenorrea', 'Dismenorrea', SOLO_MUJERES),
    ],
  },
  {
    clave: 'medicos_adolescente',
    titulo: 'Médicos',
    campos: [
      lista('antecedentesMedicos', 'Antecedentes médicos', [
        item('anemia', 'Anemia'),
        item('alergias', 'Alergias'),
        item('asma', 'Asma'),
        item('its', 'ITS'),
        item('itu', 'ITU'),
        item('violencia', 'Violencia', { sensible: true }),
        item('crecimiento', 'Problemas de crecimiento'),
        item('nutricionales', 'Problemas nutricionales'),
        item('diabetes', 'Diabetes'),
        item('tb', 'TB'),
        item('trastornosAlimentarios', 'Trastornos alimentarios'),
        item('hipertension', 'Hipertensión'),
        item('medicamentos', 'Uso de medicamentos'),
        item('discapacidad', 'Discapacidad'),
        item('intoxicaciones', 'Intoxicaciones'),
        item('accidentes', 'Accidentes'),
        item('traumas', 'Traumas'),
        item('cirugias', 'Cirugías'),
        item('hospitalizaciones', 'Hospitalizaciones'),
      ]),
      texto('otrosMedicos', 'Especifique'),
    ],
  },
  {
    clave: 'psicosociales_adolescente',
    titulo: 'Psicosociales',
    campos: [
      seleccion('viveCon', 'Vive con', VIVE_CON_ADULTO),
      siNo('comparteCama', 'Comparte cama'),
      siNo('educacionSexualidad', 'Educación integral en sexualidad'),
      siNoNumero('trabajoInfantil', 'Trabajo infantil (menor de 14 años)', 'edad de inicio', { maximo: 30 }),
      siNo('alteracionesAnimo', 'Alteraciones del estado de ánimo'),
    ],
  },
  {
    clave: 'estilos_vida_adolescente',
    titulo: 'Estilos de vida',
    campos: [
      numero('comidasDia', 'Comidas por día', null, { minimo: 0, maximo: 12 }),
      siNoNumero('actividadFisica', 'Actividad física', 'horas al día', { maximo: 24 }),
      siNo('videojuegos', 'Videojuegos'),
      siNo('tv', 'TV'),
      texto('otrasActividades', 'Otras actividades'),
      numero('horasSueno', 'Horas de sueño al día', 'horas', { minimo: 0, maximo: 24 }),
      siNo('higieneDiaria', 'Higiene diaria'),
      siNo('espaciosAmigables', 'Asiste a espacios amigables'),
      siNo('sustancias', 'Consumo de sustancias psicoactivas'),
      texto('alcohol', 'Alcohol', { mostrarSi: { campo: 'sustancias', igual: true } }),
      texto('drogas', 'Drogas', { mostrarSi: { campo: 'sustancias', igual: true } }),
      texto('tabaco', 'Tabaco', { mostrarSi: { campo: 'sustancias', igual: true } }),
      texto('otrasSustancias', 'Otras sustancias, especifique'),
      siNo('conduceVehiculo', 'Conduce vehículo'),
    ],
  },
  {
    clave: 'familiares_adolescente',
    titulo: 'Familiares',
    campos: [
      lista('antecedentesFamiliares', 'Antecedentes familiares', [
        item('diabetes', 'Diabetes'),
        item('hipertension', 'Hipertensión'),
        item('cancer', 'Cáncer'),
        item('transmisibles', 'Enfermedades transmisibles'),
        item('its', 'ITS'),
        item('tb', 'TB'),
        item('violencia', 'Violencia', { sensible: true }),
        item('psicologicos', 'Problemas psicológicos'),
        item('judiciales', 'Problemas judiciales', { sensible: true }),
        item('sustancias', 'Consumo sust. psicoactivas'),
        item('padreAusente', 'Madre/padre ausente'),
      ]),
    ],
  },
  {
    clave: 'vacunacion_adolescente',
    titulo: 'Vacunación, suplementación y desparasitación',
    campos: [
      siNo('vph', 'VPH'),
      siNo('td', 'Td'),
      texto('otrasVacunas', 'Otras, especifique'),
      especifique('suplementacion', 'Suplementación'),
      especifique('desparasitacion', 'Desparasitación'),
    ],
  },
  FAMILIOGRAMA,
  {
    clave: 'factores_riesgo_adolescente',
    titulo: 'Factores de riesgo',
    campos: [
      lista('factoresRiesgo', 'Factores de riesgo', [
        item('individuales', 'Factores de riesgo individuales'),
        item('familia', 'Factores de riesgo en la familia'),
        item('amigos', 'Factores de riesgo con amigos/pares'),
        item('escuela', 'Factores de riesgo en la escuela'),
        item('comunidad', 'Factores de riesgo en la comunidad'),
      ]),
      texto('especifiqueRiesgo', 'Especifique'),
    ],
  },
  {
    clave: 'desarrollo_puberal_adolescente',
    titulo: 'Desarrollo puberal',
    subtitulo: 'Autoevaluación en menores de 19 años',
    campos: [
      siNo('tannerAdecuado', 'Tanner adecuado a su edad', MENOR_DE_19),
      texto('tannerMamas', 'Estadío de Tanner: mamas', { ...MENOR_DE_19, ...SOLO_MUJERES }),
      texto('tannerGenitales', 'Estadío de Tanner: genitales', { ...MENOR_DE_19, soloSexo: 'M' }),
      texto('tannerVello', 'Estadío de Tanner: vello púbico', MENOR_DE_19),
    ],
  },
];

const POR_FICHA = {
  recien_nacido: NEONATO,
  lactante_ninez: NINEZ,
  adolescente_joven: ADOLESCENTE,
  adulto: ADULTO,
  persona_mayor: ADULTO,
};

// --- Consultas sobre la estructura ----------------------------------------------

/** Todas las secciones conocidas, por clave (para validar una ruta). */
const TODAS = new Map([...NEONATO, ...NINEZ, ...ADULTO, ...ADOLESCENTE].map((s) => [s.clave, s]));

/** El campo se muestra para este paciente (sexo, edad, respuesta previa). */
function aplica(campo, { sexo, edadMeses }, datos = {}) {
  if (campo.soloSexo && sexo && campo.soloSexo !== sexo) return false;
  if (campo.edadMeses && edadMeses !== null && edadMeses !== undefined) {
    const { desde = 0, hasta = Infinity } = campo.edadMeses;
    if (edadMeses < desde || edadMeses >= hasta) return false;
  }
  if (campo.mostrarSi && datos[campo.mostrarSi.campo] !== campo.mostrarSi.igual) return false;
  return true;
}

/**
 * Secciones de la ficha que le toca al paciente, con los campos que aplican a
 * su sexo y edad. `mostrarSi` se resuelve en pantalla, segun lo que se marque.
 */
function seccionesDe(claveFicha, paciente) {
  return (POR_FICHA[claveFicha] ?? []).map((s) => ({
    ...s,
    grupo: 'Antecedentes',
    campos: s.campos.filter((c) => aplica({ ...c, mostrarSi: null }, paciente)),
  }));
}

/**
 * Claves de datos que produce un campo. Una lista produce una por casilla;
 * los compuestos guardan su detalle aparte.
 */
function clavesDe(campo) {
  switch (campo.tipo) {
    case 'lista': return campo.items.map((i) => i.clave);
    case 'siNoEspecifique':
    case 'siNoNumero': return [campo.clave, `${campo.clave}Detalle`];
    case 'libraOnza': return [`${campo.clave}Lb`, `${campo.clave}Onz`];
    case 'seleccion':
      return campo.opciones.some((o) => o.valor === 'otro') ? [campo.clave, `${campo.clave}Otro`] : [campo.clave];
    case 'calculado':
    case 'archivo': return [];
    default: return [campo.clave];
  }
}

/** Claves sensibles de una seccion: las de campos o casillas marcados. */
function clavesSensibles(seccion) {
  const salida = new Set();
  for (const c of seccion.campos) {
    if (c.tipo === 'lista') {
      c.items.filter((i) => i.sensible).forEach((i) => salida.add(i.clave));
    } else if (c.sensible) {
      clavesDe(c).forEach((k) => salida.add(k));
    }
  }
  return salida;
}

// --- Validacion -----------------------------------------------------------------

const textoCorto = z.string().trim().max(200).nullable();

function esquemaDeCampo(campo) {
  const numeroCon = (min, max, decimales) => {
    let n = z.number().min(min ?? 0).max(max ?? 9999);
    if (!decimales) n = n.int();
    return n.nullable();
  };
  const salida = {};
  switch (campo.tipo) {
    case 'siNo':
      salida[campo.clave] = z.boolean().nullable();
      break;
    case 'siNoEspecifique':
      salida[campo.clave] = z.boolean().nullable();
      salida[`${campo.clave}Detalle`] = textoCorto;
      break;
    case 'siNoNumero':
      salida[campo.clave] = z.boolean().nullable();
      salida[`${campo.clave}Detalle`] = numeroCon(0, campo.maximo ?? 99, true);
      break;
    case 'lista':
      campo.items.forEach((i) => { salida[i.clave] = z.boolean().nullable(); });
      break;
    case 'numero':
      salida[campo.clave] = numeroCon(campo.minimo, campo.maximo, campo.decimales);
      break;
    case 'libraOnza':
      salida[`${campo.clave}Lb`] = numeroCon(0, 15, false);
      salida[`${campo.clave}Onz`] = numeroCon(0, 15.9, true);
      break;
    case 'fecha':
      salida[campo.clave] = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD').nullable();
      break;
    case 'texto':
      salida[campo.clave] = textoCorto;
      break;
    case 'textoLargo':
      salida[campo.clave] = z.string().trim().max(2000).nullable();
      break;
    case 'seleccion':
      salida[campo.clave] = z.enum(campo.opciones.map((o) => o.valor)).nullable();
      if (campo.opciones.some((o) => o.valor === 'otro')) salida[`${campo.clave}Otro`] = textoCorto;
      break;
    default:
      break;
  }
  return salida;
}

/**
 * Esquema Zod de una seccion. Todo es opcional (se guarda lo que se tenga) y
 * no se aceptan claves que la seccion no conoce.
 */
function esquemaSeccion(seccion) {
  const forma = {};
  for (const c of seccion.campos) {
    for (const [k, v] of Object.entries(esquemaDeCampo(c))) forma[k] = v.optional();
  }
  return z.object(forma).strict();
}

/**
 * Limpia lo que depende de otra respuesta: el texto de "especifique" sin un
 * Si, el "otro" sin la opcion otro. Asi no queda un detalle huerfano.
 */
function normalizarDatos(seccion, datos) {
  const salida = { ...datos };
  for (const c of seccion.campos) {
    if ((c.tipo === 'siNoEspecifique' || c.tipo === 'siNoNumero') && salida[c.clave] !== true
      && `${c.clave}Detalle` in salida) {
      salida[`${c.clave}Detalle`] = null;
    }
    if (c.tipo === 'seleccion' && `${c.clave}Otro` in salida && salida[c.clave] !== 'otro') {
      salida[`${c.clave}Otro`] = null;
    }
    if (c.mostrarSi && salida[c.mostrarSi.campo] !== c.mostrarSi.igual && c.clave in salida) {
      salida[c.clave] = null;
    }
  }
  return salida;
}

// --- Avance ---------------------------------------------------------------------

const lleno = (v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

/**
 * Cuanto de la seccion tiene respuesta. Cada casilla de una lista cuenta como
 * una pregunta: "Diabetes: No" es una respuesta, vacia no lo es.
 */
function avanceSeccion(seccion, datos = {}, paciente = {}) {
  let total = 0;
  let respondidas = 0;
  for (const c of seccion.campos) {
    if (!aplica(c, paciente, datos)) continue;
    if (c.tipo === 'calculado') continue;
    if (c.tipo === 'archivo') {
      total += 1;
      if (datos[c.clave]) respondidas += 1;
      continue;
    }
    if (c.tipo === 'lista') {
      total += c.items.length;
      respondidas += c.items.filter((i) => lleno(datos[i.clave])).length;
      continue;
    }
    total += 1;
    const principal = c.tipo === 'libraOnza' ? `${c.clave}Lb` : c.clave;
    if (lleno(datos[principal])) respondidas += 1;
  }
  return { respondidas, total };
}

/**
 * "Marcar el resto como No": pone en No las preguntas Si/No que siguen sin
 * registrar, despues de que se marcaron los Si. Nunca toca una que ya tiene
 * respuesta, ni las sensibles: esas se responden una por una.
 */
function marcarRestoComoNo(seccion, datos = {}, paciente = {}) {
  const salida = { ...datos };
  for (const c of seccion.campos) {
    if (!aplica(c, paciente, salida)) continue;
    if (c.tipo === 'lista') {
      for (const i of c.items) {
        if (!i.sensible && !lleno(salida[i.clave])) salida[i.clave] = false;
      }
    } else if (['siNo', 'siNoEspecifique', 'siNoNumero'].includes(c.tipo) && !c.sensible) {
      if (!lleno(salida[c.clave])) salida[c.clave] = false;
    }
  }
  return salida;
}

/** Valores calculados de una seccion, a partir de lo registrado. */
function calculados(seccion, datos = {}) {
  const salida = {};
  for (const c of seccion.campos) {
    if (c.tipo === 'calculado' && CALCULOS[c.calculo]) salida[c.clave] = CALCULOS[c.calculo](datos);
  }
  return salida;
}

module.exports = {
  NEONATO,
  NINEZ,
  ADULTO,
  ADOLESCENTE,
  POR_FICHA,
  TODAS,
  clasificacionPesoNacer,
  aplica,
  seccionesDe,
  clavesDe,
  clavesSensibles,
  esquemaSeccion,
  normalizarDatos,
  avanceSeccion,
  marcarRestoComoNo,
  calculados,
  lleno,
};
