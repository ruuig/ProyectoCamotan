// Pruebas de los puntos donde el sistema dejo de imponer una mecanica.
//
// La idea que cubren: el establecimiento decide como trabajar, y el sistema
// acompana en vez de bloquear. Pero lo que se registre debe seguir siendo
// correcto y trazable.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

const MARCA = `HERR${Date.now()}`;
let tokenPre;
let tokenMedico;
let tokenFarmacia;
let tokenBodega;
let tokenAdmin;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}

const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);
const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);
// Farmacia dispensa; el resto del inventario lo maneja bodega.
const DE_FARMACIA = /\/dispensaciones|\/pacientes\/\d+\/insumos/;
const farm = (p) => p.set('Authorization', `Bearer ${DE_FARMACIA.test(p.url) ? tokenFarmacia : tokenBodega}`);
const adm = (p) => p.set('Authorization', `Bearer ${tokenAdmin}`);

const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const sufijo = () => Math.random().toString(36).slice(2, 8);

async function nuevoPaciente(comoRol = pre) {
  const r = await comoRol(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${sufijo()}`,
    nombres: 'Herramienta',
    apellidos: `Prueba ${sufijo()}`,
    fechaNacimiento: '1990-01-01',
    sexo: 'M',
    comunidad: 'Tisipe',
    responsableNombre: 'Maria Lopez',
    responsableParentesco: 'madre',
    confirmarDuplicado: true,
  });
  return r.body.paciente;
}

/** Abre la atencion, la pone en curso y devuelve su id. */
async function atencionEnCurso(comoRol = pre) {
  const paciente = await nuevoPaciente();
  const abierta = await comoRol(request(app).post('/api/v1/atenciones')).send({
    pacienteId: paciente.id,
    motivoConsulta: 'Dolor',
  });
  const id = abierta.body.atencion.id;
  await comoRol(request(app).patch(`/api/v1/atenciones/${id}/estado`)).send({
    estado: 'en_atencion',
  });
  return id;
}

async function nuevoInsumoConLote(cantidad, dias = 200) {
  const insumo = await farm(request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} ${sufijo()}`,
    categoria: 'medico_quirurgico',
    presentacion: 'unidad',
    unidadMedida: 'unidad',
    stockMinimo: 5,
  });
  const insumoId = insumo.body.insumo.id;

  const lote = await farm(request(app).post(`/api/v1/insumos/${insumoId}/lotes`)).send({
    numeroLote: `L${sufijo()}`,
    fechaVence: enDias(dias),
    cantidad,
  });

  return { insumoId, lote: lote.body.lote };
}

beforeAll(async () => {
  tokenBodega = await login('bodega');
  [tokenPre, tokenMedico, tokenFarmacia, tokenAdmin] = await Promise.all([
    login('preconsulta'),
    login('medico'),
    login('farmacia'),
    login('admin'),
  ]);
});

/**
 * Borra lo que creo este archivo. Las clinicas son un recurso compartido y
 * limitado: una atencion en curso que quede viva ocupa una clinica y deja sin
 * poder llamar pacientes a las demas pruebas.
 */
async function limpiar() {
  const pacientes = await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: 'HERR' } },
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
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.antropometria.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.atencion.deleteMany({ where: { id: { in: aIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(async () => {
  await limpiar();
  await prisma.clinica.updateMany({ data: { disponible: true } });
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

describe('El medico puede abrir una atencion', () => {
  it('permite al medico registrar la atencion sin depender de preconsulta', async () => {
    const paciente = await nuevoPaciente();

    const r = await med(request(app).post('/api/v1/atenciones')).send({
      pacienteId: paciente.id,
      motivoConsulta: 'Llego sin pasar por preconsulta',
    });

    expect(r.status).toBe(201);
    expect(r.body.atencion.pacienteId).toBe(paciente.id);
  });

  it('sigue sin permitirselo a farmacia', async () => {
    const paciente = await nuevoPaciente();

    const r = await farm(request(app).post('/api/v1/atenciones')).send({
      pacienteId: paciente.id,
      motivoConsulta: 'No corresponde',
    });

    expect(r.status).toBe(403);
  });
});

describe('Cerrar la consulta sin codigo CIE-10', () => {
  it('cierra con el diagnostico en texto y deja el codigo pendiente', async () => {
    const id = await atencionEnCurso();

    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      diagnosticoTxt: 'Faringitis, codigo pendiente de confirmar',
    });

    expect(r.status).toBe(200);
    expect(r.body.atencion.estado).toBe('atendido');
    expect(r.body.atencion.diagnosticoCie).toBeNull();
  });

  it('acepta la cadena vacia como "sin codigo" y no la guarda como texto', async () => {
    const id = await atencionEnCurso();

    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      diagnosticoCie: '',
      diagnosticoTxt: 'Control',
    });

    expect(r.status).toBe(200);
    expect(r.body.atencion.diagnosticoCie).toBeNull();
  });

  it('sigue exigiendo el diagnostico escrito', async () => {
    const id = await atencionEnCurso();

    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      diagnosticoTxt: '',
    });

    expect(r.status).toBe(400);
  });

  it('sigue rechazando un codigo con formato invalido', async () => {
    const id = await atencionEnCurso();

    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      diagnosticoCie: 'NOESUNCODIGO',
      diagnosticoTxt: 'Control',
    });

    expect(r.status).toBe(400);
  });

  it('permite asignar el codigo despues', async () => {
    const id = await atencionEnCurso();
    await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      diagnosticoTxt: 'Faringitis',
    });

    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/codificacion`)).send({
      diagnosticoCie: 'J02.9',
    });

    expect(r.status).toBe(200);
    expect(r.body.atencion.diagnosticoCie).toBe('J02.9');
  });

  it('no codifica una consulta que todavia no se ha cerrado', async () => {
    const id = await atencionEnCurso();

    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/codificacion`)).send({
      diagnosticoCie: 'J02.9',
    });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('estado_invalido');
  });

  it('lista las pendientes de codificar en el panel de direccion', async () => {
    const id = await atencionEnCurso();
    await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      diagnosticoTxt: 'Pendiente de codificar en el panel',
    });

    const r = await adm(request(app).get('/api/v1/indicadores/panel/admin'));

    expect(r.status).toBe(200);
    expect(r.body.pendientesDeCodificar.some((a) => a.id === id)).toBe(true);
  });

  it('cuenta las no codificadas en el consolidado en vez de omitirlas', async () => {
    const id = await atencionEnCurso();
    await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      diagnosticoTxt: 'Sin codigo',
    });

    const r = await adm(request(app).get('/api/v1/indicadores/consolidado'));

    expect(r.status).toBe(200);
    expect(r.body.resumen.sinCodificar).toBeGreaterThan(0);
  });
});

