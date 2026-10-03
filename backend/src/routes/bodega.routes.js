const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const idempotencia = require('../middleware/idempotencia');
const bodega = require('../controllers/bodega.controller');
const { CLAVES_CATEGORIA } = require('../services/bodega.service');

const router = express.Router();
router.use(asincrono(autenticar));

// La bodega es de quien la maneja; farmacia dispensa a los pacientes.
const deBodega = autorizar('admin', 'bodega');
const soloAdmin = autorizar('admin');

const periodo = z.string().regex(/^\d{4}-\d{2}$/, 'El período debe tener el formato AAAA-MM');
const id = z.coerce.number().int().positive();
const orden = z.enum(['alfabetico', 'categoria', 'existencia', 'meses', 'semaforo']).optional();
const categoria = z.enum(CLAVES_CATEGORIA).optional();

const ubicacion = z.object({
  nombre: z.string().trim().min(2, 'El nombre es obligatorio').max(120),
  tipo: z.enum(['centro_salud', 'puesto_salud', 'centro_comunitario']),
  comunidad: z.string().trim().max(120).optional().nullable(),
});

// --- Ubicaciones ---------------------------------------------------------------
router.get('/ubicaciones', deBodega, asincrono(bodega.listarUbicaciones));
router.post('/ubicaciones', soloAdmin, validar(ubicacion), asincrono(bodega.crearUbicacion));
router.patch(
  '/ubicaciones/:id',
  soloAdmin,
  validar(z.object({ id }), 'params'),
  validar(ubicacion.partial().extend({ activo: z.boolean().optional(), orden: z.coerce.number().int().min(0).optional() })),
  asincrono(bodega.actualizarUbicacion),
);

// --- Traslados -----------------------------------------------------------------
router.get(
  '/traslados/propuesta-lotes',
  deBodega,
  validar(z.object({ insumoId: id, cantidad: z.coerce.number().int().positive() }), 'query'),
  asincrono(bodega.propuestaLotes),
);
router.get(
  '/distribucion',
  deBodega,
  validar(z.object({
    insumoId: id,
    modo: z.enum(['iguales', 'consumo']).default('iguales'),
    cantidad: z.coerce.number().int().min(0).optional(),
    ubicaciones: z.string().optional().transform((v) => (v ? v.split(',').map(Number) : undefined)),
  }), 'query'),
  asincrono(bodega.distribucion),
);
router.get(
  '/traslados',
  deBodega,
  validar(z.object({ ubicacionId: id.optional(), periodo: periodo.optional() }), 'query'),
  asincrono(bodega.listarTraslados),
);
router.get('/traslados/:id', deBodega, validar(z.object({ id }), 'params'), asincrono(bodega.obtenerTraslado));
router.post(
  '/traslados',
  deBodega,
  idempotencia,
  validar(z.object({
    ubicacionId: id,
    recibidoPor: z.string().trim().min(3, 'Indique quién recibe').max(160),
    observacion: z.string().trim().max(500).optional().nullable(),
    renglones: z.array(z.object({ loteId: id, cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero') }))
      .min(1, 'El traslado no tiene renglones').max(300),
  })),
  asincrono(bodega.crearTraslado),
);

// --- Reportes de los servicios ---------------------------------------------------
router.get('/reportes', deBodega, validar(z.object({ periodo: periodo.optional() }), 'query'), asincrono(bodega.estadoReportes));
const parametrosReporte = z.object({ ubicacionId: id, periodo });
router.get('/reportes/:ubicacionId/:periodo', deBodega, validar(parametrosReporte, 'params'), asincrono(bodega.obtenerReporte));
router.put(
  '/reportes/:ubicacionId/:periodo',
  deBodega,
  validar(parametrosReporte, 'params'),
  validar(z.object({
    observacion: z.string().trim().max(500).optional().nullable(),
    renglones: z.array(z.object({
      insumoId: id,
      entregado: z.coerce.number().int().min(0).default(0),
      noEntregado: z.coerce.number().int().min(0).default(0),
      saldoReportado: z.coerce.number().int().min(0).optional().nullable(),
      entradasReportadas: z.coerce.number().int().min(0).optional().nullable(),
    })).max(1000),
  })),
  asincrono(bodega.guardarReporte),
);
router.post(
  '/reportes/:ubicacionId/:periodo/revisar',
  deBodega,
  validar(parametrosReporte, 'params'),
  validar(z.object({ observacion: z.string().trim().min(5, 'Explique por qué se aceptan las diferencias').max(500) })),
  asincrono(bodega.revisarReporte),
);

// --- Balance, semáforo e inventario de cierre --------------------------------------
const consultaListado = z.object({ periodo: periodo.optional(), categoria, orden, color: z.enum(['vencido', 'rojo', 'amarillo', 'verde']).optional() });
router.get('/balance', deBodega, validar(consultaListado, 'query'), asincrono(bodega.balance));
router.get('/semaforo', deBodega, validar(consultaListado, 'query'), asincrono(bodega.semaforo));
router.get('/inventario-cierre', deBodega, validar(consultaListado, 'query'), asincrono(bodega.inventarioCierre));
router.get('/balance/:periodo/excel', deBodega, validar(z.object({ periodo }), 'params'), asincrono(bodega.exportarBalance));
router.get('/bres/:periodo/excel', deBodega, validar(z.object({ periodo }), 'params'), asincrono(bodega.exportarBres));

// --- Alias del catálogo ---------------------------------------------------------------
router.get('/lotes', deBodega, validar(z.object({ buscar: z.string().max(80).optional() }), 'query'), asincrono(bodega.buscarLotes));
router.get('/insumos/:id', deBodega, validar(z.object({ id }), 'params'), asincrono(bodega.fichaInsumo));
router.get('/insumos/:id/alias', deBodega, validar(z.object({ id }), 'params'), asincrono(bodega.listarAlias));
router.post(
  '/insumos/:id/alias',
  deBodega,
  validar(z.object({ id }), 'params'),
  validar(z.object({ alias: z.string().trim().min(2).max(200) })),
  asincrono(bodega.agregarAlias),
);
router.delete(
  '/insumos/:id/alias/:aliasId',
  deBodega,
  validar(z.object({ id, aliasId: id }), 'params'),
  asincrono(bodega.quitarAlias),
);

module.exports = router;
