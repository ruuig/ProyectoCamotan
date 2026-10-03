// Fase F: cada impresión o descarga queda en bitácora.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

let tokenMedico;
let tokenFarmacia;

beforeAll(async () => {
  const login = async (u) =>
    (await request(app).post('/api/v1/auth/login').send({ usuario: u, password: 'Camotan2026!' }))
      .body.token;
  [tokenMedico, tokenFarmacia] = await Promise.all([login('medico'), login('farmacia')]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);
const farm = (p) => p.set('Authorization', `Bearer ${tokenFarmacia}`);

describe('Registro de impresiones', () => {
  it('deja constancia de la ficha en blanco', async () => {
    const r = await med(request(app).post('/api/v1/impresiones')).send({ documento: 'ficha_blanco' });

    expect(r.status).toBe(201);

    const rastro = await prisma.bitacora.findFirst({
      where: { entidad: 'impresion' },
      orderBy: { id: 'desc' },
    });
    expect(rastro.detalle).toContain('Ficha en blanco');
  });

  it('registra los cuatro documentos que se pueden imprimir', async () => {
    for (const documento of ['ficha_atencion', 'ficha_blanco', 'resumen_expediente', 'boleta_referencia']) {
      const r = await med(request(app).post('/api/v1/impresiones')).send({ documento });
      expect(r.status).toBe(201);
    }
  });

  it('rechaza un documento desconocido', async () => {
    const r = await med(request(app).post('/api/v1/impresiones')).send({ documento: 'receta_magica' });

    expect(r.status).toBe(400);
  });

  it('no deja imprimir fichas a farmacia', async () => {
    const r = await farm(request(app).post('/api/v1/impresiones')).send({ documento: 'ficha_blanco' });

    expect(r.status).toBe(403);
  });

  it('rechaza un paciente de otro establecimiento', async () => {
    const r = await med(request(app).post('/api/v1/impresiones'))
      .send({ documento: 'resumen_expediente', pacienteId: 999999 });

    expect(r.status).toBe(404);
  });
});

describe('El encabezado impreso necesita los datos del establecimiento', () => {
  it('cualquier rol clínico los puede leer', async () => {
    const r = await med(request(app).get('/api/v1/admin/establecimiento'));

    expect(r.status).toBe(200);
    expect(r.body.establecimiento.nombre).toBeTruthy();
  });

  it('pero solo el administrador los modifica', async () => {
    const r = await med(request(app).patch('/api/v1/admin/establecimiento'))
      .send({ nombre: 'No debería' });

    expect(r.status).toBe(403);
  });
});
