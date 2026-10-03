import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  FRASE_SIN_ANTERIOR,
  FRASE_SIN_ACTUAL,
  variacionSegura,
  aclaracionMuestra,
  fraseNeutra,
  fraseBajarEsMejor,
  tendenciaVisible,
  esRepunte,
  subidaPorcentual,
  colorCobertura,
  colorRezago,
  proporcion,
  graficaDibujable,
} = require('../src/services/panelDireccion.service');

const MINUTOS = { singular: 'minuto', plural: 'minutos', mejoro: 'Mejoró', empeoro: 'Empeoró' };
const PUNTOS = { singular: 'punto', plural: 'puntos', mejoro: 'Bajó', empeoro: 'Subió' };

describe('variacionSegura', () => {
  it('nunca inventa un porcentaje contra un periodo en cero', () => {
    expect(variacionSegura(5, 0)).toEqual({ absoluta: 5, porcentaje: null });
  });

  it('calcula el porcentaje cuando hay con que comparar', () => {
    expect(variacionSegura(173, 152)).toEqual({ absoluta: 21, porcentaje: 14 });
  });

  it('una caida da porcentaje negativo', () => {
    expect(variacionSegura(80, 100).porcentaje).toBe(-20);
  });
});

describe('aclaracionMuestra', () => {
  it('no aclara nada cuando la muestra alcanza', () => {
    expect(aclaracionMuestra(10)).toBe('');
    expect(aclaracionMuestra(43)).toBe('');
  });

  it('avisa sobre cuantos pacientes se calculo si son pocos', () => {
    expect(aclaracionMuestra(3)).toBe(' sobre 3 pacientes');
    expect(aclaracionMuestra(1)).toBe(' sobre 1 paciente');
  });
});

describe('fraseNeutra', () => {
  it('dice cuantas mas, sin color de juicio', () => {
    const r = fraseNeutra(173, 152, 'la semana anterior');
    expect(r.frase).toBe('21 más que la semana anterior');
    expect(r.sentido).toBe('neutro');
  });

  it('dice cuantas menos', () => {
    expect(fraseNeutra(140, 152, 'la semana anterior').frase).toBe('12 menos que la semana anterior');
  });

  it('sin periodo anterior lo dice en lugar de comparar contra cero', () => {
    const r = fraseNeutra(5, 0, 'la semana anterior');
    expect(r.frase).toBe(FRASE_SIN_ANTERIOR);
    expect(r.sentido).toBeNull();
    expect(r.frase).not.toContain('%');
  });

  it('sin cambio no dice "0 más"', () => {
    expect(fraseNeutra(50, 50, 'el mes anterior').frase).toBe('Igual que el mes anterior');
  });
});

describe('fraseBajarEsMejor', () => {
  it('una espera que baja mejoró', () => {
    const r = fraseBajarEsMejor(38, 50, { unidad: MINUTOS, casos: 43 });
    expect(r.frase).toBe('Mejoró 12 minutos');
    expect(r.sentido).toBe('mejora');
  });

  it('una espera que sube empeoró', () => {
    const r = fraseBajarEsMejor(50, 38, { unidad: MINUTOS, casos: 43 });
    expect(r.frase).toBe('Empeoró 12 minutos');
    expect(r.sentido).toBe('empeora');
  });

  it('el ausentismo usa sus propias palabras pero el mismo significado', () => {
    expect(fraseBajarEsMejor(9, 6, { unidad: PUNTOS, casos: 40 }).frase).toBe('Subió 3 puntos');
    expect(fraseBajarEsMejor(6, 9, { unidad: PUNTOS, casos: 40 }).sentido).toBe('mejora');
  });

  it('avisa cuando el promedio sale de pocos pacientes', () => {
    const r = fraseBajarEsMejor(38, 50, { unidad: MINUTOS, casos: 3 });
    expect(r.frase).toBe('Mejoró 12 minutos sobre 3 pacientes');
  });

  it('sin periodo anterior no compara', () => {
    const r = fraseBajarEsMejor(38, 0, { unidad: MINUTOS, casos: 20, hayAnterior: false });
    expect(r.frase).toBe(FRASE_SIN_ANTERIOR);
    expect(r.sentido).toBeNull();
  });

  it('sin nada medido este periodo no se afirma una mejora', () => {
    // Una semana sin pacientes llamados no es "mejoro 93 minutos".
    const r = fraseBajarEsMejor(0, 93, {
      unidad: MINUTOS,
      casos: 0,
      hayActual: false,
      hayAnterior: true,
      fraseSinActual: 'Todavía no se ha llamado a nadie en el período',
    });
    expect(r.frase).toBe('Todavía no se ha llamado a nadie en el período');
    expect(r.sentido).toBeNull();
  });

  it('sin frase propia usa la general, y nunca dice "sobre 0 pacientes"', () => {
    const r = fraseBajarEsMejor(0, 9, { unidad: PUNTOS, casos: 0, hayActual: false });
    expect(r.frase).toBe(FRASE_SIN_ACTUAL);
    expect(r.frase).not.toContain('sobre 0');
  });

  it('un solo minuto va en singular', () => {
    expect(fraseBajarEsMejor(37, 38, { unidad: MINUTOS, casos: 20 }).frase).toBe('Mejoró 1 minuto');
  });
});

