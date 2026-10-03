import { describe, it, expect } from 'vitest';

const imp = require('../src/services/importacionPacientes.service');

describe('normalizarCodigo', () => {
  it('reconoce las formas en que se escribió el código del papel', () => {
    expect(imp.normalizarCodigo('M-01')).toBe('M-1');
    expect(imp.normalizarCodigo('R= 483')).toBe('R-483');
    expect(imp.normalizarCodigo('M.562')).toBe('M-562');
    expect(imp.normalizarCodigo('G-1,047')).toBe('G-1047');
    expect(imp.normalizarCodigo('P- 559')).toBe('P-559');
    expect(imp.normalizarCodigo('V296')).toBe('V-296');
    expect(imp.normalizarCodigo('CH-1')).toBe('CH-1');
    expect(imp.normalizarCodigo('R-63ú')).toBe('R-63');
  });

  it('un cero seguido de separador es la letra O', () => {
    expect(imp.normalizarCodigo('0-01')).toBe('O-1');
    expect(imp.normalizarCodigo('0_107')).toBe('O-107');
  });

  it('lo que no tiene letra y número no es código', () => {
    expect(imp.normalizarCodigo('1016')).toBeNull();
    expect(imp.normalizarCodigo('A')).toBeNull();
    expect(imp.normalizarCodigo('')).toBeNull();
    expect(imp.normalizarCodigo(null)).toBeNull();
  });
});

describe('parsearEdad', () => {
  it('un número solo son años', () => {
    expect(imp.parsearEdad(12)).toEqual({ anios: 12, meses: 0, dias: 0 });
  });

  it('lee las abreviaturas y las palabras completas', () => {
    expect(imp.parsearEdad('6a')).toEqual({ anios: 6, meses: 0, dias: 0 });
    expect(imp.parsearEdad('9m')).toEqual({ anios: 0, meses: 9, dias: 0 });
    expect(imp.parsearEdad('1 MES')).toEqual({ anios: 0, meses: 1, dias: 0 });
    expect(imp.parsearEdad('40 dias')).toEqual({ anios: 0, meses: 0, dias: 40 });
    expect(imp.parsearEdad('40 años ')).toEqual({ anios: 40, meses: 0, dias: 0 });
  });

  it('combina años y meses', () => {
    expect(imp.parsearEdad('2 años 7 meses')).toEqual({ anios: 2, meses: 7, dias: 0 });
  });

  it('tolera las faltas de dedo frecuentes', () => {
    expect(imp.parsearEdad('3 mese')).toEqual({ anios: 0, meses: 3, dias: 0 });
    expect(imp.parsearEdad('9 mee')).toEqual({ anios: 0, meses: 9, dias: 0 });
    expect(imp.parsearEdad('2meses')).toEqual({ anios: 0, meses: 2, dias: 0 });
    expect(imp.parsearEdad('9 ños')).toEqual({ anios: 9, meses: 0, dias: 0 });
  });

  it('no inventa una edad donde no la hay', () => {
    expect(imp.parsearEdad('edad')).toBeNull();
    expect(imp.parsearEdad('f')).toBeNull();
    expect(imp.parsearEdad(null)).toBeNull();
    expect(imp.parsearEdad(250)).toBeNull();
  });
});

describe('normalizarSexo', () => {
  it('acepta mayúsculas, minúsculas y signos sueltos', () => {
    expect(imp.normalizarSexo('F')).toBe('F');
    expect(imp.normalizarSexo('f ')).toBe('F');
    expect(imp.normalizarSexo('#F')).toBe('F');
    expect(imp.normalizarSexo(',M')).toBe('M');
  });

  it('una letra que no es F ni M queda sin sexo', () => {
    expect(imp.normalizarSexo('R')).toBeNull();
    expect(imp.normalizarSexo('N')).toBeNull();
    expect(imp.normalizarSexo(null)).toBeNull();
  });
});

describe('repararFila', () => {
  it('saca el sexo escrito al final del nombre', () => {
    const f = imp.repararFila({ nombre: 'Santos Angelina Perez Garcia F', sexo: null });
    expect(f.nombre).toBe('Santos Angelina Perez Garcia');
    expect(f.sexo).toBe('F');
  });

  it('saca el sexo pegado a la última letra', () => {
    const f = imp.repararFila({ nombre: 'Dania Paola Mejia MendozaF', sexo: null });
    expect(f.nombre).toBe('Dania Paola Mejia Mendoza');
    expect(f.sexo).toBe('F');
  });

  it('saca la edad escrita en el nombre y la comunidad escrita en el sexo', () => {
    const f = imp.repararFila({
      nombre: 'Maria Leonor Pérez Gutiérrez de aldana 41 años ',
      sexo: 'f                              peña Blanca aldea el limon',
      edad: null,
      comunidad: null,
    });
    expect(f.nombre).toBe('Maria Leonor Pérez Gutiérrez de aldana');
    expect(f.edad).toBe('41 años');
    expect(f.sexo).toBe('f');
    expect(f.comunidad).toBe('peña Blanca aldea el limon');
  });

  it('no toca lo que ya estaba en su columna', () => {
    const fila = { nombre: 'Juan Perez M', sexo: 'F', edad: 30, comunidad: 'Pajco' };
    expect(imp.repararFila(fila)).toEqual(fila);
  });
});

