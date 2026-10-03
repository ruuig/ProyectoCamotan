const prisma = require('../config/db');

async function listar(req, res) {
  const { pagina, limite, usuarioId, entidad, accion } = req.query;

  // La bitacora es por establecimiento: un admin no ve la de otro centro.
  const filtro = {
    usuario: { establecimientoId: req.usuario.establecimientoId },
    ...(usuarioId ? { usuarioId } : {}),
    ...(entidad ? { entidad } : {}),
    ...(accion ? { accion } : {}),
  };

  const [total, registros] = await Promise.all([
    prisma.bitacora.count({ where: filtro }),
    prisma.bitacora.findMany({
      where: filtro,
      orderBy: { registradaEn: 'desc' },
      skip: (pagina - 1) * limite,
      take: limite,
      include: { usuario: { select: { usuario: true, nombre: true, rol: true } } },
    }),
  ]);

  // Leer la bitacora tambien queda registrado en la bitacora.
  await req.bitacora({ accion: 'leer', entidad: 'bitacora' });

  res.json({
    registros,
    paginacion: { pagina, limite, total, paginas: Math.ceil(total / limite) },
  });
}

module.exports = { listar };
