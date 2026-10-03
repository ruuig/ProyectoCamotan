import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  mesesDelPeriodo,
  agruparPorMes,
  agruparPorHora,
  indiceDestacado,
  esperaPorMes,
} = require('../src/services/series.service');

// Fecha fija para que las pruebas no dependan del dia en que se ejecuten.
const AHORA = new Date('2026-06-15T10:00:00.000Z');

function atencion(iso, extra = {}) {
  return { registradaEn: new Date(iso), reingresoEn: null, llamadaEn: null, ...extra };
}

describe('mesesDelPeriodo', () => {
  it('devuelve los meses en orden cronologico terminando en el mes actual', () => {
    const meses = mesesDelPeriodo(AHORA, 6);

    expect(meses).toHaveLength(6);
    expect(meses[0].clave).toBe('2026-01');
    expect(meses[5].clave).toBe('2026-06');
    expect(meses[5].etiqueta).toBe('JUN');
  });

  it('cruza el cambio de anio hacia atras', () => {
    const meses = mesesDelPeriodo(new Date('2026-02-10T00:00:00.000Z'), 4);

    expect(meses.map((m) => m.clave)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(meses[0].anio).toBe(2025);
  });
});

describe('agruparPorMes', () => {
  it('cuenta las atenciones en el mes que les corresponde', () => {
    const datos = agruparPorMes(
      [
        atencion('2026-06-01T08:00:00.000Z'),
        atencion('2026-06-14T09:00:00.000Z'),
        atencion('2026-05-20T09:00:00.000Z'),
      ],
      AHORA,
      6,
    );

    expect(datos.at(-1).total).toBe(2);
    expect(datos.at(-2).total).toBe(1);
  });

  it('incluye los meses sin atenciones en cero', () => {
    const datos = agruparPorMes([atencion('2026-06-01T08:00:00.000Z')], AHORA, 6);

    expect(datos).toHaveLength(6);
    expect(datos[0].total).toBe(0);
  });

  it('calcula la variacion respecto al mes anterior', () => {
    // 10 en mayo, 12 en junio: +20%
    const mayo = Array.from({ length: 10 }, () => atencion('2026-05-10T08:00:00.000Z'));
    const junio = Array.from({ length: 12 }, () => atencion('2026-06-10T08:00:00.000Z'));

    const datos = agruparPorMes([...mayo, ...junio], AHORA, 6);

    expect(datos.at(-1).variacion).toBe(20);
  });

  it('no calcula variacion sobre un mes anterior en cero', () => {
    const datos = agruparPorMes([atencion('2026-06-10T08:00:00.000Z')], AHORA, 6);

    // Mayo fue cero: un porcentaje sobre cero no significa nada.
    expect(datos.at(-1).variacion).toBeNull();
    // El primer mes del periodo nunca tiene con que compararse.
    expect(datos[0].variacion).toBeNull();
  });
});

describe('agruparPorHora', () => {
  it('convierte la hora UTC guardada a hora local del establecimiento', () => {
    // 14:00 UTC son las 08:00 en Guatemala (UTC-6).
    const horas = agruparPorHora([atencion('2026-06-10T14:00:00.000Z')], 1);

    expect(horas.find((h) => h.hora === 8).total).toBe(1);
    expect(horas.find((h) => h.hora === 14).total).toBe(0);
  });

  it('descarta las llegadas fuera del horario de atencion', () => {
    const horas = agruparPorHora(
      [
        atencion('2026-06-10T09:00:00.000Z'), // 03:00 local, antes de abrir
        atencion('2026-06-10T14:00:00.000Z'), // 08:00 local
        atencion('2026-06-11T04:00:00.000Z'), // 22:00 local, ya cerrado
      ],
      1,
    );

    const total = horas.reduce((suma, h) => suma + h.total, 0);
    expect(total).toBe(1);
  });

  it('no se sale del rango cuando el desfase cruza la medianoche', () => {
    // 02:00 UTC son las 20:00 del dia anterior: fuera de horario, no hora -4.
    const horas = agruparPorHora([atencion('2026-06-10T02:00:00.000Z')], 1);

    expect(horas.every((h) => h.hora >= 6 && h.hora <= 18)).toBe(true);
    expect(horas.reduce((suma, h) => suma + h.total, 0)).toBe(0);
  });

  it('devuelve todas las horas del horario aunque esten vacias', () => {
    const horas = agruparPorHora([], 30);

    expect(horas).toHaveLength(13); // de 06:00 a 18:00 inclusive
    expect(horas[0].etiqueta).toBe('06:00');
    expect(horas.at(-1).etiqueta).toBe('18:00');
  });

  it('promedia por dia observado en vez de mostrar el acumulado', () => {
    const treinta = Array.from({ length: 30 }, () => atencion('2026-06-10T14:00:00.000Z'));
    const horas = agruparPorHora(treinta, 30);
    const ocho = horas.find((h) => h.hora === 8);

    expect(ocho.total).toBe(30);
    expect(ocho.promedioDiario).toBe(1);
  });

  it('no divide entre cero cuando no hay dias observados', () => {
    const horas = agruparPorHora([atencion('2026-06-10T14:00:00.000Z')], 0);

    expect(horas.find((h) => h.hora === 8).promedioDiario).toBe(0);
  });
});

describe('indiceDestacado', () => {
  it('senala el valor mas alto', () => {
    expect(indiceDestacado([3, 9, 4])).toBe(1);
  });

  it('no destaca nada cuando todo esta en cero', () => {
    expect(indiceDestacado([0, 0, 0])).toBeNull();
  });

  it('se queda con el primero ante un empate', () => {
    expect(indiceDestacado([5, 5, 2])).toBe(0);
  });
});

describe('esperaPorMes', () => {
  it('promedia solo las atenciones que llegaron a ser llamadas', () => {
    const datos = esperaPorMes(
      [
        atencion('2026-06-10T08:00:00.000Z', { llamadaEn: new Date('2026-06-10T08:30:00.000Z') }),
        atencion('2026-06-10T09:00:00.000Z', { llamadaEn: new Date('2026-06-10T10:00:00.000Z') }),
        atencion('2026-06-10T11:00:00.000Z'), // sigue en espera: no cuenta
      ],
      AHORA,
      6,
    );

    expect(datos.at(-1).promedioMin).toBe(45);
    expect(datos.at(-1).casos).toBe(2);
  });

  it('cuenta la espera desde el reingreso cuando el paciente volvio', () => {
    const datos = esperaPorMes(
      [
        atencion('2026-06-10T08:00:00.000Z', {
          reingresoEn: new Date('2026-06-10T09:00:00.000Z'),
          llamadaEn: new Date('2026-06-10T09:20:00.000Z'),
        }),
      ],
      AHORA,
      6,
    );

    // 20 minutos desde el reingreso, no 80 desde el registro original.
    expect(datos.at(-1).promedioMin).toBe(20);
  });

  it('devuelve null en vez de cero cuando el mes no tuvo casos', () => {
    const datos = esperaPorMes([], AHORA, 6);

    expect(datos.at(-1).promedioMin).toBeNull();
    expect(datos.at(-1).casos).toBe(0);
  });
});
