import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  KG_POR_LIBRA,
  esUnidadValida,
  aKilogramos,
  desdeKilogramos,
  redondear,
  convertir,
  alternar,
  describir,
} = require('../src/services/unidadesPeso.service');

describe('aKilogramos', () => {
  it('convierte libras a kilogramos', () => {
    expect(aKilogramos(63, 'lb')).toBeCloseTo(28.576, 3);
  });

  it('en kilogramos no toca el valor', () => {
    expect(aKilogramos(28.5, 'kg')).toBe(28.5);
  });

  it('un campo vacio no es cero', () => {
    // Cero seria un peso valido y falso: la ausencia de dato no es un dato.
    expect(aKilogramos('', 'kg')).toBeNull();
    expect(aKilogramos(null, 'lb')).toBeNull();
  });

  it('lo que no es numero no se convierte', () => {
    expect(aKilogramos('abc', 'lb')).toBeNull();
  });
});

describe('desdeKilogramos', () => {
  it('convierte kilogramos a libras', () => {
    expect(desdeKilogramos(28.576, 'lb')).toBeCloseTo(63, 2);
  });

  it('ida y vuelta devuelve el mismo numero', () => {
    const original = 72.4;
    expect(desdeKilogramos(aKilogramos(original, 'lb'), 'lb')).toBeCloseTo(original, 6);
  });
});

describe('convertir', () => {
  it('el ejemplo de la especificacion: 63 lb son 28.58 kg', () => {
    expect(convertir(63, 'lb', 'kg')).toBe(28.58);
  });

  it('de kilogramos a libras redondea a una decima', () => {
    expect(convertir(28.58, 'kg', 'lb')).toBe(63);
  });

  it('a la misma unidad solo redondea', () => {
    expect(convertir(28.576, 'kg', 'kg')).toBe(28.58);
  });

  it('un campo vacio sigue vacio: no se inventa un cero', () => {
    expect(convertir('', 'lb', 'kg')).toBeNull();
  });

  it('el peso de un recien nacido conserva los gramos', () => {
    // 7.5 lb son 3.40 kg: perder el segundo decimal aqui mueve el puntaje Z.
    expect(convertir(7.5, 'lb', 'kg')).toBe(3.4);
  });

  it('rechaza una unidad que no existe', () => {
    expect(() => convertir(10, 'onzas', 'kg')).toThrow(/Unidad de peso desconocida/);
  });
});

describe('alternar', () => {
  it('cambia a la otra unidad', () => {
    expect(alternar('kg')).toBe('lb');
    expect(alternar('lb')).toBe('kg');
  });
});

describe('redondear', () => {
  it('kilogramos con dos decimales y libras con una', () => {
    expect(redondear(28.5765, 'kg')).toBe(28.58);
    expect(redondear(63.049, 'lb')).toBe(63);
  });
});

describe('describir', () => {
  it('capturado en kilogramos muestra solo kilogramos', () => {
    expect(describir(28.58, 'kg')).toBe('28.58 kg');
  });

  it('capturado en libras muestra la equivalencia para poder verificarlo', () => {
    expect(describir(28.576, 'lb')).toBe('28.58 kg (63 lb)');
  });

  it('sin peso no describe nada', () => {
    expect(describir(null)).toBe('');
  });
});

describe('esUnidadValida', () => {
  it('solo acepta kg y lb', () => {
    expect(esUnidadValida('kg')).toBe(true);
    expect(esUnidadValida('lb')).toBe(true);
    expect(esUnidadValida('g')).toBe(false);
  });
});

describe('el factor no se redondea', () => {
  it('usa la libra avoirdupois exacta', () => {
    // Redondear el factor a 0.4536 arrastra error a todo puntaje Z.
    expect(KG_POR_LIBRA).toBe(0.45359237);
  });
});
