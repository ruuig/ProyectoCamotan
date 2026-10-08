import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

const MARCA = `ADM${Date.now()}`;
const DIRECTOR = { dpi: '1234567890101', password: 'Director2026!' };

let tokenAdmin;
let tokenMedico;
let establecimientoId;

async function login(usuario, password = 'Camotan2026!', extra = {}) {
  return request(app).post('/api/v1/auth/login').send({ usuario, password, ...extra });
}

const admin = (p) => p.set('Authorization', `Bearer ${tokenAdmin}`);
const medico = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);

// La bitacora de intentos fallidos alimenta el limite por IP. Entre pruebas
// se limpia para que una no bloquee a la siguiente.
async function limpiarIntentos() {
  await prisma.bitacora.deleteMany({ where: { accion: 'autorizacion_fallida' } });
}

beforeAll(async () => {
  tokenAdmin = (await login('admin')).body.token;
  tokenMedico = (await login('medico')).body.token;
  const u = await prisma.usuario.findUnique({ where: { usuario: 'admin' } });
  establecimientoId = u.establecimientoId;
});

beforeEach(limpiarIntentos);

afterAll(async () => {
  await prisma.signoPeligro.deleteMany({ where: { codigo: { startsWith: 'qa_' } } });

  // La llave foranea de bitacora impide borrar un usuario con historial de
  // auditoria, que es justo lo que se busca en produccion. Aqui se borra
  // primero su bitacora porque son usuarios creados por la prueba.
  const creados = await prisma.usuario.findMany({
    where: { usuario: { startsWith: MARCA.toLowerCase() } },
    select: { id: true },
  });
  const ids = creados.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.bitacora.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  }

  await limpiarIntentos();
  await prisma.usuario.updateMany({ where: { usuario: 'admin' }, data: { totpSecret: null } });
  await prisma.$disconnect();
});

describe('autorizacion del director', () => {
  const nuevoSigno = (extra = {}) => ({
    codigo: `qa_${Math.random().toString(36).slice(2, 8)}`,
    descripcion: 'Signo de prueba automatizada',
    grupoEtario: 'todos',
    gravedadSugerida: 'urgente',
    ...extra,
  });

  it('crea un signo de peligro con autorizacion valida', async () => {
    const r = await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno(),
      autorizacion: DIRECTOR,
    });

    expect(r.status).toBe(201);
    expect(r.body.signo.gravedadSugerida).toBe('urgente');
  });

  it('rechaza sin autorizacion', async () => {
    const r = await admin(request(app).post('/api/v1/admin/signos-peligro')).send(nuevoSigno());

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('validacion');
  });

  it('rechaza con contrasena incorrecta y no revela cual dato fallo', async () => {
    const r = await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno(),
      autorizacion: { dpi: DIRECTOR.dpi, password: 'incorrecta' },
    });

    expect(r.status).toBe(403);
    expect(r.body.error.mensaje).toBe('Credenciales de autorización inválidas');
  });

  it('responde igual ante un DPI inexistente que ante contrasena incorrecta', async () => {
    const dpiMalo = await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno(),
      autorizacion: { dpi: '9999999999999', password: 'loquesea' },
    });
    await limpiarIntentos();
    const passMala = await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno(),
      autorizacion: { dpi: DIRECTOR.dpi, password: 'incorrecta' },
    });

    expect(dpiMalo.status).toBe(passMala.status);
    expect(dpiMalo.body).toEqual(passMala.body);
  });

  it('rechaza el DPI de un usuario que no es director', async () => {
    // Se da un DPI valido a un usuario sin esDirector.
    await prisma.usuario.update({
      where: { usuario: 'preconsulta' },
      data: { dpi: '5555555555555' },
    });

    const r = await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno(),
      autorizacion: { dpi: '5555555555555', password: 'Camotan2026!' },
    });

    expect(r.status).toBe(403);
    await prisma.usuario.update({ where: { usuario: 'preconsulta' }, data: { dpi: null } });
  });

  it('registra en bitacora todo intento fallido', async () => {
    const antes = await prisma.bitacora.count({ where: { accion: 'autorizacion_fallida' } });

    await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno(),
      autorizacion: { dpi: DIRECTOR.dpi, password: 'incorrecta' },
    });

    const despues = await prisma.bitacora.count({ where: { accion: 'autorizacion_fallida' } });
    expect(despues).toBe(antes + 1);
  });

  it('bloquea tras tres intentos fallidos en una hora', async () => {
    for (let i = 0; i < 3; i += 1) {
      await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
        ...nuevoSigno(),
        autorizacion: { dpi: DIRECTOR.dpi, password: 'incorrecta' },
      });
    }

    // El cuarto intento se bloquea, incluso con la contrasena correcta.
    const r = await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno(),
      autorizacion: DIRECTOR,
    });

    expect(r.status).toBe(429);
    expect(r.body.error.codigo).toBe('demasiados_intentos');
  });

  it('la autorizacion no genera token ni sesion nueva', async () => {
    const r = await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno(),
      autorizacion: DIRECTOR,
    });

    expect(r.body.token).toBeUndefined();
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('guarda el valor anterior y el nuevo en la bitacora', async () => {
    const creado = await admin(request(app).post('/api/v1/admin/signos-peligro')).send({
      ...nuevoSigno({ gravedadSugerida: 'urgente' }),
      autorizacion: DIRECTOR,
    });

    const r = await admin(
      request(app).patch(`/api/v1/admin/signos-peligro/${creado.body.signo.id}`),
    ).send({ gravedadSugerida: 'moderado', autorizacion: DIRECTOR });

    expect(r.status).toBe(200);
    expect(r.body.cambios).toMatch(/gravedadSugerida: "urgente" a "moderado"/);

    const registro = await prisma.bitacora.findFirst({
      where: { accion: 'config_signos', entidadId: creado.body.signo.id },
      orderBy: { id: 'desc' },
    });
    expect(registro.detalle).toMatch(/"urgente" a "moderado"/);
    expect(registro.detalle).toMatch(/Autorizo el director/);
  });

  it('niega el acceso al modulo a quien no es admin', async () => {
    const r = await medico(request(app).post('/api/v1/admin/signos-peligro')).send({
      codigo: 'qa_medico',
      descripcion: 'Intento no autorizado',
      grupoEtario: 'todos',
      gravedadSugerida: 'urgente',
      autorizacion: DIRECTOR,
    });

    expect(r.status).toBe(403);
  });
});

