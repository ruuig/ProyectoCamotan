const express = require('express');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const { exigirAutorizacionDirector } = require('../services/autorizacionDirector.service');
const esquemasBitacora = require('../schemas/bitacora.schema');
const esquemas = require('../schemas/admin.schema');
const bitacoraControlador = require('../controllers/bitacora.controller');
const signosControlador = require('../controllers/signosPeligro.controller');
const admin = require('../controllers/admin.controller');
const respaldos = require('../controllers/respaldos.controller');

const router = express.Router();

router.use(asincrono(autenticar));

const soloAdmin = autorizar('admin');

// --- Signos de peligro -----------------------------------------------------

// Leer el catalogo activo lo necesita preconsulta para armar su formulario.
router.get(
  '/signos-peligro',
  autorizar('admin', 'preconsulta', 'medico'),
  asincrono(signosControlador.listar),
);

// El catalogo completo, con inactivos, es para administrarlo.
router.get('/signos-peligro/todos', soloAdmin, asincrono(admin.listarSignosPeligro));

// Crear y modificar exigen reautenticacion del director, aunque ya haya sesion.
router.post(
  '/signos-peligro',
  soloAdmin,
  validar(esquemas.crearSignoPeligro),
  asincrono(exigirAutorizacionDirector('crear signo de peligro')),
  asincrono(admin.crearSignoPeligro),
);

router.patch(
  '/signos-peligro/:id',
  soloAdmin,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.actualizarSignoPeligro),
  asincrono(exigirAutorizacionDirector('modificar signo de peligro')),
  asincrono(admin.actualizarSignoPeligro),
);

// --- Usuarios --------------------------------------------------------------

router.get('/usuarios', soloAdmin, asincrono(admin.listarUsuarios));

router.post('/usuarios', soloAdmin, validar(esquemas.crearUsuario), asincrono(admin.crearUsuario));

// Desactivar un usuario tambien es operacion protegida.
router.patch(
  '/usuarios/:id/estado',
  soloAdmin,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.cambiarEstadoUsuario),
  asincrono(exigirAutorizacionDirector('cambiar estado de usuario')),
  asincrono(admin.cambiarEstadoUsuario),
);

// Nombre y cargo salen en las hojas impresas; no cambian el acceso.
router.patch(
  '/usuarios/:id',
  soloAdmin,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.actualizarUsuario),
  asincrono(admin.actualizarUsuario),
);

// Rol, director y contraseña sí cambian el acceso: piden al director.
router.patch(
  '/usuarios/:id/acceso',
  soloAdmin,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.cambiarAccesoUsuario),
  asincrono(exigirAutorizacionDirector('cambiar acceso de usuario')),
  asincrono(admin.cambiarAccesoUsuario),
);

// --- Establecimiento -------------------------------------------------------

// Leerlo lo puede cualquier rol clinico: el nombre, area y distrito del
// establecimiento van en el encabezado de toda ficha impresa. Modificarlo
// sigue siendo solo del administrador, con autorizacion del director.
router.get(
  '/establecimiento',
  autorizar('admin', 'preconsulta', 'medico', 'farmacia', 'bodega'),
  asincrono(admin.obtenerEstablecimiento),
);

router.patch(
  '/establecimiento',
  soloAdmin,
  validar(esquemas.actualizarEstablecimiento),
  asincrono(exigirAutorizacionDirector('modificar establecimiento')),
  asincrono(admin.actualizarEstablecimiento),
);

// --- Segundo factor --------------------------------------------------------

router.post('/totp/iniciar', soloAdmin, asincrono(admin.iniciarTotp));

router.post(
  '/totp/confirmar',
  soloAdmin,
  validar(esquemas.confirmarTotp),
  asincrono(admin.confirmarTotp),
);

// --- Respaldos de la base de datos -------------------------------------------

router.get('/respaldos', soloAdmin, asincrono(respaldos.listar));

router.put(
  '/respaldos/configuracion',
  soloAdmin,
  validar(esquemas.configuracionRespaldo),
  asincrono(respaldos.guardarConfiguracion),
);

// Hacerlo deja el archivo en el servidor; no saca datos del sistema.
router.post('/respaldos', soloAdmin, asincrono(respaldos.crearRespaldo));

// Descargarlo pide al director: el archivo lleva toda la informacion de los pacientes.
router.post(
  '/respaldos/descargar',
  soloAdmin,
  validar(esquemas.descargarRespaldo),
  asincrono(exigirAutorizacionDirector('descargar respaldo de la base de datos')),
  asincrono(respaldos.descargar),
);

// --- Bitacora --------------------------------------------------------------

router.get(
  '/bitacora',
  soloAdmin,
  validar(esquemasBitacora.consulta, 'query'),
  asincrono(bitacoraControlador.listar),
);

module.exports = router;
