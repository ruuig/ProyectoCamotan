/**
 * Identificacion del paciente tal como la pide cada ficha clinica oficial.
 *
 * Transcrita de las fichas fisicas del centro (MD/fichas.md): mismos titulos,
 * mismo orden, mismas opciones. El formulario en pantalla se dibuja a partir
 * de esta estructura, asi que no hay agrupaciones inventadas como "Origen y
 * residencia" o "Identidad y pertenencia": esas no existen en ningun papel.
 *
 * La ficha se elige por la edad del paciente. Funciones puras.
 */

const { etapaDeVida } = require('./etapaVida.service');
const { DEPARTAMENTOS } = require('./geografia.service');

const MS_POR_DIA = 86400000;

// --- Las fichas -------------------------------------------------------------

const FICHAS = {
  recien_nacido: {
    clave: 'recien_nacido',
    nombre: 'Ficha clínica para neonato',
    rango: 'de 0 a 28 días',
    seccion: 'Identificación',
    provisional: false,
  },
  lactante_ninez: {
    clave: 'lactante_ninez',
    nombre: 'Ficha clínica para lactante, niña y niño',
    rango: 'de 29 días a menos de 10 años',
    seccion: 'Identificación de la niña o niño',
    provisional: false,
  },
  adolescente_joven: {
    clave: 'adolescente_joven',
    nombre: 'Ficha clínica para adolescente y joven',
    rango: 'de 10 a menos de 30 años',
    seccion: 'Identificación',
    // La ficha todavia no se ha fotografiado en el centro. Se arma con el
    // nucleo comun y lo que se sabe por la version publica, y se avisa.
    provisional: true,
    notaProvisional:
      'La ficha de adolescente todavía no se ha fotografiado en el centro. '
      + 'Se muestran los campos comunes y los que se conocen por la versión pública.',
  },
  adulto: {
    clave: 'adulto',
    nombre: 'Ficha clínica para persona adulta y persona mayor',
    rango: 'adulta/o de 30 a 59 años',
    seccion: 'Identificación del paciente',
    provisional: false,
  },
  persona_mayor: {
    clave: 'persona_mayor',
    nombre: 'Ficha clínica para persona adulta y persona mayor',
    rango: 'persona mayor de 60 años y más',
    seccion: 'Identificación del paciente',
    provisional: false,
  },
};

// --- Opciones como las trae el papel -----------------------------------------

/**
 * Pueblo: la ficha trae cinco opciones en este orden; el SIGSA agrega
 * "No indica". Se guarda el codigo SIGSA, se muestra el texto de la ficha.
 */
const PUEBLO = [
  { valor: '2', etiqueta: 'Maya' },
  { valor: '3', etiqueta: 'Garífuna' },
  { valor: '4', etiqueta: 'Xinca' },
  { valor: '1', etiqueta: 'Mestizo' },
  { valor: '5', etiqueta: 'Otro' },
  { valor: '6', etiqueta: 'No indica' },
];

const ESCOLARIDAD_ADULTO = [
  { valor: 'analfabeta', etiqueta: 'Analfabeta' },
  { valor: 'primaria', etiqueta: 'Primaria' },
  { valor: 'basicos', etiqueta: 'Básicos' },
  { valor: 'diversificado', etiqueta: 'Diversificado' },
  { valor: 'universitaria', etiqueta: 'Universitaria' },
];

// La ficha de adulto trae tres. "Unido/a" esta pendiente de confirmar.
const ESTADO_CIVIL = [
  { valor: 'soltero', etiqueta: 'Soltero/a' },
  { valor: 'casado', etiqueta: 'Casado/a' },
  { valor: 'viudo', etiqueta: 'Viudo/a' },
];

const ORIENTACION_SEXUAL = [
  { valor: '1', etiqueta: 'Heterosexual' },
  { valor: '2', etiqueta: 'Bisexual' },
  { valor: '3', etiqueta: 'Homosexual' },
  { valor: '4', etiqueta: 'Trans' },
];

const OPCIONES_DEPARTAMENTO = DEPARTAMENTOS.map((d) => ({ valor: d.nombre, etiqueta: d.nombre }));

/**
 * Codigo SIGSA de escolaridad a partir de lo que pregunta la ficha de adulto.
 * La ficha pregunta una cosa y el SIGSA pide otra: se traduce, no se pregunta
 * dos veces.
 */
const ESCOLARIDAD_A_SIGSA = {
  analfabeta: '7', // Ninguno
  primaria: '3',
  basicos: '4',
  diversificado: '5',
  universitaria: '6', // Universidad
};

function escolaridadSigsa(nivelEscolar) {
  return ESCOLARIDAD_A_SIGSA[nivelEscolar] ?? null;
}

