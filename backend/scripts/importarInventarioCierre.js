/**
 * Carga el historial del inventario de cierre de la bodega (Excel
 * INVENTARIOS CIERRE del centro) para los meses anteriores al sistema.
 *
 *   python scripts/extraerInventarioCierre.py "../documentacion/Plantillas/INVENTARIOS CIERRE 2019.xlsx" <cierre.json>
 *   node scripts/importarInventarioCierre.js <cierre.json>             (solo revisa)
 *   node scripts/importarInventarioCierre.js <cierre.json> --aplicar   (escribe)
 *
 * Cada nombre del Excel se empareja con el catalogo: primero por sus alias,
 * luego por las equivalencias escritas a mano y al final por parecido. Los
 * que no se emparejan se reportan en documentacion/bd/importacion/cierre/ y no se cargan.
 * Los valores se guardan tal como estan en el Excel, aunque no sumen.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../src/config/db');
const ib = require('../src/services/importacionBodega.service');
const { normalizarAlias } = require('../src/services/bodega.service');
const { partirLinea } = require('../src/services/csvLugares.service');

const [, , rutaDatos, bandera] = process.argv;
const APLICAR = bandera === '--aplicar';
const CARPETA = path.join(__dirname, '..', '..', 'documentacion', 'bd', 'importacion', 'cierre');

function csv(filas) {
  const celda = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return String.fromCharCode(0xFEFF) + filas.map((f) => f.map(celda).join(',')).join(String.fromCharCode(10));
}

async function main() {
  const meses = JSON.parse(fs.readFileSync(rutaDatos, 'utf8'));
  const est = await prisma.establecimiento.findFirst();
  const eid = est.id;

  // El historial llega hasta el mes de la carga inicial; desde ahi manda el sistema.
  const primerMovimiento = await prisma.movimientoInsumo.findFirst({
    where: { lote: { insumo: { establecimientoId: eid } } },
    orderBy: { registradoEn: 'asc' },
    select: { registradoEn: true },
  });
  const local = new Date(new Date(primerMovimiento.registradoEn).getTime() - 6 * 3600000);
  const ultimoHistorico = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;

  const insumos = await prisma.insumo.findMany({ where: { establecimientoId: eid }, select: { id: true, nombreGenerico: true } });
  const catalogo = insumos.map((i) => ({ clave: i.id, nombre: i.nombreGenerico }));
  const alias = await prisma.insumoAlias.findMany({ where: { insumo: { establecimientoId: eid } } });
  const porAlias = new Map(alias.map((a) => [a.aliasNormalizado, a.insumoId]));
  for (const i of insumos) porAlias.set(normalizarAlias(i.nombreGenerico), i.id);

  const rutaEquivalencias = path.join(__dirname, '..', '..', 'documentacion', 'Plantillas', 'equivalencias.csv');
  const equivalencias = fs.existsSync(rutaEquivalencias)
    ? fs.readFileSync(rutaEquivalencias, 'utf8').replace(String.fromCharCode(0xFEFF), '').split(String.fromCharCode(10))
      .map((l) => l.trim()).slice(1).filter(Boolean).map((l) => partirLinea(l))
      .map(([nombreExcel, nombreCatalogo]) => ({ nombreExcel, nombreCatalogo }))
    : [];

  const cache = new Map();
  function insumoDe(nombre) {
    if (cache.has(nombre)) return cache.get(nombre);
    let r = null;
    const exacto = porAlias.get(normalizarAlias(nombre));
    if (exacto) r = { id: exacto, metodo: 'alias' };
    if (!r) {
      const e = ib.aplicarEquivalencias(nombre, equivalencias, catalogo) ?? ib.emparejar(nombre, catalogo);
      if (e) r = { id: e.clave, metodo: e.metodo };
    }
    cache.set(nombre, r);
    return r;
  }

  const filas = [];
  const sinEmparejar = new Map();
  const repetidos = [];
  const metodos = {};
  for (const m of meses.filter((x) => x.periodo <= ultimoHistorico)) {
    const vistos = new Set();
    for (const r of m.renglones) {
      const i = insumoDe(r.nombre);
      if (!i) {
        sinEmparejar.set(r.nombre, (sinEmparejar.get(r.nombre) ?? 0) + 1);
        continue;
      }
      if (vistos.has(i.id)) {
        repetidos.push([m.periodo, r.nombre]);
        continue;
      }
      vistos.add(i.id);
      metodos[i.metodo] = (metodos[i.metodo] ?? 0) + 1;
      filas.push({
        establecimientoId: eid,
        periodo: m.periodo,
        insumoId: i.id,
        orden: r.orden,
        nombreOriginal: r.nombre,
        saldoAnterior: r.saldoAnterior,
        entradas: r.entradas,
        entregado: r.entregado,
        saldoActual: r.saldoActual,
      });
    }
  }

  fs.mkdirSync(CARPETA, { recursive: true });
  fs.writeFileSync(path.join(CARPETA, 'sin_emparejar.csv'), csv([['nombre_en_el_excel', 'meses'], ...[...sinEmparejar.entries()].sort((a, b) => b[1] - a[1])]));
  fs.writeFileSync(path.join(CARPETA, 'repetidos.csv'), csv([['periodo', 'nombre_en_el_excel'], ...repetidos]));

  const periodos = [...new Set(filas.map((f) => f.periodo))].sort();
  console.log(`Meses: ${periodos[0]} a ${periodos[periodos.length - 1]} (${periodos.length}), hasta la carga inicial ${ultimoHistorico}`);
  console.log(`Renglones a cargar: ${filas.length}`, metodos);
  console.log(`Nombres sin emparejar: ${sinEmparejar.size} (${[...sinEmparejar.values()].reduce((s, n) => s + n, 0)} renglones)`);
  console.log(`Renglones repetidos en un mismo mes: ${repetidos.length}`);

  if (!APLICAR) {
    console.log('Revisión sin cambios. Reportes en documentacion/bd/importacion/cierre/.');
    return;
  }
  const admin = await prisma.usuario.findFirst({ where: { establecimientoId: eid, rol: 'admin' } });
  await prisma.$transaction(async (tx) => {
    await tx.inventarioCierreHistorico.deleteMany({ where: { establecimientoId: eid } });
    await tx.inventarioCierreHistorico.createMany({ data: filas });
    await tx.bitacora.create({
      data: { usuarioId: admin.id, accion: 'crear', entidad: 'insumo', detalle: `Historial del inventario de cierre importado: ${periodos.length} meses, ${filas.length} renglones` },
    });
  }, { timeout: 600000 });
  console.log('Historial cargado.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
