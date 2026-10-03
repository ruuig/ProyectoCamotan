const express = require('express');
const { z } = require('zod');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const validar = require('../middleware/validar');
const asincrono = require('../utils/asincrono');
const controlador = require('../controllers/catalogos.controller');
const { CATEGORIAS } = require('../services/csvLugares.service');

const router = express.Router();

router.use(asincrono(autenticar));

// Cualquier rol autenticado lee los catalogos: los necesita para mostrar las
// etiquetas de lo que ya esta guardado.
const consultar = autorizar('admin', 'preconsulta', 'medico', 'farmacia', 'bodega');
const administrar = autorizar('admin');

const consultaCatalogo = z.object({
  catalogo: z.string().trim().max(40).optional(),
});

const consultaLugares = z.object({
  buscar: z.string().trim().max(120).optional(),
});

const crearLugar = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  categoria: z.enum(CATEGORIAS, {
    errorMap: () => ({ message: `La categoría debe ser una de: ${CATEGORIAS.join(', ')}` }),
  }),
  territorio: z.string().trim().max(80).optional().nullable(),
  sector: z.string().trim().max(80).optional().nullable(),
});

// El CSV llega como texto en el cuerpo: son unas pocas centenas de lineas y
// evita sumar una dependencia de subida de archivos.
const importarLugares = z.object({
  csv: z.string().min(1, 'El archivo está vacío').max(500_000),
});

router.get('/', consultar, validar(consultaCatalogo, 'query'), asincrono(controlador.listar));

router.get(
  '/lugares',
  consultar,
  validar(consultaLugares, 'query'),
  asincrono(controlador.lugares),
);

router.post('/lugares', administrar, validar(crearLugar), asincrono(controlador.crearLugar));

const tiempos = z.object({
  tiempos: z.array(z.object({
    id: z.number().int().positive(),
    minutos: z.number().int().min(0).max(1440).nullable(),
  })).min(1).max(500),
});
router.put('/lugares/tiempos', administrar, validar(tiempos), asincrono(controlador.guardarTiempos));

router.post(
  '/lugares/importar',
  administrar,
  validar(importarLugares),
  asincrono(controlador.importarLugares),
);

// --- CIE-10 ----------------------------------------------------------------

router.get(
  '/cie10',
  autorizar('admin', 'medico'),
  validar(z.object({ q: z.string().trim().min(2, 'Escriba al menos dos letras').max(80) }), 'query'),
  asincrono(controlador.buscarCie10),
);

// El catalogo es grande (unos 12 000 codigos): se admite un texto mayor.
router.post(
  '/cie10/importar',
  administrar,
  validar(z.object({ csv: z.string().min(1, 'El archivo está vacío').max(3_000_000) })),
  asincrono(controlador.importarCie10),
);

module.exports = router;
