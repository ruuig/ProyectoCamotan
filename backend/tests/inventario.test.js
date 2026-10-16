import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Inventario y trazabilidad segun el sistema logistico del MSPAS.
 *
 * Lo que se prueba aqui no es que el saldo baje, sino que las decisiones que
 * toma el ministerio con estos numeros salgan bien: cuanto pedir, que se
 * puede entregar y que no, y a quien hay que buscar si algo se retira.
 */

const MARCA = `INV${Date.now()}`;
let tokenFarmacia;
let tokenBodega;
let tokenMedico;
let tokenPre;
let tokenAdmin;
let establecimientoId;
let farmaciaId;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}

// Farmacia dispensa; el resto del inventario lo maneja bodega.
const DE_FARMACIA = /\/dispensaciones|\/pacientes\/\d+\/insumos/;
const farm = (p) => p.set('Authorization', `Bearer ${DE_FARMACIA.test(p.url) ? tokenFarmacia : tokenBodega}`);
const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);
const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);
const adm = (p) => p.set('Authorization', `Bearer ${tokenAdmin}`);

const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const enMeses = (n) => enDias(Math.round(n * 30));
const periodoActual = () => new Date().toISOString().slice(0, 7);

async function nuevoInsumo(extra = {}) {
  const r = await farm(request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} ${Math.random().toString(36).slice(2, 7)}`,
    categoria: 'medicamentos',
    presentacion: 'tableta',
    unidadMedida: 'unidad',
    stockMinimo: 10,
    ...extra,
  });
  return r.body.insumo;
}

// Con aFarmacia, todo lo recibido pasa a la farmacia con un traslado, como
// en el centro: farmacia solo entrega lo que tiene.
async function recibirLote(insumoId, { cantidad, dias, numeroLote, aFarmacia = false, ...extra }) {
  const r = await farm(request(app).post(`/api/v1/insumos/${insumoId}/lotes`)).send({
    numeroLote: numeroLote ?? `L${Math.random().toString(36).slice(2, 8)}`,
    fechaVence: enDias(dias),
    cantidad,
    ...extra,
  });
  if (aFarmacia && r.body.lote) {
    const t = await farm(request(app).post('/api/v1/bodega/traslados')).send({
      ubicacionId: farmaciaId, recibidoPor: 'Farmacia', renglones: [{ loteId: r.body.lote.id, cantidad }],
    });
    if (t.status !== 201) throw new Error(`No pasó a farmacia: ${JSON.stringify(t.body)}`);
  }
  return r.body;
}

// Crea paciente, atencion en curso y una prescripcion lista para dispensar.
async function nuevaPrescripcion(insumoId, cantidad) {
  const paciente = await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres: 'Farmacia',
    apellidos: `Prueba ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento: '1990-01-01',
    sexo: 'M',
    comunidad: 'Tisipe',
    responsableNombre: 'Maria Lopez',
    responsableParentesco: 'madre',
    confirmarDuplicado: true,
  });

  const atencion = await pre(request(app).post('/api/v1/atenciones')).send({
    pacienteId: paciente.body.paciente.id,
    motivoConsulta: 'Dolor',
  });

  await pre(request(app).patch(`/api/v1/atenciones/${atencion.body.atencion.id}/estado`)).send({
    estado: 'en_atencion',
  });

  const receta = await med(
    request(app).post(`/api/v1/atenciones/${atencion.body.atencion.id}/prescripcion`),
  ).send({ insumoId, cantidad });

  // Se cierra la consulta para liberar la unica clinica.
  await med(request(app).patch(`/api/v1/atenciones/${atencion.body.atencion.id}/consulta`)).send({
    diagnosticoCie: 'R52',
    diagnosticoTxt: 'Dolor no especificado',
  });

  return {
    paciente: paciente.body.paciente,
    atencion: atencion.body.atencion,
    prescripcion: receta.body.prescripcion,
  };
}

async function limpiar() {
  const insumos = await prisma.insumo.findMany({
    where: { nombreGenerico: { startsWith: MARCA } },
    select: { id: true },
  });
  const insumoIds = insumos.map((i) => i.id);

  const pacientes = await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } },
    select: { id: true },
  });
  const pacienteIds = pacientes.map((p) => p.id);

  const atenciones = await prisma.atencion.findMany({
    where: { pacienteId: { in: pacienteIds } },
    select: { id: true },
  });
  const atencionIds = atenciones.map((a) => a.id);

  const lotes = await prisma.lote.findMany({
    where: { insumoId: { in: insumoIds } },
    select: { id: true },
  });
  const loteIds = lotes.map((l) => l.id);

  // El orden importa: lo que referencia va antes que lo referenciado.
  await prisma.retiroPaciente.deleteMany({ where: { loteId: { in: loteIds } } });
  await prisma.retiroLote.deleteMany({ where: { loteId: { in: loteIds } } });
  await prisma.retiroSanitario.deleteMany({ where: { referencia: { startsWith: MARCA } } });
  await prisma.oficioBaja.deleteMany({ where: { loteId: { in: loteIds } } });
  await prisma.conteoFisico.deleteMany({ where: { loteId: { in: loteIds } } });
  await prisma.inventarioFisico.deleteMany({ where: { establecimientoId } });
  await prisma.bresRenglon.deleteMany({ where: { insumoId: { in: insumoIds } } });
  await prisma.bres.deleteMany({ where: { establecimientoId } });
  await prisma.demandaNoAtendida.deleteMany({ where: { insumoId: { in: insumoIds } } });
  await prisma.demandaNoAtendida.deleteMany({ where: { pacienteId: { in: pacienteIds } } });
  await prisma.movimientoInsumo.deleteMany({ where: { loteId: { in: loteIds } } });
  // Los traslados a farmacia de estas pruebas quedan sin renglones: se borran.
  await prisma.traslado.deleteMany({ where: { establecimientoId, recibidoPor: 'Farmacia', movimientos: { none: {} } } });
  await prisma.dispensacion.deleteMany({
    where: { prescripcion: { atencionId: { in: atencionIds } } },
  });
  await prisma.prescripcion.deleteMany({ where: { atencionId: { in: atencionIds } } });
  await prisma.recetaExterna.deleteMany({ where: { atencionId: { in: atencionIds } } });
  await prisma.lote.deleteMany({ where: { id: { in: loteIds } } });
  await prisma.insumo.deleteMany({ where: { id: { in: insumoIds } } });
  await prisma.antropometria.deleteMany({ where: { pacienteId: { in: pacienteIds } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: atencionIds } } });
  await prisma.constanciaEntrega.deleteMany({ where: { atencionId: { in: atencionIds } } });
  await prisma.atencion.deleteMany({ where: { id: { in: atencionIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: pacienteIds } } });
  await prisma.paciente.deleteMany({ where: { id: { in: pacienteIds } } });
}

