import { describe, it, expect } from 'vitest';
import { renglonesSigsa4, constanciaDe, diaLocal } from '../src/services/sigsa4.service.js';

const paciente = { nombres: 'Odilia', apellidos: 'Agustín', cui: '1234567890101', expediente: '2023-01051', expedientePapel: 'A-133' };
const atencion = (constancias = []) => ({
  id: 7,
  diagnosticoCie: 'J00',
  diagnosticoTxt: 'Rinofaringitis aguda',
  medico: { nombre: 'Médico de Prueba' },
  paciente,
  constancias,
});

describe('SIGSA-4: renglones', () => {
  it('un renglón por medicamento, con lo entregado y lo no entregado', () => {
    const r = renglonesSigsa4([{
      id: 1,
      insumo: { nombreGenerico: 'Acetaminofén 500 mg', presentacion: 'tableta' },
      dispensaciones: [
        { cantidad: 6, anulada: false, registradaEn: '2026-10-05T16:00:00Z' },
        { cantidad: 4, anulada: false, registradaEn: '2026-10-05T16:05:00Z' },
        { cantidad: 9, anulada: true, registradaEn: '2026-10-05T16:06:00Z' },
      ],
      demandaNoAtendida: [{ cantidad: 2, registradaEn: '2026-10-05T16:00:00Z' }],
      atencion: atencion(),
    }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      orden: 1,
      dia: 5,
      paciente: 'Odilia Agustín',
      cui: '1234567890101',
      responsableConsulta: 'Médico de Prueba',
      historiaClinica: 'A-133',
      cie: 'J00',
      medicamento: 'Acetaminofén 500 mg',
      presentacion: 'tableta',
      entregado: 10,
      noEntregado: 2,
      constancia: null,
    });
  });

  it('lo que no se pudo entregar en absoluto también va, con 0 entregado', () => {
    const r = renglonesSigsa4([{
      id: 2,
      insumo: { nombreGenerico: 'Amoxicilina', presentacion: 'cápsula' },
      dispensaciones: [],
      demandaNoAtendida: [{ cantidad: 21, registradaEn: '2026-10-06T15:00:00Z' }],
      atencion: atencion(),
    }]);
    expect(r[0]).toMatchObject({ entregado: 0, noEntregado: 21, dia: 6 });
  });

  it('ordena por fecha y numera', () => {
    const base = { insumo: { nombreGenerico: 'X', presentacion: '' }, demandaNoAtendida: [], atencion: atencion() };
    const r = renglonesSigsa4([
      { ...base, id: 1, dispensaciones: [{ cantidad: 1, anulada: false, registradaEn: '2026-10-09T15:00:00Z' }] },
      { ...base, id: 2, dispensaciones: [{ cantidad: 1, anulada: false, registradaEn: '2026-10-02T15:00:00Z' }] },
    ]);
    expect(r.map((x) => [x.orden, x.prescripcionId])).toEqual([[1, 2], [2, 1]]);
  });

  it('la constancia que vale es la primera tomada después de la última entrega', () => {
    const constancias = [
      { id: 1, registradaEn: '2026-10-05T15:00:00Z' },
      { id: 3, registradaEn: '2026-10-05T17:00:00Z' },
      { id: 2, registradaEn: '2026-10-05T16:10:00Z' },
    ];
    expect(constanciaDe('2026-10-05T16:05:00Z', constancias).id).toBe(2);
    expect(constanciaDe('2026-10-05T18:00:00Z', constancias)).toBeNull();
  });

  it('el día es el de Guatemala, no el de UTC', () => {
    // 5 de octubre a las 23:30 en Guatemala = 6 de octubre 05:30 UTC.
    expect(diaLocal('2026-10-06T05:30:00Z')).toBe(5);
  });
});
