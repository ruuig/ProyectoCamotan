const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const controlador = require('../controllers/indicadores.controller');
const consolidado = require('../controllers/consolidado.controller');

const router = express.Router();

router.use(asincrono(autenticar));

const consultaAlertas = z.object({
  tipo: z
    .enum([
      'vencimiento',
      'existencia_baja',
      'desabastecimiento',
      'cuarentena',
      'bres_pendiente',
      'inventario_pendiente',
      'reporte_pendiente',
      'diferencia_reporte',
      'cita_vencida',
      'patron_clinico',
      'desnutricion',
      'comunidad_sin_atencion',
    ])
    .optional(),
  severidad: z.enum(['alta', 'media', 'baja']).optional(),
  estado: z.enum(['nueva', 'en_gestion', 'resuelta']).optional(),
});

// Que se hizo. El texto que ve la direccion se arma al leer, no se guarda.
const cuerpoGestion = z.object({
  accion: z.enum(['despacho_solicitado', 'lote_revisado', 'visita_programada']),
});

const parametroId = z.object({ id: z.coerce.number().int().positive() });

const parametroRol = z.object({
  rol: z.enum(['preconsulta', 'medico', 'farmacia', 'bodega', 'admin']),
});

// El periodo solo lo usa el panel de direccion. Si no viene, es la semana.
const consultaPanel = z.object({
  periodo: z.enum(['semana', 'mes']).default('semana'),
});

// Cada rol entra a su panel. El control fino esta en el controlador.
router.get(
  '/panel/:rol',
  validar(parametroRol, 'params'),
  validar(consultaPanel, 'query'),
  asincrono(controlador.panel),
);

// Series para las graficas. Farmacia no las necesita: su panel mira
// existencias y vencimientos, no el flujo de atencion.
router.get(
  '/series',
  autorizar('admin', 'medico', 'preconsulta'),
  asincrono(controlador.series),
);

router.get('/alertas', validar(consultaAlertas, 'query'), asincrono(controlador.alertas));

// Registrar la gestion no resuelve la alerta: solo deja constancia de que
// alguien ya actuo. La alerta se cierra sola cuando su causa desaparece.
router.patch(
  '/alertas/:id/gestion',
  validar(parametroId, 'params'),
  validar(cuerpoGestion),
  asincrono(controlador.registrarGestion),
);

router.post('/alertas/recalcular', autorizar('admin'), asincrono(controlador.recalcular));

// --- Consolidado SIGSA -----------------------------------------------------

const consultaConsolidado = z.object({
  mes: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, 'El mes debe tener el formato AAAA-MM')
    .optional(),
});

router.get(
  '/consolidado',
  autorizar('admin'),
  validar(consultaConsolidado, 'query'),
  asincrono(consolidado.obtener),
);

router.get(
  '/consolidado/export',
  autorizar('admin'),
  validar(consultaConsolidado, 'query'),
  asincrono(consolidado.exportar),
);

module.exports = router;