beforeAll(async () => {
  tokenBodega = await login('bodega');
  [tokenFarmacia, tokenMedico, tokenPre, tokenAdmin] = await Promise.all([
    login('farmacia'),
    login('medico'),
    login('preconsulta'),
    login('admin'),
  ]);
  const u = await prisma.usuario.findUnique({ where: { usuario: 'farmacia' } });
  establecimientoId = u.establecimientoId;
  farmaciaId = (await prisma.ubicacion.findFirst({ where: { establecimientoId, tipo: 'centro_salud' } })).id;
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

// ===========================================================================
describe('catálogo de insumos', () => {
  it('crea un insumo con su código interno y lo lista con su saldo', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 100, dias: 400 });

    expect(insumo.codigoInterno).toMatch(/^INS-\d{5}$/);

    const r = await farm(request(app).get('/api/v1/insumos').query({ buscar: MARCA }));
    const encontrado = r.body.insumos.find((i) => i.id === insumo.id);
    expect(encontrado.saldoTotal).toBe(100);
  });

  it('no deja dos insumos activos con el mismo genérico, forma y concentración', async () => {
    const nombre = `${MARCA} Amoxicilina`;
    const primero = await farm(request(app).post('/api/v1/insumos')).send({
      nombreGenerico: nombre,
      formaFarmaceutica: 'cápsula',
      concentracion: '500 mg',
      categoria: 'medicamentos',
      presentacion: 'blíster',
      unidadMedida: 'cápsula',
    });
    expect(primero.status).toBe(201);

    const repetido = await farm(request(app).post('/api/v1/insumos')).send({
      nombreGenerico: nombre.toUpperCase(),
      formaFarmaceutica: 'cápsula',
      concentracion: '500 mg',
      categoria: 'medicamentos',
      presentacion: 'frasco',
      unidadMedida: 'cápsula',
    });

    expect(repetido.status).toBe(409);
    expect(repetido.body.error.codigo).toBe('insumo_duplicado');
  });

  it('la misma molécula en otra concentración sí es otro insumo', async () => {
    const nombre = `${MARCA} Paracetamol`;
    const base = {
      nombreGenerico: nombre,
      formaFarmaceutica: 'tableta',
      categoria: 'medicamentos',
      presentacion: 'blíster',
      unidadMedida: 'tableta',
    };

    const a = await farm(request(app).post('/api/v1/insumos')).send({ ...base, concentracion: '500 mg' });
    const b = await farm(request(app).post('/api/v1/insumos')).send({ ...base, concentracion: '1 g' });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('acepta las categorías del centro y rechaza las que no son', async () => {
    const insumo = await nuevoInsumo({ categoria: 'planificacion_familiar' });
    expect(insumo.categoria).toBe('planificacion_familiar');
    const r = await farm(request(app).post('/api/v1/insumos')).send({
      nombreGenerico: `${MARCA} vieja`, categoria: 'biologico', presentacion: 'frasco', unidadMedida: 'dosis',
    });
    expect(r.status).toBe(400);
  });
});

// ===========================================================================
describe('recepción de lotes', () => {
  it('registra la procedencia y el movimiento de ingreso', async () => {
    const insumo = await nuevoInsumo();
    const r = await recibirLote(insumo.id, {
      cantidad: 100,
      dias: 400,
      fabricante: 'Laboratorio X',
      registroSanitario: 'RS-123',
      ubicacion: 'Estante 2',
      costoUnitario: 1.5,
    });

    expect(r.lote.fabricante).toBe('Laboratorio X');
    expect(r.lote.registroSanitario).toBe('RS-123');
    expect(r.lote.estado).toBe('disponible');

    const movimientos = await prisma.movimientoInsumo.findMany({ where: { loteId: r.lote.id } });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].tipo).toBe('ingreso');
    expect(movimientos[0].cantidad).toBe(100);
  });

  it('ingresa lo realmente recibido y anota la diferencia contra el documento', async () => {
    const insumo = await nuevoInsumo();
    const r = await recibirLote(insumo.id, { cantidad: 95, dias: 400, cantidadDocumento: 100 });

    // El saldo es lo que llegó, no lo que dice el papel.
    expect(r.lote.cantidadInicial).toBe(95);
    expect(r.diferenciaCantidad).toBe(-5);
    expect(r.avisos.join(' ')).toContain('5 menos');
  });

  it('un producto no conforme entra en cuarentena y no se puede entregar', async () => {
    const insumo = await nuevoInsumo();
    const r = await recibirLote(insumo.id, {
      cantidad: 50,
      dias: 400,
      verificacion: { etiquetado: true, empaque: false, aspecto: true },
      observacionRecepcion: 'Caja con humedad',
    });

    expect(r.enCuarentena).toBe(true);
    expect(r.lote.estado).toBe('cuarentena');

    // No cuenta como existencia utilizable.
    const abast = await farm(request(app).get(`/api/v1/inventario/abastecimiento/${insumo.id}`));
    expect(abast.body.saldo).toBe(0);
    expect(abast.body.saldoEnCuarentena).toBe(50);
  });

  it('una donación sin número de acta se rechaza', async () => {
    const insumo = await nuevoInsumo();
    const r = await farm(request(app).post(`/api/v1/insumos/${insumo.id}/lotes`)).send({
      numeroLote: `L${Date.now()}`,
      fechaVence: enDias(400),
      cantidad: 10,
      origen: 'donacion',
    });

    expect(r.status).toBe(400);
  });

  it('avisa con el semáforo del centro: rojo a menos de 12 meses, amarillo de 12 a 18', async () => {
    const insumo = await nuevoInsumo();
    const rojo = await recibirLote(insumo.id, { cantidad: 10, dias: 200 });
    expect(rojo.semaforo).toBe('rojo');
    expect(rojo.avisos.join(' ')).toContain('rojo');

    const amarillo = await recibirLote(insumo.id, { cantidad: 10, dias: 450 });
    expect(amarillo.semaforo).toBe('amarillo');
  });

  it('avisa, sin impedir, si el lote vence en menos de 3 meses', async () => {
    const insumo = await nuevoInsumo();
    const r = await recibirLote(insumo.id, { cantidad: 10, dias: 60 });
    expect(r.avisos.join(' ')).toContain('menos de 3 meses');
  });

  it('un lote a dos meses entra en rojo', async () => {
    const insumo = await nuevoInsumo();
    const r = await recibirLote(insumo.id, { cantidad: 10, dias: 60 });
    expect(r.semaforo).toBe('rojo');
  });
});

