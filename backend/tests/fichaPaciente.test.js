import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Ficha completa del paciente: preconsulta la va pasando del papel al
 * sistema, sección por sección. Los datos sensibles se registran una vez y
 * después solo los ven el médico y el administrador.
 */

const MARCA = `FPC${Date.now()}`;
let tokenMedico;
let tokenPre;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}

const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);
const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);

async function pacienteDe({ fechaNacimiento = '1980-05-01', sexo = 'F' } = {}) {
  const r = await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres: 'Ficha',
    apellidos: `Completa ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento,
    sexo,
    comunidad: 'Tisipe',
    // Un menor se registra con su responsable.
    responsableNombre: 'Madre de prueba',
    responsableParentesco: 'madre',
    confirmarDuplicado: true,
  });
  return r.body.paciente.id;
}

beforeAll(async () => {
  tokenMedico = await login('medico');
  tokenPre = await login('preconsulta');
});

afterAll(async () => {
  const pacientes = await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = pacientes.map((p) => p.id);
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
});

describe('GET /pacientes/:id/ficha', () => {
  it('trae la ficha de la edad con todas sus secciones, sin registrar', async () => {
    const id = await pacienteDe();
    const r = await pre(request(app).get(`/api/v1/pacientes/${id}/ficha`));
    expect(r.status).toBe(200);
    expect(r.body.ficha.nombre).toBe('Ficha clínica para persona adulta y persona mayor');
    expect(r.body.identificacion.titulo).toBe('Identificación del paciente');
    expect(r.body.secciones.map((s) => s.titulo)).toContain('Médicos');
    expect(r.body.secciones.every((s) => s.estado === 'sin_registrar')).toBe(true);
  });

  it('farmacia no entra a la ficha', async () => {
    const id = await pacienteDe();
    const token = await login('farmacia');
    const r = await request(app).get(`/api/v1/pacientes/${id}/ficha`).set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });
});

describe('PUT /pacientes/:id/ficha/:seccion', () => {
  it('guarda una sola sección y registra quién la llenó', async () => {
    const id = await pacienteDe();
    const r = await pre(request(app).put(`/api/v1/pacientes/${id}/ficha/medicos_adulto`)).send({
      datos: { diabetes: true, hipertension: false },
    });
    expect(r.status).toBe(200);
    expect(r.body.seccion.estado).toBe('registrado');
    expect(r.body.seccion.actualizadoPor).toBe('Personal de Preconsulta');
    expect(r.body.seccion.avance.respondidas).toBe(2);

    const ficha = await pre(request(app).get(`/api/v1/pacientes/${id}/ficha`));
    const otras = ficha.body.secciones.filter((s) => s.clave !== 'medicos_adulto');
    expect(otras.every((s) => s.estado === 'sin_registrar')).toBe(true);
  });

  it('una casilla sin marcar queda sin registrar, no en No', async () => {
    const id = await pacienteDe();
    const r = await pre(request(app).put(`/api/v1/pacientes/${id}/ficha/medicos_adulto`)).send({ datos: { asma: true } });
    expect(r.body.seccion.datos.asma).toBe(true);
    expect(r.body.seccion.datos.diabetes).toBeUndefined();
  });

  it('rechaza una sección que no es de la ficha del paciente', async () => {
    const id = await pacienteDe();
    const r = await pre(request(app).put(`/api/v1/pacientes/${id}/ficha/maternos`)).send({ datos: {} });
    expect(r.status).toBe(404);
  });

  it('rechaza un campo que la sección no tiene', async () => {
    const id = await pacienteDe();
    const r = await pre(request(app).put(`/api/v1/pacientes/${id}/ficha/medicos_adulto`)).send({ datos: { inventado: true } });
    expect(r.status).toBe(400);
  });

  it('a un hombre no se le guardan datos de embarazos', async () => {
    const id = await pacienteDe({ sexo: 'M' });
    const r = await pre(request(app).put(`/api/v1/pacientes/${id}/ficha/personales_adulto`)).send({ datos: { embarazos: 2 } });
    expect(r.status).toBe(400);
  });

  it('cada cambio queda en el historial con el valor anterior', async () => {
    const id = await pacienteDe();
    await pre(request(app).put(`/api/v1/pacientes/${id}/ficha/habitos_adulto`)).send({ datos: { alcohol: false } });
    await med(request(app).put(`/api/v1/pacientes/${id}/ficha/habitos_adulto`)).send({ datos: { alcohol: true } });
    const h = await pre(request(app).get(`/api/v1/pacientes/${id}/ficha/habitos_adulto/historial`));
    expect(h.body.cambios[0]).toMatchObject({ campo: 'alcohol', anterior: false, nuevo: true, usuario: 'Medico de Prueba' });
    expect(h.body.cambios).toHaveLength(2);
  });
});

describe('datos sensibles', () => {
  it('preconsulta los registra, después ve "registrado" y no puede cambiarlos', async () => {
    const id = await pacienteDe();
    const ruta = `/api/v1/pacientes/${id}/ficha/historia_abuso`;

    const alta = await pre(request(app).put(ruta)).send({ datos: { historiaAbuso: true, historiaAbusoDetalle: 'Violencia intrafamiliar' } });
    expect(alta.status).toBe(200);
    expect(alta.body.seccion.datos.historiaAbuso).toBeUndefined();
    expect(alta.body.seccion.sensiblesRegistrados.sort()).toEqual(['historiaAbuso', 'historiaAbusoDetalle']);

    const cambio = await pre(request(app).put(ruta)).send({ datos: { historiaAbuso: false } });
    expect(cambio.status).toBe(403);

    const medico = await med(request(app).get(`/api/v1/pacientes/${id}/ficha`));
    const abuso = medico.body.secciones.find((s) => s.clave === 'historia_abuso');
    expect(abuso.datos.historiaAbusoDetalle).toBe('Violencia intrafamiliar');
  });

  it('cada lectura del médico queda en bitácora', async () => {
    const id = await pacienteDe();
    await pre(request(app).put(`/api/v1/pacientes/${id}/ficha/familiares_adulto`)).send({ datos: { violencia: true } });
    await med(request(app).get(`/api/v1/pacientes/${id}/ficha`));
    const registro = await prisma.bitacora.findFirst({
      where: { entidad: 'paciente_datos_sensibles', entidadId: id, accion: 'leer' },
      orderBy: { id: 'desc' },
    });
    expect(registro.detalle).toContain('familiares_adulto.violencia');
  });

  it('en el historial preconsulta no ve el valor', async () => {
    const id = await pacienteDe();
    await pre(request(app).put(`/api/v1/pacientes/${id}/ficha/familiares_adulto`)).send({ datos: { violencia: true } });
    const h = await pre(request(app).get(`/api/v1/pacientes/${id}/ficha/familiares_adulto/historial`));
    expect(h.body.cambios[0]).toMatchObject({ nuevo: 'registrado', oculto: true });
  });

  it('en la identificación, preconsulta registra la orientación una sola vez', async () => {
    const id = await pacienteDe();
    const alta = await pre(request(app).patch(`/api/v1/pacientes/${id}`)).send({ orientacionSexual: '1' });
    expect(alta.status).toBe(200);
    const cambio = await pre(request(app).patch(`/api/v1/pacientes/${id}`)).send({ orientacionSexual: '2' });
    expect(cambio.status).toBe(403);
    const ficha = await pre(request(app).get(`/api/v1/pacientes/${id}/ficha`));
    expect(ficha.body.identificacion.sensiblesRegistrados).toContain('orientacionSexual');
    expect(ficha.body.identificacion.datos.orientacionSexual).toBeUndefined();
  });
});

describe('faltantes', () => {
  it('cuenta solo los mínimos del SIGSA', async () => {
    const id = await pacienteDe();
    const r = await pre(request(app).get(`/api/v1/pacientes/${id}/ficha`));
    expect(r.body.faltantes.map((f) => f.campo).sort()).toEqual(
      ['departamentoResidencia', 'discapacidad', 'municipioResidencia', 'nivelEscolar', 'pueblo'].sort(),
    );
  });

  it('la identificación también deja historial', async () => {
    const id = await pacienteDe();
    await pre(request(app).patch(`/api/v1/pacientes/${id}`)).send({ pueblo: '2' });
    const h = await pre(request(app).get(`/api/v1/pacientes/${id}/ficha/identificacion/historial`));
    expect(h.body.cambios[0]).toMatchObject({ campo: 'pueblo', anterior: null, nuevo: '2' });
  });
});

describe('familiograma', () => {
  it('se adjunta a la ficha de un neonato y se puede descargar', async () => {
    const hace10Dias = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const id = await pacienteDe({ fechaNacimiento: hace10Dias });
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const r = await pre(request(app).post(`/api/v1/pacientes/${id}/archivos/familiograma`))
      .set('Content-Type', 'image/png')
      .set('X-Nombre-Archivo', encodeURIComponent('familiograma García.png'))
      .send(png);
    expect(r.status).toBe(201);
    expect(r.body.archivo.nombre).toBe('familiograma García.png');

    const d = await pre(request(app).get(`/api/v1/pacientes/${id}/archivos/${r.body.archivo.id}`));
    expect(d.status).toBe(200);
    expect(d.headers['content-type']).toBe('image/png');

    const ficha = await pre(request(app).get(`/api/v1/pacientes/${id}/ficha`));
    expect(ficha.body.secciones.find((s) => s.clave === 'familiograma').estado).toBe('registrado');
  });

  it('un adulto no lleva familiograma', async () => {
    const id = await pacienteDe();
    const r = await pre(request(app).post(`/api/v1/pacientes/${id}/archivos/familiograma`))
      .set('Content-Type', 'image/png')
      .send(Buffer.from('89504e47', 'hex'));
    expect(r.status).toBe(400);
  });

  it('rechaza un archivo que no es imagen ni PDF', async () => {
    const hace10Dias = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const id = await pacienteDe({ fechaNacimiento: hace10Dias });
    const r = await pre(request(app).post(`/api/v1/pacientes/${id}/archivos/familiograma`))
      .set('Content-Type', 'text/plain')
      .send('hola');
    expect(r.status).toBe(400);
  });
});