describe('fechaDeLaFila', () => {
  it('usa la fecha propia de la fila', () => {
    expect(imp.fechaDeLaFila({ anio: 2025, fecha: '2025-01-06' }).toISOString().slice(0, 10)).toBe('2025-01-06');
  });

  it('una fecha fuera del año de su hoja es error de dedo', () => {
    expect(imp.fechaDeLaFila({ anio: 2025, fecha: '2052-01-06' }).toISOString().slice(0, 10)).toBe('2025-07-01');
  });

  it('sin fecha usa la de referencia de la hoja', () => {
    expect(imp.fechaDeLaFila({ anio: 2023 }).toISOString().slice(0, 10)).toBe('2023-07-01');
  });
});

describe('nacimientoDesdeEdad', () => {
  it('resta la edad a la fecha de la anotación', () => {
    const r = new Date('2023-07-01T12:00:00Z');
    expect(imp.nacimientoDesdeEdad({ anios: 12, meses: 0, dias: 0 }, r).toISOString().slice(0, 10)).toBe('2011-07-01');
    expect(imp.nacimientoDesdeEdad({ anios: 0, meses: 2, dias: 0 }, r).toISOString().slice(0, 10)).toBe('2023-05-01');
  });
});

describe('partirNombre', () => {
  // Léxico mínimo: cuatro filas con apellidos primero y código coherente.
  const lexico = imp.construirLexico([
    { nombre: 'RAMIREZ PEREZ MARIA JOSE', codigo: 'R-1' },
    { nombre: 'PEREZ GARCIA LIDIA ESTER', codigo: 'P-2' },
    { nombre: 'GARCIA LOPEZ JUANA MARIA', codigo: 'G-3' },
    { nombre: 'LOPEZ RAMIREZ ESTER LIDIA', codigo: 'L-4' },
  ]);

  it('apellidos primero, como en la hoja de 2023', () => {
    expect(imp.partirNombre('MENDEZ GARCIA FABIOLA MARBELY', 'M-1', lexico))
      .toEqual({ apellidos: 'Mendez Garcia', nombres: 'Fabiola Marbely' });
  });

  it('nombres primero: la letra del código marca dónde empiezan los apellidos', () => {
    expect(imp.partirNombre('samands abigail Guerra', 'G-934', lexico))
      .toEqual({ nombres: 'Samands Abigail', apellidos: 'Guerra' });
    expect(imp.partirNombre('Juan Ramon Lopez Garcia', 'L-236', lexico))
      .toEqual({ nombres: 'Juan Ramon', apellidos: 'Lopez Garcia' });
  });

  it('sin código decide por el léxico', () => {
    expect(imp.partirNombre('MARIA JOSE PEREZ GARCIA', null, lexico))
      .toEqual({ nombres: 'Maria Jose', apellidos: 'Perez Garcia' });
  });

  it('el apellido de casada se queda con los apellidos', () => {
    expect(imp.partirNombre('VASQUEZ AVALOS DE JERONIMO LIDIA', 'V-1', lexico))
      .toEqual({ apellidos: 'Vasquez Avalos de Jeronimo', nombres: 'Lidia' });
  });

  it('un apellido compuesto con partícula empieza en mayúscula', () => {
    expect(imp.partirNombre('DE LEON PEREZ OSMIN DONALDO', 'D-1', lexico))
      .toEqual({ apellidos: 'De Leon Perez', nombres: 'Osmin Donaldo' });
  });

  it('respeta las tildes que trae el texto', () => {
    expect(imp.partirNombre('Raymundo Díaz Teofila', 'R-483', lexico).apellidos).toBe('Raymundo Díaz');
  });

  it('una sola palabra no alcanza para nombre y apellido', () => {
    expect(imp.partirNombre('MARIA', null, lexico)).toBeNull();
  });
});

