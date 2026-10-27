import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

// El director ve todo, pero fuera de lo suyo (Administración) solo consulta.
let token;
const admin = (p) => p.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  token = (await request(app).post('/api/v1/auth/login').send({ usuario: 'admin', password: 'Camotan2026!' })).body.token;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Director en modo consulta', () => {
  it('lee los módulos de trabajo', async () => {
    for (const ruta of ['/api/v1/pacientes', '/api/v1/atenciones/cola', '/api/v1/farmacia/existencias', '/api/v1/bodega/informes']) {
      expect((await admin(request(app).get(ruta))).status, ruta).toBe(200);
    }
  });

  it('no registra pacientes, atenciones, entregas ni movimientos de bodega', async () => {
    const intentos = [
      ['post', '/api/v1/pacientes'],
      ['post', '/api/v1/atenciones'],
      ['post', '/api/v1/bodega/requisiciones'],
      ['post', '/api/v1/bodega/consumo/excel?periodo=2030-01&territorioId=1'],
      ['post', '/api/v1/insumos'],
    ];
    for (const [metodo, ruta] of intentos) {
      const r = await admin(request(app)[metodo](ruta).send({}));
      expect(r.status, ruta).toBe(403);
      expect(r.body.codigo ?? r.body.error?.codigo, ruta).toBe('solo_lectura');
    }
  });

  it('sigue manejando lo suyo y registrando lo que imprime', async () => {
    expect((await admin(request(app).get('/api/v1/admin/usuarios'))).status).toBe(200);
    // Una ruta compartida marcada para él: pasa el permiso y llega a validar el cuerpo.
    const r = await admin(request(app).post('/api/v1/impresiones').send({}));
    expect(r.status).toBe(400);
  });
});
