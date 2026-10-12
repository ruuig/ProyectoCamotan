/**
 * Tiempo de registro y de consulta de fichas (objetivo 1 de la tesis).
 *
 * registro: desde que se empieza a escribir el nombre o el CUI hasta que el
 *   paciente queda registrado.
 * consulta: desde que se empieza a escribir en la busqueda hasta que se da
 *   clic en el paciente.
 * Lo envia la pantalla sola, sin que el personal haga nada.
 */

const prisma = require('../config/db');

// Mas de 15 minutos es una pantalla que se quedo abierta, no un registro.
const LIMITE_MS = 15 * 60000;

const mediana = (lista) => {
  if (!lista.length) return null;
  const o = [...lista].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
};

async function registrar(req, res) {
  await prisma.medicionTiempo.create({
    data: {
      establecimientoId: req.usuario.establecimientoId,
      usuarioId: req.usuario.id,
      tipo: req.body.tipo,
      pantalla: req.body.pantalla ?? null,
      milisegundos: req.body.milisegundos,
      pacienteId: req.body.pacienteId ?? null,
    },
  });
  res.status(201).json({ ok: true });
}

function resumirTipo(filas) {
  const validas = filas.filter((f) => f.milisegundos <= LIMITE_MS).map((f) => f.milisegundos);
  return {
    mediciones: filas.length,
    validas: validas.length,
    descartadas: filas.length - validas.length,
    medianaSeg: validas.length ? Math.round(mediana(validas) / 100) / 10 : null,
    promedioSeg: validas.length ? Math.round(validas.reduce((s, v) => s + v, 0) / validas.length / 100) / 10 : null,
    minimoSeg: validas.length ? Math.round(Math.min(...validas) / 100) / 10 : null,
    maximoSeg: validas.length ? Math.round(Math.max(...validas) / 100) / 10 : null,
  };
}

async function resumen(req, res) {
  const filas = await prisma.medicionTiempo.findMany({
    where: { establecimientoId: req.usuario.establecimientoId },
    orderBy: { registradaEn: 'desc' },
    take: 5000,
    include: {
      usuario: { select: { nombre: true } },
      paciente: { select: { expediente: true, expedientePapel: true } },
    },
  });

  // Por dia, para ver si el tiempo baja con la practica.
  const porDia = new Map();
  for (const f of filas) {
    const dia = new Date(f.registradaEn.getTime() - 6 * 3600000).toISOString().slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, { registro: [], consulta: [] });
    porDia.get(dia)[f.tipo].push(f);
  }

  res.json({
    limiteSeg: LIMITE_MS / 1000,
    registro: resumirTipo(filas.filter((f) => f.tipo === 'registro')),
    consulta: resumirTipo(filas.filter((f) => f.tipo === 'consulta')),
    dias: [...porDia.entries()].map(([dia, t]) => ({ dia, registro: resumirTipo(t.registro), consulta: resumirTipo(t.consulta) })),
    ultimas: filas.slice(0, 100).map((f) => ({
      id: f.id,
      registradaEn: f.registradaEn,
      tipo: f.tipo,
      pantalla: f.pantalla,
      segundos: Math.round(f.milisegundos / 100) / 10,
      usuario: f.usuario.nombre,
      expediente: f.paciente ? (f.paciente.expedientePapel || f.paciente.expediente) : null,
      valida: f.milisegundos <= LIMITE_MS,
    })),
  });
}

module.exports = { registrar, resumen, mediana };
