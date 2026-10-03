import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DIGITOS,
  formatearExpediente,
  leerExpediente,
} = require('../src/services/expediente.service');

describe('formatearExpediente', () => {
  it('rellena con ceros hasta cinco digitos', () => {
    expect(formatearExpediente(2026, 123)).toBe('2026-00123');
    expect(formatearExpediente(2026, 1)).toBe('2026-00001');
  });

  it('no recorta cuando el correlativo supera los cinco digitos', () => {
    // Antes de perder un numero, se prefiere un expediente mas largo.
    expect(formatearExpediente(2026, 123456)).toBe('2026-123456');
  });

  it('usa el anio que recibe, no el del reloj', () => {
    expect(formatearExpediente(2025, 7)).toBe('2025-00007');
  });

  it('mantiene la cantidad de digitos declarada', () => {
    expect(formatearExpediente(2026, 1)).toHaveLength(4 + 1 + DIGITOS);
  });
});

describe('leerExpediente', () => {
  it('separa anio y correlativo', () => {
    expect(leerExpediente('2026-00123')).toEqual({ anio: 2026, correlativo: 123 });
  });

  it('ignora espacios alrededor', () => {
    expect(leerExpediente('  2026-00001  ')).toEqual({ anio: 2026, correlativo: 1 });
  });

  it('devuelve null para un expediente de papel', () => {
    // Los numeros viejos no siguen el formato y deben distinguirse.
    expect(leerExpediente('35191-8cx5')).toBeNull();
  });

  it('devuelve null para texto vacio o ausente', () => {
    expect(leerExpediente('')).toBeNull();
    expect(leerExpediente(null)).toBeNull();
    expect(leerExpediente(undefined)).toBeNull();
  });

  it('rechaza un correlativo con menos de cinco digitos', () => {
    expect(leerExpediente('2026-123')).toBeNull();
  });
});
