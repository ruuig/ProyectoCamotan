const express = require('express');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const esquemas = require('../schemas/pacientes.schema');
const esquemasAntropometria = require('../schemas/antropometria.schema');
const controlador = require('../controllers/pacientes.controller');
const antropometria = require('../controllers/antropometria.controller');
const fichaPaciente = require('../controllers/fichaPaciente.controller');

const router = express.Router();

router.use(asincrono(autenticar));

// Farmacia no tiene acceso al expediente de pacientes.
const puedeConsultar = autorizar('admin', 'preconsulta', 'medico');
const puedeEditar = autorizar('admin', 'preconsulta');
// El medico completa la ficha y es el unico, junto al administrador, que
// registra los datos sensibles.
const puedeEditarFicha = autorizar('admin', 'preconsulta', 'medico');

router.get('/', puedeConsultar, validar(esquemas.listar, 'query'), asincrono(controlador.listar));

router.post(
  '/revisar-duplicados',
  puedeEditar,
  validar(esquemas.actualizar),
  asincrono(controlador.revisarDuplicados),
);

router.post('/', puedeEditar, validar(esquemas.crear), asincrono(controlador.crear));

router.get(
  '/:id',
  puedeConsultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(controlador.obtener),
);

router.patch(
  '/:id',
  puedeEditarFicha,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.actualizar),
  asincrono(controlador.actualizar),
);

router.get(
  '/:id/historial',
  puedeConsultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(controlador.historial),
);

router.get(
  '/:id/alertas',
  puedeConsultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(require('../controllers/consulta.controller').alertasPaciente),
);

// --- Antropometria ---------------------------------------------------------

router.get(
  '/:id/antropometria',
  puedeConsultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(antropometria.listar),
);

router.post(
  '/:id/antropometria',
  puedeEditar,
  validar(esquemas.parametroId, 'params'),
  validar(esquemasAntropometria.registrar),
  asincrono(antropometria.registrar),
);

router.get(
  '/:id/curva',
  puedeConsultar,
  validar(esquemas.parametroId, 'params'),
  validar(esquemasAntropometria.curva, 'query'),
  asincrono(antropometria.curva),
);

// --- Embarazo como episodio -------------------------------------------------

const embarazo = require('../controllers/embarazo.controller');

router.get(
  '/:id/embarazos',
  puedeConsultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(embarazo.listar),
);

router.post(
  '/:id/embarazos',
  puedeEditar,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.abrirEmbarazo),
  asincrono(embarazo.abrir),
);

router.patch(
  '/:id/embarazos/cerrar',
  puedeEditar,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.cerrarEmbarazo),
  asincrono(embarazo.cerrar),
);

// --- Ficha completa del paciente, por secciones --------------------------------

router.get(
  '/:id/ficha',
  puedeEditarFicha,
  validar(esquemas.parametroId, 'params'),
  asincrono(fichaPaciente.obtener),
);

router.put(
  '/:id/ficha/:seccion',
  puedeEditarFicha,
  validar(esquemas.parametroSeccion, 'params'),
  validar(esquemas.guardarSeccion),
  asincrono(fichaPaciente.guardarSeccion),
);

router.get(
  '/:id/ficha/:seccion/historial',
  puedeEditarFicha,
  validar(esquemas.parametroSeccion, 'params'),
  asincrono(fichaPaciente.historial),
);

// El familiograma llega como el archivo mismo, no como JSON.
router.post(
  '/:id/archivos/familiograma',
  puedeEditarFicha,
  validar(esquemas.parametroId, 'params'),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: '8mb' }),
  asincrono(fichaPaciente.subirArchivo),
);

router.get(
  '/:id/archivos/:archivoId',
  puedeConsultar,
  validar(esquemas.parametroArchivo, 'params'),
  asincrono(fichaPaciente.descargarArchivo),
);

module.exports = router;
