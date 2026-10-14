const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const esquemas = require('../schemas/inventario.schema');
const inventario = require('../controllers/inventario.controller');
const dispensaciones = require('../controllers/dispensaciones.controller');
const logistica = require('../controllers/logistica.controller');
const idempotencia = require('../middleware/idempotencia');
const { exigirAutorizacionDirector } = require('../services/autorizacionDirector.service');

const router = express.Router();

router.use(asincrono(autenticar));

// Bodega maneja el inventario; farmacia dispensa y consulta existencias.
const deBodega = autorizar('admin', 'bodega');
const dispensa = autorizar('admin', 'farmacia');
const soloAdmin = autorizar('admin');
const consultar = autorizar('admin', 'farmacia', 'bodega', 'medico');

// --- Catálogos y configuración ---------------------------------------------

router.get('/inventario/catalogos', consultar, asincrono(logistica.catalogos));

router.get('/inventario/configuracion', consultar, asincrono(logistica.obtenerConfiguracion));

// Los parámetros logísticos los define el Área de Salud; cambiarlos altera
// cuánto se pide de todo, así que es del administrador.
router.patch(
  '/inventario/configuracion',
  soloAdmin,
  validar(esquemas.configurarLogistica),
  asincrono(logistica.guardarConfiguracion),
);

// --- Abastecimiento --------------------------------------------------------

router.get(
  '/inventario/abastecimiento',
  consultar,
  validar(esquemas.listarInsumos, 'query'),
  asincrono(logistica.resumenAbastecimiento),
);

router.get(
  '/inventario/abastecimiento/:id',
  consultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(logistica.detalleAbastecimiento),
);

// El saldo guardado existe por rendimiento; esto demuestra que cuadra con
// los movimientos, que es lo que pide la auditoría.
router.get('/inventario/verificar-saldos', deBodega, asincrono(logistica.verificarSaldos));

// --- Lotes -----------------------------------------------------------------

router.get(
  '/lotes/:id/trazabilidad',
  consultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(inventario.trazabilidad),
);

router.patch(
  '/lotes/:id/estado',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.cambiarEstadoLote),
  asincrono(logistica.cambiarEstado),
);

// --- Tarjeta de control de suministros --------------------------------------

router.get(
  '/insumos/:id/tarjeta-control',
  consultar,
  validar(esquemas.parametroId, 'params'),
  validar(z.object({ ubicacion: z.enum(['bodega', 'farmacia']).optional() }), 'query'),
  asincrono(logistica.tarjetaControl),
);

// --- Trazabilidad desde el paciente ----------------------------------------

// Preconsulta tambien lo necesita: es quien contacta a la gente cuando un
// lote queda bajo retiro sanitario.
router.get(
  '/trazabilidad/pacientes',
  autorizar('admin', 'farmacia', 'bodega'),
  validar(z.object({ buscar: z.string().trim().max(80).optional() }), 'query'),
  asincrono(logistica.buscarPacientesConEntregas),
);
router.get(
  '/pacientes/:id/insumos',
  autorizar('admin', 'farmacia', 'bodega', 'medico', 'preconsulta'),
  validar(esquemas.parametroId, 'params'),
  asincrono(logistica.trazaPaciente),
);

// --- Dispensación ----------------------------------------------------------

router.get('/dispensaciones/pendientes', dispensa, asincrono(dispensaciones.pendientes));

// Entrega por paciente: la hoja con lo que se copia al formato en papel y el
// registro de toda la entrega de una vez.
router.get('/dispensaciones/por-atender', dispensa, asincrono(dispensaciones.porAtender));
// Lo ya atendido: del día o de un paciente. A quién se le dio qué, y de qué lote.
router.get(
  '/dispensaciones/entregas',
  dispensa,
  validar(z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), buscar: z.string().trim().max(80).optional() }), 'query'),
  asincrono(dispensaciones.entregas),
);
router.get(
  '/dispensaciones/atenciones/:id',
  dispensa,
  validar(esquemas.parametroId, 'params'),
  asincrono(dispensaciones.hojaDeEntrega),
);
router.post(
  '/dispensaciones/atenciones/:id',
  dispensa,
  idempotencia,
  validar(esquemas.parametroId, 'params'),
  validar(z.object({
    // Sin renglones se entrega todo lo pendiente. Cantidad 0 deja esa receta pendiente.
    renglones: z.array(z.object({
      prescripcionId: z.coerce.number().int().positive(),
      cantidad: z.coerce.number().int().min(0),
    })).max(50).optional(),
  })),
  asincrono(dispensaciones.dispensarAtencion),
);

// Constancia de entrega (firma o huella de quien recibe) y SIGSA-4 del mes.
router.get('/dispensaciones/por-firmar', dispensa, asincrono(dispensaciones.porFirmar));
router.post(
  '/dispensaciones/constancias',
  dispensa,
  validar(z.object({
    atencionId: z.coerce.number().int().positive(),
    tipo: z.enum(['firma', 'huella', 'papel']),
    quienRecibe: z.enum(['paciente', 'responsable', 'otro']),
    nombreRecibe: z.string().trim().max(160).optional().nullable(),
    // PNG en base64; una firma pesa unos pocos KB.
    imagen: z.string().max(700000).optional().nullable(),
  }).refine((d) => d.tipo === 'papel' || d.imagen, { message: 'Falta la firma o la huella', path: ['imagen'] })
    .refine((d) => d.quienRecibe === 'paciente' || (d.nombreRecibe && d.nombreRecibe.length >= 3), { message: 'Indique quién recibe', path: ['nombreRecibe'] })),
  asincrono(dispensaciones.registrarConstancia),
);
router.get('/dispensaciones/constancias/:id/imagen', dispensa, validar(esquemas.parametroId, 'params'), asincrono(dispensaciones.imagenConstancia));
router.get(
  '/dispensaciones/sigsa4',
  dispensa,
  validar(z.object({ periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }), 'query'),
  asincrono(dispensaciones.sigsa4),
);

