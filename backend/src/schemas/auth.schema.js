const { z } = require('zod');

const login = z.object({
  usuario: z
    .string({ required_error: 'El usuario es obligatorio' })
    .trim()
    .min(1, 'El usuario es obligatorio')
    .max(60, 'El usuario excede el largo permitido'),
  password: z
    .string({ required_error: 'La contrasena es obligatoria' })
    .min(1, 'La contrasena es obligatoria')
    .max(200, 'La contrasena excede el largo permitido'),
  // Segundo factor, solo exigido a administradores que lo tengan activado.
  codigoTotp: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'El código debe tener 6 digitos')
    .optional(),
});

// Cada usuario cambia la suya: la actual y la nueva, con el mismo mínimo que pone el administrador.
const cambiarPassword = z.object({
  actual: z.string({ required_error: 'Escriba su contraseña actual' }).min(1, 'Escriba su contraseña actual').max(200),
  nueva: z.string({ required_error: 'Escriba la contraseña nueva' }).min(10, 'La contraseña nueva debe tener al menos 10 caracteres').max(200),
});

module.exports = { login, cambiarPassword };