describe('usuarios', () => {
  it('crea un usuario y nunca devuelve su hash', async () => {
    const r = await admin(request(app).post('/api/v1/admin/usuarios')).send({
      usuario: `${MARCA.toLowerCase()}_enfermera`,
      password: 'ContrasenaLarga2026',
      nombre: 'Enfermera de Prueba',
      rol: 'preconsulta',
    });

    expect(r.status).toBe(201);
    expect(r.body.usuario.passwordHash).toBeUndefined();
    expect(r.body.usuario.rol).toBe('preconsulta');
  });

  it('exige contrasena de al menos 10 caracteres', async () => {
    const r = await admin(request(app).post('/api/v1/admin/usuarios')).send({
      usuario: `${MARCA.toLowerCase()}_corta`,
      password: 'corta',
      nombre: 'Prueba',
      rol: 'medico',
    });

    expect(r.status).toBe(400);
  });

  it('desactivar un usuario exige autorizacion del director', async () => {
    const creado = await admin(request(app).post('/api/v1/admin/usuarios')).send({
      usuario: `${MARCA.toLowerCase()}_baja`,
      password: 'ContrasenaLarga2026',
      nombre: 'Usuario por desactivar',
      rol: 'farmacia',
    });
    const id = creado.body.usuario.id;

    const sinAutorizacion = await admin(
      request(app).patch(`/api/v1/admin/usuarios/${id}/estado`),
    ).send({ activo: false });
    expect(sinAutorizacion.status).toBe(400);

    const conAutorizacion = await admin(
      request(app).patch(`/api/v1/admin/usuarios/${id}/estado`),
    ).send({ activo: false, autorizacion: DIRECTOR });

    expect(conAutorizacion.status).toBe(200);
    expect(conAutorizacion.body.usuario.activo).toBe(false);
  });

  it('un usuario desactivado pierde el acceso de inmediato', async () => {
    const creado = await admin(request(app).post('/api/v1/admin/usuarios')).send({
      usuario: `${MARCA.toLowerCase()}_sesion`,
      password: 'ContrasenaLarga2026',
      nombre: 'Usuario con sesion',
      rol: 'medico',
    });

    const sesion = await login(`${MARCA.toLowerCase()}_sesion`, 'ContrasenaLarga2026');
    const token = sesion.body.token;

    // Con el token ya emitido, funciona.
    const antes = await request(app)
      .get('/api/v1/atenciones/cola')
      .set('Authorization', `Bearer ${token}`);
    expect(antes.status).toBe(200);

    await admin(request(app).patch(`/api/v1/admin/usuarios/${creado.body.usuario.id}/estado`)).send({
      activo: false,
      autorizacion: DIRECTOR,
    });

    // El mismo token deja de servir sin esperar a que expire.
    const despues = await request(app)
      .get('/api/v1/atenciones/cola')
      .set('Authorization', `Bearer ${token}`);
    expect(despues.status).toBe(401);
  });

  it('el director no puede desactivarse a si mismo', async () => {
    const director = await prisma.usuario.findFirst({ where: { dpi: DIRECTOR.dpi } });

    const r = await admin(request(app).patch(`/api/v1/admin/usuarios/${director.id}/estado`)).send({
      activo: false,
      autorizacion: DIRECTOR,
    });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('autodesactivacion');
  });
});

