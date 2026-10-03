const { z } = require('zod');
const { CAUSAS } = require('../services/movimientos.service');

const { CLAVES_CATEGORIA: CATEGORIAS } = require('../services/bodega.service');
const ORIGENES = ['despacho', 'donacion', 'traslado', 'prestamo'];
const ESTADOS_LOTE = ['disponible', 'cuarentena', 'retirado'];
const CAUSAS_BAJA = ['producto_vencido', 'producto_danado'];

const periodo = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'El período debe tener el formato AAAA-MM');

const listarInsumos = z.object({
  buscar: z.string().trim().max(120).optional(),
  categoria: z.enum(CATEGORIAS).optional(),
  // Para revisar solo lo que necesita decision.
  soloBajoMinimo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const crearInsumo = z.object({
  codigoMspas: z.string().trim().max(40).optional().nullable(),
  codigoInterno: z.string().trim().max(30).optional().nullable(),
  // El MSPAS identifica por Denominación Común Internacional.
  nombreGenerico: z.string().trim().min(1, 'El nombre genérico es obligatorio').max(160),
  nombreComercial: z.string().trim().max(160).optional().nullable(),
  formaFarmaceutica: z.string().trim().max(40).optional().nullable(),
  concentracion: z.string().trim().max(40).optional().nullable(),
  componente: z.string().trim().max(160).optional().nullable(),
  categoria: z.enum(CATEGORIAS, { errorMap: () => ({ message: 'Categoría no válida' }) }),
  presentacion: z.string().trim().min(1, 'La presentación es obligatoria').max(80),
  unidadMedida: z.string().trim().min(1, 'La unidad de medida es obligatoria').max(40),
  unidadEntrega: z.string().trim().max(30).optional().nullable(),
  perecedero: z.coerce.boolean().default(true),
  cadenaFrio: z.coerce.boolean().default(false),
  stockMinimo: z.coerce.number().int().min(0).default(0),
  codigoBarras: z.string().trim().max(40).optional().nullable(),
  costoReferencia: z.coerce.number().min(0).optional().nullable(),
  unidadesPorEmpaque: z.coerce.number().int().min(1).max(10000).default(1),
});

/**
 * Recepción de un lote con la verificación que exige el procedimiento AL-MFA.
 * La cantidad que se ingresa es la realmente recibida; si no coincide con el
 * documento, la diferencia queda anotada.
 */
const recibirLote = z.object({
  numeroLote: z.string().trim().min(1, 'El número de lote es obligatorio').max(60),
  fechaVence: z.coerce
    .date({ invalid_type_error: 'Fecha de vencimiento inválida' })
    .refine((f) => f > new Date(), 'No se puede recibir un lote ya vencido'),
  fechaFabricacion: z.coerce.date({ invalid_type_error: 'Fecha de fabricación inválida' }).optional().nullable(),
  cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero'),
  cantidadDocumento: z.coerce.number().int().min(0).optional().nullable(),
  origen: z.enum(ORIGENES).default('despacho'),
  actaDonacion: z.string().trim().max(60).optional().nullable(),
  fabricante: z.string().trim().max(120).optional().nullable(),
  registroSanitario: z.string().trim().max(60).optional().nullable(),
  costoUnitario: z.coerce.number().min(0).optional().nullable(),
  ubicacion: z.string().trim().max(60).optional().nullable(),
  verificacion: z
    .object({
      etiquetado: z.boolean().optional(),
      empaque: z.boolean().optional(),
      aspecto: z.boolean().optional(),
    })
    .default({}),
  observacionRecepcion: z.string().trim().max(400).optional().nullable(),
}).refine(
  (d) => d.origen !== 'donacion' || (d.actaDonacion ?? '').trim().length > 0,
  { message: 'Una donación necesita el número de acta', path: ['actaDonacion'] },
);

const dispensar = z.object({
  prescripcionId: z.coerce.number().int().positive('Debe indicar la prescripción'),
  cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero'),
  // Si se omite, el sistema reparte por PEPE. Si se indica y no coincide con
  // el lote de vencimiento más próximo, se exige motivo.
  loteId: z.coerce.number().int().positive().optional(),
  motivo: z.string().trim().min(5, 'El motivo es demasiado corto').max(300).optional(),
});

// Insumo usado en el propio establecimiento, sin receta de por medio: gasa de
// una curación, jeringa, vacuna de jornada.
const usoInterno = z.object({
  insumoId: z.coerce.number().int().positive('Debe indicar el insumo'),
  cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero'),
  motivo: z.string().trim().min(5, 'Debe explicar en qué se usó').max(300),
  servicio: z.string().trim().max(60).optional().nullable(),
  loteId: z.coerce.number().int().positive().optional(),
});

// Traslado a otro servicio. Conserva el lote para no cortar la trazabilidad.

/**
 * Reajuste con causa del catálogo oficial. La cantidad lleva su signo y debe
 * concordar con la causa: un sobrante no puede restar.
 */
const reajustar = z.object({
  loteId: z.coerce.number().int().positive('Debe indicar el lote'),
  cantidad: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, 'Un reajuste de cero no cambia nada'),
  causa: z.enum(CAUSAS, { errorMap: () => ({ message: 'Esa causa no está en el catálogo' }) }),
  motivo: z.string().trim().max(300).optional().nullable(),
});

const cambiarEstadoLote = z.object({
  estado: z.enum(ESTADOS_LOTE, {
    errorMap: () => ({ message: 'Estado no válido. Agotado y vencido los asigna el sistema' }),
  }),
  motivo: z.string().trim().min(5, 'Debe explicar el motivo').max(300),
});

// --- Inventario físico -----------------------------------------------------

const abrirInventario = z.object({
  periodo,
  observaciones: z.string().trim().max(400).optional().nullable(),
});

// El conteo es ciego: solo viaja lo contado, nunca el saldo esperado.
const registrarConteo = z.object({
  conteos: z
    .array(
      z.object({
        loteId: z.coerce.number().int().positive(),
        cantidadContada: z.coerce.number().int().min(0, 'El conteo no puede ser negativo'),
      }),
    )
    .min(1, 'Debe registrar al menos un conteo'),
});

const cerrarInventario = z.object({
  observaciones: z.string().trim().max(400).optional().nullable(),
  // Las diferencias grandes exigen la autorización del director.
  aplicarReajustes: z.coerce.boolean().default(true),
});

// --- BRES ------------------------------------------------------------------

const generarBres = z.object({
  periodo,
  observaciones: z.string().trim().max(400).optional().nullable(),
});

// --- Oficio de baja --------------------------------------------------------

const solicitarBaja = z.object({
  loteId: z.coerce.number().int().positive('Debe indicar el lote'),
  cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero'),
  causa: z.enum(CAUSAS_BAJA, {
    errorMap: () => ({ message: 'Una baja solo procede por producto vencido o dañado' }),
  }),
  detalle: z.string().trim().min(5, 'Debe describir el motivo').max(400),
  numeroTarjeta: z.string().trim().max(30).optional().nullable(),
  precioUnitario: z.coerce.number().min(0).optional().nullable(),
});

// --- Retiro sanitario ------------------------------------------------------

const registrarRetiro = z.object({
  referencia: z.string().trim().min(2, 'Debe indicar la referencia de la alerta').max(80),
  motivo: z.string().trim().min(5, 'Debe describir el motivo del retiro').max(500),
  emitidoEn: z.coerce.date({ invalid_type_error: 'Fecha inválida' }),
  loteIds: z.array(z.coerce.number().int().positive()).min(1, 'Debe indicar al menos un lote'),
});

const actualizarLocalizacion = z.object({
  localizado: z.coerce.boolean(),
  notas: z.string().trim().max(300).optional().nullable(),
});

// --- Configuración logística ----------------------------------------------

const configurarLogistica = z.object({
  mesesSolicitudRecepcion: z.coerce.number().positive('Debe ser mayor que cero').max(12),
  mesesFrecuenciaPedido: z.coerce.number().positive('Debe ser mayor que cero').max(12),
  diaCorteBres: z.coerce.number().int().min(1).max(28),
  diaInventarioFisico: z.coerce.number().int().min(1).max(28),
  diasMaximoCuarentena: z.coerce.number().int().min(1).max(90),
  // Se marca como confirmado solo cuando el Área de Salud lo entrega.
  provisional: z.coerce.boolean().default(true),
  // Parámetros del BRES y del semáforo del centro (MD/Bodega.md).
  nivelMinimoMeses: z.coerce.number().positive().max(24).optional(),
  nivelMaximoMeses: z.coerce.number().positive().max(24).optional(),
  mesesPromedio: z.coerce.number().int().min(1).max(24).optional(),
  formulaPedido: z.enum(['centro', 'mspas']).optional(),
  semaforoRojoMeses: z.coerce.number().int().min(1).max(60).optional(),
  semaforoAmarilloMeses: z.coerce.number().int().min(2).max(72).optional(),
  diaCorteReportes: z.coerce.number().int().min(1).max(28).optional(),
  encargadoBodega: z.string().trim().max(160).optional().nullable(),
  coordinadorMunicipal: z.string().trim().max(160).optional().nullable(),
  cargoEncargadoBodega: z.string().trim().min(2).max(160).optional(),
  cargoCoordinador: z.string().trim().min(2).max(160).optional(),
})
  .refine((d) => !d.nivelMinimoMeses || !d.nivelMaximoMeses || d.nivelMaximoMeses >= d.nivelMinimoMeses,
    { message: 'El nivel máximo no puede ser menor que el mínimo', path: ['nivelMaximoMeses'] })
  .refine((d) => !d.semaforoRojoMeses || !d.semaforoAmarilloMeses || d.semaforoAmarilloMeses > d.semaforoRojoMeses,
    { message: 'El rango amarillo debe terminar después del rojo', path: ['semaforoAmarilloMeses'] });

const parametroId = z.object({
  id: z.coerce.number().int().positive('Identificador inválido'),
});

const parametroPeriodo = z.object({ periodo });

module.exports = {
  CATEGORIAS,
  ORIGENES,
  ESTADOS_LOTE,
  CAUSAS_BAJA,
  listarInsumos,
  crearInsumo,
  recibirLote,
  dispensar,
  usoInterno,
  reajustar,
  cambiarEstadoLote,
  abrirInventario,
  registrarConteo,
  cerrarInventario,
  generarBres,
  solicitarBaja,
  registrarRetiro,
  actualizarLocalizacion,
  configurarLogistica,
  parametroId,
  parametroPeriodo,
};
