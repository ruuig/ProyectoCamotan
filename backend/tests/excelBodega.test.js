import { describe, it, expect } from 'vitest';
import { filaBres, semaforoBodega } from '../src/services/bodega.service.js';
import { conciliarLotes } from '../src/services/importacionBodega.service.js';

/**
 * Las cuentas de la bodega contra los Excel del centro, con renglones copiados
 * tal cual de documentacion/Plantillas. Si una fórmula del sistema se aparta
 * de la del Excel, esta prueba lo dice sin necesitar la base de datos.
 *
 * La comparación completa (todas las celdas, todos los meses) la hacen
 * scripts/verificarBalance.js, scripts/verificarBres.js y
 * scripts/verificarSemaforo.js contra la base cargada.
 */

const CENTRO = { nivelMinimoMeses: 2, nivelMaximoMeses: 4, formulaPedido: 'centro' };

// BRES SEPTIEMBRE2026IMP.xlsx, hojas No.1 a No.4: B..J escritos, K = H/J, L = J*4, M = L-I.
const BRES_SEPTIEMBRE_2026 = [
  { nombre: 'Acetaminofén 100mg/1mf Frasco Gotero', B: 4193, C: 612, D: 742, E: 0, H: 4063, I: 2291, J: 766 },
  { nombre: 'Acetaminofén  500mg. Tableta', B: 129670, C: 35000, D: 21864, E: 0, H: 142806, I: 89300, J: 26632 },
  { nombre: 'Albendazol 200mg/5ml. Susp fco', B: 4971, C: 1482, D: 1035, E: 9, H: 5418, I: 3437, J: 1084 },
  { nombre: 'Acido Acetilsalicílico  100mg, tableta', B: 2240, C: 100, D: 230, E: 0, H: 2110, I: 1000, J: 223 },
  { nombre: 'Dicloxacilina sódica 500mg tableta', B: 5513, C: 0, D: 1984, E: 0, H: 3529, I: 500, J: 1914 },
  { nombre: 'Claritromicina granulado, 125mg/5ml Fco.', B: 0, C: 0, D: 0, E: 0, H: 0, I: 0, J: 0 },
];

describe('BRES: las fórmulas del sistema dan lo mismo que el Excel', () => {
  for (const x of BRES_SEPTIEMBRE_2026) {
    it(x.nombre.trim(), () => {
      // H del Excel = saldos de los servicios + existencia de bodega; J = suma de promedios.
      const fila = filaBres({ B: x.B, C: x.C, D: x.D, E: x.E, I: x.I, saldos: [x.H - x.I], promedios: [x.J], config: CENTRO });
      expect(fila.F).toBe(x.D + x.E); // F = D + E
      expect(fila.H).toBe(x.H);
      expect(fila.J).toBe(x.J);
      expect(fila.K).toBe(x.J ? x.H / x.J : null); // K = H / J (el Excel muestra #DIV/0!)
      expect(fila.L).toBe(x.J * 4); // L = J * 4
      expect(fila.M).toBe(x.J * 4 - x.I); // M = L - I, negativo si sobra, como el Excel
    });
  }

  it('la cantidad a pedir del acetaminofén gotero es 773, la que muestra Existencias', () => {
    const x = BRES_SEPTIEMBRE_2026[0];
    expect(filaBres({ ...x, saldos: [x.H - x.I], promedios: [x.J], config: CENTRO }).M).toBe(773);
  });

  it('con la fórmula del MSPAS se resta el saldo del municipio, no la bodega', () => {
    const x = BRES_SEPTIEMBRE_2026[0];
    const fila = filaBres({ ...x, saldos: [x.H - x.I], promedios: [x.J], config: { ...CENTRO, formulaPedido: 'mspas' } });
    expect(fila.M).toBe(766 * 4 - 4063);
  });
});

describe('Semáforo: la regla automática contra la hoja del Excel', () => {
  // SEMAFORO - Julio 2029.xlsx (de septiembre de 2025). Lotes donde la hoja a mano coincide con la regla.
  const CORTE = new Date('2025-09-01T12:00:00Z');
  const casos = [
    ['Azitromicina 500 mg tableta · 230643', '2026-06-01', 'rojo'],
    ['Cloranfenicol oftálmico · FH711', '2026-09-01', 'rojo'],
    ['Ceftriaxona 1 gramo vial · 758231107', '2026-10-01', 'amarillo'],
    ['Acetaminofén 500 mg · PRA178', '2028-08-01', 'verde'],
    ['Aguja descartable No. 21 G · 20221005', '2029-10-01', 'verde'],
  ];
  for (const [nombre, vence, color] of casos) {
    it(`${nombre} → ${color}`, () => {
      expect(semaforoBodega(new Date(`${vence}T12:00:00Z`), CORTE)).toBe(color);
    });
  }

  it('el Excel tenía en "Rojo" un lote que vence en 17 meses: el sistema lo pone amarillo', () => {
    // Acetaminofén gotero, lote 10275, vence 02/2027: estaba en la hoja Rojo.
    expect(semaforoBodega(new Date('2027-02-01T12:00:00Z'), CORTE)).toBe('amarillo');
  });
});

describe('Carga de lotes: la existencia se reparte del vencimiento más lejano al más cercano', () => {
  it('lo que vence primero se da por despachado (PEPE) y las fechas imposibles se descartan', () => {
    const r = conciliarLotes([
      { lote: 'A', vence: '2026-03', cantidad: 300 },
      { lote: 'B', vence: '2027-08', cantidad: 500 },
      { lote: 'C', vence: '1930-05', cantidad: 50 },
    ], 600);
    expect(r.lotes).toEqual([
      { lote: 'A', vence: '2026-03', cantidad: 100 },
      { lote: 'B', vence: '2027-08', cantidad: 500 },
    ]);
    expect(r.descartados.map((d) => d.lote)).toEqual(['C']);
    expect(r.sinLote).toBe(0);
  });
});
