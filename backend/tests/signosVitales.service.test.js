import { describe, it, expect } from 'vitest';
import { evaluarSignosVitales } from '../src/services/signosVitales.service.js';

const campos = (hallazgos) => hallazgos.map((h) => h.campo);

describe('evaluarSignosVitales', () => {
  it('no reporta nada cuando todo esta dentro de rango', () => {
    const hallazgos = evaluarSignosVitales(
      { temperatura: 36.8, frecCardiaca: 90, frecRespiratoria: 16, satOxigeno: 97, presionSis: 118, presionDia: 76 },
      { edadMeses: 360 },
    );
    expect(hallazgos).toEqual([]);
  });

  it('exige la edad para poder evaluar', () => {
    expect(() => evaluarSignosVitales({ temperatura: 37 }, {})).toThrow(/edad en meses/);
  });

  it('ignora los campos no medidos', () => {
    expect(evaluarSignosVitales({ temperatura: null, satOxigeno: undefined }, { edadMeses: 24 })).toEqual([]);
  });
});

describe('temperatura', () => {
  it('marca fiebre alta con severidad alta', () => {
    const [hallazgo] = evaluarSignosVitales({ temperatura: 39.4 }, { edadMeses: 30 });
    expect(hallazgo.severidad).toBe('alta');
    expect(hallazgo.mensaje).toMatch(/Fiebre alta/);
  });

  it('marca fiebre simple con severidad media', () => {
    const [hallazgo] = evaluarSignosVitales({ temperatura: 38.3 }, { edadMeses: 30 });
    expect(hallazgo.severidad).toBe('media');
  });

  it('marca hipotermia grave', () => {
    const [hallazgo] = evaluarSignosVitales({ temperatura: 35.1 }, { edadMeses: 1 });
    expect(hallazgo.severidad).toBe('alta');
    expect(hallazgo.mensaje).toMatch(/Hipotermia grave/);
  });
});

describe('respiracion rapida segun AIEPI', () => {
  // Los limites cambian por tramo: 60 en menores de 2 meses, 50 hasta el ano
  // y 40 hasta los 5 anios.
  it('marca 55 por minuto en un menor de 2 meses como normal segun AIEPI', () => {
    const hallazgos = evaluarSignosVitales({ frecRespiratoria: 55 }, { edadMeses: 1 });
    expect(hallazgos).toEqual([]);
  });

  it('marca 60 por minuto en un menor de 2 meses como respiracion rapida', () => {
    const [hallazgo] = evaluarSignosVitales({ frecRespiratoria: 60 }, { edadMeses: 1 });
    expect(hallazgo.severidad).toBe('alta');
    expect(hallazgo.mensaje).toMatch(/Respiracion rapida/);
  });

  it('aplica el limite de 50 entre los 2 y los 12 meses', () => {
    expect(evaluarSignosVitales({ frecRespiratoria: 49 }, { edadMeses: 6 })).toEqual([]);
    const [hallazgo] = evaluarSignosVitales({ frecRespiratoria: 50 }, { edadMeses: 6 });
    expect(hallazgo.severidad).toBe('alta');
  });

  it('aplica el limite de 40 entre 1 y 5 anios', () => {
    expect(evaluarSignosVitales({ frecRespiratoria: 39 }, { edadMeses: 36 })).toEqual([]);
    const [hallazgo] = evaluarSignosVitales({ frecRespiratoria: 40 }, { edadMeses: 36 });
    expect(hallazgo.severidad).toBe('alta');
  });

  it('no aplica el criterio AIEPI en mayores de 5 anios', () => {
    const [hallazgo] = evaluarSignosVitales({ frecRespiratoria: 30 }, { edadMeses: 120 });
    expect(hallazgo.severidad).toBe('media');
    expect(hallazgo.mensaje).not.toMatch(/AIEPI/);
  });
});

describe('presion arterial', () => {
  it('no evalua presion en menores de edad, por requerir percentiles', () => {
    expect(evaluarSignosVitales({ presionSis: 150, presionDia: 95 }, { edadMeses: 100 })).toEqual([]);
  });

  it('marca presion elevada en adulto', () => {
    const hallazgos = evaluarSignosVitales({ presionSis: 150, presionDia: 95 }, { edadMeses: 400 });
    expect(campos(hallazgos)).toContain('presion');
  });

  it('marca 140/90 en embarazo como alerta alta aunque no sea adulta mayor', () => {
    const [hallazgo] = evaluarSignosVitales(
      { presionSis: 142, presionDia: 92 },
      { edadMeses: 220, condiciones: ['embarazo'] },
    );
    expect(hallazgo.severidad).toBe('alta');
    expect(hallazgo.mensaje).toMatch(/preeclampsia/);
  });
});

describe('saturacion de oxigeno', () => {
  it('marca saturacion critica bajo 90', () => {
    const [hallazgo] = evaluarSignosVitales({ satOxigeno: 88 }, { edadMeses: 24 });
    expect(hallazgo.severidad).toBe('alta');
  });

  it('marca saturacion baja entre 90 y 93', () => {
    const [hallazgo] = evaluarSignosVitales({ satOxigeno: 92 }, { edadMeses: 24 });
    expect(hallazgo.severidad).toBe('media');
  });
});

describe('varios hallazgos a la vez', () => {
  it('devuelve todos los problemas encontrados', () => {
    const hallazgos = evaluarSignosVitales(
      { temperatura: 39.5, frecRespiratoria: 58, satOxigeno: 89 },
      { edadMeses: 8 },
    );
    expect(campos(hallazgos).sort()).toEqual(['frecRespiratoria', 'satOxigeno', 'temperatura']);
    expect(hallazgos.every((h) => h.severidad === 'alta')).toBe(true);
  });
});
