import { describe, it, expect } from 'vitest';

const h = require('../src/services/hojaEvolucion.service');

describe('sugerirTipoConsulta', () => {
  const fecha = new Date('2026-10-02T15:00:00Z');

  it('primera consulta si no tuvo ese diagnóstico en el año', () => {
    expect(h.sugerirTipoConsulta({ cie: 'J06.9' }, [], fecha).valor).toBe(1);
  });

  it('reconsulta si ya tuvo la misma categoría este año', () => {
    const previos = [{ cie: 'J06.0', fecha: '2026-08-10T15:00:00Z' }];
    const r = h.sugerirTipoConsulta({ cie: 'J06.9' }, previos, fecha);
    expect(r.valor).toBe(2);
    expect(r.razon).toContain('J06');
  });

  it('lo del año pasado no cuenta: el SIGSA cuenta por año', () => {
    const previos = [{ cie: 'J06.9', fecha: '2025-12-20T15:00:00Z' }];
    expect(h.sugerirTipoConsulta({ cie: 'J06.9' }, previos, fecha).valor).toBe(1);
  });

  it('otro diagnóstico no cuenta', () => {
    const previos = [{ cie: 'A09', fecha: '2026-05-01T15:00:00Z' }];
    expect(h.sugerirTipoConsulta({ cie: 'J06.9' }, previos, fecha).valor).toBe(1);
  });

  it('sin código compara la descripción', () => {
    const previos = [{ cie: null, descripcion: 'Gastritis', fecha: '2026-05-01T15:00:00Z' }];
    expect(h.sugerirTipoConsulta({ descripcion: 'GASTRITIS' }, previos, fecha).valor).toBe(2);
  });
});

describe('diagnosticosDe', () => {
  it('acepta filas repetibles', () => {
    expect(h.diagnosticosDe({ diagnosticos: [{ descripcion: 'Faringitis', cie: 'J02.9' }, { descripcion: 'Anemia' }] }))
      .toEqual([{ descripcion: 'Faringitis', cie: 'J02.9' }, { descripcion: 'Anemia', cie: null }]);
  });

  it('acepta la forma anterior de un solo diagnóstico', () => {
    expect(h.diagnosticosDe({ diagnosticoTxt: 'Faringitis', diagnosticoCie: 'J02.9' }))
      .toEqual([{ descripcion: 'Faringitis', cie: 'J02.9' }]);
  });
});

describe('parsearCsvCie10', () => {
  it('lee código, descripción y sinónimos', () => {
    const { filas, errores } = h.parsearCsvCie10('codigo,descripcion,sinonimos\nJ00,Rinofaringitis aguda,catarro|resfriado\nA09;Diarrea y gastroenteritis');
    expect(errores).toEqual([]);
    expect(filas).toEqual([
      { codigo: 'J00', descripcion: 'Rinofaringitis aguda', sinonimos: 'catarro|resfriado' },
      { codigo: 'A09', descripcion: 'Diarrea y gastroenteritis', sinonimos: null },
    ]);
  });

  it('avisa los códigos inválidos y repetidos con su línea', () => {
    const { filas, errores } = h.parsearCsvCie10('J00,Rinofaringitis\nXX,Malo\nJ00,Otra vez');
    expect(filas).toHaveLength(1);
    expect(errores.map((e) => e.linea)).toEqual([2, 3]);
  });
});

describe('ordenarResultados', () => {
  it('primero lo que empieza con lo escrito, luego lo más usado', () => {
    const r = h.ordenarResultados([
      { codigo: 'K29.7', descripcion: 'Gastritis no especificada', usos: 3 },
      { codigo: 'A09', descripcion: 'Diarrea y gastroenteritis', usos: 50 },
    ], 'gastr');
    expect(r[0].codigo).toBe('K29.7');
  });

  it('busca también en los sinónimos', () => {
    const r = h.ordenarResultados([
      { codigo: 'A09', descripcion: 'Diarrea', usos: 1 },
      { codigo: 'J00', descripcion: 'Rinofaringitis aguda', sinonimos: 'catarro|resfriado', usos: 1 },
    ], 'catarro');
    expect(r[0].codigo).toBe('J00');
  });
});

describe('catálogos del 3CS', () => {
  it('usan los códigos del formulario', () => {
    expect(h.TIPO_CONSULTA.map((t) => t.valor)).toEqual([1, 2, 3, 4]);
    expect(h.CONTROL.find((c) => c.valor === 6).etiqueta).toBe('IVAA');
    expect(h.LUGAR_NOTIFICACION.map((l) => l.etiqueta)).toEqual(['No aplica', 'MP', 'PGN', 'PNC']);
  });
});
