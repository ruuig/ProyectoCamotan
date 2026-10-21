const express = require('express');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const esquemas = require('../schemas/atenciones.schema');
const controlador = require('../controllers/atenciones.controller');
const cola = require('../controllers/cola.controller');
const consulta = require('../controllers/consulta.controller');
const referencias = require('../controllers/referencias.controller');
const triaje = require('../controllers/triaje.controller');
const idempotencia = require('../middleware/idempotencia');

const router = express.Router();

router.use(asincrono(autenticar));

const registro = autorizar('admin', 'preconsulta');
const clinicos = autorizar('admin', 'preconsulta', 'medico');
const medicos = autorizar('admin', 'medico');

// --- Cola ------------------------------------------------------------------

router.get('/cola', clinicos, asincrono(cola.cola));

// Lo que la preconsulta va mostrando mientras se escriben los signos.
router.post('/triaje/evaluar', clinicos, validar(esquemas.evaluarTriaje), asincrono(triaje.evaluar));
router.get('/resumen-dia', clinicos, asincrono(cola.resumenDia));
router.get('/siguiente', medicos, asincrono(cola.siguiente));

// --- Registro y preconsulta ------------------------------------------------

// El medico tambien puede abrirla: cuando preconsulta no esta cubierta, el
// sistema no debe impedir que se registre la atencion.
router.post('/', clinicos, validar(esquemas.crearAtencion), asincrono(controlador.crear));

// La atencion se abre al guardar la toma de signos: si no se guarda, no
// queda nada en la cola. Se encola sin conexion como la preconsulta.
router.post(
  '/con-preconsulta',
  registro,
  idempotencia,
  validar(esquemas.atencionConPreconsulta),
  asincrono(controlador.crearConPreconsulta),
);

// Una atencion abierta por error se cancela con su motivo.
router.patch(
  '/:id/cancelar',
  clinicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.cancelar),
  asincrono(controlador.cancelar),
);

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

// Hoja completa de una consulta anterior, solo lectura.
router.get(
  '/:id/hoja',
  clinicos,
  validar(esquemas.parametroId, 'params'),
  asincrono(consulta.hoja),
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

router.delete(
  '/:id/prescripcion/:recetaId',
  medicos,
  validar(esquemas.parametroReceta, 'params'),
  asincrono(consulta.quitarPrescripcion),
);

router.delete(
  '/:id/receta-externa/:recetaId',
  medicos,
  validar(esquemas.parametroReceta, 'params'),
  asincrono(consulta.quitarRecetaExterna),
);

router.post(
  '/:id/receta-externa',
  medicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.recetaExterna),
  asincrono(consulta.crearRecetaExterna),
);

// Boleta de Referencia y Contrarreferencia: la llena el medico; la
// contrarreferencia la registra quien recibe al paciente de regreso.
router.get(
  '/:id/referencia',
  clinicos,
  validar(esquemas.parametroId, 'params'),
  asincrono(referencias.obtener),
);

router.put(
  '/:id/referencia',
  medicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.referencia),
  asincrono(referencias.guardar),
);

router.put(
  '/:id/contrarreferencia',
  clinicos,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.contrarreferencia),
  asincrono(referencias.guardarContrarreferencia),
);

module.exports = router;
