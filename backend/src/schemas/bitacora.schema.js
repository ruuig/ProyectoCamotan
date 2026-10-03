const { z } = require('zod');

const consulta = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  usuarioId: z.coerce.number().int().positive().optional(),
  entidad: z.string().trim().min(1).max(60).optional(),
  accion: z.string().trim().min(1).max(40).optional(),
});

module.exports = { consulta };
