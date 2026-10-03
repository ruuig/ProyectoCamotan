const prisma = require('../config/db');
const { parsearCsvLugares, sinAcentos } = require('../services/csvLugares.service');
const { parsearCsvCie10, ordenarResultados } = require('../services/hojaEvolucion.service');
const { normalizarTexto } = require('../services/pacientes.service');

/**
 * Todos los catalogos del formulario FOR-SIGSA-3CS, agrupados por nombre.
 *
 * Se entregan juntos y de una sola vez: son pocos, casi nunca cambian y el
 * formulario de paciente los necesita todos para mostrar u ocultar campos
 * segun la edad.
 */
async function listar(req, res) {
  const filas = await prisma.catalogoSigsa.findMany({
    where: { activo: true, ...(req.query.catalogo ? { catalogo: req.query.catalogo } : {}) },
    orderBy: [{ catalogo: 'asc' }, { orden: 'asc' }],
    select: { catalogo: true, codigo: true, etiqueta: true },
  });

  const catalogos = {};
  for (const fila of filas) {
    if (!catalogos[fila.catalogo]) catalogos[fila.catalogo] = [];
    catalogos[fila.catalogo].push({ codigo: fila.codigo, etiqueta: fila.etiqueta });
  }

  res.json({ catalogos });
}

/**
 * Lugares poblados del establecimiento, para el selector con busqueda.
 */
async function lugares(req, res) {
  const { buscar } = req.query;

  const lista = await prisma.lugarPoblado.findMany({
    where: {
      establecimientoId: req.usuario.establecimientoId,
      activo: true,
      ...(buscar ? { nombre: { contains: buscar, mode: 'insensitive' } } : {}),
    },
    orderBy: { nombre: 'asc' },
  });

  res.json({ lugares: lista });
}

/**
 * Guarda el tiempo de viaje de varios lugares a la vez (por ejemplo, todos
 * los caserios de una aldea). null deja el lugar sin dato.
 */
async function guardarTiempos(req, res) {
  const establecimientoId = req.usuario.establecimientoId;
  const ids = req.body.tiempos.map((t) => t.id);
  const propios = new Set((await prisma.lugarPoblado.findMany({ where: { establecimientoId, id: { in: ids } }, select: { id: true } })).map((l) => l.id));
  const validos = req.body.tiempos.filter((t) => propios.has(t.id));
  await prisma.$transaction(validos.map((t) => prisma.lugarPoblado.update({ where: { id: t.id }, data: { tiempoViajeMinutos: t.minutos } })));
  await req.bitacora({
    accion: 'actualizar',
    entidad: 'lugar_poblado',
    detalle: `Tiempo de viaje de ${validos.length} lugar(es): ${validos.slice(0, 5).map((t) => `#${t.id}=${t.minutos ?? 'sin dato'} min`).join(', ')}${validos.length > 5 ? '…' : ''}`,
  });
  res.json({ actualizados: validos.length });
}

async function crearLugar(req, res, next) {
  const { nombre, categoria, territorio, sector } = req.body;

  // La comparacion ignora tildes y mayusculas: "El Volcan" y "El Volcán" son
  // el mismo lugar, y guardarlos por separado parte la lista de pacientes.
  const todos = await prisma.lugarPoblado.findMany({
    where: { establecimientoId: req.usuario.establecimientoId },
    select: { id: true, nombre: true, sector: true },
  });

  const clave = (l) => `${sinAcentos(l.nombre)}|${sinAcentos(l.sector ?? '')}`;
  const existente = todos.find((l) => clave(l) === clave({ nombre, sector }));

  if (existente) {
    return next({
      status: 409,
      codigo: 'lugar_duplicado',
      mensaje: existente.sector
        ? `Ya existe "${existente.nombre}" en ${existente.sector}`
        : `Ya existe un lugar poblado llamado "${existente.nombre}"`,
    });
  }

  const lugar = await prisma.lugarPoblado.create({
    data: {
      establecimientoId: req.usuario.establecimientoId,
      nombre,
      categoria,
      territorio: territorio ?? null,
      sector: sector ?? null,
    },
  });

  await req.bitacora({
    accion: 'crear',
    entidad: 'lugar_poblado',
    entidadId: lugar.id,
    detalle: `${nombre} (${categoria})`,
  });

  res.status(201).json({ lugar });
}

/**
 * Carga masiva por CSV.
 *
 * Lo que ya existe se actualiza y lo nuevo se agrega: el archivo es la fuente
 * de verdad del municipio, pero no borra lo que el sistema ya usa, porque hay
 * pacientes apuntando a esos nombres.
 */
