import { describe, it, expect } from 'vitest';

const { componerFichaImpresa, enBlanco } = require('../src/services/fichaImpresa.service');
const { estructuraIdentificacion } = require('../src/services/fichaIdentificacion.service');
const { seccionesDe } = require('../src/services/fichaSecciones.service');
const { CATALOGOS_3CS } = require('../src/services/hojaEvolucion.service');

function contexto({ nacimiento, sexo = 'F', datos = {}, atencion = {}, puedeVerSensibles = true }) {
  const registradaEn = new Date('2026-10-02T15:00:00Z');
  const estructura = estructuraIdentificacion(new Date(nacimiento), registradaEn);
  const perfil = { sexo, edadMeses: 480 };
  return {
    ficha: estructura.ficha,
    identificacion: estructura,
    secciones: seccionesDe(estructura.ficha.clave, perfil),
    filasSecciones: new Map(Object.entries(datos)),
    paciente: { nombres: 'Ana', apellidos: 'López', sexo, fechaNacimiento: new Date(nacimiento), expediente: '2026-00001', comunidad: 'Pajcó', orientacionSexual: '1' },
    perfil,
    edadTexto: '46 años',
    catalogos: {},
    atencion: { registradaEn, motivoConsulta: 'Cefalea', diagnosticos: [{ descripcion: 'Hipertensión esencial', cie: 'I10' }], ...atencion },
    antropometria: {},
    sitios: [{ clave: 'cabeza', etiqueta: 'Cabeza' }],
    signosPeligro: [{ codigo: 'confusion', descripcion: 'Confusión mental' }],
    puedeVerSensibles,
    sensiblesIdentificacion: ['orientacionSexual'],
    catalogos3cs: CATALOGOS_3CS,
    lugaresNotificacion: CATALOGOS_3CS.lugarNotificacion,
  };
}

const titulos = (f) => f.bloques.map((b) => b.titulo);

describe('ficha impresa en el orden del papel', () => {
  it('adulto: identificación, peligro, motivo, HE, antecedentes, signos vitales, examen, violencia, IC, cierre', () => {
    const t = titulos(componerFichaImpresa(contexto({ nacimiento: '1980-01-01' })));
    expect(t.slice(0, 5)).toEqual([
      'Identificación del paciente', 'Evalúe signos y síntomas de peligro', 'Motivo de consulta',
      'Historia de la enfermedad actual', 'Antecedentes',
    ]);
    expect(t.indexOf('Signos vitales')).toBeGreaterThan(t.indexOf('Historia abuso y/o violencia'));
    expect(t.slice(-5)).toEqual([
      'Examen físico', 'En caso de violencia', 'Impresión clínica (diagnóstico), codificación y tratamiento',
      'Cierre', 'Datos del SIGSA 3CS',
    ]);
  });

  it('neonato: el motivo va antes de los signos de peligro, como en su ficha', () => {
    const hace10 = new Date(Date.parse('2026-10-02T15:00:00Z') - 10 * 86400000).toISOString();
    const t = titulos(componerFichaImpresa(contexto({ nacimiento: hace10 })));
    expect(t.slice(0, 3)).toEqual(['Identificación', 'Motivo de consulta', 'Signos o síntomas de peligro']);
    expect(t).toContain('Familiograma');
  });

  it('niñez: lleva antropometría y maltrato infantil', () => {
    const t = titulos(componerFichaImpresa(contexto({ nacimiento: '2023-01-01' })));
    expect(t).toContain('Antropometría');
    expect(t).toContain('Maltrato infantil');
  });

  it('lo no registrado sale vacío, no como No', () => {
    const f = componerFichaImpresa(contexto({ nacimiento: '1980-01-01', datos: { medicos_adulto: { diabetes: true } } }));
    const medicos = f.bloques.find((b) => b.titulo === 'Médicos');
    const casillas = medicos.filas[0].casillas;
    expect(casillas.find((c) => c.etiqueta === 'Diabetes').valor).toBe('Sí');
    expect(casillas.find((c) => c.etiqueta === 'Asma').valor).toBe('');
  });

  it('la impresión clínica trae todos los diagnósticos y renglones en blanco', () => {
    const f = componerFichaImpresa(contexto({ nacimiento: '1980-01-01' }));
    const ic = f.bloques.find((b) => b.tabla);
    expect(ic.tabla.filas[0]).toEqual(['Hipertensión esencial', 'I10']);
    expect(ic.tabla.filas).toHaveLength(5);
  });

  it('a quien no ve datos sensibles le sale "Registrado"', () => {
    const f = componerFichaImpresa(contexto({
      nacimiento: '1980-01-01', puedeVerSensibles: false, datos: { familiares_adulto: { violencia: true } },
    }));
    const familiares = f.bloques.find((b) => b.titulo === 'Familiares');
    expect(familiares.filas[0].casillas.find((c) => c.etiqueta === 'Violencia').valor).toBe('Registrado');
    const orientacion = f.bloques[0].filas.find((x) => x.etiqueta === 'Orientación sexual');
    expect(orientacion.valor).toBe('Registrado');
  });

  it('en blanco no queda ningún valor', () => {
    const f = enBlanco(componerFichaImpresa(contexto({ nacimiento: '1980-01-01', datos: { medicos_adulto: { diabetes: true } } })));
    const valores = f.bloques.flatMap((b) => (b.filas ?? []).flatMap((x) => [x.valor ?? '', ...(x.casillas ?? []).map((c) => c.valor)]));
    expect(valores.every((v) => v === '')).toBe(true);
    expect(f.encabezado.every((e) => e.valor === '')).toBe(true);
  });
});
