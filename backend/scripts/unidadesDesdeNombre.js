/**
 * Pone a cada insumo la unidad que dice su nombre (tableta, frasco, vial…).
 * Los insumos se importaron del Excel con «unidad» en todos, y así salía en la
 * requisición y en el BRES. Solo cambia los que todavía dicen «unidad»; las
 * cantidades no se tocan, porque ya estaban contadas en esa unidad.
 *
 *   node scripts/unidadesDesdeNombre.js            (muestra lo que cambiaría)
 *   node scripts/unidadesDesdeNombre.js --aplicar  (lo guarda)
 */
const { PrismaClient } = require('@prisma/client');
const { unidadDesdeNombre } = require('../src/utils/unidadDesdeNombre');

const prisma = new PrismaClient();
const aplicar = process.argv.includes('--aplicar');

async function main() {
  const insumos = await prisma.insumo.findMany({
    where: { unidadMedida: 'unidad', unidadEntrega: 'unidad' },
    select: { id: true, nombreGenerico: true },
    orderBy: { nombreGenerico: 'asc' },
  });
  const cambios = insumos
    .map((i) => ({ ...i, unidad: unidadDesdeNombre(i.nombreGenerico) }))
    .filter((i) => i.unidad !== 'unidad');
  for (const c of cambios) console.log(`${c.unidad.padEnd(10)} ${c.nombreGenerico}`);
  console.log(`\n${cambios.length} de ${insumos.length} insumos cambian de «unidad».`);
  if (!aplicar) {
    console.log('Nada se guardó. Para guardar: node scripts/unidadesDesdeNombre.js --aplicar');
    return;
  }
  await prisma.$transaction(cambios.map((c) => prisma.insumo.update({
    where: { id: c.id },
    data: { unidadMedida: c.unidad, unidadEntrega: c.unidad },
  })));
  // Los renglones de requisiciones ya hechas guardaron «unidad» al crearse.
  let renglones = 0;
  for (const c of cambios) {
    const r = await prisma.requisicionRenglon.updateMany({ where: { insumoId: c.id, unidadMedida: 'unidad' }, data: { unidadMedida: c.unidad } });
    renglones += r.count;
  }
  console.log(`Guardado. También se corrigieron ${renglones} renglones de requisiciones.`);
}

main().finally(() => prisma.$disconnect());
