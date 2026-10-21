const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const controlador = require('../controllers/impresion.controller');

const router = express.Router();

router.use(asincrono(autenticar));

const registrar = z.object({
  documento: z.enum([
    'ficha_atencion',
    'ficha_blanco',
    'resumen_expediente',
    'boleta_referencia',
    // Documentos de la bodega (MD/Bodega.md seccion 8).
    'bres',
    'balance',
    'inventario_cierre',
    'hoja_conteo',
    'semaforo',
    'comprobante_traslado',
    'tarjeta_control',
    'oficio_baja',
    'requisicion',
    'kardex',
    'inventario_farmacia',
    // Farmacia: registro diario de post-consulta.
    'sigsa4',
    'sigsa3cs',
    'receta_paciente',
  ]),
  // Periodo, numero de traslado o lote: lo que identifica el documento.
  referencia: z.string().trim().max(60).optional().nullable(),
  enBlanco: z.boolean().optional(),
  pacienteId: z.coerce.number().int().positive().optional().nullable(),
  atencionId: z.coerce.number().int().positive().optional().nullable(),
});

router.post(
  '/',
  autorizar('admin', 'preconsulta', 'medico', 'farmacia', 'bodega', 'servicio'),
  validar(registrar),
  asincrono(controlador.registrar),
);

module.exports = router;