describe('datos y acceso de un usuario', () => {
  async function crear(sufijo, rol = 'medico') {
    const r = await admin(request(app).post('/api/v1/admin/usuarios')).send({
      usuario: `${MARCA.toLowerCase()}_${sufijo}`,
      password: 'ContrasenaLarga2026',
      nombre: 'Usuario de Prueba',
      rol,
      cargo: 'Auxiliar de enfermeria',
    });
    expect(r.status).toBe(201);
    return r.body.usuario;
  }

  it('guarda el cargo al crear y lo devuelve en la lista', async () => {
    const u = await crear('cargo');
    expect(u.cargo).toBe('Auxiliar de enfermeria');

    const lista = await admin(request(app).get('/api/v1/admin/usuarios'));
    expect(lista.body.usuarios.find((x) => x.id === u.id).cargo).toBe('Auxiliar de enfermeria');
  });

  it('cambia nombre y cargo sin autorizacion y lo deja en bitacora', async () => {
    const u = await crear('datos');
    const r = await admin(request(app).patch(`/api/v1/admin/usuarios/${u.id}`)).send({
      nombre: 'Dra. Ana Lopez',
      cargo: 'Medico y cirujano',
    });

    expect(r.status).toBe(200);
    expect(r.body.usuario).toMatchObject({ nombre: 'Dra. Ana Lopez', cargo: 'Medico y cirujano' });
    const registro = await prisma.bitacora.findFirst({
      where: { entidad: 'usuario', entidadId: u.id, accion: 'actualizar' },
      orderBy: { id: 'desc' },
    });
    expect(registro.detalle).toContain('Medico y cirujano');
  });

  it('el medico no puede editar usuarios', async () => {
    const u = await crear('ajeno');
    const r = await medico(request(app).patch(`/api/v1/admin/usuarios/${u.id}`)).send({ cargo: 'x' });
    expect(r.status).toBe(403);
  });

  it('cambiar el rol exige autorizacion del director', async () => {
    const u = await crear('rol');
    const sin = await admin(request(app).patch(`/api/v1/admin/usuarios/${u.id}/acceso`)).send({ rol: 'farmacia' });
    expect(sin.status).toBe(400);

    const con = await admin(request(app).patch(`/api/v1/admin/usuarios/${u.id}/acceso`)).send({
      rol: 'farmacia',
      autorizacion: DIRECTOR,
    });
    expect(con.status).toBe(200);
    expect(con.body.usuario.rol).toBe('farmacia');
  });

  it('restablece la contrasena: la nueva sirve y la anterior ya no', async () => {
    const u = await crear('clave');
    const r = await admin(request(app).patch(`/api/v1/admin/usuarios/${u.id}/acceso`)).send({
      password: 'ClaveNueva20261',
      autorizacion: DIRECTOR,
    });
    expect(r.status).toBe(200);

    expect((await login(`${MARCA.toLowerCase()}_clave`, 'ClaveNueva20261')).status).toBe(200);
    expect((await login(`${MARCA.toLowerCase()}_clave`, 'ContrasenaLarga2026')).status).toBe(401);
  });

  it('el director no puede quitarse a si mismo la direccion', async () => {
    const director = await prisma.usuario.findFirst({ where: { dpi: DIRECTOR.dpi } });
    const r = await admin(request(app).patch(`/api/v1/admin/usuarios/${director.id}/acceso`)).send({
      esDirector: false,
      autorizacion: DIRECTOR,
    });
    expect(r.status).toBe(409);
  });
});

describe('establecimiento', () => {
  it('modificarlo exige autorizacion y deja el cambio en bitacora', async () => {
    const original = await admin(request(app).get('/api/v1/admin/establecimiento'));
    const nombreOriginal = original.body.establecimiento.nombre;

    const r = await admin(request(app).patch('/api/v1/admin/establecimiento')).send({
      nombre: 'Centro de Salud de Camotan (prueba)',
      autorizacion: DIRECTOR,
    });

    expect(r.status).toBe(200);
    expect(r.body.cambios).toMatch(/nombre/);

    // Se restaura.
    await admin(request(app).patch('/api/v1/admin/establecimiento')).send({
      nombre: nombreOriginal,
      autorizacion: DIRECTOR,
    });
  });
});

