const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const idempotencia = require('../middleware/idempotencia');
const farmacia = require('../controllers/farmacia.controller');

const router = express.Router();
router.use(asincrono(autenticar));

// Farmacia lleva su existencia; bodega la consulta para saber que entregarle.
const deFarmacia = autorizar('admin', 'farmacia');
const consultar = autorizar('admin', 'farmacia', 'bodega');

router.get('/existencias', consultar, asincrono(farmacia.existencias));
router.get(
  '/dia',
  consultar,
  validar(z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD').optional() }), 'query'),
  asincrono(farmacia.dia),
);
router.post(
  '/dia/cierre',
  deFarmacia,
  idempotencia,
  validar(z.object({
    conteos: z.array(z.object({
      insumoId: z.coerce.number().int().positive(),
      contado: z.coerce.number().int().min(0, 'Lo contado no puede ser negativo'),
      motivo: z.string().trim().min(3, 'Explique la diferencia').max(300).optional().nullable(),
    })).min(1, 'Cuente al menos un medicamento').max(500),
    observacion: z.string().trim().max(500).optional().nullable(),
  })),
  asincrono(farmacia.cerrarDia),
);
router.post(
  '/devoluciones',
  deFarmacia,
  idempotencia,
  validar(z.object({
    renglones: z.array(z.object({
      loteId: z.coerce.number().int().positive(),
      cantidad: z.coerce.number().int().positive(),
    })).min(1).max(100),
    motivo: z.string().trim().min(3, 'Indique el motivo de la devolución').max(300),
  })),
  asincrono(farmacia.devolver),
);

router.post(
  '/poner-lote',
  deFarmacia,
  idempotencia,
  validar(z.object({
    loteId: z.coerce.number().int().positive(),
    numeroLote: z.string().trim().min(2, 'Escriba el número de lote').max(40),
    fechaVence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de vencimiento: día, mes y año'),
    cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero'),
  })),
  asincrono(farmacia.ponerLote),
);

module.exports = router;
