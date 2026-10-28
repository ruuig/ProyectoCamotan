const { z } = require('zod');

const CONDICIONES = ['embarazo', 'menor_5', 'adulto_mayor', 'discapacidad'];

// Campos que solo ven y editan el medico y el administrador. Se declaran aqui
// para que el control de acceso y la bitacora usen la misma lista.
const CAMPOS_SENSIBLES = [
  'orientacionSexual',
  'identidadGenero',
  'antecedenteViolencia',
  'antecedenteMaltrato',
  'ideasSuicidas',
  'problemasJudiciales',
];

const cui = z
  .string()
  .trim()
  .regex(/^[0-9]{13}$/, 'El CUI debe tener 13 dígitos')
  .optional()
  .nullable();

const fechaNacimiento = z.coerce
  .date({ invalid_type_error: 'Fecha de nacimiento inválida' })
  .refine((fecha) => fecha <= new Date(), 'La fecha de nacimiento no puede ser futura')
  .refine(
    (fecha) => fecha >= new Date('1900-01-01'),
    'La fecha de nacimiento es demasiado antigua',
  );

// Edad declarada por quien no conoce su fecha de nacimiento.
const edadDeclarada = z.object({
  valor: z.coerce.number().int().min(0, 'La edad no puede ser negativa'),
  unidad: z.enum(['dias', 'meses', 'anios'], {
    errorMap: () => ({ message: 'La unidad debe ser días, meses o años' }),
  }),
});

const texto = (max, mensaje) =>
  z.string().trim().max(max, mensaje).optional().nullable();

// --- Registro rapido: lo minimo para poder atender -------------------------
const crear = z
  .object({
    cui,
    expedientePapel: texto(30),
    nombres: z.string().trim().min(1, 'Los nombres son obligatorios').max(120),
    apellidos: z.string().trim().min(1, 'Los apellidos son obligatorios').max(120),
    // O la fecha, o la edad aproximada: una de las dos.
    fechaNacimiento: fechaNacimiento.optional(),
    edadDeclarada: edadDeclarada.optional(),
    sexo: z.enum(['M', 'F'], { errorMap: () => ({ message: 'El sexo debe ser M o F' }) }),
    // La comunidad viene del catalogo; el texto libre se acepta para no
    // romper lo que ya existe, pero el dato vivo es el identificador.
    lugarPobladoId: z.coerce.number().int().positive().optional().nullable(),
    comunidad: texto(120),
    telefono: texto(20),
    idiomaMaterno: z.string().trim().max(40).default('espanol'),
    condiciones: z.array(z.enum(CONDICIONES)).default([]),
    // Responsable: obligatorio en menores de 18, se valida en el controlador
    // porque depende de la edad ya calculada.
    responsableNombre: texto(160),
    responsableParentesco: texto(20),
    responsableTelefono: texto(20),
    responsableDpi: texto(20),
    // La madre o el padre que también es paciente.
    responsableId: z.coerce.number().int().positive().optional().nullable(),
    confirmarDuplicado: z.boolean().default(false),
  })
  .refine(
    (d) => Boolean(d.fechaNacimiento) || Boolean(d.edadDeclarada),
    { message: 'Indique la fecha de nacimiento o la edad aproximada', path: ['fechaNacimiento'] },
  )
  .refine(
    (d) => Boolean(d.lugarPobladoId) || Boolean(d.comunidad),
    { message: 'La comunidad es obligatoria', path: ['lugarPobladoId'] },
  );

// --- Ficha completa: el resto, cuando haya tiempo --------------------------
const fichaCompleta = z.object({
  departamentoNacimiento: texto(80),
  municipioNacimiento: texto(80),
  domicilio: texto(200),
  municipioResidencia: texto(80),
  departamentoResidencia: texto(40),
  celular: texto(20),
  noInscritoRenap: z.boolean().optional().nullable(),
  edadMadre: z.coerce.number().int().min(9).max(65).optional().nullable(),
  nivelEscolar: z
    .enum(['analfabeta', 'primaria', 'basicos', 'diversificado', 'universitaria'])
    .optional()
    .nullable(),
  trabajoEspecifique: texto(120),
  pueblo: texto(10),
  comunidadLinguistica: texto(10),
  migrante: z.boolean().optional().nullable(),
  origenMigracion: texto(120),
  escolaridad: texto(10),
  estudiaActualmente: z.boolean().optional().nullable(),
  desercionEscolar: z.boolean().optional().nullable(),
  ultimoGradoAprobado: texto(60),
  aniosRepetidos: z.coerce.number().int().min(0).max(20).optional().nullable(),
  motivoNoEstudia: texto(200),
  trabaja: z.boolean().optional().nullable(),
  profesionOficio: texto(10),
  estadoCivil: texto(20),
  religion: texto(80),
  correo: texto(120),
  redesSociales: texto(200),
  discapacidad: texto(10),
  responsableNombre: texto(160),
  responsableParentesco: texto(20),
  responsableTelefono: texto(20),
  responsableDpi: texto(20),
  responsableId: z.coerce.number().int().positive().optional().nullable(),
  // Sensibles: el controlador rechaza si el rol no corresponde.
  orientacionSexual: texto(10),
  identidadGenero: texto(40),
  antecedenteViolencia: texto(2000),
  antecedenteMaltrato: texto(2000),
  ideasSuicidas: texto(2000),
  problemasJudiciales: texto(2000),
});

