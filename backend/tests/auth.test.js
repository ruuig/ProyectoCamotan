import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

// Estas pruebas corren contra la base sembrada por prisma/seed.js.
const CREDENCIALES = { usuario: 'medico', password: 'Camotan2026!' };

async function obtenerToken(credenciales = CREDENCIALES) {
  const respuesta = await request(app).post('/api/v1/auth/login').send(credenciales);
  return respuesta.body.token;
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/v1/auth/login', () => {
  it('devuelve token y usuario con credenciales validas', async () => {
    const respuesta = await request(app).post('/api/v1/auth/login').send(CREDENCIALES);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.token).toBeTypeOf('string');
    expect(respuesta.body.usuario.rol).toBe('medico');
  });

  it('nunca devuelve el hash de la contrasena', async () => {
    const respuesta = await request(app).post('/api/v1/auth/login').send(CREDENCIALES);

    expect(respuesta.body.usuario.passwordHash).toBeUndefined();
    expect(respuesta.body.usuario.totpSecret).toBeUndefined();
  });

  it('rechaza una contrasena incorrecta', async () => {
    const respuesta = await request(app)
      .post('/api/v1/auth/login')
      .send({ usuario: 'medico', password: 'incorrecta' });

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error.codigo).toBe('credenciales_invalidas');
  });

  it('responde igual ante usuario inexistente que ante contrasena incorrecta', async () => {
    const inexistente = await request(app)
      .post('/api/v1/auth/login')
      .send({ usuario: 'no_existe_este_usuario', password: 'incorrecta' });
    const passwordMala = await request(app)
      .post('/api/v1/auth/login')
      .send({ usuario: 'medico', password: 'incorrecta' });

    // Si las respuestas difirieran se podria averiguar que usuarios existen.
    expect(inexistente.status).toBe(passwordMala.status);
    expect(inexistente.body).toEqual(passwordMala.body);
  });

  it('rechaza un cuerpo sin contrasena con error de validacion', async () => {
    const respuesta = await request(app).post('/api/v1/auth/login').send({ usuario: 'medico' });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('validacion');
    expect(respuesta.body.error.detalles[0].campo).toBe('password');
  });

  it('registra el intento fallido en la bitacora', async () => {
    const antes = await prisma.bitacora.count({ where: { accion: 'login_fallido' } });

    await request(app)
      .post('/api/v1/auth/login')
      .send({ usuario: 'medico', password: 'incorrecta' });

    const despues = await prisma.bitacora.count({ where: { accion: 'login_fallido' } });
    expect(despues).toBe(antes + 1);
  });
});

describe('middleware de autenticacion', () => {
  it('rechaza el acceso sin token', async () => {
    const respuesta = await request(app).get('/api/v1/admin/bitacora');

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error.codigo).toBe('no_autenticado');
  });

  it('rechaza un token manipulado', async () => {
    const respuesta = await request(app)
      .get('/api/v1/admin/bitacora')
      .set('Authorization', 'Bearer token.falso.aqui');

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error.codigo).toBe('token_invalido');
  });
});

describe('middleware rbac', () => {
  it('impide que el medico entre a un endpoint de admin', async () => {
    const token = await obtenerToken();

    const respuesta = await request(app)
      .get('/api/v1/admin/bitacora')
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(403);
    expect(respuesta.body.error.codigo).toBe('sin_permiso');
  });

  it('permite el acceso al admin', async () => {
    const token = await obtenerToken({ usuario: 'admin', password: 'Camotan2026!' });

    const respuesta = await request(app)
      .get('/api/v1/admin/bitacora')
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);
    expect(Array.isArray(respuesta.body.registros)).toBe(true);
  });
});

describe('refresh y logout', () => {
  it('renueva el token de una sesion vigente', async () => {
    const token = await obtenerToken();

    const respuesta = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.token).toBeTypeOf('string');
    expect(respuesta.body.usuario.usuario).toBe('medico');
  });

  it('registra el cierre de sesion en la bitacora', async () => {
    const token = await obtenerToken();
    const antes = await prisma.bitacora.count({ where: { accion: 'logout' } });

    const respuesta = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);
    const despues = await prisma.bitacora.count({ where: { accion: 'logout' } });
    expect(despues).toBe(antes + 1);
  });
});
