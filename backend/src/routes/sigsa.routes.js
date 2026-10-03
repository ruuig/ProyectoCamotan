const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const controlador = require('../controllers/sigsa.controller');

const router = express.Router();
router.use(asincrono(autenticar));

// El 3CS lleva datos clinicos y sensibles: lo generan el medico y la direccion.
const clinicos = autorizar('admin', 'medico');
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
const consulta = z.object({
  desde: dia,
  hasta: dia,
  medicoId: z.coerce.number().int().positive().optional(),
}).refine((q) => q.desde <= q.hasta, { message: 'El rango está al revés', path: ['hasta'] });

router.get('/medicos', clinicos, asincrono(controlador.medicos));
router.get('/3cs', clinicos, validar(consulta, 'query'), asincrono(controlador.sigsa3cs));
router.get('/3cs/excel', clinicos, validar(consulta, 'query'), asincrono(controlador.sigsa3csExcel));

module.exports = router;