const actualizar = z
  .object({
    cui,
    expedientePapel: texto(30),
    nombres: z.string().trim().min(1).max(120).optional(),
    apellidos: z.string().trim().min(1).max(120).optional(),
    fechaNacimiento: fechaNacimiento.optional(),
    edadDeclarada: edadDeclarada.optional(),
    sexo: z.enum(['M', 'F']).optional(),
    lugarPobladoId: z.coerce.number().int().positive().optional().nullable(),
    comunidad: texto(120),
    telefono: texto(20),
    idiomaMaterno: z.string().trim().max(40).optional(),
    condiciones: z.array(z.enum(CONDICIONES)).optional(),
  })
  .merge(fichaCompleta)
  .refine((datos) => Object.keys(datos).length > 0, 'No se envió ningún campo por actualizar');

const listar = z.object({
  buscar: z.string().trim().max(120).optional(),
  comunidad: z.string().trim().max(120).optional(),
  lugarPobladoId: z.coerce.number().int().positive().optional(),
  sexo: z.enum(['M', 'F']).optional(),
  edadMinima: z.coerce.number().int().min(0).max(120).optional(),
  edadMaxima: z.coerce.number().int().min(0).max(120).optional(),
  etapa: z
    .enum(['lactante_ninez', 'adolescente_joven', 'adulto', 'persona_mayor'])
    .optional(),
  embarazoActivo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  fichaIncompleta: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  conAlertas: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});

// Ficha de papel que le toca a quien se registra, y quiénes ya tienen una.
const fichaPapel = z.object({
  apellidos: z.string().trim().max(120).optional(),
  ficha: z.string().trim().max(30).optional(),
  excluir: z.coerce.number().int().positive().optional(),
});

// Lo que se está escribiendo en nombres o apellidos, para sugerir.
const sugerir = z.object({
  campo: z.enum(['nombres', 'apellidos']),
  texto: z.string().trim().min(1).max(120),
});

const parametroId = z.object({
  id: z.coerce.number().int().positive('Identificador de paciente inválido'),
});

const parametroSeccion = parametroId.extend({
  seccion: z.string().regex(/^[a-z_]{3,40}$/, 'Sección inválida'),
});

const parametroArchivo = parametroId.extend({
  archivoId: z.coerce.number().int().positive('Archivo inválido'),
});

// Los campos de cada seccion los valida el controlador con el esquema propio
// de la seccion (fichaSecciones.service): aqui solo la forma del cuerpo.
const guardarSeccion = z.object({
  datos: z.record(z.unknown()),
}).strict();

// --- Embarazo ---------------------------------------------------------------
const abrirEmbarazo = z
  .object({
    fechaUltimaRegla: z.coerce.date().optional().nullable(),
    semanasAlRegistrar: z.coerce.number().int().min(0).max(45).optional().nullable(),
  })
  .refine(
    (d) => d.fechaUltimaRegla || d.semanasAlRegistrar != null,
    { message: 'Indique la fecha de última regla o las semanas de gestación' },
  );

const cerrarEmbarazo = z.object({
  motivo: z.string().trim().min(3, 'Indique el motivo del cierre').max(200),
});

module.exports = {
  CONDICIONES,
  CAMPOS_SENSIBLES,
  crear,
  actualizar,
  fichaCompleta,
  listar,
  fichaPapel,
  sugerir,
  parametroId,
  parametroSeccion,
  parametroArchivo,
  guardarSeccion,
  abrirEmbarazo,
  cerrarEmbarazo,
};