describe('segundo factor del administrador', () => {
  it('genera secreto y codigo QR', async () => {
    const r = await admin(request(app).post('/api/v1/admin/totp/iniciar'));

    expect(r.status).toBe(200);
    expect(r.body.secreto).toBeTypeOf('string');
    expect(r.body.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('rechaza un codigo invalido al confirmar', async () => {
    const inicio = await admin(request(app).post('/api/v1/admin/totp/iniciar'));

    const r = await admin(request(app).post('/api/v1/admin/totp/confirmar')).send({
      codigo: '000000',
      secreto: inicio.body.secreto,
    });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('codigo_invalido');
  });

  it('activa el segundo factor y luego lo exige al entrar', async () => {
    const inicio = await admin(request(app).post('/api/v1/admin/totp/iniciar'));
    const secreto = inicio.body.secreto;

    const confirmacion = await admin(request(app).post('/api/v1/admin/totp/confirmar')).send({
      codigo: authenticator.generate(secreto),
      secreto,
    });
    expect(confirmacion.status).toBe(200);

    // Sin el codigo ya no basta la contrasena.
    const sinCodigo = await login('admin');
    expect(sinCodigo.status).toBe(401);
    expect(sinCodigo.body.error.codigo).toBe('totp_requerido');

    // Con un codigo incorrecto, tampoco.
    const codigoMalo = await login('admin', 'Camotan2026!', { codigoTotp: '000000' });
    expect(codigoMalo.status).toBe(401);
    expect(codigoMalo.body.error.codigo).toBe('credenciales_invalidas');

    // Con el codigo correcto, si.
    const conCodigo = await login('admin', 'Camotan2026!', {
      codigoTotp: authenticator.generate(secreto),
    });
    expect(conCodigo.status).toBe(200);
    expect(conCodigo.body.token).toBeTypeOf('string');

    // Se desactiva para no afectar a las demas pruebas.
    await prisma.usuario.update({ where: { usuario: 'admin' }, data: { totpSecret: null } });
  });

  it('no aplica el segundo factor a roles distintos de admin', async () => {
    const r = await medico(request(app).post('/api/v1/admin/totp/iniciar'));
    expect(r.status).toBe(403);
  });
});

describe('respaldos de la base de datos', () => {
  let configAntes;
  beforeAll(async () => {
    configAntes = await prisma.configuracionRespaldo.findUnique({ where: { id: 1 } });
  });
  afterAll(async () => {
    const { id, ...resto } = configAntes;
    await prisma.configuracionRespaldo.update({ where: { id }, data: resto });
  });

  it('solo el administrador los ve', async () => {
    expect((await medico(request(app).get('/api/v1/admin/respaldos'))).status).toBe(403);
    const r = await admin(request(app).get('/api/v1/admin/respaldos'));
    expect(r.status).toBe(200);
    expect(r.body.configuracion).toHaveProperty('frecuencia');
    expect(Array.isArray(r.body.respaldos)).toBe(true);
  });

  it('guarda el horario y rechaza valores fuera de rango', async () => {
    const mala = await admin(request(app).put('/api/v1/admin/respaldos/configuracion')).send({
      automatico: true, frecuencia: 'diaria', hora: 25, diaSemana: 1, conservar: 10,
    });
    expect(mala.status).toBe(400);
    const r = await admin(request(app).put('/api/v1/admin/respaldos/configuracion')).send({
      automatico: true, frecuencia: 'semanal', hora: 13, diaSemana: 5, conservar: 4,
    });
    expect(r.status).toBe(200);
    expect(r.body.configuracion).toMatchObject({ frecuencia: 'semanal', hora: 13, diaSemana: 5, conservar: 4 });
    expect(r.body.configuracion.proximo).toBeTruthy();
  });

  it('descargar exige al director y entrega el SQL', async () => {
    const sin = await admin(request(app).post('/api/v1/admin/respaldos/descargar')).send({});
    expect(sin.status).toBe(400);
    const mal = await admin(request(app).post('/api/v1/admin/respaldos/descargar')).send({
      autorizacion: { ...DIRECTOR, password: 'incorrecta' },
    });
    expect(mal.status).toBe(403);

    const r = await admin(request(app).post('/api/v1/admin/respaldos/descargar'))
      .send({ autorizacion: DIRECTOR })
      .buffer(true)
      .parse((res, fin) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => fin(null, t)); });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/camotan_\d{4}-\d{2}-\d{2}_\d{4}_manual\.sql/);
    expect(r.body).toContain('PostgreSQL database dump');
  }, 120000);

  it('no entrega archivos fuera de la carpeta de respaldos', async () => {
    const r = await admin(request(app).post('/api/v1/admin/respaldos/descargar')).send({
      nombre: '../.env', autorizacion: DIRECTOR,
    });
    expect(r.status).toBe(404);
  });
});