// ===========================================================================
describe('estados del lote', () => {
  it('solo un lote disponible se puede entregar', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    await farm(request(app).patch(`/api/v1/lotes/${lote.id}/estado`)).send({
      estado: 'cuarentena',
      motivo: 'Sospecha de alteración en el empaque',
    });

    const { prescripcion } = await nuevaPrescripcion(insumo.id, 5);
    const r = await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 5,
    });

    expect(r.status).toBe(409);
  });

  it('liberar de cuarentena lo devuelve a circulación', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, {
      cantidad: 50,
      dias: 400,
      verificacion: { empaque: false },
    });

    const r = await farm(request(app).patch(`/api/v1/lotes/${lote.id}/estado`)).send({
      estado: 'disponible',
      motivo: 'Revisado por el responsable de farmacia, empaque íntegro',
    });

    expect(r.status).toBe(200);
    expect(r.body.lote.estado).toBe('disponible');
  });

  it('un lote vencido no se puede liberar', async () => {
    const insumo = await nuevoInsumo();
    const lote = await prisma.lote.create({
      data: {
        insumoId: insumo.id,
        numeroLote: `V${Date.now()}`,
        fechaVence: new Date(Date.now() - 86400000),
        cantidadInicial: 10,
        cantidadActual: 10,
        estado: 'cuarentena',
        motivoEstado: 'prueba',
      },
    });

    const r = await farm(request(app).patch(`/api/v1/lotes/${lote.id}/estado`)).send({
      estado: 'disponible',
      motivo: 'Intento de liberación indebida',
    });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('lote_vencido');
  });

  it('agotado y vencido no se ponen a mano', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 10, dias: 400 });

    const r = await farm(request(app).patch(`/api/v1/lotes/${lote.id}/estado`)).send({
      estado: 'vencido',
      motivo: 'Intento manual',
    });

    // El esquema ya no acepta ese estado.
    expect(r.status).toBe(400);
  });

  it('al agotarse el lote pasa solo a agotado', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { aFarmacia: true, cantidad: 5, dias: 400 });
    const { prescripcion } = await nuevaPrescripcion(insumo.id, 5);

    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 5,
    });

    const actualizado = await prisma.lote.findUnique({ where: { id: lote.id } });
    expect(actualizado.cantidadActual).toBe(0);
    expect(actualizado.estado).toBe('agotado');
  });
});

// ===========================================================================
describe('entregas y demanda no atendida', () => {
  it('propone el lote que vence primero (PEPE)', async () => {
    const insumo = await nuevoInsumo();
    const viejo = await recibirLote(insumo.id, { aFarmacia: true, cantidad: 20, dias: 120 });
    await recibirLote(insumo.id, { aFarmacia: true, cantidad: 50, dias: 400 });

    const { prescripcion } = await nuevaPrescripcion(insumo.id, 10);
    const r = await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 10,
    });

    expect(r.status).toBe(201);
    expect(r.body.movimientos[0].loteId).toBe(viejo.lote.id);
  });

  it('PEPE salta el lote en cuarentena aunque venza primero', async () => {
    const insumo = await nuevoInsumo();
    // El que vence primero está en cuarentena: no se puede entregar.
    await recibirLote(insumo.id, { aFarmacia: true,
      cantidad: 40, dias: 120, verificacion: { empaque: false },
    });
    const bueno = await recibirLote(insumo.id, { aFarmacia: true, cantidad: 40, dias: 400 });

    const { prescripcion } = await nuevaPrescripcion(insumo.id, 10);
    const r = await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 10,
    });

    // Antes esto fallaba con 409: PEPE proponía el lote retenido.
    expect(r.status).toBe(201);
    expect(r.body.movimientos[0].loteId).toBe(bueno.lote.id);
  });

  it('la existencia que se informa al prescribir no cuenta la cuarentena', async () => {
    const insumo = await nuevoInsumo({ stockMinimo: 5 });
    await recibirLote(insumo.id, {
      cantidad: 50, dias: 400, verificacion: { empaque: false },
    });

    const { atencion } = await nuevaPrescripcion(insumo.id, 1);
    // Se receta más de lo entregable: el aviso debe decir que hay 0, no 50.
    const r = await med(
      request(app).post(`/api/v1/atenciones/${atencion.id}/prescripcion`),
    ).send({ insumoId: insumo.id, cantidad: 10 });

    expect(r.status).toBe(201);
    expect(r.body.existencia.saldoTotal).toBe(0);
    expect(r.body.existencia.enFarmacia).toBe(0);
    expect(r.body.avisos.join(' ')).toContain('En farmacia quedan 0');
  });

  it('registra la demanda no atendida cuando no alcanza', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { aFarmacia: true, cantidad: 4, dias: 400 });

    const { prescripcion } = await nuevaPrescripcion(insumo.id, 10);
    const r = await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 10,
    });

    // Se entrega lo que hay y se cuenta lo que faltó: las dos cosas.
    expect(r.status).toBe(201);
    expect(r.body.entregado).toBe(4);
    expect(r.body.noAtendido).toBe(6);
    expect(r.body.aviso).toContain('demanda no atendida');

    const registrada = await prisma.demandaNoAtendida.findFirst({
      where: { insumoId: insumo.id },
    });
    expect(registrada.cantidad).toBe(6);
  });

  it('sin nada en existencia también queda registrada la demanda', async () => {
    const insumo = await nuevoInsumo();
    const { prescripcion } = await nuevaPrescripcion(insumo.id, 8);

    const r = await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 8,
    });

    expect(r.status).toBe(409);
    const registrada = await prisma.demandaNoAtendida.findFirst({ where: { insumoId: insumo.id } });
    expect(registrada.cantidad).toBe(8);
  });

  it('la demanda no atendida sube lo que hay que pedir', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 100, dias: 400 });

    const antes = await farm(request(app).get(`/api/v1/inventario/abastecimiento/${insumo.id}`));
    const pedirAntes = antes.body.cantidadSolicitar;

    // Se registra una demanda no atendida grande del mes en curso.
    await prisma.demandaNoAtendida.create({
      data: {
        establecimientoId,
        insumoId: insumo.id,
        cantidad: 300,
        registradaPor: (await prisma.usuario.findUnique({ where: { usuario: 'farmacia' } })).id,
      },
    });

    const despues = await farm(request(app).get(`/api/v1/inventario/abastecimiento/${insumo.id}`));
    expect(despues.body.cantidadSolicitar).toBeGreaterThan(pedirAntes ?? 0);
    expect(despues.body.demanda.at(-1).noEntregado).toBe(300);
  });
});