describe('comunidades', () => {
  it('las variantes de escritura tienen la misma clave', () => {
    const clave = imp.claveComunidad('PITAHAYA NEARAR');
    expect(imp.claveComunidad('Nearar Pitahaya')).toBe(clave);
    expect(imp.claveComunidad('EL DESCOMBRO')).toBe(imp.claveComunidad('Descombro'));
  });

  it('"Barrio La Barrera Camotán" y "Barrio Barrera" son el mismo barrio', () => {
    expect(imp.claveComunidad('BO. LA BARRERA CAMOTAN')).toBe(imp.claveComunidad('BARRIO BARRERA'));
  });

  it('otro municipio sí distingue', () => {
    expect(imp.claveComunidad('TIERRA BLANCA JOCOTAN')).not.toBe(imp.claveComunidad('TIERRA BLANCA'));
  });

  it('sin dato no hay comunidad', () => {
    expect(imp.claveComunidad(null)).toBeNull();
    expect(imp.claveComunidad('None')).toBeNull();
  });

  it('agrupa, corrige una letra y elige la forma más usada', () => {
    const { comunidades, comunidadDe } = imp.agruparComunidades(
      ['GUAYABO', 'GUAYABO', 'EL GUAYABO', 'Gayabo', 'PAJCO'],
      { pajco: 'Pajcó' },
    );
    expect(comunidades.map((c) => c.nombre)).toEqual(['Guayabo', 'Pajcó']);
    expect(comunidades[0].total).toBe(4);
    expect(comunidadDe('Gayabo')).toBe('Guayabo');
  });

  it('dos lugares que difieren en más de una letra no se juntan', () => {
    const { comunidades } = imp.agruparComunidades(['LIMON', 'LIMAR', 'NEARAR PETENTA', 'NEARAR PITAHAYA']);
    expect(comunidades).toHaveLength(4);
  });

  it('usa la ortografía del catálogo solo si es casi igual', () => {
    const { comunidades } = imp.agruparComunidades(
      ['SESESMILITO', 'PLAN DEL MORRO'],
      {},
      ['Sesemilito', 'Plan del Bordo', 'Plan del Morro'],
    );
    expect(comunidades.map((c) => c.nombre).sort()).toEqual(['Plan del Morro', 'Sesemilito']);
  });

  it('el barrio se reconoce por la abreviatura', () => {
    const { comunidades } = imp.agruparComunidades(['BO. EL CALVARIO CAMOTAN'], { camotan: 'Camotán' });
    expect(comunidades[0]).toMatchObject({ nombre: 'Barrio El Calvario Camotán', categoria: 'barrio' });
  });
});

describe('codigosInvalidos', () => {
  it('un código repetido en decenas de personas no identifica a nadie', () => {
    const filas = Array.from({ length: 20 }, (_, i) => ({ codigo: 'L-130', nombre: `Persona Numero${i}` }));
    filas.push({ codigo: 'R-14', nombre: 'Ramirez Amador Walter' }, { codigo: 'R-14', nombre: 'Amador Recinos Maria' });
    const invalidos = imp.codigosInvalidos(filas);
    expect(invalidos.has('L-130')).toBe(true);
    // Un expediente familiar con dos personas sí es válido.
    expect(invalidos.has('R-14')).toBe(false);
  });
});

describe('agruparPersonas', () => {
  const base = (extra) => ({
    nombres: 'Fabiola',
    apellidos: 'Mendez Garcia',
    nombre: 'Fabiola Mendez Garcia',
    sexo: 'F',
    nacimiento: new Date('2011-07-01'),
    codigo: 'M-1',
    comunidad: 'Nearar Pitahaya',
    fecha: new Date('2023-07-01'),
    hoja: 'pacientes 2023',
    fila: 4,
    ...extra,
  });

  it('la misma persona en dos años es un solo paciente', () => {
    const personas = imp.agruparPersonas([
      base(),
      base({ nombre: 'MENDEZ GARCIA FABIOLA', fecha: new Date('2024-07-01'), nacimiento: new Date('2011-03-01'), hoja: 'pacientes 2024' }),
    ]);
    expect(personas).toHaveLength(1);
    expect(personas[0].registros).toBe(2);
    // La fecha de nacimiento sale de la anotación más reciente.
    expect(personas[0].fechaNacimiento.toISOString().slice(0, 10)).toBe('2011-03-01');
    expect(personas[0].primeraVez.toISOString().slice(0, 10)).toBe('2023-07-01');
  });

  it('mismo nombre con edades muy distintas son dos personas', () => {
    const personas = imp.agruparPersonas([
      base({ codigo: null }),
      base({ codigo: null, nacimiento: new Date('1980-01-01') }),
    ]);
    expect(personas).toHaveLength(2);
  });

  it('mismo nombre con códigos distintos en comunidades distintas son dos personas', () => {
    const personas = imp.agruparPersonas([
      base(),
      base({ codigo: 'M-99', comunidad: 'Pajcó' }),
    ]);
    expect(personas).toHaveLength(2);
  });

  it('mismo código y nombre casi igual es la misma persona', () => {
    const personas = imp.agruparPersonas([
      base({ nombre: 'Gutierrez Guerra Liam Elier', codigo: 'G-9' }),
      base({ nombre: 'Gutierrez Guerra Liam Eviel', codigo: 'G-9', fecha: new Date('2024-07-01') }),
    ]);
    expect(personas).toHaveLength(1);
  });

  it('una persona sin edad toma la de otra anotación suya', () => {
    const personas = imp.agruparPersonas([
      base({ nacimiento: null }),
      base({ fecha: new Date('2024-07-01') }),
    ]);
    expect(personas[0].fechaNacimiento).not.toBeNull();
  });
});

describe('enTitulo', () => {
  it('pone tildes solo si el diccionario las conoce', () => {
    expect(imp.enTitulo('LELA CHANCO', { lela: 'Lelá', chanco: 'Chancó' })).toBe('Lelá Chancó');
    expect(imp.enTitulo('TAPUAN', {})).toBe('Tapuan');
  });

  it('respeta los números romanos', () => {
    expect(imp.enTitulo('PALO VERDE II')).toBe('Palo Verde II');
  });
});
