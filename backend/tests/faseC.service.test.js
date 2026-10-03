// Pruebas de las funciones puras de la Fase C: etapa de vida, edad estimada
// y episodio de embarazo.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { etapaDeVida, camposVisibles, condicionesPorEdad } =
  require('../src/services/etapaVida.service');
const { fechaDesdeEdad, validarEdadDeclarada, edadLegible } =
  require('../src/services/edadEstimada.service');
const {
  SEMANAS_MAXIMAS,
  fechaProbableParto,
  semanasDeGestacion,
  debeVencerse,
  describirEpisodio,
} = require('../src/services/embarazo.service');

const AHORA = new Date('2026-06-15T12:00:00.000Z');

describe('etapaDeVida', () => {
  it('separa al recién nacido por días, no por meses', () => {
    expect(etapaDeVida(0, 10).clave).toBe('recien_nacido');
    expect(etapaDeVida(1, 29).clave).toBe('lactante_ninez');
  });

  it('ubica cada edad en su ficha', () => {
    expect(etapaDeVida(24).clave).toBe('lactante_ninez');
    expect(etapaDeVida(119).clave).toBe('lactante_ninez');
    expect(etapaDeVida(120).clave).toBe('adolescente_joven');
    expect(etapaDeVida(359).clave).toBe('adolescente_joven');
    expect(etapaDeVida(360).clave).toBe('adulto');
    expect(etapaDeVida(719).clave).toBe('adulto');
    expect(etapaDeVida(720).clave).toBe('persona_mayor');
  });

  it('sin edad no decide etapa', () => {
    expect(etapaDeVida(null)).toBeNull();
  });
});

describe('camposVisibles', () => {
  it('pide responsable solo en menores de 18', () => {
    expect(camposVisibles(12 * 10).responsable).toBe(true);
    expect(camposVisibles(12 * 17).responsable).toBe(true);
    expect(camposVisibles(12 * 18).responsable).toBe(false);
  });

  it('de 10 a 17 lo llama referente adulto', () => {
    expect(camposVisibles(12 * 9).referenteAdulto).toBe(false);
    expect(camposVisibles(12 * 10).referenteAdulto).toBe(true);
    expect(camposVisibles(12 * 18).referenteAdulto).toBe(false);
  });

  it('muestra la escolaridad de niñez solo de 5 a menos de 10', () => {
    expect(camposVisibles(12 * 4).escolaridadNinez).toBe(false);
    expect(camposVisibles(12 * 5).escolaridadNinez).toBe(true);
    expect(camposVisibles(12 * 10).escolaridadNinez).toBe(false);
  });

  it('muestra la escolaridad de adolescencia de 10 a menos de 30', () => {
    expect(camposVisibles(12 * 10).escolaridadAdolescente).toBe(true);
    expect(camposVisibles(12 * 29).escolaridadAdolescente).toBe(true);
    expect(camposVisibles(12 * 30).escolaridadAdolescente).toBe(false);
  });

  it('pregunta trabajo y estado civil desde los 10', () => {
    expect(camposVisibles(12 * 9).trabaja).toBe(false);
    expect(camposVisibles(12 * 10).trabaja).toBe(true);
    expect(camposVisibles(12 * 10).estadoCivil).toBe(true);
  });

  it('pregunta religión solo de 10 a menos de 30', () => {
    expect(camposVisibles(12 * 10).religion).toBe(true);
    expect(camposVisibles(12 * 30).religion).toBe(false);
  });

  it('pide correo y redes desde los 30', () => {
    expect(camposVisibles(12 * 29).contactoDigital).toBe(false);
    expect(camposVisibles(12 * 30).contactoDigital).toBe(true);
  });

  it('orientación sexual solo en mayores de 20', () => {
    expect(camposVisibles(12 * 20).orientacionSexual).toBe(false);
    expect(camposVisibles(12 * 21).orientacionSexual).toBe(true);
  });

  it('sin edad muestra lo mínimo', () => {
    const c = camposVisibles(null);
    expect(c.responsable).toBe(false);
    expect(c.escolaridad).toBe(true);
  });
});

describe('condicionesPorEdad', () => {
  it('marca menor de 5 por edad, no a mano', () => {
    expect(condicionesPorEdad(59)).toContain('menor_5');
    expect(condicionesPorEdad(60)).not.toContain('menor_5');
  });

  it('marca adulto mayor desde los 60 años', () => {
    expect(condicionesPorEdad(12 * 59)).not.toContain('adulto_mayor');
    expect(condicionesPorEdad(12 * 60)).toContain('adulto_mayor');
  });
});