// ===========================================================================
describe('reajustes con causa del catálogo', () => {
  it('registra un sobrante de inventario físico', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    const r = await farm(request(app).post('/api/v1/inventario/reajustes')).send({
      loteId: lote.id,
      cantidad: 3,
      causa: 'sobrante_inventario_fisico',
      motivo: 'Conteo del mes',
    });

    expect(r.status).toBe(200);
    expect(r.body.lote.cantidadActual).toBe(53);
    expect(r.body.causaEtiqueta).toBe('Sobrante en inventario físico');
  });

  it('rechaza una causa que no concuerda con el signo', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    const r = await farm(request(app).post('/api/v1/inventario/reajustes')).send({
      loteId: lote.id,
      cantidad: -3,
      causa: 'sobrante_inventario_fisico',
      motivo: 'Incoherente a propósito',
    });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('causa_no_concuerda');
  });

  it('no acepta una causa fuera del catálogo', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    const r = await farm(request(app).post('/api/v1/inventario/reajustes')).send({
      loteId: lote.id,
      cantidad: -3,
      causa: 'se_perdio',
      motivo: 'Causa inventada',
    });

    expect(r.status).toBe(400);
  });

  it('no deja el saldo en negativo', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 5, dias: 400 });

    const r = await farm(request(app).post('/api/v1/inventario/reajustes')).send({
      loteId: lote.id,
      cantidad: -10,
      causa: 'faltante_inventario_fisico',
      motivo: 'Más de lo que hay',
    });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('reajuste_invalido');
  });

  it('el movimiento anterior no se toca: queda la historia completa', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    await farm(request(app).post('/api/v1/inventario/reajustes')).send({
      loteId: lote.id,
      cantidad: -2,
      causa: 'faltante_inventario_fisico',
      motivo: 'Faltante',
    });
    await farm(request(app).post('/api/v1/inventario/reajustes')).send({
      loteId: lote.id,
      cantidad: 2,
      causa: 'correccion_error_registro_positiva',
      motivo: 'Era error de conteo',
    });

    const movimientos = await prisma.movimientoInsumo.findMany({ where: { loteId: lote.id } });
    expect(movimientos).toHaveLength(3);
    const lote2 = await prisma.lote.findUnique({ where: { id: lote.id } });
    expect(lote2.cantidadActual).toBe(50);
  });
});

// ===========================================================================
describe('consumo interno', () => {
  it('el consumo interno sale del saldo y cuenta como movimiento propio', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    const r = await farm(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId: insumo.id,
      cantidad: 5,
      motivo: 'Curación en clínica 1',
      servicio: 'Curaciones',
    });

    expect(r.status).toBe(201);
    const movimiento = await prisma.movimientoInsumo.findFirst({
      where: { lote: { insumoId: insumo.id }, tipo: 'consumo_interno' },
    });
    expect(movimiento.servicio).toBe('Curaciones');
    expect(movimiento.cantidad).toBe(-5);
  });

});

// ===========================================================================
describe('cálculos del MSPAS sobre datos reales', () => {
  it('calcula PMDR, MED y cuánto solicitar', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 100, dias: 400 });

    const r = await farm(request(app).get(`/api/v1/inventario/abastecimiento/${insumo.id}`));

    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('pmdr');
    expect(r.body).toHaveProperty('med');
    expect(r.body).toHaveProperty('cantidadMinima');
    expect(r.body).toHaveProperty('cantidadSolicitar');
    expect(r.body.demanda).toHaveLength(6);
  });

  it('sin historia de demanda no inventa niveles', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 100, dias: 400 });

    const r = await farm(request(app).get(`/api/v1/inventario/abastecimiento/${insumo.id}`));
    // Nunca se ha entregado nada: no hay con qué calcular.
    expect(r.body.pmdr).toBe(0);
    expect(r.body.med).toBeNull();
    expect(r.body.cantidadMinima).toBe(0);
  });

  it('marca las cifras como provisionales mientras no se confirmen los tiempos', async () => {
    const r = await farm(request(app).get('/api/v1/inventario/abastecimiento'));
    expect(r.body).toHaveProperty('provisional');
    expect(typeof r.body.provisional).toBe('boolean');
  });

  it('los niveles del BRES del centro mandan en todo el sistema', async () => {
    const antes = await adm(request(app).get('/api/v1/inventario/configuracion'));
    const original = antes.body.configuracion;
    const base = {
      mesesSolicitudRecepcion: original.mesesSolicitudRecepcion,
      mesesFrecuenciaPedido: original.mesesFrecuenciaPedido,
      diaCorteBres: 25,
      diaInventarioFisico: 28,
      diasMaximoCuarentena: 7,
      provisional: true,
    };

    const r = await adm(request(app).patch('/api/v1/inventario/configuracion')).send({
      ...base, nivelMinimoMeses: 3, nivelMaximoMeses: 6,
    });
    expect(r.status).toBe(200);
    const despues = await adm(request(app).get('/api/v1/inventario/configuracion'));
    expect(despues.body.configuracion.nivelMinimoMeses).toBe(3);
    expect(despues.body.configuracion.nivelMaximoMeses).toBe(6);

    const malo = await adm(request(app).patch('/api/v1/inventario/configuracion')).send({
      ...base, nivelMinimoMeses: 5, nivelMaximoMeses: 4,
    });
    expect(malo.status).toBe(400);

    // Se deja como estaba para no afectar a las demás pruebas.
    await adm(request(app).patch('/api/v1/inventario/configuracion')).send({
      ...base, nivelMinimoMeses: original.nivelMinimoMeses, nivelMaximoMeses: original.nivelMaximoMeses,
    });
  });

  it('farmacia no puede cambiar los parámetros logísticos', async () => {
    const r = await farm(request(app).patch('/api/v1/inventario/configuracion')).send({
      mesesSolicitudRecepcion: 5,
      mesesFrecuenciaPedido: 5,
      diaCorteBres: 25,
      diaInventarioFisico: 28,
      diasMaximoCuarentena: 7,
      provisional: true,
    });
    expect(r.status).toBe(403);
  });
});

