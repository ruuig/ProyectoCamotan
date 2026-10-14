/**
 * Importa el catálogo CIE-10 completo de la OPS desde el JSON oficial.
 *
 *   node scripts/importarCie10.js [ruta del json]
 *
 * Por defecto lee src/utils/cie10_guatemala.json. Se puede correr las veces que
 * haga falta: actualiza lo que ya está y conserva los sinónimos locales
 * ("dolor de cabeza", "calentura"...) que se hayan escrito para cada código.
 */
require('dotenv').config();
const path = require('path');
const prisma = require('../src/config/db');
const { legible } = require('../src/services/cie10Texto.service');

const ruta = path.resolve(process.argv[2] ?? path.join(__dirname, '..', 'src', 'utils', 'cie10_guatemala.json'));

async function main() {
  const datos = require(ruta);
  const { capitulos, categorias, diagnosticos } = datos;
  if (!Array.isArray(capitulos) || !Array.isArray(categorias) || !Array.isArray(diagnosticos)) {
    throw new Error('El archivo no tiene capitulos, categorias y diagnosticos');
  }

  const filas = [
    ...categorias.map((c) => ({
      codigo: c.codigo, oficial: c.descripcion, categoria: c.codigo, capitulo: c.capitulo, nivel: 3, marca: c.marca, subcodigos: (c.subcodigos ?? 0) > 0,
    })),
    ...diagnosticos.map((d) => ({
      codigo: d.codigo, oficial: d.descripcion, categoria: d.categoria, capitulo: d.capitulo, nivel: d.nivel ?? d.codigo.replace('.', '').length, marca: d.marca, subcodigos: false,
    })),
  ];

  await prisma.$transaction(async (tx) => {
    for (const [orden, c] of capitulos.entries()) {
      await tx.cie10Capitulo.upsert({
        where: { numero: c.numero },
        create: { numero: c.numero, rango: c.rango, descripcion: legible(c.descripcion), orden },
        update: { rango: c.rango, descripcion: legible(c.descripcion), orden },
      });
    }

    // Un solo INSERT por bloque. Los sinónimos no se tocan: son locales.
    for (let i = 0; i < filas.length; i += 1000) {
      const bloque = filas.slice(i, i + 1000);
      await tx.$executeRaw`
        INSERT INTO cie10 (codigo, descripcion, descripcion_oficial, categoria, capitulo, nivel, marca, tiene_subcodigos, activo)
        SELECT * FROM UNNEST(
          ${bloque.map((f) => f.codigo)}::text[],
          ${bloque.map((f) => legible(f.oficial))}::text[],
          ${bloque.map((f) => f.oficial)}::text[],
          ${bloque.map((f) => f.categoria)}::text[],
          ${bloque.map((f) => f.capitulo)}::text[],
          ${bloque.map((f) => f.nivel)}::smallint[],
          ${bloque.map((f) => f.marca)}::text[],
          ${bloque.map((f) => f.subcodigos)}::boolean[],
          ${bloque.map(() => true)}::boolean[]
        )
        ON CONFLICT (codigo) DO UPDATE SET
          descripcion = EXCLUDED.descripcion,
          descripcion_oficial = EXCLUDED.descripcion_oficial,
          categoria = EXCLUDED.categoria,
          capitulo = EXCLUDED.capitulo,
          nivel = EXCLUDED.nivel,
          marca = EXCLUDED.marca,
          tiene_subcodigos = EXCLUDED.tiene_subcodigos,
          activo = true`;
    }
  }, { timeout: 120000 });

  const total = await prisma.cie10.count();
  const conSinonimos = await prisma.cie10.count({ where: { sinonimos: { not: null } } });
  const fuera = await prisma.cie10.findMany({ where: { descripcionOficial: null }, select: { codigo: true, descripcion: true } });
  console.log(`Capítulos: ${capitulos.length}. Códigos en el catálogo: ${total} (${conSinonimos} con sinónimos locales).`);
  if (fuera.length) console.log(`Fuera de la lista OPS (se conservan): ${fuera.map((f) => `${f.codigo} ${f.descripcion}`).join(' | ')}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e.message); process.exit(1); });
