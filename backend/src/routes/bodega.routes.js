const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const idempotencia = require('../middleware/idempotencia');
const bodega = require('../controllers/bodega.controller');
const requisiciones = require('../controllers/requisiciones.controller');
const recepciones = require('../controllers/recepciones.controller');
const { hoy } = require('../controllers/hoy.controller');
const { CLAVES_TIPO } = require('../services/requisiciones.service');
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
  tipo: z.enum(['centro_salud', 'puesto_salud', 'centro_comunitario', 'unidad_interna']),
  comunidad: z.string().trim().max(120).optional().nullable(),
});

// --- Ubicaciones ---------------------------------------------------------------
// Farmacia la usa para elegirse en sus requisiciones.
router.get('/ubicaciones', autorizar('admin', 'bodega', 'farmacia', 'servicio'), asincrono(bodega.listarUbicaciones));
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

// --- Requisiciones (FOR-ASB-01) ----------------------------------------------------
// Farmacia registra y consulta las de la farmacia; la bodega autoriza y despacha.
const conFarmacia = autorizar('admin', 'bodega', 'farmacia');
// Los pedidos a la bodega también los hace el encargado de cada centro o puesto
// (solo los de su ubicación; el controlador lo revisa).
const conServicio = autorizar('admin', 'bodega', 'farmacia', 'servicio');
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida');
const requisicion = z.object({
  direccion: z.enum(['servicio', 'superior']).default('servicio'),
  almacen: z.string().trim().max(160).optional().nullable(),
  numero: z.string().trim().max(20).optional().nullable(),
  ubicacionId: id.optional().nullable(),
  codigo: z.string().trim().max(40).optional().nullable(),
  unidadSeccion: z.string().trim().max(160).optional().nullable(),
  tipos: z.array(z.enum(CLAVES_TIPO)).max(8).optional(),
  fechaSolicitud: fecha,
  solicitante: z.string().trim().min(3, 'Indique quién solicita').max(160),
  jefe: z.string().trim().max(160).optional().nullable(),
  recepcionEn: z.string().datetime({ offset: true }).optional().nullable().or(z.literal('')),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  renglones: z.array(z.object({
    insumoId: id.optional().nullable(),
    descripcion: z.string().trim().max(300).optional().nullable(),
    unidadMedida: z.string().trim().max(60).optional().nullable(),
    cantidadSolicitada: z.coerce.number().int().positive('La cantidad solicitada debe ser mayor que cero'),
    cantidadAutorizada: z.coerce.number().int().min(0).optional().nullable(),
  })).min(1, 'La requisición no tiene renglones').max(500, 'La requisición tiene más de 500 renglones'),
});
router.get(
  '/requisiciones',
  conServicio,
  validar(z.object({
    estado: z.enum(['solicitada', 'autorizada', 'despachada', 'parcial', 'recibida', 'anulada']).optional(),
    direccion: z.enum(['servicio', 'superior']).optional(),
    ubicacionId: id.optional(),
    periodo: periodo.optional(),
  }), 'query'),
  asincrono(requisiciones.listar),
);
router.get('/requisiciones/solicitantes', conServicio, asincrono(requisiciones.solicitantes));
router.get('/requisiciones/sugerida-ddriss', deBodega, validar(z.object({ periodo: periodo.optional() }), 'query'), asincrono(requisiciones.sugeridaDdriss));
router.get('/requisiciones/sugerida', conServicio, validar(z.object({ ubicacionId: id.optional() }), 'query'), asincrono(requisiciones.sugerida));
// Entregar en un paso: registra la entrega y genera la requisicion.
router.post(
  '/requisiciones/entregar',
  conFarmacia,
  idempotencia,
  validar(z.object({
    numero: z.string().trim().max(20).optional().nullable(),
    ubicacionId: id,
    unidadSeccion: z.string().trim().max(160).optional().nullable(),
    codigo: z.string().trim().max(40).optional().nullable(),
    fechaSolicitud: fecha.optional(),
    solicitante: z.string().trim().min(3, 'Indique quién solicita').max(160),
    jefe: z.string().trim().max(160).optional().nullable(),
    tipos: z.array(z.enum(CLAVES_TIPO)).max(8).optional(),
    observaciones: z.string().trim().max(1000).optional().nullable(),
    renglones: z.array(z.object({
      insumoId: id.optional().nullable(),
      descripcion: z.string().trim().max(300).optional().nullable(),
      unidadMedida: z.string().trim().max(60).optional().nullable(),
      cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero'),
      // Lote elegido a mano; sin él, sale el que vence primero.
      lotes: z.array(z.object({ loteId: id, cantidad: z.coerce.number().int().positive() })).max(20).optional(),
    })).min(1, 'Agregue lo que se entrega').max(500, 'La entrega tiene más de 500 renglones'),
  })),
  asincrono(requisiciones.entregar),
);
router.patch(
  '/requisiciones/:id/numero',
  conFarmacia,
  validar(z.object({ id }), 'params'),
  validar(z.object({ numero: z.string().trim().min(1, 'Escriba el número').max(20) })),
  asincrono(requisiciones.anotarNumero),
);
router.get('/requisiciones/:id', conServicio, validar(z.object({ id }), 'params'), asincrono(requisiciones.obtener));
router.post('/requisiciones', conServicio, idempotencia, validar(requisicion), asincrono(requisiciones.crear));
router.put('/requisiciones/:id', conServicio, validar(z.object({ id }), 'params'), validar(requisicion), asincrono(requisiciones.actualizar));
router.post(
  '/requisiciones/:id/autorizar',
  deBodega,
  validar(z.object({ id }), 'params'),
  validar(z.object({ renglones: z.array(z.object({
    id,
    cantidadAutorizada: z.coerce.number().int().min(0),
    motivo: z.string().trim().max(200).optional().nullable(),
  })).optional() })),
  asincrono(requisiciones.autorizar),
);
router.post(
  '/requisiciones/:id/despachar',
  deBodega,
  idempotencia,
  validar(z.object({ id }), 'params'),
  validar(z.object({
    numero: z.string().trim().max(20).optional().nullable(),
    recibidoPor: z.string().trim().min(3, 'Indique quién recibe').max(160),
    fechaEntrega: z.string().datetime({ offset: true }).optional().nullable(),
    renglones: z.array(z.object({
      id,
      cantidadDespachada: z.coerce.number().int().min(0).optional(),
      lotes: z.array(z.object({ loteId: id, cantidad: z.coerce.number().int().positive() })).optional(),
    })).optional(),
  })),
  asincrono(requisiciones.despachar),
);
router.post(
  '/requisiciones/:id/recibir',
  deBodega,
  idempotencia,
  validar(z.object({ id }), 'params'),
  validar(z.object({
    numero: z.string().trim().max(20).optional().nullable(),
    recibidoPor: z.string().trim().max(160).optional().nullable(),
    completa: z.boolean().default(false),
    renglones: z.array(z.object({
      id,
      cantidad: z.coerce.number().int().min(0).optional(),
      // Lo pedido a mano que al llegar se creó como producto: se enlaza.
      insumoId: id.optional(),
      lotes: z.array(z.object({
        numeroLote: z.string().trim().min(1, 'Falta el número de lote').max(60),
        fechaVence: fecha,
        cantidad: z.coerce.number().int().positive('La cantidad debe ser mayor que cero'),
        costoUnitario: z.coerce.number().min(0).optional().nullable(),
        fabricante: z.string().trim().max(160).optional().nullable(),
      })).max(20).optional(),
    })).min(1, 'Indique lo que se recibió').max(500, 'La recepción tiene más de 500 renglones'),
  })),
  asincrono(requisiciones.recibir),
);
router.post(
  '/requisiciones/:id/anular',
  conServicio,
  validar(z.object({ id }), 'params'),
  validar(z.object({ motivo: z.string().trim().min(5, 'Explique por qué se anula').max(300) })),
  asincrono(requisiciones.anular),
);

