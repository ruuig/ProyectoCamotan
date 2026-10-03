const express = require('express');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const esquemas = require('../schemas/inventario.schema');
const controlador = require('../controllers/insumos.controller');

const router = express.Router();

router.use(asincrono(autenticar));

// El medico consulta el catalogo para prescribir; farmacia lo administra.
const consultar = autorizar('admin', 'medico', 'farmacia', 'bodega');
const administrar = autorizar('admin', 'bodega');

router.get('/', consultar, validar(esquemas.listarInsumos, 'query'), asincrono(controlador.listar));

router.post('/', administrar, validar(esquemas.crearInsumo), asincrono(controlador.crear));

router.get(
  '/:id/cobertura',
  consultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(controlador.cobertura),
);

router.post(
  '/:id/lotes',
  administrar,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.recibirLote),
  asincrono(controlador.recibirLote),
);

module.exports = router;
