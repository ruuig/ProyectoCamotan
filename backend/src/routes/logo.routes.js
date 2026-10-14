const express = require('express');
const fs = require('fs');
const path = require('path');
const autenticar = require('../middleware/auth');
const autorizar = require('../middleware/rbac');
const asincrono = require('../utils/asincrono');

/**
 * Logo institucional que se muestra en el sistema y en las hojas impresas.
 *
 * Por defecto se usa el oficial del MSPAS que viene con el frontend. Si el
 * Ministerio cambia su imagen, dirección sube la nueva aquí y aparece en
 * todo el sistema, también en el inicio de sesión (por eso leerlo no pide
 * sesión). Quitarlo vuelve al oficial.
 */
const router = express.Router();
const CARPETA = path.join(__dirname, '..', '..', 'datos', 'logos');
const VARIANTES = ['vertical', 'horizontal'];
const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MIME = Object.fromEntries(Object.entries(TIPOS).map(([m, e]) => [e, m]));

function archivoDe(variante) {
  if (!fs.existsSync(CARPETA)) return null;
  const nombre = fs.readdirSync(CARPETA).find((f) => f.startsWith(`${variante}.`));
  return nombre ? path.join(CARPETA, nombre) : null;
}

function borrar(variante) {
  const actual = archivoDe(variante);
  if (actual) fs.unlinkSync(actual);
}

// Qué logo usar: la URL del personalizado, o null para el oficial.
router.get('/', (req, res) => {
  const estado = {};
  for (const v of VARIANTES) {
    const archivo = archivoDe(v);
    estado[v] = archivo ? `/api/v1/logo/${v}?v=${Math.round(fs.statSync(archivo).mtimeMs)}` : null;
  }
  res.json(estado);
});

router.get('/:variante', (req, res, next) => {
  if (!VARIANTES.includes(req.params.variante)) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Logo no encontrado' });
  const archivo = archivoDe(req.params.variante);
  if (!archivo) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Se usa el logo oficial' });
  res.type(MIME[path.extname(archivo).slice(1)]);
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(archivo);
});

const soloAdmin = [asincrono(autenticar), autorizar('admin')];

router.post(
  '/:variante',
  ...soloAdmin,
  express.raw({ type: Object.keys(TIPOS), limit: '4mb' }),
  asincrono(async (req, res, next) => {
    const { variante } = req.params;
    if (!VARIANTES.includes(variante)) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Variante de logo desconocida' });
    const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    if (!TIPOS[tipo]) return next({ status: 400, codigo: 'archivo_invalido', mensaje: 'El logo debe ser una imagen PNG, JPG, WEBP o SVG' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return next({ status: 400, codigo: 'archivo_vacio', mensaje: 'No llegó ninguna imagen' });
    fs.mkdirSync(CARPETA, { recursive: true });
    borrar(variante);
    fs.writeFileSync(path.join(CARPETA, `${variante}.${TIPOS[tipo]}`), req.body);
    await req.bitacora({ accion: 'actualizar', entidad: 'establecimiento', detalle: `Cambió el logo institucional (${variante})` });
    res.status(201).json({ ok: true });
  }),
);

router.delete(
  '/:variante',
  ...soloAdmin,
  asincrono(async (req, res, next) => {
    const { variante } = req.params;
    if (!VARIANTES.includes(variante)) return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Variante de logo desconocida' });
    borrar(variante);
    await req.bitacora({ accion: 'actualizar', entidad: 'establecimiento', detalle: `Volvió al logo oficial del MSPAS (${variante})` });
    res.json({ ok: true });
  }),
);

module.exports = router;