describe('fechaDesdeEdad', () => {
  it('resta días', () => {
    const f = fechaDesdeEdad(10, 'dias', AHORA);
    expect(f.toISOString().slice(0, 10)).toBe('2026-06-05');
  });

  it('resta meses', () => {
    const f = fechaDesdeEdad(6, 'meses', AHORA);
    expect(f.toISOString().slice(0, 7)).toBe('2025-12');
  });

  it('resta años', () => {
    const f = fechaDesdeEdad(40, 'anios', AHORA);
    expect(f.getUTCFullYear()).toBe(1986);
  });

  it('rechaza una unidad desconocida o un valor imposible', () => {
    expect(fechaDesdeEdad(5, 'semanas', AHORA)).toBeNull();
    expect(fechaDesdeEdad(-3, 'anios', AHORA)).toBeNull();
  });
});

describe('validarEdadDeclarada', () => {
  it('acepta lo que cae en su unidad', () => {
    expect(validarEdadDeclarada(20, 'dias').valida).toBe(true);
    expect(validarEdadDeclarada(11, 'meses').valida).toBe(true);
    expect(validarEdadDeclarada(45, 'anios').valida).toBe(true);
  });

  it('avisa cuando se equivocó de unidad', () => {
    // 40 días no existe como edad: quiso decir años.
    const r = validarEdadDeclarada(40, 'dias');
    expect(r.valida).toBe(false);
    expect(r.mensaje).toContain('menores de un mes');
  });

  it('rechaza una edad imposible', () => {
    expect(validarEdadDeclarada(150, 'anios').valida).toBe(false);
  });

  it('rechaza decimales', () => {
    expect(validarEdadDeclarada(2.5, 'anios').valida).toBe(false);
  });
});

describe('edadLegible', () => {
  it('marca la edad aproximada', () => {
    expect(edadLegible({ anios: 40, meses: 0, dias: 0 }, true)).toBe('40 años (aproximada)');
  });

  it('no marca la edad exacta', () => {
    expect(edadLegible({ anios: 2, meses: 3, dias: 0 })).toBe('2 años 3 meses');
  });

  it('usa singular donde toca', () => {
    expect(edadLegible({ anios: 1, meses: 0, dias: 0 })).toBe('1 año');
    expect(edadLegible({ anios: 0, meses: 1, dias: 0 })).toBe('1 mes');
    expect(edadLegible({ anios: 0, meses: 0, dias: 1 })).toBe('1 día');
  });
});

describe('fechaProbableParto', () => {
  it('suma 280 días a la última regla', () => {
    const fpp = fechaProbableParto('2026-01-01');
    expect(fpp.toISOString().slice(0, 10)).toBe('2026-10-08');
  });

  it('devuelve null sin fecha válida', () => {
    expect(fechaProbableParto(null)).toBeNull();
    expect(fechaProbableParto('no es fecha')).toBeNull();
  });
});

describe('semanasDeGestacion', () => {
  it('cuenta desde la última regla', () => {
    const e = { fechaUltimaRegla: new Date('2026-04-06') };
    expect(semanasDeGestacion(e, AHORA)).toBe(10);
  });

  it('avanza desde las semanas declaradas cuando no hay última regla', () => {
    const e = { semanasAlRegistrar: 12, abiertoEn: new Date('2026-06-01') };
    // Dos semanas despues de abrirlo van 14.
    expect(semanasDeGestacion(e, AHORA)).toBe(14);
  });

  it('devuelve null cuando no hay con qué calcular', () => {
    expect(semanasDeGestacion({ estado: 'activo' }, AHORA)).toBeNull();
  });
});

describe('debeVencerse', () => {
  it('vence a las 42 semanas', () => {
    const limite = new Date(AHORA.getTime() - SEMANAS_MAXIMAS * 7 * 86400000);
    expect(debeVencerse({ estado: 'activo', fechaUltimaRegla: limite }, AHORA)).toBe(true);
  });

  it('no vence antes', () => {
    const e = { estado: 'activo', fechaUltimaRegla: new Date('2026-04-06') };
    expect(debeVencerse(e, AHORA)).toBe(false);
  });

  it('no vence un episodio sin semanas conocidas', () => {
    // No se cierra un embarazo por no saber cuánto lleva.
    expect(debeVencerse({ estado: 'activo' }, AHORA)).toBe(false);
  });

  it('no toca un episodio ya cerrado', () => {
    const viejo = new Date('2020-01-01');
    expect(debeVencerse({ estado: 'finalizado', fechaUltimaRegla: viejo }, AHORA)).toBe(false);
  });
});

describe('describirEpisodio', () => {
  it('dice las semanas cuando se pueden calcular', () => {
    const d = describirEpisodio({ id: 1, estado: 'activo', fechaUltimaRegla: new Date('2026-04-06') }, AHORA);
    expect(d.semanas).toBe(10);
    expect(d.texto).toBe('Embarazo de 10 semanas');
  });

  it('lo dice con todas sus letras cuando no se saben', () => {
    const d = describirEpisodio({ id: 1, estado: 'activo' }, AHORA);
    expect(d.semanas).toBeNull();
    expect(d.texto).toContain('semanas desconocidas');
  });
});