async function importarLugares(req, res, next) {
  const { csv } = req.body;
  const { filas, errores } = parsearCsvLugares(csv);

  if (filas.length === 0) {
    return next({
      status: 400,
      codigo: 'csv_sin_filas',
      mensaje: errores[0]?.mensaje ?? 'El archivo no tiene filas válidas',
      detalles: errores,
    });
  }

  const establecimientoId = req.usuario.establecimientoId;
  let creados = 0;
  let actualizados = 0;
  const renombrados = [];

  // Se comparan sin tildes ni mayusculas: si el sembrado dice "El Volcan" y el
  // archivo oficial dice "El Volcán", es el mismo lugar. Se adopta la
  // escritura del archivo, que es la que manda.
  const existentes = await prisma.lugarPoblado.findMany({
    where: { establecimientoId },
    select: { id: true, nombre: true, sector: true },
  });

  const clave = (l) => `${sinAcentos(l.nombre)}|${sinAcentos(l.sector ?? '')}`;
  const porNombre = new Map(existentes.map((l) => [clave(l), l]));

  for (const fila of filas) {
    const existente = porNombre.get(clave(fila));

    if (existente) {
      await prisma.lugarPoblado.update({
        where: { id: existente.id },
        data: {
          nombre: fila.nombre,
          categoria: fila.categoria,
          territorio: fila.territorio,
          sector: fila.sector,
          activo: true,
        },
      });
      if (existente.nombre !== fila.nombre) {
        renombrados.push({ antes: existente.nombre, ahora: fila.nombre });
      }
      actualizados += 1;
    } else {
      const creado = await prisma.lugarPoblado.create({
        data: { establecimientoId, ...fila },
      });
      porNombre.set(clave(creado), creado);
      creados += 1;
    }
  }

  await req.bitacora({
    accion: 'actualizar',
    entidad: 'lugar_poblado',
    detalle: `Carga por CSV: ${creados} creados, ${actualizados} actualizados, `
      + `${errores.length} con error, ${renombrados.length} con la escritura corregida`,
  });

  res.json({
    creados,
    actualizados,
    renombrados,
    errores,
    mensaje: `${creados} lugar(es) creado(s) y ${actualizados} actualizado(s)`,
  });
}

/**
 * Buscador de diagnosticos para la consulta.
 *
 * Junta dos fuentes: el catalogo CIE-10 (codigo, descripcion y sinonimos),
 * cuando se haya cargado, y los diagnosticos que ya se escribieron en el
 * centro, con cuantas veces se usaron. Asi sirve desde el primer dia, aunque
 * el catalogo oficial todavia no este.
 */
async function buscarCie10(req, res) {
  const q = req.query.q.trim();
  const contiene = { contains: q, mode: 'insensitive' };

  const [catalogo, usados, totalCatalogo] = await Promise.all([
    prisma.cie10.findMany({
      where: { activo: true, OR: [{ codigo: { startsWith: q.toUpperCase() } }, { descripcion: contiene }, { sinonimos: contiene }] },
      take: 30,
    }),
    prisma.diagnosticoAtencion.groupBy({
      by: ['cie', 'descripcion'],
      where: {
        atencion: { establecimientoId: req.usuario.establecimientoId },
        OR: [{ cie: { startsWith: q.toUpperCase() } }, { descripcion: contiene }],
      },
      _count: { _all: true },
      orderBy: { _count: { cie: 'desc' } },
      take: 30,
    }),
    prisma.cie10.count(),
  ]);

  // Lo usado en el centro se agrupa por codigo (o por texto, si no tiene).
  const frecuentes = new Map();
  for (const u of usados) {
    const clave = u.cie ?? `texto:${normalizarTexto(u.descripcion)}`;
    const previo = frecuentes.get(clave);
    if (previo) previo.usos += u._count._all;
    else frecuentes.set(clave, { codigo: u.cie, descripcion: u.descripcion, usos: u._count._all, frecuente: true });
  }

  const delCatalogo = catalogo.map((c) => ({
    codigo: c.codigo,
    descripcion: c.descripcion,
    sinonimos: c.sinonimos,
    usos: [...frecuentes.values()].find((f) => f.codigo === c.codigo)?.usos ?? 0,
  }));
  const codigosCatalogo = new Set(delCatalogo.map((c) => c.codigo));
  const soloFrecuentes = [...frecuentes.values()].filter((f) => !f.codigo || !codigosCatalogo.has(f.codigo));

  res.json({
    resultados: ordenarResultados([...delCatalogo, ...soloFrecuentes], q).slice(0, 20),
    catalogoCargado: totalCatalogo > 0,
  });
}

/** Carga o actualiza el catalogo CIE-10 desde un CSV. */
async function importarCie10(req, res, next) {
  const { filas, errores } = parsearCsvCie10(req.body.csv);
  if (filas.length === 0) {
    return next({
      status: 400,
      codigo: 'csv_sin_filas',
      mensaje: errores[0]?.mensaje ?? 'El archivo no tiene filas válidas',
      detalles: errores,
    });
  }

  const existentes = new Set((await prisma.cie10.findMany({ select: { codigo: true } })).map((c) => c.codigo));
  await prisma.$transaction(async (tx) => {
    const nuevos = filas.filter((f) => !existentes.has(f.codigo));
    if (nuevos.length) await tx.cie10.createMany({ data: nuevos });
    for (const f of filas.filter((x) => existentes.has(x.codigo))) {
      await tx.cie10.update({ where: { codigo: f.codigo }, data: { descripcion: f.descripcion, sinonimos: f.sinonimos, activo: true } });
    }
  }, { timeout: 120000 });

  const creados = filas.filter((f) => !existentes.has(f.codigo)).length;
  await req.bitacora({
    accion: 'crear',
    entidad: 'cie10',
    detalle: `Catálogo CIE-10 cargado: ${creados} nuevos, ${filas.length - creados} actualizados, ${errores.length} líneas con error`,
  });

  res.json({ creados, actualizados: filas.length - creados, errores });
}

module.exports = { listar, lugares, guardarTiempos, crearLugar, importarLugares, buscarCie10, importarCie10 };
