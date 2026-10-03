import { describe, it, expect } from 'vitest';

const {
  estructuraIdentificacion,
  faltantes,
  escolaridadSigsa,
  diasDeVida,
  PUEBLO,
  ESTADO_CIVIL,
} = require('../src/services/fichaIdentificacion.service');
const { evaluarFicha } = require('../src/services/ficha.service');
const { DEPARTAMENTOS, municipiosDe, esDepartamento } = require('../src/services/geografia.service');

const HOY = new Date('2026-10-02T12:00:00Z');

function nacidoHace({ dias = 0, anios = 0 }) {
  const f = new Date(HOY);
  f.setUTCFullYear(f.getUTCFullYear() - anios);
  f.setUTCDate(f.getUTCDate() - dias);
  return f;
}

const claves = (e) => e.campos.map((c) => c.clave);

describe('elección de la ficha por edad', () => {
  it('de 0 a 28 días es la ficha de neonato', () => {
    const e = estructuraIdentificacion(nacidoHace({ dias: 10 }), HOY);
    expect(e.ficha.clave).toBe('recien_nacido');
    expect(e.ficha.nombre).toBe('Ficha clínica para neonato');
    expect(e.ficha.rango).toBe('de 0 a 28 días');
    expect(e.seccion).toBe('Identificación');
  });

  it('el día 29 ya es la ficha de lactante, niña y niño', () => {
    const e = estructuraIdentificacion(nacidoHace({ dias: 29 }), HOY);
    expect(e.ficha.clave).toBe('lactante_ninez');
    expect(e.seccion).toBe('Identificación de la niña o niño');
  });

  it('de 10 a menos de 30 años es la de adolescente, y se marca provisional', () => {
    const e = estructuraIdentificacion(nacidoHace({ anios: 15 }), HOY);
    expect(e.ficha.clave).toBe('adolescente_joven');
    expect(e.ficha.provisional).toBe(true);
    expect(e.ficha.notaProvisional).toMatch(/fotografiado/);
  });

  it('adulto y persona mayor comparten ficha pero no rango', () => {
    const adulto = estructuraIdentificacion(nacidoHace({ anios: 40 }), HOY);
    const mayor = estructuraIdentificacion(nacidoHace({ anios: 70 }), HOY);
    expect(adulto.ficha.nombre).toBe(mayor.ficha.nombre);
    expect(adulto.ficha.rango).toBe('adulta/o de 30 a 59 años');
    expect(mayor.ficha.rango).toBe('persona mayor de 60 años y más');
    expect(adulto.seccion).toBe('Identificación del paciente');
  });

  it('se elige por la edad a la fecha de la atención, no a la de hoy', () => {
    const nacimiento = new Date('2016-10-10T12:00:00Z');
    expect(estructuraIdentificacion(nacimiento, new Date('2026-10-01T12:00:00Z')).ficha.clave)
      .toBe('lactante_ninez');
    expect(estructuraIdentificacion(nacimiento, new Date('2026-10-20T12:00:00Z')).ficha.clave)
      .toBe('adolescente_joven');
  });
});

describe('orden y campos de cada ficha', () => {
  it('neonato: RENAP antes del domicilio y datos de la madre al final', () => {
    const c = claves(estructuraIdentificacion(nacidoHace({ dias: 5 }), HOY));
    expect(c.indexOf('noInscritoRenap')).toBeLessThan(c.indexOf('domicilio'));
    expect(c.slice(-3)).toEqual(['responsableNombre', 'edadMadre', 'celular']);
  });

  it('niñez: la escolaridad es una subdivisión dentro de la identificación', () => {
    const e = estructuraIdentificacion(nacidoHace({ anios: 7 }), HOY);
    const escolaridad = e.campos.filter((x) => x.subseccion === 'Escolaridad').map((x) => x.clave);
    expect(escolaridad).toEqual([
      'estudiaActualmente', 'desercionEscolar', 'ultimoGradoAprobado', 'aniosRepetidos',
    ]);
  });

  it('niñez: el DPI del responsable es el último campo', () => {
    const c = claves(estructuraIdentificacion(nacidoHace({ anios: 3 }), HOY));
    expect(c[c.length - 1]).toBe('responsableDpi');
  });

  it('adulto: no tiene municipio de nacimiento y sí escolaridad propia', () => {
    const c = claves(estructuraIdentificacion(nacidoHace({ anios: 45 }), HOY));
    expect(c).not.toContain('municipioNacimiento');
    expect(c).toContain('nivelEscolar');
    expect(c).toContain('celular');
    expect(c.indexOf('telefono')).toBeLessThan(c.indexOf('celular'));
  });

  it('no existe ninguna agrupación inventada', () => {
    for (const anios of [0, 5, 15, 45, 70]) {
      const e = estructuraIdentificacion(nacidoHace({ anios, dias: anios === 0 ? 3 : 0 }), HOY);
      expect(e.seccion).not.toMatch(/Origen|pertenencia|Educación y ocupación/);
    }
  });

  it('adolescente: orientación sexual solo a mayores de 20', () => {
    expect(claves(estructuraIdentificacion(nacidoHace({ anios: 16 }), HOY)))
      .not.toContain('orientacionSexual');
    expect(claves(estructuraIdentificacion(nacidoHace({ anios: 22 }), HOY)))
      .toContain('orientacionSexual');
  });

  it('adolescente: referente adulto solo en menores de 18', () => {
    expect(claves(estructuraIdentificacion(nacidoHace({ anios: 15 }), HOY)))
      .toContain('responsableNombre');
    expect(claves(estructuraIdentificacion(nacidoHace({ anios: 19 }), HOY)))
      .not.toContain('responsableNombre');
  });

  it('el pueblo va en el orden de la ficha con "No indica" al final', () => {
    expect(PUEBLO.map((p) => p.etiqueta)).toEqual([
      'Maya', 'Garífuna', 'Xinca', 'Mestizo', 'Otro', 'No indica',
    ]);
  });

  it('el estado civil trae solo las opciones del papel', () => {
    expect(ESTADO_CIVIL.map((e) => e.etiqueta)).toEqual(['Soltero/a', 'Casado/a', 'Viudo/a']);
  });

  it('los datos del SIGSA van aparte y no repiten la escolaridad del adulto', () => {
    const adulto = estructuraIdentificacion(nacidoHace({ anios: 45 }), HOY);
    const nino = estructuraIdentificacion(nacidoHace({ anios: 6 }), HOY);
    expect(adulto.sigsa.map((c) => c.clave)).not.toContain('escolaridad');
    expect(nino.sigsa.map((c) => c.clave)).toContain('escolaridad');
    expect(adulto.sigsa.map((c) => c.clave)).toContain('discapacidad');
  });
});

