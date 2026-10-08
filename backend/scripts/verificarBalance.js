/**
 * Compara, celda por celda, el balance que muestra el sistema con el balance
 * del centro en Excel.
 *
 *   python scripts/leerBalanceExcel.py <BALANCE.xlsx> <INVENTARIOS CIERRE.xlsx> <excel.json>
 *   node scripts/verificarBalance.js <excel.json> [diferencias.csv]
 *
 * Para cada mes del Excel se pide el balance al servicio del sistema (el
 * mismo que usan la pantalla, la hoja impresa y el Excel exportado) y se
 * compara cada insumo en cada columna: los seis valores de cada servicio,
 * post-consulta, la bodega y los totales B a M. El insumo se reconoce por su
 * nombre o por sus alias, igual que en la importacion, porque en el Excel una
 * misma fila cambia de insumo entre meses.
 *
 * Termina con codigo 1 si hay alguna diferencia.
 */

if (require.main === module) require('dotenv').config();
const fs = require('node:fs');
const prisma = require('../src/config/db');
const datos = require('../src/services/bodegaDatos.service');
const { emparejarServicio } = require('../src/services/importacionBodega.service');
const { normalizarAlias } = require('../src/services/bodega.service');


const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
// Una celda vacia del Excel es un cero en el sistema; un error (#DIV/0!) es "sin dato".
const delExcel = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string' && v.startsWith('#')) return null;
  return v;
};

/** Iguales al mostrarse: los enteros exactos, los decimales a dos cifras. */
function iguales(excel, sistema) {
  const e = delExcel(excel);
  if (e === null) return sistema === null || sistema === undefined;
  if (!esNumero(e)) return false;
  if (!esNumero(sistema)) return false;
  return Math.abs(e - sistema) < 0.005 + 1e-9;
}

/** Compara cada mes leido del Excel con el balance del sistema. */
async function verificar({ meses, eid }) {
  const [insumos, alias, ubicaciones] = await Promise.all([
    prisma.insumo.findMany({ where: { establecimientoId: eid }, select: { id: true, nombreGenerico: true } }),
    prisma.insumoAlias.findMany({ where: { insumo: { establecimientoId: eid } }, select: { insumoId: true, aliasNormalizado: true } }),
    prisma.ubicacion.findMany({ where: { establecimientoId: eid } }),
  ]);
  const insumoDe = new Map();
  for (const a of alias) insumoDe.set(a.aliasNormalizado, a.insumoId);
  for (const i of insumos) insumoDe.set(normalizarAlias(i.nombreGenerico), i.id);

  const diferencias = [];
  const cuenta = new Map(); // campo -> { iguales, distintas }
  const anotar = (campo, ok) => {
    const c = cuenta.get(campo) ?? { iguales: 0, distintas: 0 };
    if (ok) c.iguales += 1; else c.distintas += 1;
    cuenta.set(campo, c);
  };
  const sinInsumo = [];
  const erroresExcel = [];
  const repetidos = [];

  for (const mes of meses) {
    const balance = await datos.balance(eid, mes.periodo);
    const fila = new Map(balance.filas.map((f) => [f.insumoId, f]));
    const vistos = new Map();

    for (const r of mes.renglones) {
      const insumoId = insumoDe.get(normalizarAlias(r.nombre));
      if (!insumoId) { sinInsumo.push([mes.periodo, r.fila, r.nombre]); continue; }
      if (vistos.has(insumoId)) { repetidos.push([mes.periodo, r.fila, vistos.get(insumoId), r.nombre]); continue; }
      vistos.set(insumoId, r.fila);
      const f = fila.get(insumoId);
      const comparar = (campo, excel, sistema) => {
        // El Excel muestra un error o un texto donde va un numero: no hay cifra con que comparar.
        if (typeof excel === 'string' && !excel.startsWith('#DIV') && excel !== 'sí') {
          erroresExcel.push([mes.periodo, r.fila, r.nombre, campo, excel, sistema ?? '']);
          return;
        }
        const ok = iguales(excel, sistema);
        anotar(campo, ok);
        if (!ok) diferencias.push([mes.periodo, r.fila, r.nombre, campo, excel ?? '', sistema ?? '', r.reconstruidos.includes(campo.split('.').pop()) ? 'reconstruido' : '']);
      };
      if (!f) { comparar('insumo en el balance', 'sí', null); continue; }

      for (const s of r.servicios) {
        const u = emparejarServicio(s.servicio, ubicaciones);
        const esPost = u?.tipo === 'centro_salud';
        const col = esPost ? f.postConsulta : f.servicios.find((c) => c.ubicacionId === u?.id);
        const prefijo = esPost ? 'post-consulta' : 'servicio';
        if (!col) { comparar(`${prefijo}: columna`, s.servicio, null); continue; }
        for (const campo of ['saldoAnterior', 'entradas', 'entregado', 'noEntregado', 'saldoSiguiente', 'promedio']) {
          comparar(`${prefijo}.${campo}`, s[campo], col[campo]);
        }
      }

      const t = r.totales;
      comparar('bodega.mesAnterior', t.mesAnterior, f.bodega.saldoAnterior);
      comparar('bodega.entradas', t.C, f.bodega.entradas);
      comparar('bodega.existencia', t.I, f.bodega.saldoSiguiente);
      for (const k of ['B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'M']) comparar(`totales.${k}`, t[k], f.bres[k]);
      comparar('totales.saldoPorDemanda', t.saldoPorDemanda, f.bres.saldoPorDemanda);
    }
  }

  const total = [...cuenta.values()].reduce((s, c) => s + c.distintas, 0);
  return { total, cuenta, diferencias, sinInsumo, repetidos, erroresExcel };
}

function informar({ total, cuenta, diferencias, sinInsumo, repetidos, erroresExcel }, rutaCsv) {
  console.log('Campo                              iguales  distintas');
  for (const [campo, c] of [...cuenta].sort()) {
    console.log(`${campo.padEnd(34)} ${String(c.iguales).padStart(7)} ${String(c.distintas).padStart(10)}`);
  }
  console.log(`\nRenglones del Excel sin insumo en el sistema: ${sinInsumo.length}`);
  for (const x of sinInsumo.slice(0, 20)) console.log('  ', x.join(' | '));
  console.log(`Renglones repetidos (otro renglon del mismo mes ya es ese insumo): ${repetidos.length}`);
  for (const x of repetidos.slice(0, 20)) console.log('  ', x.join(' | '));
  console.log(`Celdas donde el propio Excel muestra un error o un texto (no se comparan): ${erroresExcel.length}`);
  for (const x of erroresExcel) console.log('  ', x.join(' | '));
  console.log(`\nDiferencias: ${total}`);
  if (rutaCsv) {
    const celda = (v) => {
      const t = String(v ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const filas = [['periodo', 'fila_excel', 'insumo', 'campo', 'excel', 'sistema', 'nota'], ...diferencias];
    fs.writeFileSync(rutaCsv, `\uFEFF${filas.map((f) => f.map(celda).join(',')).join('\n')}`);
    console.log(`Detalle en ${rutaCsv}`);
  }
}

module.exports = { verificar };

if (require.main === module) {
  const [, , rutaExcel, rutaCsv] = process.argv;
  (async () => {
    const establecimiento = await prisma.establecimiento.findFirst();
    const meses = JSON.parse(fs.readFileSync(rutaExcel, 'utf8'));
    const r = await verificar({ meses, eid: establecimiento.id });
    informar(r, rutaCsv);
    if (r.total > 0 || r.sinInsumo.length || r.repetidos.length) process.exitCode = 1;
  })()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