describe('tendenciaVisible', () => {
  it('no dibuja una tendencia con menos de cuatro periodos medidos', () => {
    expect(tendenciaVisible([null, null, 3, 5])).toBeNull();
    expect(tendenciaVisible([1, 2, 3])).toBeNull();
  });

  it('dibuja cuando hay cuatro o mas', () => {
    const serie = [1, 2, null, 3, 4];
    expect(tendenciaVisible(serie)).toBe(serie);
  });
});

describe('esRepunte', () => {
  it('senala una subida grande con casos suficientes', () => {
    expect(esRepunte(27, 18)).toBe(true);
  });

  it('no senala una subida grande con pocos casos', () => {
    // De 2 a 4 es un 100% de subida y sigue siendo ruido.
    expect(esRepunte(4, 2)).toBe(false);
  });

  it('no senala una subida pequena aunque haya muchos casos', () => {
    expect(esRepunte(38, 35)).toBe(false);
  });

  it('no senala nada contra un mes anterior en cero', () => {
    expect(esRepunte(12, 0)).toBe(false);
  });

  it('justo en el limite de casos y porcentaje si senala', () => {
    // 5 casos contra 3 son 5 casos y un 67% de subida.
    expect(esRepunte(5, 3)).toBe(true);
  });
});

describe('subidaPorcentual', () => {
  it('redondea la subida', () => {
    expect(subidaPorcentual(27, 18)).toBe(50);
  });

  it('no da porcentaje contra cero', () => {
    expect(subidaPorcentual(5, 0)).toBeNull();
  });
});

describe('colorCobertura', () => {
  it('bajo el umbral es critico', () => {
    expect(colorCobertura(4, 15)).toBe('empeora');
    expect(colorCobertura(0, 15)).toBe('empeora');
  });

  it('entre el umbral y el doble se vigila', () => {
    expect(colorCobertura(15, 15)).toBe('advertencia');
    expect(colorCobertura(29, 15)).toBe('advertencia');
  });

  it('por encima del doble es normal', () => {
    expect(colorCobertura(30, 15)).toBe('marino');
  });

  it('sin dato de consumo no se pinta nada', () => {
    expect(colorCobertura(null, 15)).toBeNull();
  });
});

describe('colorRezago', () => {
  it('nunca atendida es lo mas grave', () => {
    expect(colorRezago(null)).toBe('empeora');
  });

  it('pasado el mes se advierte', () => {
    expect(colorRezago(34)).toBe('advertencia');
  });

  it('dentro del mes es neutro', () => {
    expect(colorRezago(12)).toBe('neutro');
  });
});

describe('proporcion', () => {
  it('recorta lo que supera el horizonte', () => {
    expect(proporcion(90, 60)).toBe(1);
  });

  it('nunca es negativa', () => {
    expect(proporcion(-5, 60)).toBe(0);
  });

  it('sin valor la barra queda vacia', () => {
    expect(proporcion(null, 60)).toBe(0);
  });

  it('calcula la fraccion normal', () => {
    expect(proporcion(15, 30)).toBe(0.5);
  });
});

describe('graficaDibujable', () => {
  it('con menos de una semana de registros no se dibuja', () => {
    expect(graficaDibujable(6)).toBe(false);
  });

  it('con una semana ya se dibuja', () => {
    expect(graficaDibujable(7)).toBe(true);
  });
});
