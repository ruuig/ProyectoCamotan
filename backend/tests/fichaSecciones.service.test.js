import { describe, it, expect } from 'vitest';

const sec = require('../src/services/fichaSecciones.service');
const fp = require('../src/services/fichaPaciente.service');

const titulos = (lista) => lista.map((s) => s.titulo);

describe('secciones por ficha, en el orden del papel', () => {
  it('neonato: perinatales, alimentación, psicosociales, maternos, vacunación y familiograma', () => {
    expect(titulos(sec.seccionesDe('recien_nacido', { sexo: 'F', edadMeses: 0 }))).toEqual([
      'Perinatales', 'Alimentación', 'Psicosociales', 'Maternos', 'Vacunación', 'Familiograma',
    ]);
  });

  it('niñez: perinatales, médicos, familiares, psicosociales y estilos de vida', () => {
    expect(titulos(sec.seccionesDe('lactante_ninez', { sexo: 'M', edadMeses: 30 }))).toEqual([
      'Perinatales', 'Médicos', 'Familiares', 'Psicosociales', 'Estilos de vida: alimentación según edad',
    ]);
  });

  it('adulto y persona mayor comparten secciones', () => {
    const esperado = [
      'Personales', 'Médicos', 'Psicosociales', 'Estilos de vida', 'Familiares',
      'Vacunación', 'Suplementación', 'Hábitos', 'Historia abuso y/o violencia',
    ];
    expect(titulos(sec.seccionesDe('adulto', { sexo: 'F', edadMeses: 480 }))).toEqual(esperado);
    expect(titulos(sec.seccionesDe('persona_mayor', { sexo: 'M', edadMeses: 900 }))).toEqual(esperado);
  });

  it('adolescente no tiene secciones hasta confirmar su ficha', () => {
    expect(sec.seccionesDe('adolescente_joven', { sexo: 'F', edadMeses: 180 })).toEqual([]);
  });

  it('todas van dentro de Antecedentes, como en el papel', () => {
    expect(sec.seccionesDe('adulto', { sexo: 'F', edadMeses: 480 }).every((s) => s.grupo === 'Antecedentes')).toBe(true);
  });

  it('no hay claves de sección repetidas entre fichas distintas', () => {
    const claves = [...sec.NEONATO, ...sec.NINEZ, ...sec.ADULTO].map((s) => s.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('dentro de cada sección ninguna clave de dato se repite', () => {
    for (const s of sec.TODAS.values()) {
      const claves = s.campos.flatMap(sec.clavesDe);
      expect(new Set(claves).size, s.clave).toBe(claves.length);
    }
  });
});

describe('campos según sexo y edad', () => {
  const personales = (sexo) => sec.seccionesDe('adulto', { sexo, edadMeses: 480 })[0].campos.map((c) => c.clave);

  it('embarazos, abortos, FUR y ciclos solo en mujeres', () => {
    expect(personales('F')).toEqual(expect.arrayContaining(['embarazos', 'abortos', 'fur', 'ciclosIrregulares', 'dismenorrea']));
    expect(personales('M')).not.toContain('embarazos');
    expect(personales('M')).not.toContain('fur');
    expect(personales('M')).toContain('hijos');
  });

  it('la alimentación de la niñez se muestra según la edad', () => {
    const campos = (meses) => sec.seccionesDe('lactante_ninez', { sexo: 'F', edadMeses: meses })[4].campos.map((c) => c.clave);
    expect(campos(3)).toContain('lmExclusiva');
    expect(campos(3)).not.toContain('alimentacionComplementaria');
    expect(campos(12)).not.toContain('lmExclusiva');
    expect(campos(12)).toContain('alimentacionComplementaria');
  });

  it('"¿Es peligroso?" solo aparece si hay trabajo infantil', () => {
    const psico = sec.TODAS.get('psicosociales_ninez');
    const peligroso = psico.campos.find((c) => c.clave === 'trabajoPeligroso');
    expect(sec.aplica(peligroso, {}, { trabajoInfantil: true })).toBe(true);
    expect(sec.aplica(peligroso, {}, { trabajoInfantil: false })).toBe(false);
    expect(sec.aplica(peligroso, {}, {})).toBe(false);
  });
});

describe('validación', () => {
  const medicos = sec.TODAS.get('medicos_adulto');
  const esquema = sec.esquemaSeccion(medicos);

  it('acepta las tres respuestas de cada casilla', () => {
    expect(esquema.safeParse({ diabetes: true, asma: false, tb: null }).success).toBe(true);
  });

  it('rechaza una clave que la sección no tiene', () => {
    expect(esquema.safeParse({ inventado: true }).success).toBe(false);
  });

  it('rechaza un número fuera de rango', () => {
    const personales = sec.esquemaSeccion(sec.TODAS.get('personales_adulto'));
    expect(personales.safeParse({ menarquia: 3 }).success).toBe(false);
    expect(personales.safeParse({ menarquia: 12 }).success).toBe(true);
  });

  it('rechaza una opción que no está en la lista', () => {
    const psico = sec.esquemaSeccion(sec.TODAS.get('psicosociales_adulto'));
    expect(psico.safeParse({ viveCon: 'familia' }).success).toBe(true);
    expect(psico.safeParse({ viveCon: 'luna' }).success).toBe(false);
  });
});

describe('normalizarDatos', () => {
  it('borra el detalle de un "especifique" que no es Sí', () => {
    const s = sec.TODAS.get('personales_adulto');
    expect(sec.normalizarDatos(s, { anticonceptivos: false, anticonceptivosDetalle: 'Pastillas' }).anticonceptivosDetalle).toBeNull();
    expect(sec.normalizarDatos(s, { anticonceptivos: true, anticonceptivosDetalle: 'Pastillas' }).anticonceptivosDetalle).toBe('Pastillas');
  });

  it('borra el texto de "otro" si la opción ya no es otro', () => {
    const s = sec.TODAS.get('psicosociales_adulto');
    expect(sec.normalizarDatos(s, { viveCon: 'familia', viveConOtro: 'Con la abuela' }).viveConOtro).toBeNull();
  });
});

describe('tres estados: nunca se asume No', () => {
  const familiares = sec.TODAS.get('familiares_adulto');

  it('una casilla vacía no cuenta como respondida', () => {
    expect(sec.avanceSeccion(familiares, {})).toEqual({ respondidas: 0, total: 11 });
    expect(sec.avanceSeccion(familiares, { diabetes: false })).toEqual({ respondidas: 1, total: 11 });
  });

  it('"Marcar el resto como No" respeta lo marcado y no toca las sensibles', () => {
    const r = sec.marcarRestoComoNo(familiares, { diabetes: true });
    expect(r.diabetes).toBe(true);
    expect(r.hipertension).toBe(false);
    expect(r.demencia).toBe(false);
    expect(r.violencia).toBeUndefined();
    expect(r.judiciales).toBeUndefined();
  });

  it('"Marcar el resto como No" no cambia una respuesta No ya dada ni un Sí', () => {
    const r = sec.marcarRestoComoNo(familiares, { cancer: false, tb: true });
    expect(r.cancer).toBe(false);
    expect(r.tb).toBe(true);
  });
});

describe('clasificación del peso al nacer', () => {
  it('usa los cortes del papel', () => {
    // Los cortes impresos en libras: 5 lb 4 onz y 8 lb.
    expect(sec.clasificacionPesoNacer(5, 3)).toBe('Menor de 2,500 g');
    expect(sec.clasificacionPesoNacer(5, 4)).toBe('De 2,500 a 4,000 g');
    expect(sec.clasificacionPesoNacer(8, 0)).toBe('De 2,500 a 4,000 g');
    expect(sec.clasificacionPesoNacer(8, 1)).toBe('Mayor de 4,000 g');
  });

  it('sin peso no clasifica', () => {
    expect(sec.clasificacionPesoNacer(null, null)).toBeNull();
  });

  it('se calcula desde los datos de la sección', () => {
    const s = sec.TODAS.get('perinatales_neonato');
    expect(sec.calculados(s, { pesoNacerLb: 6, pesoNacerOnz: 2 }).clasificacionPesoNacer).toBe('De 2,500 a 4,000 g');
  });
});

describe('datos sensibles', () => {
  const sensibles = new Set(['violencia', 'judiciales']);

  it('se reconocen en casillas y en campos completos', () => {
    expect([...sec.clavesSensibles(sec.TODAS.get('familiares_adulto'))].sort()).toEqual(['judiciales', 'violencia']);
    expect([...sec.clavesSensibles(sec.TODAS.get('historia_abuso'))].sort()).toEqual(['historiaAbuso', 'historiaAbusoDetalle']);
  });

  it('a quien no puede verlos se le dice que están registrados, no qué dicen', () => {
    const r = fp.enmascarar({ diabetes: true, violencia: true, judiciales: null }, sensibles);
    expect(r.datos).toEqual({ diabetes: true, judiciales: null });
    expect(r.registrados).toEqual(['violencia']);
  });

  it('preconsulta puede registrar uno vacío', () => {
    const r = fp.fusionarCambios({ anteriores: {}, nuevos: { violencia: true }, sensibles, puedeVerSensibles: false });
    expect(r.error).toBeUndefined();
    expect(r.cambios).toEqual([{ campo: 'violencia', anterior: null, nuevo: true, sensible: true }]);
  });

  it('preconsulta no puede cambiar ni borrar uno ya registrado', () => {
    const cambiar = fp.fusionarCambios({ anteriores: { violencia: true }, nuevos: { violencia: false }, sensibles, puedeVerSensibles: false });
    expect(cambiar.error).toBe('sensible_registrado');
    const borrar = fp.fusionarCambios({ anteriores: { violencia: true }, nuevos: { violencia: null }, sensibles, puedeVerSensibles: false });
    expect(borrar.error).toBe('sensible_registrado');
  });

  it('el médico sí puede cambiarlo', () => {
    const r = fp.fusionarCambios({ anteriores: { violencia: true }, nuevos: { violencia: false }, sensibles, puedeVerSensibles: true });
    expect(r.cambios).toHaveLength(1);
  });

  it('lo que no viene se conserva', () => {
    const r = fp.fusionarCambios({ anteriores: { violencia: true, diabetes: false }, nuevos: { diabetes: true }, sensibles, puedeVerSensibles: false });
    expect(r.datos).toEqual({ violencia: true, diabetes: true });
  });

  it('en el historial, preconsulta ve que cambió pero no el valor', () => {
    const h = fp.historialVisible([{ campo: 'violencia', anterior: null, nuevo: true, sensible: true }], false);
    expect(h[0]).toMatchObject({ anterior: null, nuevo: 'registrado', oculto: true });
    expect(fp.historialVisible([{ campo: 'violencia', anterior: null, nuevo: true, sensible: true }], true)[0].nuevo).toBe(true);
  });
});

describe('fusionarCambios', () => {
  it('solo registra lo que de verdad cambió', () => {
    const r = fp.fusionarCambios({
      anteriores: { diabetes: false, otrosMedicos: 'Gastritis' },
      nuevos: { diabetes: false, otrosMedicos: 'Gastritis crónica', asma: '' },
      sensibles: new Set(),
      puedeVerSensibles: false,
    });
    expect(r.cambios.map((c) => c.campo)).toEqual(['otrosMedicos']);
  });
});

describe('resumen de antecedentes para el médico', () => {
  const { leerSeccion, resumenAntecedentes } = require('../src/services/resumenFicha.service');

  it('lista lo marcado como Sí y cuenta los No', () => {
    const r = leerSeccion(sec.TODAS.get('medicos_adulto'), { diabetes: true, asma: false, tb: false }, { sexo: 'F', edadMeses: 480 });
    expect(r.positivos).toEqual(['Diabetes']);
    expect(r.negativos).toBe(2);
  });

  it('incluye el detalle de un Sí con especifique y las selecciones', () => {
    const r = leerSeccion(sec.TODAS.get('psicosociales_adulto'), { viveCon: 'otro', viveConOtro: 'Con la abuela' }, {});
    expect(r.datos).toEqual(['Vive con: Otro: Con la abuela']);
    const p = leerSeccion(sec.TODAS.get('personales_adulto'), { anticonceptivos: true, anticonceptivosDetalle: 'Inyección' }, { sexo: 'F' });
    expect(p.positivos).toEqual(['Uso de métodos anticonceptivos (Inyección)']);
  });

  it('dice qué secciones siguen sin registrar y qué sensibles se mostraron', () => {
    const paciente = { fechaNacimiento: new Date('1980-01-01'), sexo: 'F' };
    const r = resumenAntecedentes(paciente, [{ seccion: 'familiares_adulto', datos: { violencia: true }, actualizadoEn: new Date() }]);
    expect(r.secciones.find((s) => s.clave === 'familiares_adulto').positivos).toEqual(['Violencia']);
    expect(r.secciones.find((s) => s.clave === 'medicos_adulto').registrada).toBe(false);
    expect(r.sensibles).toEqual(['familiares_adulto.violencia']);
  });
});
