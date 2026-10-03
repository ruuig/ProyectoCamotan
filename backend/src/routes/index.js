const express = require('express');
const authRutas = require('./auth.routes');
const adminRutas = require('./admin.routes');
const pacientesRutas = require('./pacientes.routes');
const atencionesRutas = require('./atenciones.routes');
const insumosRutas = require('./insumos.routes');
const inventarioRutas = require('./inventario.routes');
const indicadoresRutas = require('./indicadores.routes');
const catalogosRutas = require('./catalogos.routes');
const impresionRutas = require('./impresion.routes');
const fichasRutas = require('./fichas.routes');

const router = express.Router();

// Endpoint de verificacion, sin autenticacion.
router.get('/salud', (req, res) => {
  res.json({ estado: 'ok' });
});

router.use('/auth', authRutas);
router.use('/admin', adminRutas);
router.use('/pacientes', pacientesRutas);
router.use('/atenciones', atencionesRutas);
router.use('/insumos', insumosRutas);
// lotes, dispensaciones e inventario cuelgan de la raiz de /api/v1
router.use('/', inventarioRutas);
router.use('/indicadores', indicadoresRutas);
router.use('/catalogos', catalogosRutas);
router.use('/impresiones', impresionRutas);
router.use('/fichas', fichasRutas);
router.use('/bodega', require('./bodega.routes'));
router.use('/sigsa', require('./sigsa.routes'));

// El consolidado SIGSA y su exportacion se agregan en la Fase 7.

module.exports = router;
