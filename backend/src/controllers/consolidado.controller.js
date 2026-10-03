const { consolidadoDelMes } = require('../services/consolidado.service');
const { generarXlsx, nombreArchivo } = require('../services/exportarConsolidado.service');

async function obtener(req, res) {
  const consolidado = await consolidadoDelMes(req.usuario.establecimientoId, req.query.mes);

  await req.bitacora({
    accion: 'leer',
    entidad: 'consolidado',
    detalle: `Consolidado de ${consolidado.mes}`,
  });

  res.json(consolidado);
}

async function exportar(req, res) {
  const consolidado = await consolidadoDelMes(req.usuario.establecimientoId, req.query.mes);
  const buffer = await generarXlsx(consolidado);

  // Exportar es una accion sensible: se lleva datos fuera del sistema.
  await req.bitacora({
    accion: 'exportar',
    entidad: 'consolidado',
    detalle: `Consolidado de ${consolidado.mes} exportado a XLSX`,
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(consolidado)}"`);
  res.send(Buffer.from(buffer));
}

module.exports = { obtener, exportar };
