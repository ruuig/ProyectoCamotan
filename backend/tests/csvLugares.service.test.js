import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  partirLinea,
  normalizarCategoria,
  parsearCsvLugares,
} = require('../src/services/csvLugares.service');

const ENCABEZADO = 'nombre,categoria,territorio,sector';

describe('partirLinea', () => {
  it('separa por coma', () => {
    expect(partirLinea('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('acepta punto y coma, que es lo que usa Excel en español', () => {
    expect(partirLinea('a;b;c')).toEqual(['a', 'b', 'c']);
  });

  it('respeta las comas dentro de comillas', () => {
    expect(partirLinea('"San Juan, sector 2",aldea')).toEqual(['San Juan, sector 2', 'aldea']);
  });

  it('entiende la comilla escapada', () => {
    expect(partirLinea('"El ""Volcan""",aldea')).toEqual(['El "Volcan"', 'aldea']);
  });

  it('quita los espacios alrededor', () => {
    expect(partirLinea('  a , b ')).toEqual(['a', 'b']);
  });
});

describe('normalizarCategoria', () => {
  it('acepta la categoria escrita con y sin tilde', () => {
    expect(normalizarCategoria('caserío')).toBe('caserio');
    expect(normalizarCategoria('CASERIO')).toBe('caserio');
  });

  it('acepta el plural de otros', () => {
    expect(normalizarCategoria('Otros')).toBe('otro');
  });

  it('trata la categoria vacia como otro', () => {
    expect(normalizarCategoria('')).toBe('otro');
  });

  it('rechaza lo que no reconoce', () => {
    expect(normalizarCategoria('municipio')).toBeNull();
  });
});

describe('parsearCsvLugares', () => {
  it('lee las filas validas', () => {
    const { filas, errores } = parsearCsvLugares(
      `${ENCABEZADO}\nTisipe,aldea,Territorio 1,Sector A\nEl Volcán,caserío,,`,
    );

    expect(errores).toHaveLength(0);
    expect(filas).toEqual([
      { nombre: 'Tisipe', categoria: 'aldea', territorio: 'Territorio 1', sector: 'Sector A' },
      { nombre: 'El Volcán', categoria: 'caserio', territorio: null, sector: null },
    ]);
  });

  it('quita la marca de bytes que agrega Excel', () => {
    const { filas, errores } = parsearCsvLugares(`﻿${ENCABEZADO}\nTisipe,aldea,,`);

    expect(errores).toHaveLength(0);
    expect(filas[0].nombre).toBe('Tisipe');
  });

  it('acepta saltos de linea de Windows', () => {
    const { filas } = parsearCsvLugares(`${ENCABEZADO}\r\nTisipe,aldea,,\r\n`);

    expect(filas).toHaveLength(1);
  });

  it('no se cae con lineas en blanco', () => {
    const { filas, errores } = parsearCsvLugares(`${ENCABEZADO}\n\nTisipe,aldea,,\n\n`);

    expect(filas).toHaveLength(1);
    expect(errores).toHaveLength(0);
  });

  it('avisa si falta una columna del encabezado', () => {
    const { filas, errores } = parsearCsvLugares('nombre,categoria\nTisipe,aldea');

    expect(filas).toHaveLength(0);
    expect(errores[0].mensaje).toContain('territorio');
    expect(errores[0].mensaje).toContain('sector');
  });

  it('acepta el encabezado sin tildes ni mayusculas', () => {
    const { filas, errores } = parsearCsvLugares('Nombre,Categoría,Territorio,Sector\nTisipe,aldea,,');

    expect(errores).toHaveLength(0);
    expect(filas).toHaveLength(1);
  });

  it('reporta el nombre vacio con su numero de linea', () => {
    const { filas, errores } = parsearCsvLugares(`${ENCABEZADO}\n,aldea,,`);

    expect(filas).toHaveLength(0);
    expect(errores[0].linea).toBe(2);
    expect(errores[0].mensaje).toContain('vacío');
  });

  it('reporta la categoria desconocida sin descartar el resto del archivo', () => {
    const { filas, errores } = parsearCsvLugares(
      `${ENCABEZADO}\nTisipe,municipio,,\nShalagua,aldea,,`,
    );

    // Se carga lo valido y se avisa lo demas: un archivo largo no se pierde
    // por una linea mal escrita.
    expect(filas).toHaveLength(1);
    expect(filas[0].nombre).toBe('Shalagua');
    expect(errores[0].mensaje).toContain('Categoría no reconocida');
  });

  it('detecta nombres repetidos aunque cambien las tildes', () => {
    const { filas, errores } = parsearCsvLugares(
      `${ENCABEZADO}\nEl Volcán,aldea,,\nEl Volcan,caserio,,`,
    );

    expect(filas).toHaveLength(1);
    expect(errores[0].mensaje).toContain('repetido');
  });

  it('acepta el mismo nombre en aldeas distintas', () => {
    // Hay un Descombro en La Lima y otro en Lelá Obraje: son lugares
    // diferentes, no una repeticion.
    const { filas, errores } = parsearCsvLugares(
      `${ENCABEZADO}\nDescombro,caserio,Región I,La Lima`
      + `\nDescombro,caserio,Región I,Lelá Obraje`,
    );

    expect(errores).toHaveLength(0);
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.sector)).toEqual(['La Lima', 'Lelá Obraje']);
  });

  it('sigue rechazando el mismo nombre en la misma aldea', () => {
    const { filas, errores } = parsearCsvLugares(
      `${ENCABEZADO}\nZarzal,caserio,Región II,Shupá\nZarzal,caserio,Región II,Shupá`,
    );

    expect(filas).toHaveLength(1);
    expect(errores[0].mensaje).toContain('Shupá');
  });

  it('avisa cuando el archivo esta vacio', () => {
    expect(parsearCsvLugares('').errores[0].mensaje).toContain('vacío');
    expect(parsearCsvLugares('   \n  ').errores[0].mensaje).toContain('vacío');
  });

  it('no se cae con texto nulo', () => {
    expect(parsearCsvLugares(null).errores).toHaveLength(1);
  });
});
