import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  rangoPeriodo,
  etiquetaPeriodo,
  nombreAnterior,
  describirPeriodo,
} = require('../src/services/periodo.service');

// Guatemala esta en UTC-6. Un instante local se escribe sumando 6 horas.
const local = (texto) => new Date(`${texto}-06:00`);

describe('rangoPeriodo - semana', () => {
  it('empieza el lunes y dura siete dias', () => {
    // Martes 29 de septiembre de 2026, media manana.
    const r = rangoPeriodo('semana', local('2026-09-29T10:00:00'));
    expect(r.desde.toISOString()).toBe(local('2026-09-28T00:00:00').toISOString());
    expect(r.hasta.toISOString()).toBe(local('2026-10-05T00:00:00').toISOString());
  });

  it('el domingo cierra su semana, no abre la siguiente', () => {
    // Domingo 4 de octubre: pertenece a la semana que abrio el 28.
    const r = rangoPeriodo('semana', local('2026-10-04T23:00:00'));
    expect(r.desde.toISOString()).toBe(local('2026-09-28T00:00:00').toISOString());
  });

  it('el lunes abre su propia semana', () => {
    const r = rangoPeriodo('semana', local('2026-09-28T00:05:00'));
    expect(r.desde.toISOString()).toBe(local('2026-09-28T00:00:00').toISOString());
  });

  it('el periodo anterior es la semana previa completa y no se traslapa', () => {
    const r = rangoPeriodo('semana', local('2026-09-29T10:00:00'));
    expect(r.anterior.desde.toISOString()).toBe(local('2026-09-21T00:00:00').toISOString());
    expect(r.anterior.hasta.getTime()).toBe(r.desde.getTime());
  });

  it('una atencion de la noche cuenta en el dia local, no en el siguiente UTC', () => {
    // Domingo 4 a las 20:00 locales son las 02:00 UTC del lunes 5.
    const r = rangoPeriodo('semana', local('2026-10-04T20:00:00'));
    expect(r.desde.toISOString()).toBe(local('2026-09-28T00:00:00').toISOString());
    expect(r.hasta.toISOString()).toBe(local('2026-10-05T00:00:00').toISOString());
  });
});

describe('rangoPeriodo - mes', () => {
  it('va del primero al primero del siguiente', () => {
    const r = rangoPeriodo('mes', local('2026-09-29T10:00:00'));
    expect(r.desde.toISOString()).toBe(local('2026-09-01T00:00:00').toISOString());
    expect(r.hasta.toISOString()).toBe(local('2026-10-01T00:00:00').toISOString());
  });

  it('el mes anterior es el previo completo', () => {
    const r = rangoPeriodo('mes', local('2026-09-29T10:00:00'));
    expect(r.anterior.desde.toISOString()).toBe(local('2026-08-01T00:00:00').toISOString());
    expect(r.anterior.hasta.getTime()).toBe(r.desde.getTime());
  });

  it('en enero el mes anterior es diciembre del ano pasado', () => {
    const r = rangoPeriodo('mes', local('2026-01-15T10:00:00'));
    expect(r.anterior.desde.toISOString()).toBe(local('2025-12-01T00:00:00').toISOString());
  });

  it('febrero de un ano bisiesto cierra el primero de marzo', () => {
    const r = rangoPeriodo('mes', local('2028-02-10T10:00:00'));
    expect(r.hasta.toISOString()).toBe(local('2028-03-01T00:00:00').toISOString());
  });

  it('el primer dia del mes pertenece a ese mes', () => {
    const r = rangoPeriodo('mes', local('2026-09-01T00:10:00'));
    expect(r.desde.toISOString()).toBe(local('2026-09-01T00:00:00').toISOString());
  });
});

describe('rangoPeriodo - periodo invalido', () => {
  it('rechaza lo que no sea semana o mes', () => {
    expect(() => rangoPeriodo('anio')).toThrow(/Periodo desconocido/);
  });
});

describe('etiquetaPeriodo', () => {
  it('nombra la semana con el ultimo dia incluido, no con el limite', () => {
    // El rango cierra el 5 de octubre, pero la semana es del 28 al 4.
    expect(etiquetaPeriodo('semana', local('2026-09-29T10:00:00'))).toBe(
      'Semana del 28 de septiembre al 4 de octubre',
    );
  });

  it('no repite el mes cuando la semana cae dentro de uno solo', () => {
    // Semana del lunes 21 al domingo 27 de septiembre.
    expect(etiquetaPeriodo('semana', local('2026-09-23T10:00:00'))).toBe(
      'Semana del 21 al 27 de septiembre',
    );
  });

  it('nombra los dos meses cuando la semana los cruza', () => {
    const texto = etiquetaPeriodo('semana', local('2026-12-30T10:00:00'));
    expect(texto).toBe('Semana del 28 de diciembre al 3 de enero');
  });

  it('nombra el mes con mayuscula inicial y ano', () => {
    expect(etiquetaPeriodo('mes', local('2026-09-29T10:00:00'))).toBe('Septiembre de 2026');
  });
});

describe('nombreAnterior', () => {
  it('nombra el periodo con el que se compara', () => {
    expect(nombreAnterior('semana')).toBe('la semana anterior');
    expect(nombreAnterior('mes')).toBe('el mes anterior');
  });
});

describe('describirPeriodo', () => {
  it('reune rango, etiqueta y nombre del anterior', () => {
    const d = describirPeriodo('semana', local('2026-09-29T10:00:00'));
    expect(d.periodo).toBe('semana');
    expect(d.etiqueta).toBe('Semana del 28 de septiembre al 4 de octubre');
    expect(d.nombreAnterior).toBe('la semana anterior');
    expect(d.desde).toBeInstanceOf(Date);
    expect(d.anterior.hasta.getTime()).toBe(d.desde.getTime());
  });
});