describe('faltantes', () => {
  const adulto = {
    fechaNacimiento: nacidoHace({ anios: 45 }),
    departamentoNacimiento: 'Chiquimula',
    domicilio: 'Aldea Lela',
    departamentoResidencia: 'Chiquimula',
    municipioResidencia: 'Camotán',
    nivelEscolar: 'primaria',
    trabaja: true,
    pueblo: '1',
    estadoCivil: 'casado',
    discapacidad: '0',
  };

  it('un adulto con lo que pide su ficha está completo', () => {
    expect(faltantes(adulto, estructuraIdentificacion(adulto.fechaNacimiento, HOY))).toEqual([]);
  });

  it('"No" en trabaja es una respuesta, no un faltante', () => {
    const p = { ...adulto, trabaja: false };
    expect(faltantes(p, estructuraIdentificacion(p.fechaNacimiento, HOY))).toEqual([]);
  });

  it('la comunidad lingüística solo se exige si el pueblo es Maya', () => {
    const maya = { ...adulto, pueblo: '2' };
    expect(faltantes(maya, estructuraIdentificacion(maya.fechaNacimiento, HOY)).map((f) => f.campo))
      .toEqual(['comunidadLinguistica']);
  });

  it('los datos sensibles nunca cuentan como faltantes', () => {
    const f = faltantes(adulto, estructuraIdentificacion(adulto.fechaNacimiento, HOY));
    expect(f.map((x) => x.campo)).not.toContain('orientacionSexual');
  });

  it('solo cuentan los mínimos del SIGSA, no toda la identificación', () => {
    const e = estructuraIdentificacion(nacidoHace({ anios: 1 }), HOY);
    const f = faltantes({ fechaNacimiento: nacidoHace({ anios: 1 }) }, e).map((x) => x.campo);
    expect(f.sort()).toEqual(
      ['departamentoResidencia', 'discapacidad', 'escolaridad', 'municipioResidencia', 'pueblo'].sort(),
    );
    // El domicilio o el responsable se piden en la ficha, pero no generan alarma.
    expect(f).not.toContain('domicilio');
    expect(f).not.toContain('responsableNombre');
  });

  it('en adulto la escolaridad mínima es la de la ficha, no la del SIGSA', () => {
    const e = estructuraIdentificacion(nacidoHace({ anios: 45 }), HOY);
    const f = faltantes({}, e).map((x) => x.campo);
    expect(f).toContain('nivelEscolar');
    expect(f).not.toContain('escolaridad');
  });

  it('evaluarFicha devuelve el nombre y rango de la ficha usada', () => {
    const r = evaluarFicha(adulto, HOY);
    expect(r.completa).toBe(true);
    expect(r.nombre).toBe('Ficha clínica para persona adulta y persona mayor');
    expect(r.rango).toBe('adulta/o de 30 a 59 años');
  });
});

describe('escolaridad SIGSA derivada de la ficha de adulto', () => {
  it('traduce cada opción de la ficha a su código SIGSA', () => {
    expect(escolaridadSigsa('analfabeta')).toBe('7');
    expect(escolaridadSigsa('primaria')).toBe('3');
    expect(escolaridadSigsa('basicos')).toBe('4');
    expect(escolaridadSigsa('diversificado')).toBe('5');
    expect(escolaridadSigsa('universitaria')).toBe('6');
  });

  it('sin respuesta no inventa un código', () => {
    expect(escolaridadSigsa(null)).toBeNull();
    expect(escolaridadSigsa('otra')).toBeNull();
  });
});

describe('diasDeVida', () => {
  it('cuenta días cumplidos', () => {
    expect(diasDeVida(nacidoHace({ dias: 28 }), HOY)).toBe(28);
  });
});

describe('geografía', () => {
  it('trae los 22 departamentos con código del INE', () => {
    expect(DEPARTAMENTOS).toHaveLength(22);
    expect(DEPARTAMENTOS.find((d) => d.nombre === 'Chiquimula').codigo).toBe('20');
  });

  it('Chiquimula tiene sus 11 municipios, Camotán incluido', () => {
    expect(municipiosDe('Chiquimula')).toHaveLength(11);
    expect(municipiosDe('Chiquimula')).toContain('Camotán');
  });

  it('un departamento sin catálogo devuelve lista vacía, no inventa', () => {
    expect(municipiosDe('Petén')).toEqual([]);
    expect(esDepartamento('Petén')).toBe(true);
    expect(esDepartamento('Atlántida')).toBe(false);
  });
});
