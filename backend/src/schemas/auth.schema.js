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

module.exports = { login };
