// Fase E: la ficha que corresponde a cada etapa de vida.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sitiosExamen, fichasParaAtencion, FICHAS } =
  require('../src/services/fichaClinica.service');

const MARCA = 'FICHAQA';
let tokenPre;
let tokenMedico;

const sufijo = () => Math.random().toString(36).slice(2, 8);
const hace = (anios) => {
  const f = new Date();
  f.setFullYear(f.getFullYear() - anios);
  return f.toISOString().slice(0, 10);
};

beforeAll(async () => {
  const login = async (u) =>
    (await request(app).post('/api/v1/auth/login').send({ usuario: u, password: 'Camotan2026!' }))
      .body.token;
  [tokenPre, tokenMedico] = await Promise.all([login('preconsulta'), login('medico')]);
});

afterAll(async () => {
  const ids = (await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } }, select: { id: true },
  })).map((p) => p.id);

  if (ids.length > 0) {
    await prisma.episodioEmbarazo.deleteMany({ where: { pacienteId: { in: ids } } });
    const at = await prisma.atencion.findMany({ where: { pacienteId: { in: ids } }, select: { id: true } });
    await prisma.preconsulta.deleteMany({ where: { atencionId: { in: at.map((a) => a.id) } } });
    await prisma.atencion.deleteMany({ where: { id: { in: at.map((a) => a.id) } } });
    await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
    await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);
const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);