// --- Kardex ------------------------------------------------------------------------
router.get(
  '/kardex',
  // Farmacia (post-consulta) lleva su propia tarjeta: el controlador le da la suya.
  conFarmacia,
  validar(z.object({ periodo: periodo.optional(), insumoId: id.optional(), desde: fecha.optional(), ubicacion: z.enum(['bodega', 'farmacia']).optional() }), 'query'),
  asincrono(bodega.kardex),
);

// --- Recepcion: lo que llega con su documento ---------------------------------------
router.get('/recepciones', deBodega, asincrono(recepciones.listar));
router.get('/recepciones/faltantes', deBodega, asincrono(recepciones.faltantes));
router.get('/recepciones/:id', deBodega, validar(z.object({ id }), 'params'), asincrono(recepciones.obtener));
router.post(
  '/recepciones',
  deBodega,
  idempotencia,
  validar(z.object({
    numeroDocumento: z.string().trim().max(40).optional().nullable(),
    procedencia: z.enum(['despacho', 'donacion', 'traslado', 'prestamo']).default('despacho'),
    remitente: z.string().trim().min(3, 'Indique de dónde viene').max(160),
    acta: z.string().trim().max(60).optional().nullable(),
    fecha,
    observaciones: z.string().trim().max(1000).optional().nullable(),
    renglones: z.array(z.object({
      insumoId: id,
      numeroLote: z.string().trim().min(1, 'Falta el número de lote').max(60),
      vence: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Vencimiento: mes y año'),
      cantidadDocumento: z.coerce.number().int().positive('La cantidad del documento debe ser mayor que cero'),
      cantidadRecibida: z.coerce.number().int().min(0),
      costoUnitario: z.coerce.number().min(0).optional().nullable(),
      conforme: z.boolean().default(true),
      observacion: z.string().trim().max(300).optional().nullable(),
    })).min(1, 'Agregue lo que llegó').max(100),
  })),
  asincrono(recepciones.crear),
);
router.post(
  '/lotes/:id/reponer',
  deBodega,
  validar(z.object({ id }), 'params'),
  validar(z.object({ cantidad: z.coerce.number().int().positive() })),
  asincrono(recepciones.reponer),
);

