import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  Z_MINIMO,
  Z_MAXIMO,
  edadLegible,
  zFueraDeRango,
  valorEsperado,
  rangoPlausible,
  sugerirIntercambio,
  evaluarPlausibilidad,
} = require('../src/services/plausibilidad.service');

// Tablas minimas con la forma que entrega la base: x, l, m, s.
// Valores de la OMS para nino varon a los 24 meses.
const PESO_EDAD = [
  { x: 23, l: -0.3521, m: 11.9514, s: 0.12619 },
  { x: 24, l: -0.3583, m: 12.1515, s: 0.12683 },
  { x: 25, l: -0.3644, m: 12.3502, s: 0.12746 },
];

const TALLA_EDAD = [
  { x: 23, l: 1, m: 86.4153, s: 0.03608 },
  { x: 24, l: 1, m: 87.1161, s: 0.03637 },
  { x: 25, l: 1, m: 87.9720, s: 0.03664 },
];

const REFERENCIAS = { pesoEdad: PESO_EDAD, tallaEdad: TALLA_EDAD };

describe('edadLegible', () => {
  it('usa meses en menores de un año', () => {
    expect(edadLegible(0)).toBe('0 mes');
    expect(edadLegible(7)).toBe('7 meses');
  });

  it('usa años desde los doce meses', () => {
    expect(edadLegible(12)).toBe('1 año');
    expect(edadLegible(24)).toBe('2 años');
    expect(edadLegible(35)).toBe('2 años');
  });
});

describe('zFueraDeRango', () => {
  it('acepta lo que cae dentro del rango de la OMS', () => {
    expect(zFueraDeRango(0)).toBe(false);
    expect(zFueraDeRango(-4.9)).toBe(false);
    expect(zFueraDeRango(Z_MAXIMO)).toBe(false);
    expect(zFueraDeRango(Z_MINIMO)).toBe(false);
  });

  it('marca lo que se sale', () => {
    expect(zFueraDeRango(5.1)).toBe(true);
    expect(zFueraDeRango(-7)).toBe(true);
  });

  it('un puntaje ausente no es improbable, solo no calculable', () => {
    expect(zFueraDeRango(null)).toBe(false);
    expect(zFueraDeRango(undefined)).toBe(false);
  });
});

describe('valorEsperado', () => {
  it('devuelve la mediana cuando el puntaje Z es cero', () => {
    expect(valorEsperado(PESO_EDAD, 24, 0)).toBeCloseTo(12.1515, 3);
  });

  it('crece con el puntaje Z', () => {
    const bajo = valorEsperado(PESO_EDAD, 24, -2);
    const alto = valorEsperado(PESO_EDAD, 24, 2);
    expect(alto).toBeGreaterThan(bajo);
  });

  it('devuelve null sin tablas para esa edad', () => {
    expect(valorEsperado(PESO_EDAD, 200, 0)).toBeNull();
  });
});

describe('rangoPlausible', () => {
  it('encierra la mediana', () => {
    const rango = rangoPlausible(PESO_EDAD, 24);
    expect(rango.min).toBeLessThan(12.15);
    expect(rango.max).toBeGreaterThan(12.15);
  });

  it('deja 60 kg fuera del rango de un niño de dos años', () => {
    // Es el caso que motivo esta validacion.
    const rango = rangoPlausible(PESO_EDAD, 24);
    expect(60).toBeGreaterThan(rango.max);
  });

  it('devuelve null sin referencias', () => {
    expect(rangoPlausible([], 24)).toBeNull();
    expect(rangoPlausible(null, 24)).toBeNull();
  });
});

describe('sugerirIntercambio', () => {
  const rangoPeso = { min: 7, max: 20 };
  const rangoTalla = { min: 75, max: 100 };

  it('detecta peso y talla cruzados', () => {
    // 87 kg cae en el rango de talla y 12 cm en el de peso: estan al reves.
    expect(sugerirIntercambio({ peso: 87, talla: 12, rangoPeso, rangoTalla })).toBe(true);
  });

  it('no lo sugiere cuando solo un valor esta mal', () => {
    expect(sugerirIntercambio({ peso: 60, talla: 87, rangoPeso, rangoTalla })).toBe(false);
  });

  it('no lo sugiere sin rangos', () => {
    expect(sugerirIntercambio({ peso: 87, talla: 12, rangoPeso: null, rangoTalla })).toBe(false);
  });
});

describe('evaluarPlausibilidad', () => {
  it('acepta una medicion normal', () => {
    const r = evaluarPlausibilidad({
      edadMeses: 24,
      peso: 12.2,
      talla: 87,
      puntajes: { pesoEdad: 0.1, tallaEdad: -0.2 },
      referencias: REFERENCIAS,
    });

    expect(r.plausible).toBe(true);
    expect(r.avisos).toHaveLength(0);
  });

  it('rechaza 60 kg en un niño de dos años y lo dice en su idioma', () => {
    const r = evaluarPlausibilidad({
      edadMeses: 24,
      peso: 60,
      talla: 87,
      referencias: REFERENCIAS,
    });

    expect(r.plausible).toBe(false);
    const aviso = r.avisos.find((a) => a.campo === 'peso');
    expect(aviso.mensaje).toContain('60 kg');
    expect(aviso.mensaje).toContain('2 años');
  });

  it('sugiere revisar el cruce de campos cuando peso y talla estan al reves', () => {
    const r = evaluarPlausibilidad({
      edadMeses: 24,
      peso: 87,
      talla: 12.2,
      referencias: REFERENCIAS,
    });

    expect(r.plausible).toBe(false);
    expect(r.avisos.some((a) => a.campo === 'intercambio')).toBe(true);
  });

  it('marca un puntaje Z fuera del rango de la OMS aunque el valor parezca posible', () => {
    const r = evaluarPlausibilidad({
      edadMeses: 24,
      peso: 12,
      talla: 87,
      puntajes: { pesoTalla: 6.4 },
      referencias: REFERENCIAS,
    });

    expect(r.plausible).toBe(false);
    expect(r.avisos.some((a) => a.campo === 'pesoTalla')).toBe(true);
  });

  it('usa el limite absoluto cuando no hay tablas para esa edad', () => {
    // Persona adulta: sin tablas OMS, pero 900 kg sigue siendo imposible.
    const r = evaluarPlausibilidad({ edadMeses: 480, peso: 900, referencias: {} });

    expect(r.plausible).toBe(false);
    expect(r.avisos[0].mensaje).toContain('fuera de lo posible');
  });

  it('no inventa avisos cuando no hay tablas y el valor es razonable', () => {
    const r = evaluarPlausibilidad({ edadMeses: 480, peso: 70, talla: 165, referencias: {} });

    expect(r.plausible).toBe(true);
  });

  it('ignora los campos que no se midieron', () => {
    const r = evaluarPlausibilidad({ edadMeses: 24, peso: 12.2, referencias: REFERENCIAS });

    expect(r.plausible).toBe(true);
  });
});
