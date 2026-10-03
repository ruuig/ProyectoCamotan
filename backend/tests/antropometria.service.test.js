import { describe, it, expect } from 'vitest';
import {
  valorEnZ,
  calcularZ,
  ajustarZExtremo,
  puntajeZ,
  interpolarLms,
  clasificar,
  clasificarPorMuac,
  peorClasificacion,
  calcularImc,
  compararConAnterior,
  detallarIndicadores,
} from '../src/services/antropometria.service.js';

// Parametros LMS publicados por la OMS para peso para la edad, ninos, 0 meses.
// Sirven para validar la cadena completa contra datos reales de referencia.
const WFA_NINO_0M = { l: 0.3487, m: 3.3464, s: 0.14602 };
// Longitud para la edad, ninos, 0 meses. L = 1 ejercita la rama polinomica.
const LFA_NINO_0M = { l: 1, m: 49.8842, s: 0.03795 };

describe('calcularZ y valorEnZ', () => {
  it('da Z = 0 exactamente en la mediana', () => {
    const { l, m, s } = WFA_NINO_0M;
    expect(calcularZ(m, l, m, s)).toBeCloseTo(0, 10);
  });

  it('es la operacion inversa de valorEnZ', () => {
    const { l, m, s } = WFA_NINO_0M;
    for (const z of [-2.5, -1, 0, 1.5, 2.9]) {
      expect(calcularZ(valorEnZ(z, l, m, s), l, m, s)).toBeCloseTo(z, 9);
    }
  });

  it('usa la rama logaritmica cuando L es 0', () => {
    // Con L = 0 la formula es log(valor/M)/S.
    const esperado = Math.log(12 / 10) / 0.12;
    expect(calcularZ(12, 0, 10, 0.12)).toBeCloseTo(esperado, 10);
    expect(valorEnZ(esperado, 0, 10, 0.12)).toBeCloseTo(12, 9);
  });

  it('reproduce el valor de -2 DE publicado por la OMS', () => {
    const { l, m, s } = WFA_NINO_0M;
    // La tabla de la OMS da 2.5 kg como -2 DE al nacer en ninos.
    expect(valorEnZ(-2, l, m, s)).toBeCloseTo(2.46, 1);
    expect(puntajeZ(2.46, WFA_NINO_0M)).toBeCloseTo(-2, 1);
  });

  it('funciona con la longitud para la edad, donde L vale 1', () => {
    expect(puntajeZ(LFA_NINO_0M.m, LFA_NINO_0M)).toBeCloseTo(0, 10);
    expect(valorEnZ(-2, 1, 49.8842, 0.03795)).toBeCloseTo(46.1, 1);
  });
});

describe('ajustarZExtremo', () => {
  const { l, m, s } = WFA_NINO_0M;

  it('no modifica los puntajes dentro de mas o menos 3 DE', () => {
    for (const z of [-3, -1.5, 0, 2, 3]) {
      const valor = valorEnZ(z, l, m, s);
      expect(ajustarZExtremo(z, valor, l, m, s)).toBeCloseTo(z, 9);
    }
  });

  it('extrapola de forma lineal por encima de +3 DE', () => {
    const sd3 = valorEnZ(3, l, m, s);
    const anchoSd = sd3 - valorEnZ(2, l, m, s);
    // Un valor exactamente una desviacion mas alla de +3 debe dar +4.
    expect(ajustarZExtremo(99, sd3 + anchoSd, l, m, s)).toBeCloseTo(4, 9);
  });

  it('extrapola de forma lineal por debajo de -3 DE', () => {
    const sd3neg = valorEnZ(-3, l, m, s);
    const anchoSd = valorEnZ(-2, l, m, s) - sd3neg;
    expect(ajustarZExtremo(-99, sd3neg - anchoSd, l, m, s)).toBeCloseTo(-4, 9);
  });
});

