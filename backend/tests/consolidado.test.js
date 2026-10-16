import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { grupoDeEdad, rangoDelMes } from '../src/services/consolidado.service.js';

const MARCA = `CON${Date.now()}`;
const tokens = {};
let establecimientoId;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}
const como = (rol, p) => p.set('Authorization', `Bearer ${tokens[rol]}`);

async function limpiar() {
  const pacientes = await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = pacientes.map((p) => p.id);
  if (ids.length === 0) return;

  const atenciones = await prisma.atencion.findMany({
    where: { pacienteId: { in: ids } },
    select: { id: true },
  });
  const aIds = atenciones.map((a) => a.id);

  await prisma.prescripcion.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.antropometria.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.atencion.deleteMany({ where: { id: { in: aIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  await prisma.operacionIdempotente.deleteMany({ where: { clave: { startsWith: MARCA } } });
}

beforeAll(async () => {
  for (const rol of ['admin', 'preconsulta', 'medico', 'farmacia']) tokens[rol] = await login(rol);
  const u = await prisma.usuario.findUnique({ where: { usuario: 'admin' } });
  establecimientoId = u.establecimientoId;
  await limpiar();
});

afterAll(async () => {
  await limpiar();
  await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });
  await prisma.$disconnect();
});

describe('grupos de edad del consolidado', () => {
  it('clasifica por los cortes definidos', () => {
    expect(grupoDeEdad(6).clave).toBe('menor_1');
    expect(grupoDeEdad(11).clave).toBe('menor_1');
    expect(grupoDeEdad(12).clave).toBe('de_1_a_4');
    expect(grupoDeEdad(59).clave).toBe('de_1_a_4');
    expect(grupoDeEdad(60).clave).toBe('de_5_a_9');
    expect(grupoDeEdad(240).clave).toBe('de_20_a_59');
    expect(grupoDeEdad(900).clave).toBe('de_60_mas');
  });
});

describe('rango del mes', () => {
  it('interpreta AAAA-MM', () => {
    const { desde, hasta, etiqueta } = rangoDelMes('2026-03');
    expect(etiqueta).toBe('2026-03');
    expect(desde.getMonth()).toBe(2);
    expect(hasta.getMonth()).toBe(3);
  });

  it('usa el mes en curso sin parametro', () => {
    const { etiqueta } = rangoDelMes();
    const hoy = new Date();
    expect(etiqueta).toBe(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
  });
});

describe('GET /indicadores/consolidado', () => {
  it('devuelve los cinco bloques que exige el informe', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/consolidado'));

    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('atencionesPorGrupo');
    expect(r.body).toHaveProperty('diagnosticos');
    expect(r.body).toHaveProperty('consumoInsumos');
    expect(r.body).toHaveProperty('existencias');
    expect(r.body).toHaveProperty('tiemposEspera');
    expect(r.body.atencionesPorGrupo).toHaveLength(6);
  });

  it('no inventa un promedio de espera cuando no hubo casos', async () => {
    const r = await como(
      'admin',
      request(app).get('/api/v1/indicadores/consolidado').query({ mes: '2020-01' }),
    );

    const sinCasos = r.body.tiemposEspera.filter((t) => t.casos === 0);
    expect(sinCasos.length).toBeGreaterThan(0);
    expect(sinCasos.every((t) => t.promedioMin === null)).toBe(true);
  });

  it('rechaza un mes mal formado', async () => {
    const r = await como(
      'admin',
      request(app).get('/api/v1/indicadores/consolidado').query({ mes: 'marzo' }),
    );
    expect(r.status).toBe(400);
  });

  it('solo lo ve el administrador', async () => {
    const r = await como('medico', request(app).get('/api/v1/indicadores/consolidado'));
    expect(r.status).toBe(403);
  });

  it('cuenta la atencion del mes en su grupo de edad y sexo', async () => {
    const paciente = await como('preconsulta', request(app).post('/api/v1/pacientes')).send({
      expedientePapel: `${MARCA}-A`,
      nombres: 'Consolidado',
      apellidos: 'Prueba Uno',
      fechaNacimiento: '1995-06-15',
      sexo: 'F',
      comunidad: 'Tisipe',
      responsableNombre: 'Maria Lopez',
      responsableParentesco: 'madre',
      confirmarDuplicado: true,
    });

    const atencion = await como('preconsulta', request(app).post('/api/v1/atenciones')).send({
      pacienteId: paciente.body.paciente.id,
      motivoConsulta: 'Control',
    });

    await como('preconsulta', request(app).patch(`/api/v1/atenciones/${atencion.body.atencion.id}/estado`))
      .send({ estado: 'en_atencion' });
    await como('medico', request(app).patch(`/api/v1/atenciones/${atencion.body.atencion.id}/consulta`))
      .send({ diagnosticoCie: 'Z00.0', diagnosticoTxt: 'Examen medico general' });

    const r = await como('admin', request(app).get('/api/v1/indicadores/consolidado'));

    const grupo = r.body.atencionesPorGrupo.find((g) => g.grupo === '20 a 59 años');
    expect(grupo.F).toBeGreaterThanOrEqual(1);

    const dx = r.body.diagnosticos.find((d) => d.codigo === 'Z00.0');
    expect(dx).toBeTruthy();
  });
});

describe('GET /indicadores/consolidado/export', () => {
  it('devuelve un XLSX valido con sus seis hojas', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/consolidado/export'))
      .buffer()
      .parse((res, cb) => {
        const trozos = [];
        res.on('data', (t) => trozos.push(t));
        res.on('end', () => cb(null, Buffer.concat(trozos)));
      });

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    expect(r.headers['content-disposition']).toMatch(/consolidado-.*\.xlsx/);

    // Se abre el archivo de verdad para comprobar que no esta corrupto.
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(r.body);

    const hojas = libro.worksheets.map((h) => h.name);
    expect(hojas).toEqual([
      'Consolidado',
      'Por grupo de edad',
      'Diagnosticos CIE-10',
      'Consumo de insumos',
      'Existencias por lote',
      'Tiempos de espera',
    ]);

    // La portada debe traer el establecimiento.
    const portada = libro.getWorksheet('Consolidado');
    expect(portada.getCell('A2').value).toBe('Establecimiento');
    expect(portada.getCell('B2').value).toMatch(/Camotán/);

    // Los tramos sin casos dicen "sin casos", no 0.
    const esperas = libro.getWorksheet('Tiempos de espera');
    const valores = [];
    esperas.eachRow((fila, n) => {
      if (n > 1) valores.push(fila.getCell(3).value);
    });
    expect(valores.length).toBe(3);
  });

  it('queda registrada la exportacion en bitacora', async () => {
    const antes = await prisma.bitacora.count({ where: { accion: 'exportar' } });

    await como('admin', request(app).get('/api/v1/indicadores/consolidado/export')).buffer();

    const despues = await prisma.bitacora.count({ where: { accion: 'exportar' } });
    expect(despues).toBe(antes + 1);
  });
});

describe('idempotencia de la cola offline', () => {
  async function pacienteConAtencion(sufijo) {
    const paciente = await como('preconsulta', request(app).post('/api/v1/pacientes')).send({
      expedientePapel: `${MARCA}-${sufijo}`,
      nombres: 'Offline',
      apellidos: `Prueba ${sufijo}`,
      fechaNacimiento: '1990-01-01',
      sexo: 'M',
      comunidad: 'Tisipe',
      responsableNombre: 'Maria Lopez',
      responsableParentesco: 'madre',
      confirmarDuplicado: true,
    });
    const atencion = await como('preconsulta', request(app).post('/api/v1/atenciones')).send({
      pacienteId: paciente.body.paciente.id,
      motivoConsulta: 'Reenvio desde cola offline',
    });
    return atencion.body.atencion;
  }

  it('el reenvio con la misma clave no duplica la preconsulta', async () => {
    const atencion = await pacienteConAtencion('IDEM1');
    const clave = `${MARCA}-preconsulta-1`;

    const primera = await como('preconsulta', request(app).post(`/api/v1/atenciones/${atencion.id}/preconsulta`))
      .set('Idempotency-Key', clave)
      .send({ motivoConsulta: 'Control', temperatura: 37.2, peso: 70, talla: 170 });

    expect(primera.status).toBe(201);

    // Mismo envio, como lo haria la cola al recuperar conexion.
    const reenvio = await como('preconsulta', request(app).post(`/api/v1/atenciones/${atencion.id}/preconsulta`))
      .set('Idempotency-Key', clave)
      .send({ motivoConsulta: 'Control', temperatura: 37.2, peso: 70, talla: 170 });

    expect(reenvio.status).toBe(200);
    expect(reenvio.headers['x-idempotencia']).toBe('repetida');
    expect(reenvio.body.preconsulta.id).toBe(primera.body.preconsulta.id);

    const cuantas = await prisma.preconsulta.count({ where: { atencionId: atencion.id } });
    expect(cuantas).toBe(1);
  });

  it('sin clave, el segundo intento si es rechazado por la regla de negocio', async () => {
    const atencion = await pacienteConAtencion('IDEM2');

    await como('preconsulta', request(app).post(`/api/v1/atenciones/${atencion.id}/preconsulta`))
      .send({ motivoConsulta: 'Control', temperatura: 37 });
    const segunda = await como('preconsulta', request(app).post(`/api/v1/atenciones/${atencion.id}/preconsulta`))
      .send({ motivoConsulta: 'Control', temperatura: 37 });

    expect(segunda.status).toBe(409);
    expect(segunda.body.error.codigo).toBe('preconsulta_registrada');
  });

  it('rechaza una clave demasiado corta', async () => {
    const atencion = await pacienteConAtencion('IDEM3');

    const r = await como('preconsulta', request(app).post(`/api/v1/atenciones/${atencion.id}/preconsulta`))
      .set('Idempotency-Key', 'corta')
      .send({ motivoConsulta: 'Control', temperatura: 37 });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('clave_idempotencia_invalida');
  });

  it('claves distintas son operaciones distintas', async () => {
    const a = await pacienteConAtencion('IDEM4');
    const b = await pacienteConAtencion('IDEM5');

    const r1 = await como('preconsulta', request(app).post(`/api/v1/atenciones/${a.id}/preconsulta`))
      .set('Idempotency-Key', `${MARCA}-clave-A`)
      .send({ motivoConsulta: 'Control', temperatura: 37 });
    const r2 = await como('preconsulta', request(app).post(`/api/v1/atenciones/${b.id}/preconsulta`))
      .set('Idempotency-Key', `${MARCA}-clave-B`)
      .send({ motivoConsulta: 'Control', temperatura: 37 });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.preconsulta.id).not.toBe(r2.body.preconsulta.id);
  });
});
