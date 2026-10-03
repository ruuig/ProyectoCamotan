import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { renglonSigsa3cs, nacimiento } from '../src/services/sigsa3cs.service.js';

const paciente = {
  nombres: 'Julia', apellidos: 'Gutiérrez Torres', cui: '2039438170101', expediente: '2024-00010', expedientePapel: 'J-21',
  sexo: 'F', pueblo: '2', comunidadLinguistica: '6', fechaNacimiento: '2009-07-01T12:00:00Z', fechaNacimientoEstimada: false,
  discapacidad: '0', orientacionSexual: '1', escolaridad: '4', profesionOficio: 'Estudiante', municipioResidencia: 'Camotán',
  migrante: false, lugarPoblado: { nombre: 'Guior' },
};
const atencion = {
  id: 9, cerradaEn: '2026-10-05T16:00:00Z', paciente, tipoConsulta: 1, controlSigsa: 0, semanasGestacion: null,
  referenciaViene: 0, referenciaFue: 1, referidoA: 'Oftalmología', lugarNotificacion: 0, numeroNotificacion: null, acompanante: null,
  diagnosticos: [{ orden: 1, descripcion: 'Conjuntivitis', cie: 'H10.9' }, { orden: 0, descripcion: 'Cuerpo extraño en ojo', cie: 'T15.9' }],
  prescripciones: [{ cantidad: 10, insumo: { nombreGenerico: 'Ibuprofeno 400 mg', presentacion: 'tableta' } }],
};

describe('SIGSA-3CS: renglón de una consulta', () => {
  it('lleva las columnas del formulario con los códigos de la ficha', () => {
    const r = renglonSigsa3cs(atencion);
    expect(r).toMatchObject({
      dia: 5, historiaClinica: 'J-21', nombre: 'Julia Gutiérrez Torres', cui: '2039438170101', sexo: 'F',
      pueblo: '2', comunidadLinguistica: '6', discapacidad: '0', orientacionSexual: '1', escolaridad: '4',
      comunidad: 'Guior', municipio: 'Camotán', migrante: '', consulta: '1', control: '', fue: '1', referidoA: 'Oftalmología',
    });
    expect(r.nacimiento).toEqual({ dia: 1, mes: 7, anio: 2009, edad: '' });
    expect(r.diagnosticos.map((d) => d.cie)).toEqual(['T15.9', 'H10.9']);
    expect(r.tratamiento).toEqual([{ descripcion: 'Ibuprofeno 400 mg', presentacion: 'tableta', cantidad: 10 }]);
  });

  it('sin permiso de ver datos sensibles, la orientación sexual va vacía', () => {
    expect(renglonSigsa3cs(atencion, { sensibles: false }).orientacionSexual).toBe('');
  });

  it('con fecha de nacimiento estimada se anota la edad, no una fecha inventada', () => {
    expect(nacimiento({ fechaNacimiento: '1968-07-01T12:00:00Z', fechaNacimientoEstimada: true }, '2026-10-05T16:00:00Z'))
      .toEqual({ dia: '', mes: '', anio: '', edad: '58 años' });
    expect(nacimiento({ fechaNacimiento: '2025-10-01T12:00:00Z', fechaNacimientoEstimada: true }, '2026-10-05T16:00:00Z').edad).toBe('1 año');
    expect(nacimiento({ fechaNacimiento: '2026-03-01T12:00:00Z', fechaNacimientoEstimada: true }, '2026-10-05T16:00:00Z').edad).toBe('7 meses');
  });

  it('marca con X al agrícola migrante', () => {
    expect(renglonSigsa3cs({ ...atencion, paciente: { ...paciente, migrante: true } }).migrante).toBe('X');
  });
});

describe('SIGSA-3CS: acceso', () => {
  const entrar = async (usuario) => (await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' })).body.token;
  it('el médico lo genera y lo descarga en Excel; farmacia y bodega no', async () => {
    const q = 'desde=2026-10-01&hasta=2026-10-31';
    const tm = await entrar('medico');
    const r = await request(app).get(`/api/v1/sigsa/3cs?${q}`).set('Authorization', `Bearer ${tm}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.renglones)).toBe(true);
    const x = await request(app).get(`/api/v1/sigsa/3cs/excel?${q}`).set('Authorization', `Bearer ${tm}`);
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    for (const u of ['farmacia', 'bodega']) {
      const t = await entrar(u);
      expect((await request(app).get(`/api/v1/sigsa/3cs?${q}`).set('Authorization', `Bearer ${t}`)).status).toBe(403);
    }
  });
});