// ===========================================================================
describe('el saldo cuadra con los movimientos', () => {
  it('verifica todos los lotes y informa descuadres', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    const r = await farm(request(app).get('/api/v1/inventario/verificar-saldos'));

    expect(r.status).toBe(200);
    // El lote recién recibido cuadra con su único movimiento.
    expect(r.body.descuadrados.some((d) => d.insumo.startsWith(MARCA))).toBe(false);
    expect(r.body.revisados).toBeGreaterThan(0);
  });

  it('detecta un saldo alterado por fuera de los movimientos', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    // Alteración directa, como la que dejaría un error de programación.
    await prisma.lote.update({ where: { id: lote.id }, data: { cantidadActual: 77 } });

    const r = await farm(request(app).get('/api/v1/inventario/verificar-saldos'));
    const descuadrado = r.body.descuadrados.find((d) => d.loteId === lote.id);

    expect(descuadrado).toBeTruthy();
    expect(descuadrado.saldoCalculado).toBe(50);
    expect(descuadrado.diferencia).toBe(27);
  });
});

// ===========================================================================
describe('inventario físico', () => {
  it('la hoja de conteo no revela el saldo esperado', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    const r = await farm(request(app).get('/api/v1/inventario/fisico/hoja'));
    const fila = r.body.lotes.find((l) => l.insumo.id === insumo.id);

    expect(fila).toBeTruthy();
    // El conteo es ciego a propósito.
    expect(fila.cantidadActual).toBeUndefined();
    expect(fila.saldoSistema).toBeUndefined();
  });

  it('un lote recién agotado sigue entrando: hay que verificar que el cero es cero', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { aFarmacia: true, cantidad: 5, dias: 400 });
    const { prescripcion } = await nuevaPrescripcion(insumo.id, 5);

    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 5,
    });

    const r = await farm(request(app).get('/api/v1/inventario/fisico/hoja'));
    const fila = r.body.lotes.find((l) => l.loteId === lote.id);

    expect(fila).toBeTruthy();
    expect(fila.estado).toBe('agotado');
    // Sigue siendo ciego: tampoco de este se dice cuánto debería haber.
    expect(fila.cantidadActual).toBeUndefined();
  });

  it('cierra el inventario, calcula diferencias y aplica los reajustes chicos', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 50, dias: 400 });

    const abierto = await farm(request(app).post('/api/v1/inventario/fisico')).send({
      periodo: periodoActual(),
    });
    expect(abierto.status).toBe(201);

    // Se cuenta uno menos: diferencia pequeña, se aplica sola.
    await farm(request(app).post(`/api/v1/inventario/fisico/${abierto.body.inventario.id}/conteos`)).send({
      conteos: [{ loteId: lote.id, cantidadContada: 49 }],
    });

    const cerrado = await farm(
      request(app).post(`/api/v1/inventario/fisico/${abierto.body.inventario.id}/cerrar`),
    ).send({ aplicarReajustes: true });

    expect(cerrado.status).toBe(200);
    expect(cerrado.body.conDiferencia).toBe(1);
    expect(cerrado.body.reajustesAplicados).toBe(1);

    const actualizado = await prisma.lote.findUnique({ where: { id: lote.id } });
    expect(actualizado.cantidadActual).toBe(49);

    // El reajuste queda con la causa del catálogo.
    const reajuste = await prisma.movimientoInsumo.findFirst({
      where: { loteId: lote.id, tipo: 'reajuste' },
    });
    expect(reajuste.causa).toBe('faltante_inventario_fisico');
  });

  it('una diferencia grande queda pendiente de autorización', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 100, dias: 400 });

    const abierto = await farm(request(app).post('/api/v1/inventario/fisico')).send({
      periodo: periodoActual(),
    });

    // Faltan 40 de 100: eso no es un error de conteo.
    await farm(request(app).post(`/api/v1/inventario/fisico/${abierto.body.inventario.id}/conteos`)).send({
      conteos: [{ loteId: lote.id, cantidadContada: 60 }],
    });

    const cerrado = await farm(
      request(app).post(`/api/v1/inventario/fisico/${abierto.body.inventario.id}/cerrar`),
    ).send({ aplicarReajustes: true });

    expect(cerrado.body.pendientesDeAutorizar).toHaveLength(1);
    expect(cerrado.body.reajustesAplicados).toBe(0);

    // El saldo no se tocó: la pérdida no se borra sin que se note.
    const actualizado = await prisma.lote.findUnique({ where: { id: lote.id } });
    expect(actualizado.cantidadActual).toBe(100);
  });

  it('no deja abrir dos inventarios del mismo período', async () => {
    await farm(request(app).post('/api/v1/inventario/fisico')).send({ periodo: periodoActual() });
    const segundo = await farm(request(app).post('/api/v1/inventario/fisico')).send({
      periodo: periodoActual(),
    });

    expect(segundo.status).toBe(409);
    expect(segundo.body.error.codigo).toBe('inventario_duplicado');
  });
});

