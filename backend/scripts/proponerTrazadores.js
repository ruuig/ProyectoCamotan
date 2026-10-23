/**
 * Propone, para cada renglón de los formatos de trazadores, el producto del
 * catálogo que más se le parece (por palabras y números en común). Sirve para
 * llenar `catalogo` en src/data/trazadores.js; la propuesta se revisa a mano.
 *
 *   node scripts/proponerTrazadores.js > propuesta.tsv
 */
require('dotenv').config({ quiet: true });
const prisma = require('../src/config/db');
const { FORMATOS } = require('../src/data/trazadores');

const VACIAS = new Set(['de', 'la', 'el', 'y', 'con', 'para', 'sin', 'en', 'unidad', 'oral', 'tableta', 'capsula', 'frasco', 'vial', 'ampolla', 'solucion', 'inyectable', 'x', 'no', 'mg', 'ml', 'g', 'tubo', 'tarro']);
const palabras = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d)\s*(mg|ml|g|ui|fr)\b/g, '$1')
  .split(/[^a-z0-9.]+/).map((p) => p.replace(/^\.+|\.+$/g, '')).filter((p) => p && !VACIAS.has(p));

(async () => {
  const insumos = await prisma.insumo.findMany({ where: { establecimientoId: 1 }, select: { id: true, nombreGenerico: true, activo: true } });
  const fichas = insumos.map((i) => ({ ...i, p: new Set(palabras(i.nombreGenerico)) }));
  for (const [clave, f] of Object.entries(FORMATOS)) {
    for (const s of f.secciones) {
      s.renglones.forEach((ren, n) => {
        if (!ren.texto || ren.texto === '-') return;
        const p = palabras(ren.texto);
        const numeros = p.filter((x) => /\d/.test(x));
        const puntaje = (i) => {
          const comunes = p.filter((x) => i.p.has(x)).length;
          const numFaltan = numeros.filter((x) => !i.p.has(x)).length;
          return comunes - numFaltan * 0.8 + (i.activo ? 0.1 : 0);
        };
        const top = fichas.map((i) => ({ i, s: puntaje(i) })).sort((a, b) => b.s - a.s).slice(0, 2);
        console.log([clave, s.titulo.slice(0, 12), n + 1, ren.texto, ...top.map((t) => `${t.i.nombreGenerico} [${t.s.toFixed(1)}]${t.i.activo ? '' : ' (inactivo)'}`)].join('\t'));
      });
    }
  }
  await prisma.$disconnect();
})();
