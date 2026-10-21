import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { unidadDesdeNombre } = require('../src/utils/unidadDesdeNombre');
const { periodoDelPedido } = require('../src/services/bodegaDatos.service');

describe('unidad de un insumo según su nombre', () => {
  it.each([
    ['Acetaminofén 500mg. Tableta', 'tableta'],
    ['Acetaminofén 100mg/1mf Frasco Gotero', 'frasco'],
    ['Amoxicilina 250mg/5ml Susp. Fco 120ml', 'frasco'],
    ['Amoxicilina capsulas 500mg.', 'cápsula'],
    ['Agua Estéril (trideslida) 100 ml, vial/ampolla', 'vial'],
    ['Dexametasona Ampolla 4mg', 'ampolla'],
    ['Sales de rehidratación oral sobre de 20.5gr.', 'sobre'],
    ['Permetrina crema 5 %, tubo', 'tubo'],
    ['Alcohol Etílico al 70%, galón', 'galón'],
    ['Guante quirúrgico No. 7 par', 'par'],
    ['Cloruro Sodio Sol. Iny. 0.90% 1000 ml bolsa', 'bolsa'],
    ['Esparadrapo de Seda impermeable, 1 pulgada, rollo', 'rollo'],
    ['Comprimidos compuestos 1ra. Fase TB', 'tableta'],
  ])('%s → %s', (nombre, unidad) => {
    expect(unidadDesdeNombre(nombre)).toBe(unidad);
  });

  it('el objeto mismo y lo que dice «unidad» se cuentan por unidad', () => {
    expect(unidadDesdeNombre('Bolsas rojas para biologicos, 20x30 pulgadas')).toBe('unidad');
    expect(unidadDesdeNombre('Tubos al vacío (vacutainer) de 3 ml')).toBe('unidad');
    expect(unidadDesdeNombre('Frascos para muestras de orina')).toBe('unidad');
    expect(unidadDesdeNombre('Bolsa roja No. 4 para bioinfecciosos, unidad')).toBe('unidad');
    expect(unidadDesdeNombre('Equipo p/Venoclisis, cámara transparente de 20 gotas')).toBe('unidad');
    expect(unidadDesdeNombre('Micronebulizador pediátrico (Mascarilla y tubo conector)')).toBe('unidad');
    expect(unidadDesdeNombre('Aguja descartable No. 21 G')).toBe('unidad');
  });
});

describe('BRES con que se pide a la DDRISS', () => {
  // Guatemala está en UTC-6: el mediodía local son las 18:00 UTC.
  const dia = (fecha) => new Date(`${fecha}T18:00:00Z`);
  it('antes del día de corte es el mes anterior, el último cerrado', () => {
    expect(periodoDelPedido(25, dia('2026-10-20'))).toBe('2026-09');
    expect(periodoDelPedido(25, dia('2026-01-10'))).toBe('2025-12');
  });
  it('desde el día de corte es el mes en curso', () => {
    expect(periodoDelPedido(25, dia('2026-10-25'))).toBe('2026-10');
    expect(periodoDelPedido(25, dia('2026-10-31'))).toBe('2026-10');
  });
});