describe('interpolarLms', () => {
  const tabla = [
    { x: 10, l: 1, m: 100, s: 0.1 },
    { x: 11, l: 2, m: 110, s: 0.2 },
    { x: 12, l: 3, m: 120, s: 0.3 },
  ];

  it('devuelve la fila exacta cuando existe', () => {
    expect(interpolarLms(tabla, 11)).toEqual({ l: 2, m: 110, s: 0.2 });
  });

  it('interpola linealmente entre dos filas', () => {
    const resultado = interpolarLms(tabla, 10.5);
    expect(resultado.l).toBeCloseTo(1.5, 10);
    expect(resultado.m).toBeCloseTo(105, 10);
    expect(resultado.s).toBeCloseTo(0.15, 10);
  });

  it('no extrapola fuera del rango de la tabla', () => {
    expect(interpolarLms(tabla, 9.9)).toBeNull();
    expect(interpolarLms(tabla, 12.1)).toBeNull();
  });

  it('devuelve null si no hay tabla cargada', () => {
    expect(interpolarLms([], 11)).toBeNull();
    expect(interpolarLms(null, 11)).toBeNull();
  });
});

describe('clasificacion', () => {
  it('clasifica desnutricion aguda severa bajo -3 DE de peso para la talla', () => {
    expect(clasificar({ zPesoTalla: -3.4, edadMeses: 24 })).toBe('desnutricion_aguda_severa');
  });

  it('clasifica desnutricion aguda moderada entre -3 y -2 DE', () => {
    expect(clasificar({ zPesoTalla: -2.4, edadMeses: 24 })).toBe('desnutricion_aguda_moderada');
  });

  it('clasifica riesgo entre -2 y -1 DE', () => {
    expect(clasificar({ zPesoTalla: -1.5, edadMeses: 24 })).toBe('riesgo');
  });

  it('clasifica normal sobre -1 DE', () => {
    expect(clasificar({ zPesoTalla: -0.4, edadMeses: 24 })).toBe('normal');
  });

  it('clasifica desnutricion cronica por talla para la edad bajo -2 DE', () => {
    expect(clasificar({ zTallaEdad: -2.7, edadMeses: 30 })).toBe('desnutricion_cronica');
  });

  it('clasifica sobrepeso sobre +2 DE de IMC para la edad', () => {
    expect(clasificar({ zImcEdad: 2.6, edadMeses: 30 })).toBe('sobrepeso');
  });

  it('devuelve null cuando no hay ningun criterio evaluable', () => {
    expect(clasificar({ edadMeses: 30 })).toBeNull();
  });

  it('se queda con el hallazgo mas grave cuando coexisten varios', () => {
    // Retardo de talla y desnutricion aguda severa a la vez.
    expect(clasificar({ zPesoTalla: -3.2, zTallaEdad: -2.5, edadMeses: 24 }))
      .toBe('desnutricion_aguda_severa');
  });

  it('prioriza la cronica sobre el riesgo', () => {
    expect(clasificar({ zPesoTalla: -1.2, zTallaEdad: -2.3, edadMeses: 24 }))
      .toBe('desnutricion_cronica');
  });
});

describe('perimetro braquial (MUAC)', () => {
  it('marca severa bajo 115 mm', () => {
    expect(clasificarPorMuac(110, 24)).toBe('desnutricion_aguda_severa');
  });

  it('marca moderada entre 115 y 125 mm', () => {
    expect(clasificarPorMuac(120, 24)).toBe('desnutricion_aguda_moderada');
    expect(clasificarPorMuac(115, 24)).toBe('desnutricion_aguda_moderada');
  });

  it('no marca nada desde 125 mm', () => {
    expect(clasificarPorMuac(125, 24)).toBeNull();
  });

  it('no aplica en mayores de 5 anios', () => {
    expect(clasificarPorMuac(110, 60)).toBeNull();
    expect(clasificarPorMuac(110, 72)).toBeNull();
  });

  it('detecta desnutricion aguda severa aunque el peso para la talla sea normal', () => {
    // Es criterio independiente: por eso se mide aunque los Z no alarmen.
    expect(clasificar({ zPesoTalla: -0.5, perimetroBraquial: 110, edadMeses: 24 }))
      .toBe('desnutricion_aguda_severa');
  });

  it('funciona sin tablas OMS cargadas, solo con el MUAC', () => {
    expect(clasificar({ perimetroBraquial: 112, edadMeses: 18 }))
      .toBe('desnutricion_aguda_severa');
  });
});

describe('peorClasificacion', () => {
  it('ignora los valores nulos', () => {
    expect(peorClasificacion([null, 'riesgo', null])).toBe('riesgo');
  });

  it('devuelve null si no hay ninguna', () => {
    expect(peorClasificacion([null, undefined])).toBeNull();
  });
});