// --- Hoy: lo pendiente ---------------------------------------------------------------
router.get('/hoy', deBodega, validar(z.object({ kardexDesde: fecha.optional() }), 'query'), asincrono(hoy));

// --- Excel del consumo de cada territorio -----------------------------------------
// Bodega baja y sube el de cualquier territorio; el encargado, solo el suyo.
const conTerritorio = autorizar('admin', 'bodega', 'servicio');
const EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
router.get('/territorios', conTerritorio, asincrono(bodega.territorios));
router.get(
  '/consumo/excel',
  conTerritorio,
  validar(z.object({ periodo, territorioId: id.optional() }), 'query'),
  asincrono(bodega.excelConsumo),
);
router.post(
  '/consumo/excel',
  conTerritorio,
  validar(z.object({ periodo, ubicacionId: id.optional() }), 'query'),
  express.raw({ type: [EXCEL, 'application/octet-stream'], limit: '15mb' }),
  asincrono(bodega.subirExcelConsumo),
);

// --- Informes de los servicios ---------------------------------------------------
router.get('/informes', deBodega, validar(z.object({ periodo: periodo.optional() }), 'query'), asincrono(bodega.estadoInformes));
const parametrosInforme = z.object({ ubicacionId: id, periodo });
// El encargado de un centro o puesto ve y sube el informe de su ubicación.
const informePropio = [
  autorizar('admin', 'bodega', 'servicio'),
  (req, _res, next) => (req.usuario.rol !== 'servicio' || Number(req.params.ubicacionId) === req.usuario.ubicacionId
    ? next() : next({ status: 403, codigo: 'sin_permiso', mensaje: 'Solo puede ver el informe de su centro o puesto' })),
];
router.get('/informes/:ubicacionId/:periodo', informePropio, validar(parametrosInforme, 'params'), asincrono(bodega.obtenerInforme));
router.put(
  '/informes/:ubicacionId/:periodo',
  informePropio,
  validar(parametrosInforme, 'params'),
  validar(z.object({
    observacion: z.string().trim().max(500).optional().nullable(),
    renglones: z.array(z.object({
      insumoId: id,
      entregado: z.coerce.number().int().min(0).default(0),
      noEntregado: z.coerce.number().int().min(0).default(0),
      saldoInformado: z.coerce.number().int().min(0).optional().nullable(),
      entradasInformadas: z.coerce.number().int().min(0).optional().nullable(),
    })).max(1000),
  })),
  asincrono(bodega.guardarInforme),
);
router.post(
  '/informes/:ubicacionId/:periodo/revisar',
  deBodega,
  validar(parametrosInforme, 'params'),
  validar(z.object({ observacion: z.string().trim().min(5, 'Explique por qué se aceptan las diferencias').max(500) })),
  asincrono(bodega.revisarInforme),
);

// --- Balance, semáforo e inventario de cierre --------------------------------------
const consultaListado = z.object({ periodo: periodo.optional(), categoria, orden, color: z.enum(['vencido', 'rojo', 'amarillo', 'verde']).optional() });
router.get('/balance', deBodega, validar(consultaListado, 'query'), asincrono(bodega.balance));
router.get('/semaforo', deBodega, validar(consultaListado, 'query'), asincrono(bodega.semaforo));
router.get('/inventario-cierre', deBodega, validar(consultaListado, 'query'), asincrono(bodega.inventarioCierre));
router.get('/balance/:periodo/excel', deBodega, validar(z.object({ periodo }), 'params'), asincrono(bodega.exportarBalance));
router.get('/bres/:periodo/excel', deBodega, validar(z.object({ periodo }), 'params'), asincrono(bodega.exportarBres));
// Trazadores: el informe mensual a la DDRISS en sus tres formatos.
router.get(
  '/trazadores/:formato',
  deBodega,
  validar(z.object({ formato: z.enum(['medicamentos', 'quirurgico', 'laboratorio']) }), 'params'),
  validar(z.object({ periodo: periodo.optional() }), 'query'),
  asincrono(bodega.trazador),
);

// --- Alias del catálogo ---------------------------------------------------------------
router.get('/lotes', deBodega, validar(z.object({ buscar: z.string().max(80).optional() }), 'query'), asincrono(bodega.buscarLotes));
router.get('/insumos/:id', deBodega, validar(z.object({ id }), 'params'), asincrono(bodega.fichaInsumo));
router.patch(
  '/insumos/:id/prescribible',
  deBodega,
  validar(z.object({ id }), 'params'),
  validar(z.object({ prescribible: z.boolean() })),
  asincrono(bodega.cambiarPrescribible),
);
router.patch(
  '/insumos/:id/ubicacion',
  deBodega,
  validar(z.object({ id }), 'params'),
  validar(z.object({ ubicacionFisica: z.string().trim().max(80).optional().nullable() })),
  asincrono(bodega.cambiarUbicacionFisica),
);
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
