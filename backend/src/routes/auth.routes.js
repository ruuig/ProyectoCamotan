const express = require('express');
const validar = require('../middleware/validar');
const autenticar = require('../middleware/auth');
const asincrono = require('../utils/asincrono');
const esquemas = require('../schemas/auth.schema');
const controlador = require('../controllers/auth.controller');

const router = express.Router();

router.post('/login', validar(esquemas.login), asincrono(controlador.login));
router.post('/refresh', asincrono(autenticar), asincrono(controlador.refresh));
router.post('/logout', asincrono(autenticar), asincrono(controlador.logout));

module.exports = router;
