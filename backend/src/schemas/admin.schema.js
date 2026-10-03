const { z } = require('zod');

// La autorizacion del director viaja dentro del cuerpo de la operacion.
// El DPI se trata como nombre de usuario, no como secreto.
const autorizacion = z.object({
  dpi: z.string().trim().regex(/^[0-9]{13}$/, 'DPI invalido'),
  password: z.string().min(1, 'La contrasena es obligatoria').max(200),
  totp: z.string().trim().regex(/^[0-9]{6}$/, 'El código debe tener 6 digitos').optional(),
});

const crearSignoPeligro = z.object({
  codigo: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,30}$/, 'El código solo admite letras, numeros y guion bajo'),
  descripcion: z.string().trim().min(3, 'La descripcion es obligatoria').max(200),
  grupoEtario: z.enum(['todos', 'menor_5', 'embarazada', 'adulto_mayor']),
  gravedadSugerida: z.enum(['urgente', 'moderado']),
  orden: z.coerce.number().int().min(0).default(0),
  autorizacion,
});

const actualizarSignoPeligro = z
  .object({
    descripcion: z.string().trim().min(3).max(200).optional(),
    grupoEtario: z.enum(['todos', 'menor_5', 'embarazada', 'adulto_mayor']).optional(),
    gravedadSugerida: z.enum(['urgente', 'moderado']).optional(),
    orden: z.coerce.number().int().min(0).optional(),
    activo: z.boolean().optional(),
    autorizacion,
  })
  .refine(
    (d) => Object.keys(d).some((k) => k !== 'autorizacion'),
    'No se envio ningun campo por actualizar',
  );

const crearUsuario = z.object({
  usuario: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'El usuario solo admite letras, numeros, punto, guion y guion bajo'),
  password: z.string().min(10, 'La contrasena debe tener al menos 10 caracteres').max(200),
  nombre: z.string().trim().min(3, 'El nombre es obligatorio').max(120),
  dpi: z.string().trim().regex(/^[0-9]{13}$/, 'DPI invalido').optional().nullable(),
  rol: z.enum(['admin', 'preconsulta', 'medico', 'farmacia', 'bodega']),
  esDirector: z.boolean().default(false),
});

// Desactivar un usuario es operacion protegida, igual que los signos.
const cambiarEstadoUsuario = z.object({
  activo: z.boolean(),
  autorizacion,
});

const actualizarEstablecimiento = z.object({
  codigo: z.string().trim().min(1).max(40).optional(),
  nombre: z.string().trim().min(1).max(160).optional(),
  municipio: z.string().trim().min(1).max(120).optional(),
  departamento: z.string().trim().min(1).max(120).optional(),
  tipo: z.enum(['centro_salud_a', 'centro_salud_b', 'puesto_salud']).optional(),
  autorizacion,
});

const confirmarTotp = z.object({
  codigo: z.string().trim().regex(/^[0-9]{6}$/, 'El código debe tener 6 digitos'),
  // El secreto vuelve desde el cliente: no se guarda hasta confirmarse, para
  // que un alta abandonada no deje al usuario con un factor que no tiene.
  secreto: z.string().trim().min(16).max(64),
});

const parametroId = z.object({ id: z.coerce.number().int().positive() });

module.exports = {
  autorizacion,
  crearSignoPeligro,
  actualizarSignoPeligro,
  crearUsuario,
  cambiarEstadoUsuario,
  actualizarEstablecimiento,
  confirmarTotp,
  parametroId,
};