// --- Piezas que se repiten entre fichas --------------------------------------

/** Lo que ya se capturo en el registro rapido: se muestra, no se vuelve a pedir. */
const registrado = (clave, etiqueta) => ({ clave, etiqueta, tipo: 'registrado' });

const campo = (clave, etiqueta, tipo, extra = {}) => ({ clave, etiqueta, tipo, ...extra });

const residencia = () => [
  campo('departamentoResidencia', 'Departamento', 'departamento', {
    opciones: OPCIONES_DEPARTAMENTO,
    ayuda: 'De residencia',
    nombreCompleto: 'Departamento de residencia',
  }),
  campo('municipioResidencia', 'Municipio', 'municipio', {
    dependeDe: 'departamentoResidencia',
    ayuda: 'De residencia',
    nombreCompleto: 'Municipio de residencia',
  }),
  // Territorio y sector no se llevan: el catalogo de comunidades del centro
  // es la lista de su propia base de pacientes, sin region.
  // No se exige: el catalogo de lugares poblados puede estar vacio todavia.
  campo('lugarPobladoId', 'Comunidad', 'comunidad'),
];

const pueblo = () => [
  campo('pueblo', 'Pueblo', 'seleccion', { opciones: PUEBLO }),
  campo('comunidadLinguistica', 'Comunidad lingüística', 'catalogo', {
    catalogo: 'comunidad_linguistica',
    mostrarSi: { campo: 'pueblo', igual: '2' },
    ayuda: 'Solo si el pueblo es Maya',
  }),
];

const migrante = () => [
  campo('migrante', 'Migrante', 'siNoEspecifique', {
    especifique: { clave: 'origenMigracion', etiqueta: 'Origen' },
  }),
];

const nacimientoCompleto = () => [
  campo('departamentoNacimiento', 'Departamento de nacimiento', 'departamento', {
    opciones: OPCIONES_DEPARTAMENTO,
  }),
  campo('municipioNacimiento', 'Municipio de nacimiento', 'municipio', {
    dependeDe: 'departamentoNacimiento',
  }),
];

// --- Identificacion de cada ficha, en el orden del papel ---------------------

function identificacionNeonato() {
  return [
    registrado('nombres', 'Nombres'),
    registrado('apellidos', 'Apellidos'),
    campo('noInscritoRenap', 'No inscrito aún en RENAP', 'siNo', {
      ayuda: 'Si aún no está inscrito, el neonato no tiene CUI propio',
    }),
    campo('domicilio', 'Domicilio', 'texto'),
    ...nacimientoCompleto(),
    ...residencia(),
    registrado('fechaNacimiento', 'Fecha de nacimiento'),
    campo('edad', 'Edad (en días)', 'calculado'),
    registrado('sexo', 'Sexo'),
    ...pueblo(),
    ...migrante(),
    campo('responsableNombre', 'Nombre de la madre/responsable', 'texto'),
    campo('edadMadre', 'Edad de la madre', 'numero', { unidad: 'años', minimo: 9, maximo: 65 }),
    campo('celular', 'Número de celular', 'telefono'),
  ];
}

function identificacionNinez() {
  return [
    registrado('nombres', 'Nombres'),
    registrado('apellidos', 'Apellidos'),
    ...nacimientoCompleto(),
    campo('domicilio', 'Domicilio', 'texto'),
    ...residencia(),
    registrado('fechaNacimiento', 'Fecha de nacimiento'),
    campo('edad', 'Edad', 'calculado', { ayuda: 'Años, meses y días' }),
    campo('cui', 'Número CUI de la niña o niño', 'cui'),
    registrado('sexo', 'Sexo'),

    campo('estudiaActualmente', 'Estudia actualmente', 'siNo', {
      subseccion: 'Escolaridad',
    }),
    campo('desercionEscolar', 'Deserción escolar', 'siNo', { subseccion: 'Escolaridad' }),
    campo('ultimoGradoAprobado', 'Último grado aprobado', 'texto', { subseccion: 'Escolaridad' }),
    campo('aniosRepetidos', 'Años repetidos, ¿cuántos?', 'numero', {
      subseccion: 'Escolaridad',
      minimo: 0,
      maximo: 10,
    }),

    ...pueblo(),
    ...migrante(),
    campo('responsableNombre', 'Nombre del/la responsable', 'texto'),
    campo('responsableTelefono', 'No. de teléfono', 'telefono'),
    campo('responsableParentesco', 'Parentesco', 'catalogo', {
      catalogo: 'parentesco',
    }),
    campo('responsableDpi', 'DPI', 'cui', { ayuda: 'Del responsable' }),
  ];
}