// ===========================================================================
describe('BRES', () => {
  it('arma el informe con los renglones del período', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 100, dias: 400 });

    const r = await farm(
      request(app).get(`/api/v1/inventario/bres/${periodoActual()}/vista-previa`),
    );

    expect(r.status).toBe(200);
    const renglon = r.body.renglones.find((x) => x.insumoId === insumo.id);
    expect(renglon.entradas).toBe(100);
    expect(renglon.saldoFinal).toBe(100);
    expect(renglon.demandaReal).toBe(0);
  });

  it('la demanda real es lo entregado más lo no entregado', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { aFarmacia: true, cantidad: 20, dias: 400 });

    const { prescripcion } = await nuevaPrescripcion(insumo.id, 15);
    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 15,
    });

    // Otra receta que ya no alcanza.
    const segunda = await nuevaPrescripcion(insumo.id, 10);
    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: segunda.prescripcion.id,
      cantidad: 10,
    });

    const r = await farm(
      request(app).get(`/api/v1/inventario/bres/${periodoActual()}/vista-previa`),
    );
    const renglon = r.body.renglones.find((x) => x.insumoId === insumo.id);

    // Se entregaron 15 y luego los 5 que quedaban; faltaron 5 de la segunda
    // receta. La demanda real es lo uno mas lo otro.
    expect(renglon.entregado).toBe(20);
    expect(renglon.noEntregado).toBe(5);
    expect(renglon.demandaReal).toBe(25);
    // Sin contar el faltante, el mes siguiente se volveria a pedir de menos.
    expect(renglon.demandaReal).toBeGreaterThan(renglon.entregado);
  });

  it('el saldo anterior nunca sale negativo: el balance cuadra', async () => {
    const insumo = await nuevoInsumo();
    // Un lote normal y otro que queda en cuarentena: las entradas cuentan los
    // dos, así que el saldo del BRES también tiene que contarlos.
    await recibirLote(insumo.id, { cantidad: 30, dias: 400 });
    await recibirLote(insumo.id, { cantidad: 50, dias: 400, verificacion: { empaque: false } });

    const r = await farm(
      request(app).get(`/api/v1/inventario/bres/${periodoActual()}/vista-previa`),
    );
    const renglon = r.body.renglones.find((x) => x.insumoId === insumo.id);

    expect(renglon.saldoInicial).toBeGreaterThanOrEqual(0);
    expect(renglon.entradas).toBe(80);
    expect(renglon.saldoFinal).toBe(80);
    // saldo inicial + entradas + reajustes - salidas = saldo final
    const salidas = renglon.entregado + renglon.consumoInterno + renglon.traslados + renglon.bajas;
    expect(renglon.saldoInicial + renglon.entradas + renglon.reajustes - salidas).toBe(
      renglon.saldoFinal,
    );
  });

  it('ningún renglón del BRES sale con saldo anterior negativo', async () => {
    const r = await farm(
      request(app).get(`/api/v1/inventario/bres/${periodoActual()}/vista-previa`),
    );
    for (const renglon of r.body.renglones) {
      expect(renglon.saldoInicial).toBeGreaterThanOrEqual(0);
    }
  });

  it('se genera, se cierra y ya no admite cambios', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 30, dias: 400 });

    const generado = await farm(request(app).post('/api/v1/inventario/bres')).send({
      periodo: periodoActual(),
    });
    expect(generado.status).toBe(201);

    const sinClave = await farm(request(app).post(`/api/v1/inventario/bres/${periodoActual()}/cerrar`)).send({ password: 'otra' });
    expect(sinClave.status).toBe(403);
    expect(sinClave.body.error.codigo).toBe('contrasena_incorrecta');

    const cerrado = await farm(
      request(app).post(`/api/v1/inventario/bres/${periodoActual()}/cerrar`),
    ).send({ password: 'Camotan2026!' });
    expect(cerrado.status).toBe(200);

    const otraVez = await farm(request(app).post('/api/v1/inventario/bres')).send({
      periodo: periodoActual(),
    });
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.error.codigo).toBe('bres_cerrado');
  });

  it('el registro diario de demanda se deriva de los movimientos', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { aFarmacia: true, cantidad: 20, dias: 400 });
    const { prescripcion } = await nuevaPrescripcion(insumo.id, 5);
    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 5,
    });

    const r = await farm(
      request(app).get(`/api/v1/inventario/demanda-diaria/${periodoActual()}`),
    );

    const hoy = new Date().toISOString().slice(0, 10);
    const dia = r.body.dias.find((d) => d.dia === hoy);
    const fila = dia.insumos.find((i) => i.insumoId === insumo.id);
    expect(fila.entregado).toBe(5);
    expect(fila.demandaReal).toBe(5);
  });
});

// ===========================================================================
describe('trazabilidad', () => {
  it('desde el lote: movimientos y a quién llegó', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { aFarmacia: true, cantidad: 30, dias: 400 });
    const { prescripcion, paciente } = await nuevaPrescripcion(insumo.id, 6);

    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 6,
    });

    const r = await farm(request(app).get(`/api/v1/lotes/${lote.id}/trazabilidad`));

    expect(r.status).toBe(200);
    expect(r.body.cuadra).toBe(true);
    // Ingreso a bodega, sale de bodega, entra a farmacia, entrega al paciente.
    expect(r.body.movimientos.map((m) => [m.tipo, m.ubicacion, m.cantidad])).toEqual([
      ['ingreso', 'bodega', 30],
      ['paso_farmacia', 'bodega', -30],
      ['paso_farmacia', 'farmacia', 30],
      ['entrega', 'farmacia', -6],
    ]);
    expect(r.body.pasosFarmacia).toMatchObject([{ sentido: 'a_farmacia', cantidad: 30 }]);
    expect(r.body.pasosFarmacia[0].numero).toMatch(/^TRA-/);
    expect(r.body.pacientes[0].pacienteId).toBe(paciente.id);
    expect(r.body.pacientes[0].cantidad).toBe(6);
    expect(r.body.pacientes[0].entregadoPor).toBeTruthy();
    // Donde esta cada unidad: 6 al paciente, 24 en farmacia, nada en bodega.
    expect(r.body.cuenta).toMatchObject({ recibido: 30, aPacientes: 6, enFarmacia: 24, enBodega: 0, cuadra: true });
  });

  it('desde el paciente: qué recibió y en qué estado está cada lote', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { aFarmacia: true, cantidad: 30, dias: 400 });
    const { prescripcion, paciente } = await nuevaPrescripcion(insumo.id, 4);

    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 4,
    });

    const r = await farm(request(app).get(`/api/v1/pacientes/${paciente.id}/insumos`));

    expect(r.status).toBe(200);
    expect(r.body.entregas).toHaveLength(1);
    expect(r.body.entregas[0].cantidad).toBe(4);
    expect(r.body.entregas[0].lote.estado).toBe('disponible');
    expect(r.body.conRetiroActivo).toBe(0);
  });

  it('la tarjeta de control lleva el saldo corrido y dice que es de apoyo', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 30, dias: 400 });
    await farm(request(app).post('/api/v1/inventario/uso-interno')).send({
      insumoId: insumo.id,
      cantidad: 4,
      motivo: 'Jornada de vacunación',
    });

    const r = await farm(request(app).get(`/api/v1/insumos/${insumo.id}/tarjeta-control`));

    expect(r.status).toBe(200);
    expect(r.body.esDeApoyo).toBe(true);
    expect(r.body.movimientos).toHaveLength(2);
    expect(r.body.movimientos[0].saldoInsumo).toBe(30);
    expect(r.body.movimientos[1].saldoInsumo).toBe(26);
    expect(r.body.saldoFinal).toBe(26);
  });
});

