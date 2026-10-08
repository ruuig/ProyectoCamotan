const fs = require('fs');
const prisma = require('../config/db');
const respaldo = require('../services/respaldo.service');

const CAMPOS_CONFIG = ['automatico', 'frecuencia', 'hora', 'diaSemana', 'conservar'];

function configPublica(config) {
  return {
    ...Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, config[k]])),
    ultimoIntentoEn: config.ultimoIntentoEn,
    ultimoError: config.ultimoError,
    proximo: respaldo.proximoProgramado(config),
  };
}

// La fila la crea la migracion; se asegura por si la base vino de otro lado.
async function obtenerConfig() {
  return prisma.configuracionRespaldo.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

async function listar(req, res) {
  const [config, respaldos] = await Promise.all([obtenerConfig(), respaldo.listarRespaldos()]);
  res.json({ configuracion: configPublica(config), respaldos });
}

async function guardarConfiguracion(req, res) {
  const config = await prisma.configuracionRespaldo.upsert({
    where: { id: 1 },
    update: { ...req.body, actualizadoPor: req.usuario.id, actualizadoEn: new Date() },
    create: { id: 1, ...req.body, actualizadoPor: req.usuario.id, actualizadoEn: new Date() },
  });
  await req.bitacora({
    accion: 'actualizar',
    entidad: 'respaldo',
    detalle: config.automatico
      ? `Respaldo automático ${config.frecuencia} a las ${config.hora}:00, se conservan ${config.conservar}`
      : 'Respaldo automático desactivado',
  });
  res.json({ configuracion: configPublica(config) });
}

async function crearRespaldo(req, res, next) {
  let nombre;
  try {
    nombre = await respaldo.crearRespaldo('manual');
  } catch (error) {
    // Lo que falla aqui es del servidor (pg_dump, disco), pero el
    // administrador necesita leer por que para poder resolverlo.
    return next({ status: 503, codigo: 'respaldo_fallido', mensaje: `No se pudo hacer el respaldo: ${error.message}` });
  }
  const config = await obtenerConfig();
  await respaldo.aplicarConservacion(config.conservar);
  await req.bitacora({ accion: 'crear', entidad: 'respaldo', detalle: nombre });
  res.status(201).json({ nombre });
}

/**
 * Entrega el archivo de un respaldo. Lleva toda la informacion del sistema,
 * con datos clinicos y personales, por eso la ruta exige al director.
 * Sin nombre, hace uno en ese momento y entrega ese.
 */
async function descargar(req, res, next) {
  let nombre = req.body.nombre;
  if (!nombre) {
    try {
      nombre = await respaldo.crearRespaldo('manual');
      const config = await obtenerConfig();
      await respaldo.aplicarConservacion(config.conservar);
    } catch (error) {
      return next({ status: 503, codigo: 'respaldo_fallido', mensaje: `No se pudo hacer el respaldo: ${error.message}` });
    }
  }

  const ruta = respaldo.rutaDe(nombre);
  if (!ruta || !fs.existsSync(ruta)) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Ese respaldo ya no existe' });
  }

  await req.bitacora({
    accion: 'exportar',
    entidad: 'respaldo',
    detalle: `${nombre}. Autorizó ${req.director.nombre}`,
  });
  res.download(ruta, nombre, { headers: { 'Content-Type': 'application/sql; charset=utf-8' } });
}

module.exports = { listar, guardarConfiguracion, crearRespaldo, descargar };
