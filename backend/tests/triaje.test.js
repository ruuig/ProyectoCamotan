import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { triaje, evaluarCriterios } from '../src/services/triaje.service.js';
import { ordenarCola, PUNTOS_INICIALES } from '../src/services/priorizacion.service.js';

/**
 * Prioridad parametrizada: los criterios clinicos deciden el nivel, el nivel
 * manda en la cola, y quien pasa su tiempo maximo sube.
 */

const C = (campo, operador, valor, nivel, etiqueta, extra = {}) => ({ campo, operador, valor, nivel, etiqueta, edadDesdeMeses: 0, edadHastaMeses: null, soloEmbarazo: false, activo: true, ...extra });
const CRITERIOS = [
  C('temperatura', 'mayor_igual', 37.5, 'urgente', 'Fiebre en menor de 2 meses', { edadHastaMeses: 2 }),
  C('temperatura', 'mayor_igual', 40, 'urgente', 'Fiebre muy alta', { edadDesdeMeses: 2 }),
  C('temperatura', 'mayor_igual', 39, 'moderado', 'Fiebre alta', { edadDesdeMeses: 2 }),
  C('satOxigeno', 'menor', 90, 'urgente', 'Saturación crítica'),
  C('presionSis', 'mayor_igual', 140, 'urgente', 'Presión alta en el embarazo', { soloEmbarazo: true }),
  C('conciencia', 'mayor_igual', 2, 'urgente', 'No está alerta'),
];

describe('triaje (capa 1)', () => {
  it('de cada dato se queda el criterio más grave', () => {
    const m = evaluarCriterios({ temperatura: 40.2 }, { edadMeses: 300 }, CRITERIOS);
    expect(m).toEqual([expect.objectContaining({ nivel: 'urgente', texto: 'Fiebre muy alta (40.2 °C)' })]);
  });

  it('la edad cambia el umbral: 37.8 °C es urgente en un bebé de 1 mes y nada en un adulto', () => {
    expect(triaje({ temperatura: 37.8 }, { edadMeses: 1 }, CRITERIOS).nivel).toBe('urgente');
    expect(triaje({ temperatura: 37.8 }, { edadMeses: 300 }, CRITERIOS).nivel).toBe('leve');
  });

  it('la presión de embarazo solo aplica a embarazadas', () => {
    expect(triaje({ presionSis: 145 }, { edadMeses: 300, embarazada: true }, CRITERIOS).nivel).toBe('urgente');
    expect(triaje({ presionSis: 145 }, { edadMeses: 300, embarazada: false }, CRITERIOS).nivel).toBe('leve');
  });

  it('gana lo más grave entre criterios y signos de peligro', () => {
    const r = triaje({ temperatura: 39.2, conciencia: 'alerta' }, { edadMeses: 300 }, CRITERIOS, [{ descripcion: 'Convulsiones', gravedadSugerida: 'urgente' }]);
    expect(r.nivel).toBe('urgente');
    expect(r.motivos.map((m) => m.texto)).toEqual(['Convulsiones', 'Fiebre alta (39.2 °C)']);
  });
});

describe('cola (capas 2 y 3)', () => {
  const ahora = new Date('2026-10-10T15:00:00Z');
  const atencion = (id, gravedad, minutos, condiciones = []) => ({
    id, gravedad, ausencias: 0, registradaEn: new Date(ahora.getTime() - minutos * 60000),
    paciente: { condiciones: condiciones.map((tipo) => ({ tipo })), embarazos: [], fechaNacimiento: '1990-01-01' },
  });

  it('el nivel manda: un moderado recién llegado pasa antes que un leve embarazado con espera', () => {
    const orden = ordenarCola([atencion(1, 'leve', 50, ['embarazo']), atencion(2, 'moderado', 1)], ahora);
    expect(orden.map((o) => o.atencion.id)).toEqual([2, 1]);
  });

  it('un leve que pasa su tiempo máximo sube a moderado', () => {
    const orden = ordenarCola([atencion(1, 'moderado', 5), atencion(2, 'leve', 130)], ahora, PUNTOS_INICIALES);
    expect(orden[0]).toMatchObject({ nivel: 'moderado', subio: true });
    expect(orden[0].atencion.id).toBe(2);
    expect(orden[0].factores[0].tipo).toBe('espera_excedida');
  });
});

