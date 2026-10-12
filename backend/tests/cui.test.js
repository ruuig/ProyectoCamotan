import { describe, it, expect } from 'vitest';
import { analizarCui } from '../src/services/cui.service.js';

describe('CUI de RENAP', () => {
  it('acepta un CUI con su dígito verificador y dice dónde se inscribió', () => {
    expect(analizarCui('1234 56789 2005')).toEqual({ valido: true, departamento: 'Chiquimula', municipio: 'Camotán' });
  });

  it('de otros departamentos da solo el departamento', () => {
    expect(analizarCui('1234567890101')).toEqual({ valido: true, departamento: 'Guatemala', municipio: null });
  });

  it('rechaza un dígito verificador que no corresponde', () => {
    expect(analizarCui('1234567882005')).toEqual({ valido: false, motivo: 'verificador' });
  });

  it('rechaza departamento o municipio que no existen', () => {
    expect(analizarCui('1234567892305').motivo).toBe('departamento');
    expect(analizarCui('1234567892012').motivo).toBe('municipio');
  });

  it('incompleto no es error de validez', () => {
    expect(analizarCui('12345').motivo).toBe('incompleto');
  });
});