function identificacionAdolescente(edadAnios) {
  const menorDeEdad = edadAnios < 18;
  // Orientacion sexual e identidad de genero solo se preguntan a mayores de 20.
  const preguntaOrientacion = edadAnios > 20;

  return [
    registrado('nombres', 'Nombres'),
    registrado('apellidos', 'Apellidos'),
    campo('departamentoNacimiento', 'Departamento de nacimiento', 'departamento', {
      opciones: OPCIONES_DEPARTAMENTO,
    }),
    campo('domicilio', 'Domicilio', 'texto'),
    ...residencia(),
    registrado('fechaNacimiento', 'Fecha de nacimiento'),
    campo('edad', 'Edad', 'calculado', { ayuda: 'En años' }),
    campo('cui', 'Número CUI/DPI', 'cui'),
    registrado('sexo', 'Sexo'),
    ...(preguntaOrientacion
      ? [
          campo('orientacionSexual', 'Orientación sexual', 'seleccion', {
            opciones: ORIENTACION_SEXUAL,
            sensible: true,
          }),
          campo('identidadGenero', 'Identidad de género', 'texto', { sensible: true }),
        ]
      : []),
    campo('religion', 'Religión', 'texto'),
    campo('estudiaActualmente', 'Estudia', 'siNo'),
    campo('ultimoGradoAprobado', 'Último grado aprobado', 'texto'),
    campo('motivoNoEstudia', 'Motivo por el que no estudia', 'texto', {
      mostrarSi: { campo: 'estudiaActualmente', igual: false },
    }),
    campo('trabaja', 'Trabaja', 'siNoEspecifique', {
      especifique: { clave: 'trabajoEspecifique', etiqueta: 'Especifique' },
    }),
    ...pueblo(),
    ...migrante(),
    ...(menorDeEdad
      ? [
          campo('responsableNombre', 'Nombre del referente adulto', 'texto'),
          campo('responsableParentesco', 'Parentesco', 'catalogo', {
            catalogo: 'parentesco',
          }),
          campo('responsableTelefono', 'No. de teléfono del referente', 'telefono'),
        ]
      : []),
    campo('telefono', 'No. de teléfono', 'telefono'),
  ];
}

function identificacionAdulto() {
  return [
    registrado('nombres', 'Nombres'),
    registrado('apellidos', 'Apellidos'),
    // La ficha de adulto no tiene municipio de nacimiento.
    campo('departamentoNacimiento', 'Departamento de nacimiento', 'departamento', {
      opciones: OPCIONES_DEPARTAMENTO,
    }),
    campo('domicilio', 'Domicilio', 'texto'),
    ...residencia(),
    registrado('fechaNacimiento', 'Fecha de nacimiento'),
    campo('edad', 'Edad', 'calculado', { ayuda: 'En años' }),
    campo('cui', 'Número CUI/DPI', 'cui'),
    registrado('sexo', 'Sexo'),
    campo('orientacionSexual', 'Orientación sexual', 'seleccion', {
      opciones: ORIENTACION_SEXUAL,
      sensible: true,
    }),
    campo('identidadGenero', 'Identidad de género', 'texto', { sensible: true }),
    campo('nivelEscolar', 'Escolaridad', 'seleccion', {
      opciones: ESCOLARIDAD_ADULTO,
    }),
    campo('trabaja', 'Trabaja', 'siNoEspecifique', {
      especifique: { clave: 'trabajoEspecifique', etiqueta: 'Especifique' },
    }),
    campo('profesionOficio', 'Profesión u oficio o condición', 'catalogo', {
      catalogo: 'profesion_oficio',
    }),
    ...pueblo(),
    campo('estadoCivil', 'Estado civil', 'seleccion', { opciones: ESTADO_CIVIL }),
    ...migrante(),
    campo('responsableNombre', 'Nombre del/la responsable', 'texto'),
    campo('responsableParentesco', 'Parentesco', 'catalogo', { catalogo: 'parentesco' }),
    campo('telefono', 'No. de teléfono', 'telefono'),
    campo('celular', 'No. de celular', 'telefono'),
    campo('redesSociales', 'Redes sociales', 'texto', { ayuda: 'Cuáles usa, si usa' }),
    campo('correo', 'Correo electrónico', 'correo'),
  ];
}

/**
 * Lo que pide el SIGSA y no pide la ficha.
 *
 * No es una seccion de ningun papel, y por eso se presenta aparte y con su
 * nombre: son datos que se necesitan para el informe al SIGSA.
 */
