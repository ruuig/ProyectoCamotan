import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import prisma from '../src/config/db.js';
import { cargarHistorial } from '../scripts/cargarHistorialBalance.js';
import { verificar } from '../scripts/verificarBalance.js';
import datos from '../src/services/bodegaDatos.service.js';

/**
 * Del Excel del balance al balance del sistema, de punta a punta: se arma un
 * balance pequeno con las trampas del real y se comprueba que el sistema
 * muestra exactamente lo que muestra Excel.
 *
 *   - El vinculo al inventario de cierre roto (=#REF!) en el segundo mes.
 *   - Un total escrito a mano encima de su formula.
 *   - Un promedio con decimales y una cantidad a solicitar negativa.
 *   - Un insumo que existe en un mes y luego desaparece.
 *   - Un titulo de seccion entre los insumos.
 */

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const hayPython = spawnSync(PYTHON, ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
const MARCA = `HB${Date.now()}`;
const AMOX = `QA Amoxicilina ${MARCA}`;
const RETIRADO = `QA Retirado ${MARCA}`;
const PERIODOS = ['2019-01', '2019-02'];

const CAMPOS = ['Saldo anterior', 'Entradas', 'Entregado', 'No entregado', 'Saldo siguiente', 'Promedio'];
const TOTALES = ['mes anterior', 'saldo anterior', 'Entradas', 'Entregado Usu', 'No entregado', 'demanda',
  'Saldo x demanda', 'saldo  siguiente', 'Exis Fisic', 'Promedio', 'meses exist', 'cantidad max', 'cantidad solicitar'];
// Columnas: post-consulta en C:H, Anicillo en I:N, totales desde O.
const POST = 3;
const ANICILLO = 9;
const T = 15;
const letra = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const col = (inicio, k) => letra(inicio + k);

function hojaBalance(libro, nombre, renglones, anterior) {
  const ws = libro.addWorksheet(nombre);
  ws.getCell(2, T + 10).value = 4; // nivel maximo, como GQ2
  ws.getCell(3, POST).value = 'POST CONSULTA';
  ws.getCell(3, ANICILLO).value = 'C/C ANICILLO';
  ws.getCell(3, T + 1).value = 'Totales';
  CAMPOS.forEach((c, k) => { ws.getCell(4, POST + k).value = c; ws.getCell(4, ANICILLO + k).value = c; });
  TOTALES.forEach((c, k) => { ws.getCell(4, T + k).value = c; });
  const nivel = `$${col(T, 10)}$2`;

  for (const r of renglones) {
    const f = r.fila;
    ws.getCell(f, 1).value = r.numero ?? null;
    ws.getCell(f, 2).value = r.nombre;
    if (r.titulo) continue;
    for (const [inicio, s] of [[POST, r.post], [ANICILLO, r.anicillo]]) {
      const c = (k) => `${col(inicio, k)}${f}`;
      ws.getCell(f, inicio).value = s.sa;
      ws.getCell(f, inicio + 1).value = s.en;
      ws.getCell(f, inicio + 2).value = s.ent;
      ws.getCell(f, inicio + 3).value = s.ne;
      ws.getCell(f, inicio + 4).value = { formula: `(${c(0)}+${c(1)})-${c(2)}`, result: s.sa + s.en - s.ent };
      ws.getCell(f, inicio + 5).value = s.prom;
    }
    const t = r.totales;
    const c = (k) => `${col(T, k)}${f}`;
    const valor = (k, formula, result) => {
      ws.getCell(f, T + k).value = t.aMano?.[k] !== undefined ? t.aMano[k] : { formula, result };
    };
    valor(0, anterior ? `'${anterior}'!${col(T, 8)}${f}` : 'X', t.mesAnterior);
    valor(1, anterior ? `'${anterior}'!${col(T, 7)}${f}` : 'X', t.B);
    valor(2, t.C.formula, t.C.result);
    valor(3, `${col(POST, 2)}${f}+${col(ANICILLO, 2)}${f}`, t.D);
    valor(4, `${col(POST, 3)}${f}+${col(ANICILLO, 3)}${f}`, t.E);
    valor(5, `${c(3)}+${c(4)}`, t.F);
    valor(6, `${c(1)}+${c(2)}-${c(3)}`, t.SxD);
    valor(7, `${col(POST, 4)}${f}+${col(ANICILLO, 4)}${f}+${c(8)}`, t.H);
    valor(8, t.I.formula, t.I.result);
    valor(9, `${col(POST, 5)}${f}+${col(ANICILLO, 5)}${f}`, t.J);
    valor(10, `${c(7)}/${c(9)}`, t.K);
    valor(11, `${c(9)}*${nivel}`, t.L);
    valor(12, `${c(11)}-${c(8)}`, t.M);
  }
  return ws;
}

async function armarLibros(carpeta) {
  const REF = { error: '#REF!' };
  const balance = new ExcelJS.Workbook();
  // Enero: sano. El saldo anterior del primer mes viene de otro libro: escrito.
  hojaBalance(balance, 'ENE19', [
    {
      fila: 5, numero: 1, nombre: AMOX,
      post: { sa: 100, en: 50, ent: 30, ne: 5, prom: 25.5 },
      anicillo: { sa: 40, en: 10, ent: 15, ne: 0, prom: 14 },
      totales: {
        aMano: { 0: 300, 1: 460 }, mesAnterior: 300, B: 460,
        C: { formula: '[2]Enero19!D3', result: 200 }, D: 45, E: 5, F: 50, SxD: 615,
        I: { formula: '[2]Enero19!F3', result: 400 }, H: 555, J: 39.5, K: 555 / 39.5, L: 158, M: -242,
      },
    },
    {
      fila: 6, numero: 2, nombre: RETIRADO,
      post: { sa: 5, en: 0, ent: 1, ne: 0, prom: 1 },
      anicillo: { sa: 0, en: 0, ent: 0, ne: 0, prom: 0 },
      // El entregado total esta escrito a mano encima de la formula.
      totales: {
        aMano: { 0: 0, 1: 5, 3: 999 }, mesAnterior: 0, B: 5,
        C: { formula: '[2]Enero19!D4', result: 0 }, D: 999, E: 0, F: 999, SxD: -994,
        I: { formula: '[2]Enero19!F4', result: 0 }, H: 4, J: 1, K: 4, L: 4, M: 4,
      },
    },
    { fila: 7, nombre: 'PLANIFICACION FAMILIAR', titulo: true },
  ]);
  // Febrero: el vinculo al cierre se rompio y todo lo que depende sale #REF!.
  hojaBalance(balance, 'FEB19', [
    {
      fila: 5, numero: 1, nombre: AMOX,
      post: { sa: 120, en: 0, ent: 20, ne: 0, prom: 20 },
      anicillo: { sa: 35, en: 0, ent: 10, ne: 2, prom: 12 },
      totales: {
        mesAnterior: 400, B: 555, C: { formula: '#REF!', result: REF }, D: 30, E: 2, F: 32, SxD: REF,
        I: { formula: '#REF!', result: REF }, H: REF, J: 32, K: REF, L: 128, M: REF,
      },
    },
    { fila: 7, nombre: 'PLANIFICACION FAMILIAR', titulo: true },
  ], 'ENE19');

  // Inventario de cierre: A numero, B insumo, C saldo anterior, D entradas,
  // E entregado, F saldo actual. El balance toma D y F dos filas mas arriba.
  const cierre = new ExcelJS.Workbook();
  const fila = (ws, n, valores) => valores.forEach((v, k) => { ws.getCell(n, k + 1).value = v; });
  const enero = cierre.addWorksheet('Enero19');
  fila(enero, 3, [1, AMOX, 0, 200, 0, 400]);
  fila(enero, 4, [2, RETIRADO, 0, 0, 0, 0]);
  const febrero = cierre.addWorksheet('Febrero19');
  fila(febrero, 3, [1, AMOX, 400, 60, 110, 350]);

  const rutaBalance = path.join(carpeta, 'BALANCE.xlsx');
  const rutaCierre = path.join(carpeta, 'CIERRE.xlsx');
  await balance.xlsx.writeFile(rutaBalance);
  await cierre.xlsx.writeFile(rutaCierre);
  return { rutaBalance, rutaCierre };
}

let carpeta;
let meses;
let eid;

async function limpiar() {
  const insumos = await prisma.insumo.findMany({ where: { nombreGenerico: { contains: MARCA } }, select: { id: true } });
  const ids = insumos.map((i) => i.id);
  await prisma.bresRenglon.deleteMany({ where: { insumoId: { in: ids } } });
  await prisma.bres.deleteMany({ where: { periodo: { in: PERIODOS }, observaciones: { startsWith: 'Importado' } } });
  await prisma.reporteServicio.deleteMany({ where: { periodo: { in: PERIODOS }, importado: true } });
  await prisma.insumoAlias.deleteMany({ where: { insumoId: { in: ids } } });
  await prisma.insumo.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!hayPython)('historial del balance: del Excel al sistema', () => {
  beforeAll(async () => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'balance-'));
    const { rutaBalance, rutaCierre } = await armarLibros(carpeta);
    const salida = path.join(carpeta, 'excel.json');
    const r = spawnSync(PYTHON, [path.join(__dirname, '..', 'scripts', 'leerBalanceExcel.py'), rutaBalance, rutaCierre, salida], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    meses = JSON.parse(fs.readFileSync(salida, 'utf8'));
    eid = (await prisma.establecimiento.findFirst()).id;
    await limpiar();
  }, 60000);

  afterAll(async () => {
    await limpiar();
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  it('el lector toma lo que muestra Excel: lo escrito a mano y sin los títulos', () => {
    const [enero] = meses;
    expect(enero.renglones.map((r) => r.nombre)).toEqual([AMOX, RETIRADO]);
    const retirado = enero.renglones.find((r) => r.nombre === RETIRADO);
    expect(retirado.totales.D).toBe(999);
    expect(retirado.totales.F).toBe(999);
    const amox = enero.renglones.find((r) => r.nombre === AMOX);
    expect(amox.servicios[0].promedio).toBe(25.5);
    expect(amox.totales.M).toBe(-242);
  });

  it('con el vínculo roto, C e I salen del cierre y lo demás de sus fórmulas', () => {
    const amox = meses[1].renglones[0].totales;
    expect(amox).toMatchObject({ C: 60, I: 350, H: 475, saldoPorDemanda: 585, M: -222, B: 555, mesAnterior: 400 });
    expect(amox.K).toBeCloseTo(475 / 32);
    expect(meses[1].renglones[0].reconstruidos).toEqual(expect.arrayContaining(['C', 'I', 'H', 'K', 'M', 'saldoPorDemanda']));
  });

  it('cargado al sistema, el balance coincide celda por celda', async () => {
    const r = await cargarHistorial({ meses, eid, aplicar: true, log: () => {} });
    expect(r.cargado).toBe(true);
    expect(r.nuevos).toEqual([AMOX, RETIRADO]);

    const v = await verificar({ meses, eid });
    expect(v.sinInsumo).toEqual([]);
    expect(v.diferencias).toEqual([]);
    expect(v.total).toBe(0);
  });

  it('el balance muestra decimales, negativos y lo escrito a mano tal cual', async () => {
    const enero = await datos.balance(eid, '2019-01');
    const amox = enero.filas.find((f) => f.nombre === AMOX);
    expect(amox.postConsulta).toMatchObject({ saldoAnterior: 100, entradas: 50, entregado: 30, saldoSiguiente: 120, promedio: 25.5 });
    expect(amox.bres).toMatchObject({ B: 460, H: 555, I: 400, J: 39.5, L: 158, M: -242, mesAnterior: 300, saldoPorDemanda: 615 });
    expect(enero.filas.find((f) => f.nombre === RETIRADO).bres.D).toBe(999);
  });

  it('un insumo que ya no se usa aparece en su mes y no en los siguientes', async () => {
    const enero = await datos.balance(eid, '2019-01');
    const febrero = await datos.balance(eid, '2019-02');
    const retirado = enero.filas.find((f) => f.nombre === RETIRADO);
    expect(retirado.activo).toBe(false);
    expect(febrero.filas.some((f) => f.nombre === RETIRADO)).toBe(false);
  });

  it('volver a cargar no duplica nada', async () => {
    const r = await cargarHistorial({ meses, eid, aplicar: true, log: () => {} });
    expect(r.nuevos).toEqual([]);
    const v = await verificar({ meses, eid });
    expect(v.total).toBe(0);
    expect(await prisma.insumo.count({ where: { nombreGenerico: { contains: MARCA } } })).toBe(2);
  });
});