// ===========================================================================
describe('retiro sanitario', () => {
  it('retira los lotes y arma la lista de pacientes a localizar', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { aFarmacia: true, cantidad: 30, dias: 400 });
    const { prescripcion, paciente } = await nuevaPrescripcion(insumo.id, 5);

    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 5,
    });

    const r = await farm(request(app).post('/api/v1/inventario/retiros')).send({
      referencia: `${MARCA}-ALERTA-1`,
      motivo: 'Alerta sanitaria del laboratorio fabricante',
      emitidoEn: new Date().toISOString().slice(0, 10),
      loteIds: [lote.id],
    });

    expect(r.status).toBe(201);
    expect(r.body.retiro.resumen.pacientes).toBe(1);
    expect(r.body.retiro.pacientes[0].paciente.id).toBe(paciente.id);

    // El lote sale de circulación de inmediato.
    const actualizado = await prisma.lote.findUnique({ where: { id: lote.id } });
    expect(actualizado.estado).toBe('retirado');
  });

  it('el retiro se marca en la ficha del paciente', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { aFarmacia: true, cantidad: 30, dias: 400 });
    const { prescripcion, paciente } = await nuevaPrescripcion(insumo.id, 5);

    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 5,
    });
    await farm(request(app).post('/api/v1/inventario/retiros')).send({
      referencia: `${MARCA}-ALERTA-2`,
      motivo: 'Lote con defecto de fabricación',
      emitidoEn: new Date().toISOString().slice(0, 10),
      loteIds: [lote.id],
    });

    const r = await farm(request(app).get(`/api/v1/pacientes/${paciente.id}/insumos`));
    expect(r.body.conRetiroActivo).toBe(1);
    expect(r.body.entregas[0].retiro.referencia).toBe(`${MARCA}-ALERTA-2`);
  });

  it('no se cierra mientras quede alguien sin localizar', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { aFarmacia: true, cantidad: 30, dias: 400 });
    const { prescripcion } = await nuevaPrescripcion(insumo.id, 5);

    await farm(request(app).post('/api/v1/dispensaciones')).send({
      prescripcionId: prescripcion.id,
      cantidad: 5,
    });

    const creado = await farm(request(app).post('/api/v1/inventario/retiros')).send({
      referencia: `${MARCA}-ALERTA-3`,
      motivo: 'Retiro preventivo',
      emitidoEn: new Date().toISOString().slice(0, 10),
      loteIds: [lote.id],
    });

    const sinCerrar = await farm(
      request(app).post(`/api/v1/inventario/retiros/${creado.body.retiro.id}/cerrar`),
    );
    expect(sinCerrar.status).toBe(409);

    // Se localiza a la persona y entonces sí se cierra.
    await farm(
      request(app).patch(
        `/api/v1/inventario/retiros/pacientes/${creado.body.retiro.pacientes[0].id}`,
      ),
    ).send({ localizado: true, notas: 'Se le avisó por teléfono' });

    const cerrado = await farm(
      request(app).post(`/api/v1/inventario/retiros/${creado.body.retiro.id}/cerrar`),
    );
    expect(cerrado.status).toBe(200);
  });
});

// ===========================================================================
describe('oficio de baja', () => {
  it('propone los lotes que ya se pueden dar de baja', async () => {
    const insumo = await nuevoInsumo();
    const lote = await prisma.lote.create({
      data: {
        insumoId: insumo.id,
        numeroLote: `VEN${Date.now()}`,
        fechaVence: new Date(Date.now() - 86400000),
        cantidadInicial: 20,
        cantidadActual: 20,
        estado: 'vencido',
      },
    });

    const r = await farm(request(app).get('/api/v1/inventario/bajas/candidatos'));
    const candidato = r.body.lotes.find((l) => l.loteId === lote.id);

    expect(candidato).toBeTruthy();
    expect(candidato.causaSugerida).toBe('producto_vencido');
  });

  it('la baja no se aplica sin autorización del director', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 20, dias: 400 });

    const oficio = await farm(request(app).post('/api/v1/inventario/bajas')).send({
      loteId: lote.id,
      cantidad: 5,
      causa: 'producto_danado',
      detalle: 'Frascos quebrados en el traslado',
    });

    expect(oficio.status).toBe(201);
    expect(oficio.body.oficio.correlativo).toMatch(/^BAJA-\d{4}-\d{4}$/);
    expect(oficio.body.oficio.estado).toBe('borrador');

    const aplicar = await farm(
      request(app).post(`/api/v1/inventario/bajas/${oficio.body.oficio.id}/aplicar`),
    );
    expect(aplicar.status).toBe(409);
    expect(aplicar.body.error.codigo).toBe('sin_autorizacion');

    // El inventario no se tocó.
    const actualizado = await prisma.lote.findUnique({ where: { id: lote.id } });
    expect(actualizado.cantidadActual).toBe(20);
  });

  it('no deja dos oficios en trámite sobre el mismo lote', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 20, dias: 400 });

    await farm(request(app).post('/api/v1/inventario/bajas')).send({
      loteId: lote.id,
      cantidad: 5,
      causa: 'producto_danado',
      detalle: 'Primera solicitud',
    });

    const segunda = await farm(request(app).post('/api/v1/inventario/bajas')).send({
      loteId: lote.id,
      cantidad: 3,
      causa: 'producto_danado',
      detalle: 'Segunda solicitud',
    });

    expect(segunda.status).toBe(409);
    expect(segunda.body.error.codigo).toBe('oficio_pendiente');
  });

  it('no se puede dar de baja más de lo que hay', async () => {
    const insumo = await nuevoInsumo();
    const { lote } = await recibirLote(insumo.id, { cantidad: 5, dias: 400 });

    const r = await farm(request(app).post('/api/v1/inventario/bajas')).send({
      loteId: lote.id,
      cantidad: 50,
      causa: 'producto_danado',
      detalle: 'Más de lo que existe',
    });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('cantidad_excede_existencia');
  });
});