const MARCA = `TRI${Date.now()}`;
let tokenPre;
let tokenAdmin;
const login = async (usuario, password = 'Camotan2026!') => (await request(app).post('/api/v1/auth/login').send({ usuario, password })).body.token;
const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);
const adm = (p) => p.set('Authorization', `Bearer ${tokenAdmin}`);
const DIRECTOR = { dpi: '1234567890101', password: 'Director2026!' };

async function paciente(fechaNacimiento = '1985-05-05') {
  return (await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres: 'Triaje', apellidos: `Prueba ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento, sexo: 'M', comunidad: 'Tisipe', confirmarDuplicado: true,
  })).body.paciente;
}

beforeAll(async () => {
  [tokenPre, tokenAdmin] = await Promise.all([login('preconsulta'), login('admin')]);
});

afterAll(async () => {
  const ids = (await prisma.paciente.findMany({ where: { expedientePapel: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id);
  const aIds = (await prisma.atencion.findMany({ where: { pacienteId: { in: ids } }, select: { id: true } })).map((a) => a.id);
  await prisma.antropometria.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.atencion.deleteMany({ where: { id: { in: aIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('preconsulta con triaje', () => {
  it('evalúa en vivo antes de guardar', async () => {
    const p = await paciente();
    const r = await pre(request(app).post('/api/v1/atenciones/triaje/evaluar')).send({ pacienteId: p.id, temperatura: 39.5, satOxigeno: 88 });
    expect(r.status).toBe(200);
    expect(r.body.nivel).toBe('urgente');
    expect(r.body.motivos.map((m) => m.etiqueta)).toEqual(expect.arrayContaining(['Saturación crítica', 'Fiebre alta']));
  });

  it('la fiebre alta deja la atención en moderado y guarda por qué', async () => {
    const p = await paciente();
    const r = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({ pacienteId: p.id, motivoConsulta: 'Fiebre', temperatura: 39.4 });
    expect(r.status).toBe(201);
    expect(r.body.gravedad).toBe('moderado');
    const guardada = await prisma.preconsulta.findUnique({ where: { id: r.body.preconsulta.id } });
    expect(guardada.triaje.motivos[0].texto).toBe('Fiebre alta (39.4 °C)');
  });

  it('bajar el nivel sugerido exige justificación', async () => {
    const p = await paciente();
    const sin = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({ pacienteId: p.id, motivoConsulta: 'Dolor', dolor: 9, gravedad: 'leve' });
    expect(sin.status).toBe(400);
    expect(sin.body.error.codigo).toBe('justificacion_requerida');
    const con = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({
      pacienteId: p.id, motivoConsulta: 'Dolor', dolor: 9, gravedad: 'moderado', justificacionGravedad: 'Dolor crónico conocido, sin cambios',
    });
    expect(con.status).toBe(201);
    expect(con.body.gravedad).toBe('moderado');
  });
});

describe('parámetros de la prioridad', () => {
  it('se leen; cambiarlos pide al director; el probador explica', async () => {
    const r = await adm(request(app).get('/api/v1/admin/priorizacion'));
    expect(r.body.criterios.length).toBeGreaterThan(10);
    expect(r.body.puntos.tiempoMaximo.leve).toBe(120);

    const sinDirector = await adm(request(app).put('/api/v1/admin/priorizacion/puntos')).send({ puntos: r.body.puntos });
    expect(sinDirector.status).toBe(400);

    const puntos = { ...r.body.puntos, tiempoMaximo: { moderado: 60, leve: 100 } };
    const ok = await adm(request(app).put('/api/v1/admin/priorizacion/puntos')).send({ puntos, autorizacion: DIRECTOR });
    expect(ok.status).toBe(200);
    expect((await adm(request(app).get('/api/v1/admin/priorizacion'))).body.puntos.tiempoMaximo.leve).toBe(100);
    await adm(request(app).put('/api/v1/admin/priorizacion/puntos')).send({ puntos: r.body.puntos, autorizacion: DIRECTOR });

    const prueba = await adm(request(app).post('/api/v1/admin/priorizacion/probar')).send({ edadMeses: 8, temperatura: 39, frecRespiratoria: 55 });
    expect(prueba.body.nivel).toBe('moderado');
    expect(prueba.body.motivos.map((m) => m.etiqueta)).toEqual(expect.arrayContaining(['Fiebre alta', 'Respiración rápida']));
  });
});
