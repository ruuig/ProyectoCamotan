/**
 * Compara el BRES impreso del centro (Excel) con el que calcula el sistema.
 *
 *   python scripts/leerBresExcel.py "<BRES.xlsx>" <bres.json>
 *   node scripts/verificarBres.js <bres.json> <periodo AAAA-MM>
 *
 * El insumo se reconoce por su nombre o sus alias. Septiembre 2026: 279 de
 * 296 renglones iguales; 3 distintos porque el Excel toma la fila equivocada
 * del balance, y 17 con el nombre roto (=[1]JUL25!B265).
 */
const path = require('node:path');
if (require.main === module) require('dotenv').config({ quiet: true });
const prisma = require('../src/config/db');
const bres = require('../src/services/bres.service');
const { normalizarAlias } = require('../src/services/bodega.service');

(async () => {
  const [archivo, periodo] = process.argv.slice(2);
  const excel = require(path.resolve(archivo));
  const eid = 1;
  const calc = await bres.calcular(eid, periodo);
  const filas = calc.filas ?? calc.renglones ?? calc;
  const [insumos, alias] = await Promise.all([
    prisma.insumo.findMany({ where: { establecimientoId: eid }, select: { id: true, nombreGenerico: true } }),
    prisma.insumoAlias.findMany({ where: { insumo: { establecimientoId: eid } }, select: { insumoId: true, aliasNormalizado: true } }),
  ]);
  const idDe = new Map();
  for (const a of alias) idDe.set(a.aliasNormalizado, a.insumoId);
  for (const i of insumos) idDe.set(normalizarAlias(i.nombreGenerico), i.id);
  const sis = new Map(filas.map((f) => [f.insumoId, f]));
  const MAPA = { B: 'saldoInicial', C: 'entradas', D: 'entregado', E: 'noEntregado', F: 'demandaReal', G: 'reajustes', H: 'saldoFinal', I: 'existenciaBodega', J: 'pmdr', K: 'med', L: 'cantidadMaxima', M: 'cantidadSolicitar' };
  const cuenta = {}; const dif = []; const sinPar = [];
  for (const e of excel) {
    const id = idDe.get(normalizarAlias(e.nombre));
    const s = id && sis.get(id);
    if (!s) { sinPar.push(e.nombre); continue; }
    for (const [col, campo] of Object.entries(MAPA)) {
      let ve = e[col]; let vs = s[campo];
      // M puede ser negativo en los dos: el formulario de pedido lo toma como cero.

      const iguales = (ve == null && (vs == null || vs === 0)) || (typeof ve === 'number' && typeof vs === 'number' && Math.abs(ve - vs) < 0.005 + 1e-9);
      cuenta[col] ??= { iguales: 0, distintas: 0 };
      cuenta[col][iguales ? 'iguales' : 'distintas'] += 1;
      if (!iguales) dif.push(`${e.hoja} | ${e.nombre} | ${col} | excel=${ve} | sistema=${vs}`);
    }
  }
  console.log('Renglones Excel:', excel.length, '· sistema:', filas.length);
  console.table(cuenta);
  console.log('Sin pareja en el sistema:', sinPar.length, sinPar.slice(0, 10));
  console.log('Diferencias:', dif.length);
  for (const d of dif.slice(0, 40)) console.log('  ', d);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