// ===========================================================================
describe('constancia de entrega y SIGSA-4', () => {
  // PNG de 1x1 válido, como el que manda el lienzo de firma.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const periodo = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 7);

  it('tras entregar, el paciente queda por firmar; con su firma sale del pendiente y la firma va al SIGSA-4', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { aFarmacia: true, cantidad: 50, dias: 400 });
    const { atencion, prescripcion } = await nuevaPrescripcion(insumo.id, 10);
    await farm(request(app).post('/api/v1/dispensaciones')).send({ prescripcionId: prescripcion.id, cantidad: 10 });

    const antes = await farm(request(app).get('/api/v1/dispensaciones/por-firmar'));
    expect(antes.body.porFirmar.some((p) => p.atencionId === atencion.id)).toBe(true);

    const c = await farm(request(app).post('/api/v1/dispensaciones/constancias')).send({
      atencionId: atencion.id, tipo: 'firma', quienRecibe: 'paciente', imagen: PNG,
    });
    expect(c.status).toBe(201);

    const despues = await farm(request(app).get('/api/v1/dispensaciones/por-firmar'));
    expect(despues.body.porFirmar.some((p) => p.atencionId === atencion.id)).toBe(false);

    const img = await farm(request(app).get(`/api/v1/dispensaciones/constancias/${c.body.constancia.id}/imagen`));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');

    const hoja = await farm(request(app).get(`/api/v1/dispensaciones/sigsa4?periodo=${periodo()}`));
    const renglon = hoja.body.renglones.find((r) => r.prescripcionId === prescripcion.id);
    expect(renglon).toMatchObject({ entregado: 10, noEntregado: 0, medicamento: insumo.nombreGenerico });
    expect(renglon.constancia.id).toBe(c.body.constancia.id);
  });

  it('rechaza una firma que no es imagen, y exige el nombre si recibe otra persona', async () => {
    const insumo = await nuevoInsumo();
    await recibirLote(insumo.id, { cantidad: 5, dias: 400 });
    const { atencion } = await nuevaPrescripcion(insumo.id, 1);
    const mala = await farm(request(app).post('/api/v1/dispensaciones/constancias')).send({
      atencionId: atencion.id, tipo: 'firma', quienRecibe: 'paciente', imagen: 'data:image/png;base64,aG9sYQ==',
    });
    expect(mala.status).toBe(400);
    const sinNombre = await farm(request(app).post('/api/v1/dispensaciones/constancias')).send({
      atencionId: atencion.id, tipo: 'papel', quienRecibe: 'responsable',
    });
    expect(sinNombre.status).toBe(400);
    const papel = await farm(request(app).post('/api/v1/dispensaciones/constancias')).send({
      atencionId: atencion.id, tipo: 'papel', quienRecibe: 'responsable', nombreRecibe: 'María López',
    });
    expect(papel.status).toBe(201);
  });

  it('bodega no registra constancias ni ve el SIGSA-4', async () => {
    const r = await request(app).get(`/api/v1/dispensaciones/sigsa4?periodo=${periodo()}`).set('Authorization', `Bearer ${tokenBodega}`);
    expect(r.status).toBe(403);
  });
});

describe('Receta del medico', () => {
  it('lo de laboratorio y material medico quirurgico no se receta ni aparece en la lista', async () => {
    const reactivo = await nuevoInsumo({ categoria: 'laboratorio' });
    const pastilla = await nuevoInsumo();
    expect(reactivo.prescribible).toBe(false);
    expect(pastilla.prescribible).toBe(true);

    const lista = await med(request(app).get('/api/v1/insumos?prescribible=true'));
    const ids = lista.body.insumos.map((i) => i.id);
    expect(ids).toContain(pastilla.id);
    expect(ids).not.toContain(reactivo.id);

    const { atencion } = await nuevaPrescripcion(pastilla.id, 1);
    const r = await med(request(app).post(`/api/v1/atenciones/${atencion.id}/prescripcion`)).send({ insumoId: reactivo.id, cantidad: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('insumo_no_prescribible');
  });

  it('bodega puede marcar que un insumo si se receta', async () => {
    const guantes = await nuevoInsumo({ categoria: 'medico_quirurgico' });
    const r = await farm(request(app).patch(`/api/v1/bodega/insumos/${guantes.id}/prescribible`)).send({ prescribible: true });
    expect(r.status).toBe(200);
    const lista = await med(request(app).get('/api/v1/insumos?prescribible=true'));
    expect(lista.body.insumos.map((i) => i.id)).toContain(guantes.id);
  });

  it('receta para conseguir fuera: queda en la consulta y no pasa por farmacia', async () => {
    const pastilla = await nuevoInsumo();
    const { atencion } = await nuevaPrescripcion(pastilla.id, 1);
    const r = await med(request(app).post(`/api/v1/atenciones/${atencion.id}/receta-externa`)).send({
      medicamento: 'Loratadina 10 mg tableta', cantidad: 10, indicaciones: '1 diaria por 10 días',
    });
    expect(r.status).toBe(201);
    expect(r.body.receta).toMatchObject({ medicamento: 'Loratadina 10 mg tableta', cantidad: 10 });

    const consulta = await med(request(app).get(`/api/v1/atenciones/${atencion.id}`));
    expect(consulta.body.atencion.recetasExternas.map((x) => x.medicamento)).toEqual(['Loratadina 10 mg tableta']);

    // Farmacia no tiene nada que entregar de esto.
    const pendientes = await farm(request(app).get('/api/v1/dispensaciones/pendientes'));
    expect(JSON.stringify(pendientes.body)).not.toContain('Loratadina 10 mg tableta');
  });

  it('la receta de fuera exige el nombre del medicamento', async () => {
    const pastilla = await nuevoInsumo();
    const { atencion } = await nuevaPrescripcion(pastilla.id, 1);
    const r = await med(request(app).post(`/api/v1/atenciones/${atencion.id}/receta-externa`)).send({ medicamento: ' ' });
    expect(r.status).toBe(400);
  });
});