describe('calcularImc', () => {
  it('calcula el indice con la talla en centimetros', () => {
    expect(calcularImc(12, 85)).toBeCloseTo(16.61, 2);
  });

  it('devuelve null si falta peso o talla', () => {
    expect(calcularImc(null, 85)).toBeNull();
    expect(calcularImc(12, null)).toBeNull();
  });
});

describe('compararConAnterior', () => {
  it('detecta un descenso relevante respecto a la medicion previa', () => {
    const resultado = compararConAnterior(-2.4, -1.6);
    expect(resultado.diferencia).toBe(-0.8);
    expect(resultado.descensoRelevante).toBe(true);
  });

  it('no alarma ante una variacion pequena', () => {
    expect(compararConAnterior(-1.7, -1.6).descensoRelevante).toBe(false);
  });

  it('no alarma ante una mejora', () => {
    expect(compararConAnterior(-1.0, -2.0).descensoRelevante).toBe(false);
  });

  it('devuelve null si no hay medicion anterior', () => {
    expect(compararConAnterior(-2.4, null)).toBeNull();
  });
});

describe('detallarIndicadores', () => {
  it('devuelve los cuatro indicadores', () => {
    const r = detallarIndicadores({ zPesoTalla: 0, edadMeses: 24, talla: 87 });

    expect(r.map((i) => i.clave)).toEqual(['peso_talla', 'talla_edad', 'peso_edad', 'imc_edad']);
  });

  it('clasifica cada indicador con su propio puntaje', () => {
    const r = detallarIndicadores({
      zPesoTalla: -3.5,
      zImcEdad: 2.5,
      edadMeses: 24,
      talla: 87,
    });

    const pesoTalla = r.find((i) => i.clave === 'peso_talla');
    const imc = r.find((i) => i.clave === 'imc_edad');

    expect(pesoTalla.clasificacion).toBe('desnutricion_aguda_severa');
    expect(imc.clasificacion).toBe('sobrepeso');
  });

  it('no clasifica un indicador sin puntaje', () => {
    // Este era el defecto: se mostraba "Sobrepeso" junto a un peso para la
    // talla en blanco, como si fueran el mismo indicador.
    const r = detallarIndicadores({ zPesoTalla: null, zImcEdad: 2.5, edadMeses: 24, talla: 87 });
    const pesoTalla = r.find((i) => i.clave === 'peso_talla');

    expect(pesoTalla.calculable).toBe(false);
    expect(pesoTalla.clasificacion).toBeNull();
    expect(pesoTalla.motivo).toBeTruthy();
  });

  it('dice que falta la talla cuando es lo que falta', () => {
    const r = detallarIndicadores({ edadMeses: 24, talla: null });

    expect(r.find((i) => i.clave === 'peso_talla').motivo).toBe('Falta la talla');
  });

  it('avisa cuando la edad supera las tablas de la OMS', () => {
    const r = detallarIndicadores({ edadMeses: 84, talla: 120 });

    expect(r.every((i) => !i.calculable)).toBe(true);
    expect(r[0].motivo).toContain('60 meses');
  });

  it('avisa cuando no hay tablas cargadas', () => {
    const r = detallarIndicadores({ edadMeses: 24, talla: 87, tablasCargadas: false });

    expect(r[0].motivo).toContain('no están cargadas');
  });

  it('una medicion improbable no clasifica ninguno de sus indicadores', () => {
    const r = detallarIndicadores({
      zPesoEdad: 26.07,
      zImcEdad: 4.62,
      improbable: true,
      edadMeses: 24,
      talla: 160,
    });

    expect(r.every((i) => i.clasificacion === null)).toBe(true);
    expect(r.every((i) => i.motivo.includes('improbable'))).toBe(true);
  });

  it('no inventa clasificacion para peso para la edad', () => {
    const r = detallarIndicadores({ zPesoEdad: -3, edadMeses: 24, talla: 87 });
    const pesoEdad = r.find((i) => i.clave === 'peso_edad');

    expect(pesoEdad.calculable).toBe(true);
    expect(pesoEdad.z).toBe(-3);
    expect(pesoEdad.clasificacion).toBeNull();
  });
});