async function pacienteConAtencion({ anios, sexo = 'F' }) {
  const p = await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${sufijo()}`,
    nombres: 'Ficha',
    apellidos: `Prueba ${sufijo()}`,
    fechaNacimiento: hace(anios),
    sexo,
    comunidad: 'Tisipe',
    responsableNombre: 'Madre Prueba',
    responsableParentesco: 'madre',
    confirmarDuplicado: true,
  });

  const a = await pre(request(app).post('/api/v1/atenciones')).send({
    pacienteId: p.body.paciente.id,
    motivoConsulta: 'Control',
  });

  return { paciente: p.body.paciente, atencionId: a.body.atencion.id };
}

describe('E1. Estructura común', () => {
  it('declara los catorce sitios del examen físico', () => {
    expect(sitiosExamen('lactante_ninez')).toHaveLength(14);
  });

  it('la ficha de persona adulta agrega pies', () => {
    const sitios = sitiosExamen('adulto');
    expect(sitios).toHaveLength(15);
    expect(sitios.some((s) => s.clave === 'pies')).toBe(true);
  });

  it('expone las secciones comunes en el orden del formulario', async () => {
    const r = await med(request(app).get('/api/v1/fichas'));

    expect(r.status).toBe(200);
    const claves = r.body.secciones.map((s) => s.clave);
    expect(claves[0]).toBe('encabezado');
    expect(claves).toContain('signos_peligro');
    expect(claves).toContain('impresion_clinica');
    expect(claves.at(-1)).toBe('proveedor');
  });
});

describe('E2. Qué se registra una vez y qué en cada atención', () => {
  it('los antecedentes perinatales se registran una sola vez', () => {
    const s = FICHAS.lactante_ninez.seccionesPropias
      .find((x) => x.clave === 'antecedentes_perinatales');
    expect(s.momento).toBe('una_vez');
  });

  it('los factores de riesgo se registran en cada atención', () => {
    const s = FICHAS.adolescente_joven.seccionesPropias
      .find((x) => x.clave === 'factores_riesgo');
    expect(s.momento).toBe('cada_atencion');
  });
});

describe('E3. Selección automática de la ficha', () => {
  it('elige la de niñez para un paciente de 5 años', async () => {
    const { atencionId } = await pacienteConAtencion({ anios: 5 });
    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    expect(r.status).toBe(200);
    expect(r.body.etapa.clave).toBe('lactante_ninez');
    expect(r.body.fichas[0].clave).toBe('lactante_ninez');
  });

  it('elige la de adolescente a los 15', async () => {
    const { atencionId } = await pacienteConAtencion({ anios: 15 });
    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    expect(r.body.etapa.clave).toBe('adolescente_joven');
  });

  it('elige la de persona mayor a los 70', async () => {
    const { atencionId } = await pacienteConAtencion({ anios: 70 });
    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    expect(r.body.etapa.clave).toBe('persona_mayor');
    expect(r.body.fichas[0].sitiosExamen.some((s) => s.clave === 'pies')).toBe(true);
  });

  it('habilita además la prenatal cuando hay embarazo activo', async () => {
    const { paciente, atencionId } = await pacienteConAtencion({ anios: 25, sexo: 'F' });
    await pre(request(app).post(`/api/v1/pacientes/${paciente.id}/embarazos`))
      .send({ semanasAlRegistrar: 12 });

    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    expect(r.body.embarazoActivo).toBe(true);
    expect(r.body.fichas.map((f) => f.clave)).toEqual(['adolescente_joven', 'prenatal']);
  });

  it('la prenatal es complementaria, no reemplaza a la de la edad', () => {
    const fichas = fichasParaAtencion({ etapa: 'adulto', embarazoActivo: true });
    expect(fichas).toHaveLength(2);
    expect(fichas[1].complementaria).toBe(true);
  });
});

describe('E4. Signos de peligro por etapa', () => {
  it('a un niño le ofrece los signos de la ficha de niñez', async () => {
    const { atencionId } = await pacienteConAtencion({ anios: 3 });
    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    const textos = r.body.signosPeligro.map((s) => s.descripcion.toLowerCase());
    expect(textos.some((t) => t.includes('mamar') || t.includes('beber'))).toBe(true);
  });

  it('a un adulto le ofrece los signos de la ficha de persona adulta', async () => {
    const { atencionId } = await pacienteConAtencion({ anios: 45 });
    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    const textos = r.body.signosPeligro.map((s) => s.descripcion.toLowerCase());
    expect(textos.some((t) => t.includes('precordial'))).toBe(true);
    expect(textos.some((t) => t.includes('confusión mental'))).toBe(true);
    // No se le ofrecen los de lactancia.
    expect(textos.some((t) => t.includes('mamar'))).toBe(false);
  });
});

describe('La ficha de recién nacido no se inventa', () => {
  it('existe como tipo pero se declara sin confirmar', () => {
    expect(FICHAS.recien_nacido.confirmada).toBe(false);
    expect(FICHAS.recien_nacido.seccionesPropias).toHaveLength(0);
  });
});

describe('Los signos prenatales no se ofrecen a quien no está embarazada', () => {
  it('un adolescente varón no ve "Sangrado vaginal"', async () => {
    const { atencionId } = await pacienteConAtencion({ anios: 15, sexo: 'M' });
    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    const textos = r.body.signosPeligro.map((s) => s.descripcion.toLowerCase());
    expect(textos.some((t) => t.includes('vaginal'))).toBe(false);
  });

  it('una paciente con embarazo activo sí los ve', async () => {
    const { paciente, atencionId } = await pacienteConAtencion({ anios: 26, sexo: 'F' });
    await pre(request(app).post(`/api/v1/pacientes/${paciente.id}/embarazos`))
      .send({ semanasAlRegistrar: 20 });

    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    const textos = r.body.signosPeligro.map((s) => s.descripcion.toLowerCase());
    expect(textos.some((t) => t.includes('vaginal'))).toBe(true);
  });

  it('avisa cuando la lista de la etapa es provisional', async () => {
    // La ficha de adolescente no trae su lista en la capa de texto del PDF:
    // se usa la de persona adulta y el sistema lo declara.
    const { atencionId } = await pacienteConAtencion({ anios: 16, sexo: 'M' });
    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    expect(r.body.listaSignosProvisional).toBe(true);
    expect(r.body.signosPeligro.length).toBeGreaterThan(0);
  });

  it('no la marca provisional cuando la etapa sí tiene su lista', async () => {
    const { atencionId } = await pacienteConAtencion({ anios: 45, sexo: 'M' });
    const r = await med(request(app).get(`/api/v1/fichas/atencion/${atencionId}`));

    expect(r.body.listaSignosProvisional).toBe(false);
  });
});
