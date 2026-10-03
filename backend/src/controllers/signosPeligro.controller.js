const prisma = require('../config/db');

async function listar(req, res) {
  const signos = await prisma.signoPeligro.findMany({
    where: { establecimientoId: req.usuario.establecimientoId, activo: true },
    orderBy: [{ orden: 'asc' }, { codigo: 'asc' }],
    select: {
      id: true,
      codigo: true,
      descripcion: true,
      grupoEtario: true,
      gravedadSugerida: true,
      orden: true,
    },
  });

  res.json({ signos });
}

module.exports = { listar };
