import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { mediana } from '../src/controllers/mediciones.controller.js';

/** Tiempo de registro y consulta de fichas: se guarda solo y lo ve dirección. */

let tokenPre;
let tokenAdmin;
const login = async (usuario) => (await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' })).body.token;

beforeAll(async () => {
  [tokenPre, tokenAdmin] = await Promise.all([login('preconsulta'), login('admin')]);
  await prisma.medicionTiempo.deleteMany({});
});
afterAll(async () => {
  await prisma.medicionTiempo.deleteMany({});
  await prisma.$disconnect();
});

describe('mediciones de tiempo', () => {
  it('mediana de una lista', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(3);
  });

  it('preconsulta las envía y dirección ve el resumen, sin contar las olvidadas', async () => {
    for (const ms of [20000, 40000, 30000]) {
      const r = await request(app).post('/api/v1/indicadores/mediciones').set('Authorization', `Bearer ${tokenPre}`).send({ tipo: 'registro', milisegundos: ms, pantalla: 'registrar_paciente' });
      expect(r.status).toBe(201);
    }
    await request(app).post('/api/v1/indicadores/mediciones').set('Authorization', `Bearer ${tokenPre}`).send({ tipo: 'consulta', milisegundos: 20 * 60000 });

    expect((await request(app).get('/api/v1/indicadores/mediciones').set('Authorization', `Bearer ${tokenPre}`)).status).toBe(403);
    const r = await request(app).get('/api/v1/indicadores/mediciones').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(r.body.registro).toMatchObject({ validas: 3, medianaSeg: 30, promedioSeg: 30 });
    expect(r.body.consulta).toMatchObject({ validas: 0, descartadas: 1 });
  });
});