function datosSigsa(claveFicha) {
  const esAdulto = claveFicha === 'adulto' || claveFicha === 'persona_mayor';
  return [
    campo('discapacidad', 'Discapacidad', 'catalogo', {
      catalogo: 'discapacidad',
      ayuda: 'Tipo según el SIGSA',
    }),
    // En adulto la escolaridad SIGSA se deriva de la ficha; en las demas no
    // se pregunta con esas opciones y se deja aqui, sin exigirla.
    ...(esAdulto
      ? []
      : [campo('escolaridad', 'Escolaridad (SIGSA)', 'catalogo', { catalogo: 'escolaridad' })]),
    campo('expedientePapel', 'Expediente en papel', 'texto', {
      ayuda: 'El número de la ficha física en el estante, si lo tiene',
    }),
  ];
}

// --- Lo minimo que pide el SIGSA ----------------------------------------------

/**
 * Los datos de identificacion sin los que la consulta no se puede informar
 * al SIGSA 3CS: lugar de residencia y los catalogos oficiales (pueblo,
 * comunidad linguistica, escolaridad, discapacidad).
 *
 * Solo estos cuentan en el aviso "faltan N datos". El resto de la ficha se
 * muestra como "sin registrar" sin generar alarma: en papel nunca se lleno
 * todo, y exigirlo convierte el aviso en ruido.
 */
const MINIMOS_SIGSA = new Set([
  'departamentoResidencia',
  'municipioResidencia',
  'pueblo',
  'comunidadLinguistica',
  'nivelEscolar',
  'escolaridad',
  'discapacidad',
]);

const marcarMinimos = (campos) => campos.map((c) => ({ ...c, requerido: MINIMOS_SIGSA.has(c.clave) }));

// --- Resolucion --------------------------------------------------------------

/** Edad en dias cumplidos, para distinguir al neonato. */
function diasDeVida(fechaNacimiento, ahora = new Date()) {
  return Math.floor((new Date(ahora) - new Date(fechaNacimiento)) / MS_POR_DIA);
}

/**
 * La ficha que corresponde a un paciente y su seccion de identificacion,
 * ya resuelta para su edad.
 */
function estructuraIdentificacion(fechaNacimiento, ahora = new Date()) {
  const dias = diasDeVida(fechaNacimiento, ahora);
  const edadMeses = Math.floor(dias / 30.4375);
  const edadAnios = Math.floor(dias / 365.25);

  const etapa = etapaDeVida(edadMeses, dias <= 28 ? dias : null);
  const ficha = FICHAS[etapa?.clave] ?? FICHAS.adulto;

  let campos;
  if (ficha.clave === 'recien_nacido') campos = identificacionNeonato();
  else if (ficha.clave === 'lactante_ninez') campos = identificacionNinez();
  else if (ficha.clave === 'adolescente_joven') campos = identificacionAdolescente(edadAnios);
  else campos = identificacionAdulto();

  return {
    ficha: {
      clave: ficha.clave,
      nombre: ficha.nombre,
      rango: ficha.rango,
      provisional: ficha.provisional,
      notaProvisional: ficha.notaProvisional ?? null,
    },
    seccion: ficha.seccion,
    campos: marcarMinimos(campos),
    sigsa: marcarMinimos(datosSigsa(ficha.clave)),
  };
}

// --- Que falta ---------------------------------------------------------------

function tieneValor(valor) {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  return true;
}

/** Si un campo se muestra, segun los valores que ya tiene el paciente. */
function seMuestra(definicion, paciente) {
  if (!definicion.mostrarSi) return true;
  const { campo: clave, igual } = definicion.mostrarSi;
  return paciente[clave] === igual;
}

/**
 * Lo que le falta a la ficha.
 *
 * Solo cuenta lo que la ficha de su edad pide y que se marca como necesario.
 * No se exige lo que no corresponde preguntar, ni lo que depende de otra
 * respuesta que todavia no se dio: una ficha no puede quedar incompleta para
 * siempre por un campo que no aplica.
 *
 * Los datos sensibles nunca cuentan como faltantes: no se presiona a nadie
 * para preguntarlos.
 */
function faltantes(paciente, estructura) {
  const todos = [...estructura.campos, ...estructura.sigsa];
  return todos
    .filter((c) => c.requerido && !c.sensible && seMuestra(c, paciente))
    .filter((c) => !tieneValor(paciente[c.clave]))
    .map((c) => ({ campo: c.clave, etiqueta: c.nombreCompleto ?? c.etiqueta }));
}

module.exports = {
  MINIMOS_SIGSA,
  FICHAS,
  PUEBLO,
  ESCOLARIDAD_ADULTO,
  ESTADO_CIVIL,
  ORIENTACION_SEXUAL,
  ESCOLARIDAD_A_SIGSA,
  escolaridadSigsa,
  diasDeVida,
  estructuraIdentificacion,
  faltantes,
  seMuestra,
  tieneValor,
};
