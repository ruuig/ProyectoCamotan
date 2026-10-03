import { describe, it, expect } from 'vitest';
import {
  normalizarTexto,
  similitud,
  detectarDuplicados,
  tokensDeBusqueda,
  calcularEdad,
} from '../src/services/pacientes.service.js';

describe('normalizarTexto', () => {
  it('quita tildes, signos y espacios repetidos', () => {
    expect(normalizarTexto('  JOSÉ  Ramírez-Pérez ')).toBe('jose ramirez perez');
  });

  it('trata la n con virgulilla igual que la n simple', () => {
    expect(normalizarTexto('Muñoz')).toBe(normalizarTexto('Munoz'));
  });

  it('no falla con valores nulos', () => {
    expect(normalizarTexto(null)).toBe('');
    expect(normalizarTexto(undefined)).toBe('');
  });
});

describe('similitud', () => {
  it('da 1 para el mismo nombre escrito distinto', () => {
    expect(similitud('Ramírez Pérez, José', 'ramirez perez jose')).toBe(1);
  });

  it('detecta parecido alto ante un error de digitacion', () => {
    expect(similitud('Ramirez Perez Jose', 'Ramirez Peres Jose')).toBeGreaterThan(0.7);
  });

  it('da valor bajo para nombres distintos', () => {
    expect(similitud('Ramirez Perez Jose', 'Gonzalez Lopez Maria')).toBeLessThan(0.2);
  });

  it('da 0 si alguno esta vacio', () => {
    expect(similitud('', 'Ramirez')).toBe(0);
  });
});

describe('detectarDuplicados', () => {
  const existentes = [
    { id: 1, nombres: 'Jose', apellidos: 'Ramirez Perez', cui: '1234567890101', fechaNacimiento: '1990-03-15', comunidad: 'Tisipe' },
    { id: 2, nombres: 'Maria', apellidos: 'Gonzalez Lopez', cui: null, fechaNacimiento: '1985-07-20', comunidad: 'Shalaguá' },
  ];

  it('marca como certeza cuando el CUI coincide, aunque el nombre difiera', () => {
    const resultado = detectarDuplicados(existentes, {
      nombres: 'J.',
      apellidos: 'Ramires',
      cui: '1234567890101',
    });

    expect(resultado[0].paciente.id).toBe(1);
    expect(resultado[0].puntaje).toBe(1);
    expect(resultado[0].razones).toEqual(['mismo CUI']);
  });

  it('detecta un nombre casi igual sin CUI', () => {
    const resultado = detectarDuplicados(existentes, {
      nombres: 'Jose',
      apellidos: 'Ramires Peres',
    });

    expect(resultado).toHaveLength(1);
    expect(resultado[0].paciente.id).toBe(1);
    expect(resultado[0].razones).toContain('nombre similar');
  });

  it('sube el puntaje si ademas coinciden fecha de nacimiento y comunidad', () => {
    const base = { nombres: 'Jose', apellidos: 'Ramires Peres' };
    const solo = detectarDuplicados(existentes, base)[0].puntaje;
    const conDatos = detectarDuplicados(existentes, {
      ...base,
      fechaNacimiento: '1990-03-15',
      comunidad: 'TISIPE',
      responsableNombre: 'Maria Lopez',
      responsableParentesco: 'madre',
    })[0].puntaje;

    expect(conDatos).toBeGreaterThan(solo);
  });

  it('no devuelve nada para un paciente claramente distinto', () => {
    expect(detectarDuplicados(existentes, { nombres: 'Pedro', apellidos: 'Castillo Mejia' })).toEqual([]);
  });

  it('ordena de mayor a menor parecido', () => {
    const resultado = detectarDuplicados(
      [...existentes, { id: 3, nombres: 'Jose', apellidos: 'Ramirez Perez', cui: null, fechaNacimiento: '1990-03-15', comunidad: 'Tisipe' }],
      { nombres: 'Jose', apellidos: 'Ramirez Perez' },
    );

    expect(resultado.length).toBeGreaterThan(1);
    expect(resultado[0].puntaje).toBeGreaterThanOrEqual(resultado[1].puntaje);
  });
});

describe('tokensDeBusqueda', () => {
  it('descarta particulas y palabras muy cortas', () => {
    expect(tokensDeBusqueda('Maria de los Angeles Cruz')).toEqual(['maria', 'angeles', 'cruz']);
  });
});

describe('calcularEdad', () => {
  it('calcula la edad en meses de un lactante', () => {
    const edad = calcularEdad('2025-03-10', new Date('2026-09-05'));
    expect(edad.anios).toBe(1);
    expect(edad.meses).toBe(5);
    expect(edad.edadMeses).toBe(17);
  });

  it('no adelanta el cumpleanios cuando aun no llega el dia', () => {
    const edad = calcularEdad('2000-09-20', new Date('2026-09-05'));
    expect(edad.anios).toBe(25);
    expect(edad.meses).toBe(11);
  });

  it('devuelve 0 meses para un recien nacido', () => {
    const edad = calcularEdad('2026-09-01', new Date('2026-09-05'));
    expect(edad.edadMeses).toBe(0);
    expect(edad.dias).toBe(4);
  });
});
