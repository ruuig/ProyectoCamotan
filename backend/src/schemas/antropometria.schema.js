const { z } = require('zod');

const registrar = z.object({
  // Confirmacion explicita de una medicion que el sistema marco como
  // improbable. Sin esto no se guarda, pero tampoco se bloquea a ciegas.
  confirmarImprobable: z.boolean().default(false),
  peso: z.coerce.number().min(0.5, 'Peso fuera de lo posible').max(400, 'Peso fuera de lo posible'),
  talla: z.coerce.number().min(20, 'Talla fuera de lo posible').max(250, 'Talla fuera de lo posible'),
  perimetroCefalico: z.coerce.number().min(20).max(70).optional().nullable(),
  // MUAC en milimetros, que es como viene la cinta del establecimiento.
  perimetroBraquial: z.coerce
    .number()
    .min(50, 'Perimetro braquial fuera de lo posible')
    .max(400, 'Perimetro braquial fuera de lo posible')
    .optional()
    .nullable(),
  // Null cuando la medicion se toma en jornada extramural.
  atencionId: z.coerce.number().int().positive().optional().nullable(),
  fecha: z.coerce.date().max(new Date(), 'La fecha no puede ser futura').optional(),
});

const curva = z.object({
  indicador: z
    .enum(['peso_edad', 'talla_edad', 'peso_talla', 'peso_longitud', 'imc_edad'])
    .default('peso_edad'),
});

module.exports = { registrar, curva };
