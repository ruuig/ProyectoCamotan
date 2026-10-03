/**
 * Revisa la continuidad de los reportes importados: el saldo anterior de un
 * servicio en un mes debe ser el saldo siguiente del mes previo. Sirve para
 * detectar columnas del Excel que venian de libros vinculados desactualizados.
 *
 *   node scripts/continuidadReportes.js
 */
require('dotenv').config();
const prisma = require('../src/config/db');

function previo(p) {
  const [a, m] = p.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

(async () => {
  const reportes = await prisma.reporteServicio.findMany({
    include: { renglones: true, ubicacion: { select: { nombre: true } } },
  });
  const saldo = new Map();
  for (const r of reportes) for (const x of r.renglones) saldo.set(`${r.ubicacionId}|${r.periodo}|${x.insumoId}`, x.saldoSiguiente);

  const porServicio = new Map();
  for (const r of reportes) {
    const fila = porServicio.get(r.ubicacion.nombre) ?? { revisados: 0, distintos: 0, meses: new Map() };
    for (const x of r.renglones) {
      const antes = saldo.get(`${r.ubicacionId}|${previo(r.periodo)}|${x.insumoId}`);
      if (antes === undefined) continue;
      fila.revisados += 1;
      if (antes !== x.saldoAnterior) {
        fila.distintos += 1;
        fila.meses.set(r.periodo, (fila.meses.get(r.periodo) ?? 0) + 1);
      }
    }
    porServicio.set(r.ubicacion.nombre, fila);
  }
  const lista = [...porServicio.entries()].sort((a, b) => b[1].distintos - a[1].distintos);
  for (const [nombre, f] of lista) {
    const meses = [...f.meses.entries()].sort().map(([p, n]) => `${p}:${n}`).join(' ');
    console.log(`${nombre.padEnd(36)} ${String(f.distintos).padStart(5)} de ${String(f.revisados).padStart(5)}  ${meses}`);
  }
  await prisma.$disconnect();
})();