// La dispensación se encola sin conexión: el reenvío no debe duplicarla.
router.post(
  '/dispensaciones',
  dispensa,
  idempotencia,
  validar(esquemas.dispensar),
  asincrono(dispensaciones.crear),
);

router.patch(
  '/dispensaciones/:id/anular',
  dispensa,
  validar(esquemas.parametroId, 'params'),
  asincrono(dispensaciones.anular),
);

// --- Movimientos -----------------------------------------------------------

router.post(
  '/inventario/reajustes',
  deBodega,
  validar(esquemas.reajustar),
  asincrono(inventario.reajustar),
);

// Consumo propio del establecimiento, sin receta. Se encola sin conexión como
// la dispensación: el reenvío no debe duplicar la salida.
router.post(
  '/inventario/uso-interno',
  deBodega,
  idempotencia,
  validar(esquemas.usoInterno),
  asincrono(inventario.usoInterno),
);

// Los traslados a los servicios viven en /bodega/traslados: llevan destino,
// quien recibe y comprobante.

router.get('/inventario/diferencias', deBodega, asincrono(inventario.diferenciasDelMes));

// --- Inventario físico -----------------------------------------------------

// La hoja no lleva el saldo esperado: el conteo es ciego a propósito.
router.get('/inventario/fisico/hoja', deBodega, asincrono(logistica.hojaDeConteo));

router.post(
  '/inventario/fisico',
  deBodega,
  validar(esquemas.abrirInventario),
  asincrono(logistica.abrirInventario),
);

router.get(
  '/inventario/fisico/:periodo',
  deBodega,
  validar(esquemas.parametroPeriodo, 'params'),
  asincrono(logistica.obtenerInventario),
);

router.post(
  '/inventario/fisico/:id/conteos',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.registrarConteo),
  asincrono(logistica.registrarConteo),
);

// Al cerrar se congelan los saldos y se aplican los reajustes. Las
// diferencias grandes quedan pendientes salvo que el director autorice aquí.
router.post(
  '/inventario/fisico/:id/cerrar',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.cerrarInventario),
  asincrono(logistica.cerrarInventario),
);

// --- BRES ------------------------------------------------------------------

router.get(
  '/inventario/bres/:periodo/vista-previa',
  deBodega,
  validar(esquemas.parametroPeriodo, 'params'),
  asincrono(logistica.vistaPreviaBres),
);

router.get(
  '/inventario/bres/:periodo',
  deBodega,
  validar(esquemas.parametroPeriodo, 'params'),
  asincrono(logistica.obtenerBres),
);

router.post(
  '/inventario/bres',
  deBodega,
  validar(esquemas.generarBres),
  asincrono(logistica.generarBres),
);

router.post(
  '/inventario/bres/:periodo/cerrar',
  deBodega,
  validar(esquemas.parametroPeriodo, 'params'),
  asincrono(logistica.cerrarBres),
);

router.get(
  '/inventario/demanda-diaria/:periodo',
  deBodega,
  validar(esquemas.parametroPeriodo, 'params'),
  asincrono(logistica.registroDiario),
);

// --- Retiro sanitario ------------------------------------------------------

router.get('/inventario/retiros', consultar, asincrono(logistica.listarRetiros));

router.post(
  '/inventario/retiros',
  deBodega,
  validar(esquemas.registrarRetiro),
  asincrono(logistica.registrarRetiro),
);

router.get(
  '/inventario/retiros/:id',
  consultar,
  validar(esquemas.parametroId, 'params'),
  asincrono(logistica.obtenerRetiro),
);

router.patch(
  '/inventario/retiros/pacientes/:id',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  validar(esquemas.actualizarLocalizacion),
  asincrono(logistica.marcarLocalizacion),
);

router.post(
  '/inventario/retiros/:id/cerrar',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  asincrono(logistica.cerrarRetiro),
);

// --- Oficio de baja --------------------------------------------------------

router.get('/inventario/bajas/candidatos', deBodega, asincrono(logistica.candidatosBaja));

router.get('/inventario/bajas', deBodega, asincrono(logistica.listarOficios));

router.post(
  '/inventario/bajas',
  deBodega,
  validar(esquemas.solicitarBaja),
  asincrono(logistica.solicitarBaja),
);

router.get(
  '/inventario/bajas/:id',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  asincrono(logistica.obtenerOficio),
);

// Nadie da de baja lo que él mismo solicitó sin que el director lo autorice.
router.post(
  '/inventario/bajas/:id/autorizar',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  asincrono(exigirAutorizacionDirector('autorizar baja de inventario')),
  asincrono(logistica.autorizarBaja),
);

router.post(
  '/inventario/bajas/:id/aplicar',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  asincrono(logistica.aplicarBaja),
);

router.post(
  '/inventario/bajas/:id/anular',
  deBodega,
  validar(esquemas.parametroId, 'params'),
  asincrono(logistica.anularBaja),
);

module.exports = router;
