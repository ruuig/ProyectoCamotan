/**
 * Compara el semaforo del centro (Excel, clasificado a mano) con los lotes del
 * sistema y con la regla automatica (rojo < 12 meses, amarillo 12-18, verde > 18).
 *
 *   python scripts/leerSemaforoExcel.py "<SEMAFORO.xlsx>" <semaforo.json>
 *   node scripts/verificarSemaforo.js <semaforo.json> <fecha del Excel AAAA-MM-DD>
 */
const path = require('node:path');
if (require.main === module) require('dotenv').config({ quiet: true });
const prisma = require('../src/config/db');

(async () => {
  const [archivo, fecha] = process.argv.slice(2);
  const excel = require(path.resolve(archivo));
  const corte = new Date(`${fecha}T12:00:00Z`);
  const lotes = await prisma.lote.findMany({ where: { insumo: { establecimientoId: 1 } }, select: { numeroLote: true, fechaVence: true, insumo: { select: { nombreGenerico: true } } } });
  const porNumero = new Map();
  for (const l of lotes) {
    const k = l.numeroLote.trim().toUpperCase();
    if (!porNumero.has(k)) porNumero.set(k, []);
    porNumero.get(k).push(l);
  }
  // Regla del sistema: rojo < 12 meses, amarillo 12-18, verde > 18 (rangos del centro).
  const meses = (v) => (new Date(`${v}T12:00:00Z`) - corte) / (30.4375 * 86400000);
  const regla = (v) => { const m = meses(v); if (m < 0) return 'vencido'; if (m < 12) return 'rojo'; if (m <= 18) return 'amarillo'; return 'verde'; };

  let enSistema = 0; let mismaFecha = 0; const noEstan = []; const otraFecha = []; const imposibles = [];
  const matriz = {};
  for (const e of excel) {
    const c = porNumero.get(e.lote.toUpperCase()) ?? [];
    if (c.length) enSistema += 1; else noEstan.push(`${e.nombre} · lote ${e.lote}`);
    if (c.some((l) => l.fechaVence && l.fechaVence.toISOString().slice(0, 7) === (e.vence ?? '').slice(0, 7))) mismaFecha += 1;
    else if (c.length) otraFecha.push(`${e.nombre} · lote ${e.lote} · Excel ${e.vence} · sistema ${c.map((l) => l.fechaVence?.toISOString().slice(0, 10)).join('/')}`);
    if (!e.vence || e.vence < '2000') { imposibles.push(`${e.nombre} · lote ${e.lote} · ${e.vence}`); continue; }
    const r = regla(e.vence);
    matriz[e.color] ??= {};
    matriz[e.color][r] = (matriz[e.color][r] ?? 0) + 1;
  }
  console.log(`Lotes del Excel: ${excel.length} · en el sistema: ${enSistema} · con la misma fecha: ${mismaFecha}`);
  console.log('No están en el sistema:', noEstan.length, noEstan.slice(0, 8));
  console.log('Con otra fecha en el sistema:', otraFecha.length, otraFecha.slice(0, 8));
  console.log('Fechas imposibles en el Excel:', imposibles);
  console.log(`Hoja del Excel (filas) contra la regla automática al ${fecha} (columnas):`);
  console.table(matriz);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
