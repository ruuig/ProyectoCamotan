import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Inmutabilidad de la consulta cerrada.
 *
 * Al cerrar una consulta sus datos quedan fijos. Corregir sigue siendo
 * posible, pero deja rastro: el valor anterior no se borra. Sin esto nadie
 * puede saber con que diagnostico se receto el dia que se receto.
 */

const MARCA = `COR${Date.now()}`;
let tokenMedico;
let tokenPre;
let establecimientoId;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}

const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);
const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);

/** Deja una consulta cerrada, lista para corregir. */
async function consultaCerrada({ diagnosticoCie = 'J02.9', diagnosticoTxt = 'Faringitis aguda' } = {}) {
  const paciente = await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres: 'Correccion',
    apellidos: `Prueba ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento: '1990-01-01',
    sexo: 'M',
    comunidad: 'Tisipe',
    confirmarDuplicado: true,
  });

  const atencion = await pre(request(app).post('/api/v1/atenciones')).send({
    pacienteId: paciente.body.paciente.id,
    motivoConsulta: 'Dolor de garganta',
  });
  const atencionId = atencion.body.atencion.id;

  await pre(request(app).patch(`/api/v1/atenciones/${atencionId}/estado`)).send({
    estado: 'en_atencion',
  });

  await med(request(app).patch(`/api/v1/atenciones/${atencionId}/consulta`)).send({
    diagnosticoCie,
    diagnosticoTxt,
    tratamiento: 'Reposo e hidratación',
  });

  return { atencionId, pacienteId: paciente.body.paciente.id };
}

async function limpiar() {
  const pacientes = await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = pacientes.map((p) => p.id);
  const atenciones = await prisma.atencion.findMany({
    where: { pacienteId: { in: ids } },
    select: { id: true },
  });
  const atencionIds = atenciones.map((a) => a.id);

  await prisma.notaCorreccion.deleteMany({ where: { atencionId: { in: atencionIds } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: atencionIds } } });
  await prisma.atencion.deleteMany({ where: { id: { in: atencionIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  [tokenMedico, tokenPre] = await Promise.all([login('medico'), login('preconsulta')]);
  const u = await prisma.usuario.findUnique({ where: { usuario: 'medico' } });
  establecimientoId = u.establecimientoId;
});

beforeEach(async () => {
  await limpiar();
  await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });
});

afterAll(async () => {
  await limpiar();
  await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });
  await prisma.$disconnect();
});

describe('corregir una consulta cerrada', () => {
  it('cambia el dato y conserva el anterior en la nota', async () => {
    const { atencionId } = await consultaCerrada();

    const r = await med(request(app).post(`/api/v1/atenciones/${atencionId}/correcciones`)).send({
      campo: 'diagnosticoTxt',
      valorNuevo: 'Amigdalitis aguda',
      motivo: 'Se confundió con faringitis al transcribir',
    });

    expect(r.status).toBe(200);
    expect(r.body.atencion.diagnosticoTxt).toBe('Amigdalitis aguda');
    // El valor original no se pierde.
    expect(r.body.nota.valorAnterior).toBe('Faringitis aguda');
    expect(r.body.nota.motivo).toContain('transcribir');
  });

  it('la corrección queda consultable con su autor', async () => {
    const { atencionId } = await consultaCerrada();

    await med(request(app).post(`/api/v1/atenciones/${atencionId}/correcciones`)).send({
      campo: 'tratamiento',
      valorNuevo: 'Amoxicilina 500 mg cada 8 horas por 7 días',
      motivo: 'Faltó el antibiótico en la nota original',
    });

    const r = await med(request(app).get(`/api/v1/atenciones/${atencionId}/correcciones`));

    expect(r.status).toBe(200);
    expect(r.body.correcciones).toHaveLength(1);
    expect(r.body.correcciones[0].etiqueta).toBe('Tratamiento');
    expect(r.body.correcciones[0].usuario).toBeTruthy();
    expect(r.body.correcciones[0].valorAnterior).toBe('Reposo e hidratación');
  });

  it('exige explicar por qué se corrige', async () => {
    const { atencionId } = await consultaCerrada();

    const r = await med(request(app).post(`/api/v1/atenciones/${atencionId}/correcciones`)).send({
      campo: 'diagnosticoTxt',
      valorNuevo: 'Otra cosa',
      motivo: 'x',
    });

    expect(r.status).toBe(400);
  });

  it('no acepta corregir un campo que no es del cierre', async () => {
    const { atencionId } = await consultaCerrada();

    const r = await med(request(app).post(`/api/v1/atenciones/${atencionId}/correcciones`)).send({
      campo: 'pacienteId',
      valorNuevo: '99',
      motivo: 'Intento de cambiar el paciente',
    });

    expect(r.status).toBe(400);
  });

  it('no deja registrar una corrección que no cambia nada', async () => {
    const { atencionId } = await consultaCerrada();

    const r = await med(request(app).post(`/api/v1/atenciones/${atencionId}/correcciones`)).send({
      campo: 'diagnosticoTxt',
      valorNuevo: 'Faringitis aguda',
      motivo: 'Es el mismo valor',
    });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('sin_cambio');
  });

  it('varias correcciones se apilan, la más reciente primero', async () => {
    const { atencionId } = await consultaCerrada();

    await med(request(app).post(`/api/v1/atenciones/${atencionId}/correcciones`)).send({
      campo: 'diagnosticoTxt',
      valorNuevo: 'Amigdalitis',
      motivo: 'Primera corrección del diagnóstico',
    });
    await med(request(app).post(`/api/v1/atenciones/${atencionId}/correcciones`)).send({
      campo: 'tratamiento',
      valorNuevo: 'Amoxicilina',
      motivo: 'Segunda corrección, ahora el tratamiento',
    });

    const r = await med(request(app).get(`/api/v1/atenciones/${atencionId}/correcciones`));

    expect(r.body.correcciones).toHaveLength(2);
    expect(r.body.correcciones[0].campo).toBe('tratamiento');
  });
});

describe('corregir un signo vital', () => {
  /** Deja una atención en espera con preconsulta registrada. */
  async function enEspera() {
    const paciente = await pre(request(app).post('/api/v1/pacientes')).send({
      expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
      nombres: 'Vital',
      apellidos: `Prueba ${Math.random().toString(36).slice(2, 6)}`,
      fechaNacimiento: '1990-01-01',
      sexo: 'F',
      comunidad: 'Tisipe',
      confirmarDuplicado: true,
    });

    const atencion = await pre(request(app).post('/api/v1/atenciones')).send({
      pacienteId: paciente.body.paciente.id,
      motivoConsulta: 'Fiebre',
    });
    const atencionId = atencion.body.atencion.id;

    await pre(request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`)).send({ motivoConsulta: 'Control', 
      // Un dedo de más: 3.7 en vez de 37.
      temperatura: 36.5,
      peso: 62,
      talla: 158,
    });

    return atencionId;
  }

  it('preconsulta corrige lo suyo mientras nadie lo ha leído, sin nota', async () => {
    const atencionId = await enEspera();

    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencionId}/preconsulta`)).send({ motivoConsulta: 'Control', 
      campo: 'temperatura',
      valorNuevo: 38.2,
    });

    expect(r.status).toBe(200);
    expect(Number(r.body.preconsulta.temperatura)).toBe(38.2);
    // Nadie había actuado sobre ese dato: no hace falta constancia.
    expect(r.body.nota).toBeNull();
  });

  it('una vez llamado el paciente, preconsulta ya no puede tocarlo', async () => {
    const atencionId = await enEspera();
    await pre(request(app).patch(`/api/v1/atenciones/${atencionId}/estado`)).send({
      estado: 'en_atencion',
    });

    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencionId}/preconsulta`)).send({ motivoConsulta: 'Control', 
      campo: 'temperatura',
      valorNuevo: 39,
      motivo: 'Intento de preconsulta con la consulta en curso',
    });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('datos_congelados');
  });

  it('el médico sí puede corregirlo, y queda la nota', async () => {
    const atencionId = await enEspera();
    await pre(request(app).patch(`/api/v1/atenciones/${atencionId}/estado`)).send({
      estado: 'en_atencion',
    });

    const r = await med(request(app).patch(`/api/v1/atenciones/${atencionId}/preconsulta`)).send({ motivoConsulta: 'Control', 
      campo: 'temperatura',
      valorNuevo: 39.1,
      motivo: 'La temperatura registrada no coincide con el estado del paciente',
    });

    expect(r.status).toBe(200);
    expect(r.body.nota.valorAnterior).toBe('36.5');
    expect(r.body.nota.campo).toBe('preconsulta.temperatura');

    const notas = await med(request(app).get(`/api/v1/atenciones/${atencionId}/correcciones`));
    expect(notas.body.correcciones[0].etiqueta).toBe('Temperatura');
  });

  it('el médico debe explicar por qué corrige', async () => {
    const atencionId = await enEspera();
    await pre(request(app).patch(`/api/v1/atenciones/${atencionId}/estado`)).send({
      estado: 'en_atencion',
    });

    const r = await med(request(app).patch(`/api/v1/atenciones/${atencionId}/preconsulta`)).send({ motivoConsulta: 'Control', 
      campo: 'temperatura',
      valorNuevo: 39.1,
    });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('motivo_requerido');
  });

  it('los signos de peligro no se corrigen por esta vía', async () => {
    const atencionId = await enEspera();

    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencionId}/preconsulta`)).send({ motivoConsulta: 'Control', 
      campo: 'signosPeligro',
      valorNuevo: 1,
    });

    // Cambiarlos cambia la gravedad y el puesto en la cola: no es digitación.
    expect(r.status).toBe(400);
  });
});

describe('codificación de una consulta cerrada', () => {
  it('poner el código que faltaba es completar: no pide motivo', async () => {
    const { atencionId } = await consultaCerrada({ diagnosticoCie: null });

    const r = await med(request(app).patch(`/api/v1/atenciones/${atencionId}/codificacion`)).send({
      diagnosticoCie: 'J02.9',
    });

    expect(r.status).toBe(200);
    expect(r.body.corregido).toBe(false);

    const notas = await med(request(app).get(`/api/v1/atenciones/${atencionId}/correcciones`));
    expect(notas.body.correcciones).toHaveLength(0);
  });

  it('reemplazar un código que ya estaba exige motivo', async () => {
    const { atencionId } = await consultaCerrada({ diagnosticoCie: 'J02.9' });

    const sinMotivo = await med(
      request(app).patch(`/api/v1/atenciones/${atencionId}/codificacion`),
    ).send({ diagnosticoCie: 'J03.9' });

    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.error.codigo).toBe('motivo_requerido');

    // El código no se tocó.
    const atencion = await prisma.atencion.findUnique({ where: { id: atencionId } });
    expect(atencion.diagnosticoCie).toBe('J02.9');
  });

  it('con motivo, el cambio queda registrado como corrección', async () => {
    const { atencionId } = await consultaCerrada({ diagnosticoCie: 'J02.9' });

    const r = await med(request(app).patch(`/api/v1/atenciones/${atencionId}/codificacion`)).send({
      diagnosticoCie: 'J03.9',
      motivo: 'Revisión de la codificación mensual',
    });

    expect(r.status).toBe(200);
    expect(r.body.corregido).toBe(true);

    const notas = await med(request(app).get(`/api/v1/atenciones/${atencionId}/correcciones`));
    expect(notas.body.correcciones).toHaveLength(1);
    expect(notas.body.correcciones[0].valorAnterior).toBe('J02.9');
    expect(notas.body.correcciones[0].valorNuevo).toBe('J03.9');
  });
});
