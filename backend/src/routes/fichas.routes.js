const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const controlador = require('../controllers/fichas.controller');

const router = express.Router();

router.use(asincrono(autenticar));

const clinicos = autorizar('admin', 'preconsulta', 'medico');
const parametroId = z.object({ id: z.coerce.number().int().positive() });

router.get('/', clinicos, asincrono(controlador.listar));

router.get(
  '/atencion/:id',
  clinicos,
  validar(parametroId, 'params'),
  asincrono(controlador.deAtencion),
);

router.get(
  '/atencion/:id/impresa',
  clinicos,
  validar(parametroId, 'params'),
  asincrono(controlador.impresa),
);

module.exports = router;