describe('Uso interno de insumos', () => {
  it('descuenta del saldo sin necesitar una receta', async () => {
    const { insumoId } = await nuevoInsumoConLote(100);

    const r = await farm(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId,
      cantidad: 8,
      motivo: 'Curacion en clinica',
    });

    expect(r.status).toBe(201);

    const detalle = await farm(request(app).get(`/api/v1/insumos/${insumoId}/cobertura`));
    expect(detalle.body.saldo).toBe(92);
  });

  it('cuenta como consumo, no como baja', async () => {
    const { insumoId, lote } = await nuevoInsumoConLote(50);

    await farm(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId,
      cantidad: 5,
      motivo: 'Jornada de vacunacion',
    });

    const movimientos = await prisma.movimientoInsumo.findMany({
      where: { loteId: lote.id, tipo: 'consumo_interno' },
    });

    expect(movimientos).toHaveLength(1);
    // Sin dispensacion detras: es consumo propio del establecimiento, y para
    // el BRES es un renglon distinto de la entrega a paciente.
    expect(movimientos[0].dispensacionId).toBeNull();
    expect(movimientos[0].cantidad).toBe(-5);
    expect(movimientos[0].motivo).toBe('Jornada de vacunacion');
  });

  it('se distingue de una dispensacion en la trazabilidad', async () => {
    const { insumoId, lote } = await nuevoInsumoConLote(30);

    await farm(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId,
      cantidad: 3,
      motivo: 'Material de curacion',
    });

    const r = await farm(request(app).get(`/api/v1/lotes/${lote.id}/trazabilidad`));
    const etiquetas = r.body.movimientos.map((m) => m.etiqueta);

    expect(etiquetas).toContain('Consumo interno');
    expect(etiquetas.some((e) => e.startsWith('Entrega a paciente'))).toBe(false);
  });

  it('exige explicar en que se uso', async () => {
    const { insumoId } = await nuevoInsumoConLote(20);

    const r = await farm(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId,
      cantidad: 2,
      motivo: 'x',
    });

    expect(r.status).toBe(400);
  });

  it('no deja sacar mas de lo que hay', async () => {
    const { insumoId } = await nuevoInsumoConLote(4);

    const r = await farm(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId,
      cantidad: 10,
      motivo: 'Curacion mayor',
    });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('existencia_insuficiente');
  });

  it('reparte entre lotes por FEFO cuando uno solo no alcanza', async () => {
    const { insumoId } = await nuevoInsumoConLote(6, 30);
    await farm(request(app).post(`/api/v1/insumos/${insumoId}/lotes`)).send({
      numeroLote: `L${sufijo()}`,
      fechaVence: enDias(300),
      cantidad: 10,
    });

    const r = await farm(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId,
      cantidad: 9,
      motivo: 'Jornada comunitaria',
    });

    expect(r.status).toBe(201);
    expect(r.body.fraccionado).toBe(true);
    // Primero se agota el lote que vence antes.
    expect(r.body.movimientos[0].cantidad).toBe(6);
    expect(r.body.movimientos[1].cantidad).toBe(3);
  });

  it('no lo permite a quien no es de farmacia', async () => {
    const { insumoId } = await nuevoInsumoConLote(10);

    const r = await med(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId,
      cantidad: 1,
      motivo: 'No corresponde',
    });

    expect(r.status).toBe(403);
  });
});
