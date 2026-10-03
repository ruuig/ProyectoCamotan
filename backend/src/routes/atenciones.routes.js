const express = require('express');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const esquemas = require('../schemas/atenciones.schema');
const controlador = require('../controllers/atenciones.controller');
const cola = require('../controllers/cola.controller');
const consulta = require('../controllers/consulta.controller');
const idempotencia = require('../middleware/idempotencia');

const router = express.Router();

router.use(asincrono(autenticar));

const registro = autorizar('admin', 'preconsulta');
const clinicos = autorizar('admin', 'preconsulta', 'medico');
const medicos = autorizar('admin', 'medico');

// --- Cola ------------------------------------------------------------------

router.get('/cola', clinicos, asincrono(cola.cola));
router.get('/resumen-dia', clinicos, asincrono(cola.resumenDia));
router.get('/siguiente', medicos, asincrono(cola.siguiente));

// --- Registro y preconsulta ------------------------------------------------

// El medico tambien puede abrirla: cuando preconsulta no esta cubierta, el
// sistema no debe impedir que se registre la atencion.
router.post('/', clinicos, validar(esquemas.crearAtencion), asincrono(controlador.crear));

router.post(
  '/:id/preconsulta',
  registro,
  // La preconsulta se encola sin conexion: el reenvio no debe duplicarla.
  idempotencia,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.preconsulta),
  asincrono(controlador.registrarPreconsulta),
);

// --- Consulta medica -------------------------------------------------------

router.get(
  '/:id',
  clinicos,
  validar(esquemas.parametroId, 'params'),
  asincrono(consulta.obtener),
);

router.patch(
  '/:id/estado',
  clinicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.cambiarEstado),
  asincrono(cola.cambiarEstado),
);

router.patch(
  '/:id/consulta',
  medicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.consulta),
  asincrono(consulta.registrarConsulta),
);

// Completar el CIE-10 de una consulta ya cerrada.
router.patch(
  '/:id/codificacion',
  medicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.codificacion),
  asincrono(consulta.codificar),
);

router.get(
  '/:id/sugerencia-tipo',
  autorizar('admin', 'medico'),
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.sugerenciaTipo, 'query'),
  asincrono(consulta.sugerenciaTipo),
);

// Corregir una consulta cerrada no sobrescribe: deja constancia de que se
// corrigio, quien y por que.
router.post(
  '/:id/correcciones',
  medicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.correccion),
  asincrono(consulta.corregirConsulta),
);

// Preconsulta corrige lo suyo mientras nadie lo haya leido; despues, el medico.
router.patch(
  '/:id/preconsulta',
  clinicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.correccionSignos),
  asincrono(consulta.corregirSignosVitales),
);

router.get(
  '/:id/correcciones',
  clinicos,
  validar(esquemas.parametroId, 'params'),
  asincrono(consulta.correccionesDe),
);

router.post(
  '/:id/prescripcion',
  medicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.prescripcion),
  asincrono(consulta.crearPrescripcion),
);

module.exports = router;
