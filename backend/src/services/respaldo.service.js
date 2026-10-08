const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { databaseUrl } = require('../config/env');

/**
 * Respaldo de la base de datos con pg_dump, en SQL plano: se restaura con
 * psql sin herramientas especiales.
 *
 * Los archivos quedan en una carpeta del servidor (RESPALDOS_DIR) y se
 * conservan los mas recientes segun la configuracion. pg_dump se busca en el
 * PATH, o donde indique PG_DUMP.
 */
const CARPETA = process.env.RESPALDOS_DIR || path.join(__dirname, '..', '..', 'respaldos');
const PG_DUMP = process.env.PG_DUMP || 'pg_dump';

// camotan_2026-10-07_1530_manual.sql. El nombre es lo unico que llega del
// cliente al descargar: si no cumple el patron, no se toca el disco.
const PATRON_NOMBRE = /^camotan_\d{4}-\d{2}-\d{2}_\d{4}_(manual|automatico)\.sql$/;

// Guatemala no tiene horario de verano: siempre UTC-6.
const DESFASE_GT_MS = 6 * 60 * 60 * 1000;
const MS_DIA = 86400000;

/** Fecha y hora de Guatemala para el nombre del archivo. */
function sello(fecha) {
  const gt = new Date(fecha.getTime() - DESFASE_GT_MS).toISOString();
  return `${gt.slice(0, 10)}_${gt.slice(11, 13)}${gt.slice(14, 16)}`;
}

function nombreRespaldo(origen, fecha = new Date()) {
  return `camotan_${sello(fecha)}_${origen}.sql`;
}

function rutaDe(nombre) {
  if (!PATRON_NOMBRE.test(nombre)) return null;
  return path.join(CARPETA, nombre);
}

/**
 * Ultimo momento programado que ya paso, en UTC. La hora y el dia de la
 * semana (0 = domingo) son de Guatemala.
 */
function ultimoProgramado(config, ahora = new Date()) {
  const local = new Date(ahora.getTime() - DESFASE_GT_MS);
  let momento = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), config.hora) + DESFASE_GT_MS;
  if (momento > ahora.getTime()) momento -= MS_DIA;
  if (config.frecuencia === 'semanal') {
    const dia = new Date(momento - DESFASE_GT_MS).getUTCDay();
    momento -= ((dia - config.diaSemana + 7) % 7) * MS_DIA;
  }
  return new Date(momento);
}

/**
 * Si toca hacer el respaldo automatico: hay un momento programado que ya
 * paso y no se ha intentado desde entonces. Un intento fallido no se repite
 * cada pocos minutos; el error queda a la vista y se reintenta en el
 * siguiente horario.
 */
function tocaRespaldo(config, ahora = new Date()) {
  if (!config?.automatico) return false;
  const programado = ultimoProgramado(config, ahora);
  return !config.ultimoIntentoEn || new Date(config.ultimoIntentoEn) < programado;
}

/** Siguiente momento programado, para mostrarlo en la pantalla. */
function proximoProgramado(config, ahora = new Date()) {
  if (!config?.automatico) return null;
  const paso = config.frecuencia === 'semanal' ? 7 * MS_DIA : MS_DIA;
  return new Date(ultimoProgramado(config, ahora).getTime() + paso);
}

/**
 * Variables de conexion para pg_dump. Se pasan por entorno y no en la linea
 * de comandos, para que la contrasena no aparezca en la lista de procesos.
 * La URL de Prisma puede traer parametros (schema, connection_limit) que
 * pg_dump no entiende; de ella solo se toma lo que libpq conoce.
 */
function entornoConexion(url = databaseUrl) {
  const u = new URL(url);
  const entorno = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  const ssl = u.searchParams.get('sslmode');
  if (ssl) entorno.PGSSLMODE = ssl;
  return entorno;
}

function ejecutarPgDump(argumentos) {
  return new Promise((resolver, rechazar) => {
    let errores = '';
    let proceso;
    try {
      proceso = spawn(PG_DUMP, argumentos, { env: { ...process.env, ...entornoConexion() }, windowsHide: true });
    } catch (error) {
      rechazar(error);
      return;
    }
    proceso.stderr.on('data', (d) => { errores += d; });
    proceso.on('error', (error) => {
      rechazar(error.code === 'ENOENT'
        ? new Error('No se encontró pg_dump en el servidor. Instale las herramientas de PostgreSQL o indique su ruta en PG_DUMP')
        : error);
    });
    proceso.on('close', (codigo) => {
      if (codigo === 0) resolver();
      else rechazar(new Error(errores.trim().split('\n').pop() || `pg_dump terminó con código ${codigo}`));
    });
  });
}

let enCurso = null;

/**
 * Hace un respaldo y devuelve su nombre. Se escribe primero a un archivo
 * temporal: un respaldo cortado a medias nunca aparece en la lista.
 * Si ya hay uno en curso, se espera ese en vez de lanzar otro.
 */
async function crearRespaldo(origen = 'manual') {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    await fs.promises.mkdir(CARPETA, { recursive: true });
    const nombre = nombreRespaldo(origen);
    const destino = path.join(CARPETA, nombre);
    const temporal = `${destino}.parcial`;
    try {
      await ejecutarPgDump([
        '--format=plain',
        '--encoding=UTF8',
        // Se puede restaurar sobre una base existente y con otro usuario.
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        `--file=${temporal}`,
      ]);
      await fs.promises.rename(temporal, destino);
    } catch (error) {
      await fs.promises.rm(temporal, { force: true });
      throw error;
    }
    return nombre;
  })();
  try {
    return await enCurso;
  } finally {
    enCurso = null;
  }
}

async function listarRespaldos() {
  let nombres;
  try {
    nombres = await fs.promises.readdir(CARPETA);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const lista = await Promise.all(
    nombres.filter((n) => PATRON_NOMBRE.test(n)).map(async (nombre) => {
      const info = await fs.promises.stat(path.join(CARPETA, nombre));
      return {
        nombre,
        origen: nombre.endsWith('_automatico.sql') ? 'automatico' : 'manual',
        bytes: info.size,
        creadoEn: info.mtime,
      };
    }),
  );
  return lista.sort((a, b) => b.creadoEn - a.creadoEn);
}

/** Borra los respaldos que pasan del numero a conservar, los mas viejos primero. */
async function aplicarConservacion(conservar) {
  const lista = await listarRespaldos();
  const sobran = lista.slice(conservar);
  await Promise.all(sobran.map((r) => fs.promises.rm(path.join(CARPETA, r.nombre), { force: true })));
  return sobran.map((r) => r.nombre);
}

module.exports = {
  CARPETA,
  PATRON_NOMBRE,
  nombreRespaldo,
  rutaDe,
  ultimoProgramado,
  tocaRespaldo,
  proximoProgramado,
  entornoConexion,
  crearRespaldo,
  listarRespaldos,
  aplicarConservacion,
};
