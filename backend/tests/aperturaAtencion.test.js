import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * La atención se abre al guardar la toma de signos, no al tocar "Atender";
 * y la que se abrió por error se cancela con su motivo.
 */

const MARCA = `APE${Date.now()}`;
let tokenPre;
let tokenMedico;

async function login(usuario) {
  return (await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' })).body.token;
}
const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);
const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);

async function nuevoPaciente() {
  const r = await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres: 'Apertura', apellidos: `Prueba ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento: '1985-05-05', sexo: 'M', comunidad: 'Tisipe', confirmarDuplicado: true,
  });
  return r.body.paciente;
}

const atencionesDe = (pacienteId) => prisma.atencion.findMany({ where: { pacienteId }, include: { preconsulta: true } });

beforeAll(async () => {
  [tokenPre, tokenMedico] = await Promise.all([login('preconsulta'), login('medico')]);
});

afterAll(async () => {
  const ids = (await prisma.paciente.findMany({ where: { expedientePapel: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id);
  const aIds = (await prisma.atencion.findMany({ where: { pacienteId: { in: ids } }, select: { id: true } })).map((a) => a.id);
  await prisma.prescripcion.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.antropometria.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.atencion.deleteMany({ where: { id: { in: aIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('la atención se abre al guardar la toma de signos', () => {
  it('con los datos completos se crean juntas la atención y su preconsulta', async () => {
    const p = await nuevoPaciente();
    const r = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({
      pacienteId: p.id, motivoConsulta: 'Fiebre', temperatura: 38.5, peso: 70,
    });
    expect(r.status).toBe(201);
    const [a] = await atencionesDe(p.id);
    expect(a).toMatchObject({ estado: 'en_espera', motivoConsulta: 'Fiebre' });
    expect(Number(a.preconsulta.temperatura)).toBe(38.5);
    expect(r.body.preconsulta.atencionId).toBe(a.id);
  });

  it('sin motivo de consulta no se abre nada', async () => {
    const p = await nuevoPaciente();
    const r = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({ pacienteId: p.id, temperatura: 37 });
    expect(r.status).toBe(400);
    expect(await atencionesDe(p.id)).toEqual([]);
  });

  it('si un dato no pasa (peso imposible), la atención se deshace', async () => {
    const p = await nuevoPaciente();
    const r = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({
      pacienteId: p.id, motivoConsulta: 'Control', peso: 900, unidadPeso: 'kg',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('peso_fuera_de_rango');
    expect(await atencionesDe(p.id)).toEqual([]);
  });

  it('no abre una segunda atención si ya hay una en curso', async () => {
    const p = await nuevoPaciente();
    await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({ pacienteId: p.id, motivoConsulta: 'Tos' });
    const r = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({ pacienteId: p.id, motivoConsulta: 'Tos' });
    expect(r.status).toBe(409);
    expect(await atencionesDe(p.id)).toHaveLength(1);
  });
});

describe('cancelar una atención abierta por error', () => {
  async function abierta() {
    const p = await nuevoPaciente();
    const r = await pre(request(app).post('/api/v1/atenciones')).send({ pacienteId: p.id });
    return { paciente: p, atencion: r.body.atencion };
  }

  it('exige el motivo', async () => {
    const { atencion } = await abierta();
    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/cancelar`)).send({ motivo: 'no' });
    expect(r.status).toBe(400);
  });

  it('sale de la cola, queda quién y por qué, y se puede volver a abrir', async () => {
    const { paciente, atencion } = await abierta();
    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/cancelar`)).send({ motivo: 'Se abrió por error' });
    expect(r.status).toBe(200);
    const guardada = await prisma.atencion.findUnique({ where: { id: atencion.id } });
    expect(guardada).toMatchObject({ estado: 'cancelada', motivoCancelacion: 'Se abrió por error' });
    expect(guardada.canceladaPor).toBeTruthy();

    const cola = await pre(request(app).get('/api/v1/atenciones/cola'));
    expect(JSON.stringify(cola.body)).not.toContain(`"id":${atencion.id},`);

    const otra = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({ pacienteId: paciente.id, motivoConsulta: 'Ahora sí' });
    expect(otra.status).toBe(201);
  });

  it('no se cancela si el médico ya recetó, ni una ya atendida', async () => {
    const { atencion } = await abierta();
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_atencion' });
    const insumo = (await med(request(app).get('/api/v1/insumos?prescribible=true'))).body.insumos[0];
    await med(request(app).post(`/api/v1/atenciones/${atencion.id}/prescripcion`)).send({ insumoId: insumo.id, cantidad: 1 });
    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/cancelar`)).send({ motivo: 'Se abrió por error' });
    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('consulta_iniciada');

    await med(request(app).patch(`/api/v1/atenciones/${atencion.id}/consulta`)).send({ diagnosticoCie: 'R52', diagnosticoTxt: 'Dolor' });
    const otra = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/cancelar`)).send({ motivo: 'Se abrió por error' });
    expect(otra.status).toBe(409);
    expect(otra.body.error.codigo).toBe('no_cancelable');
  });
});
