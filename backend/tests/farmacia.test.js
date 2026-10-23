import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Farmacia con existencia propia: recibe de la bodega con un traslado,
 * entrega a cada paciente desde lo que tiene y cierra el dia contando. Cada
 * unidad queda ligada a su lote en cada paso.
 */

const MARCA = `FAR${Date.now()}`;
let tokens = {};
let establecimientoId;
let farmaciaId;
let servicioId;

const como = (rol) => (p) => p.set('Authorization', `Bearer ${tokens[rol]}`);
const bodega = como('bodega');
const farmacia = como('farmacia');
const medico = como('medico');
const pre = como('preconsulta');
const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function login(usuario) {
  return (await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' })).body.token;
}

async function nuevoInsumo() {
  const r = await bodega(request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} ${Math.random().toString(36).slice(2, 7)}`,
    categoria: 'medicamentos', presentacion: 'tableta', unidadMedida: 'unidad',
  });
  return r.body.insumo;
}

async function recibir(insumoId, cantidad, dias = 400) {
  const r = await bodega(request(app).post(`/api/v1/insumos/${insumoId}/lotes`)).send({
    numeroLote: `L${Math.random().toString(36).slice(2, 8)}`, fechaVence: enDias(dias), cantidad,
  });
  return r.body.lote;
}

async function aFarmacia(loteId, cantidad) {
  return bodega(request(app).post('/api/v1/bodega/traslados')).send({
    ubicacionId: farmaciaId, recibidoPor: 'Farmacia', renglones: [{ loteId, cantidad }],
  });
}

/** Paciente con su consulta en curso y las recetas indicadas. */
async function consultaConRecetas(recetas) {
  const paciente = await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres: 'Farmacia', apellidos: `Prueba ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento: '1990-01-01', sexo: 'F', comunidad: 'Tisipe', confirmarDuplicado: true,
  });
  const atencion = await pre(request(app).post('/api/v1/atenciones')).send({ pacienteId: paciente.body.paciente.id, motivoConsulta: 'Dolor' });
  const atencionId = atencion.body.atencion.id;
  await pre(request(app).patch(`/api/v1/atenciones/${atencionId}/estado`)).send({ estado: 'en_atencion' });
  const prescripciones = [];
  for (const [insumoId, cantidad] of recetas) {
    const r = await medico(request(app).post(`/api/v1/atenciones/${atencionId}/prescripcion`)).send({ insumoId, cantidad, indicaciones: 'cada 8 horas' });
    prescripciones.push(r.body.prescripcion);
  }
  // Se cierra la consulta para liberar la clinica.
  await medico(request(app).patch(`/api/v1/atenciones/${atencionId}/consulta`)).send({ diagnosticoCie: 'R52', diagnosticoTxt: 'Dolor no especificado' });
  return { atencionId, paciente: paciente.body.paciente, prescripciones };
}

async function lote(id) {
  return prisma.lote.findUnique({ where: { id } });
}

async function limpiar() {
  const insumos = (await prisma.insumo.findMany({ where: { nombreGenerico: { startsWith: MARCA } }, select: { id: true } })).map((i) => i.id);
  const lotes = (await prisma.lote.findMany({ where: { insumoId: { in: insumos } }, select: { id: true } })).map((l) => l.id);
  const pacientes = (await prisma.paciente.findMany({ where: { expedientePapel: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id);
  const atenciones = (await prisma.atencion.findMany({ where: { pacienteId: { in: pacientes } }, select: { id: true } })).map((a) => a.id);
  await prisma.conteoFarmacia.deleteMany({ where: { insumoId: { in: insumos } } });
  await prisma.cierreFarmacia.deleteMany({ where: { establecimientoId, conteos: { none: {} } } });
  await prisma.demandaNoAtendida.deleteMany({ where: { insumoId: { in: insumos } } });
  await prisma.movimientoInsumo.deleteMany({ where: { loteId: { in: lotes } } });
  await prisma.traslado.deleteMany({ where: { establecimientoId, movimientos: { none: {} } } });
  await prisma.dispensacion.deleteMany({ where: { prescripcion: { atencionId: { in: atenciones } } } });
  await prisma.prescripcion.deleteMany({ where: { atencionId: { in: atenciones } } });
  await prisma.lote.deleteMany({ where: { id: { in: lotes } } });
  await prisma.insumo.deleteMany({ where: { id: { in: insumos } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: atenciones } } });
  await prisma.diagnosticoAtencion.deleteMany({ where: { atencionId: { in: atenciones } } });
  await prisma.atencion.deleteMany({ where: { id: { in: atenciones } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: pacientes } } });
  await prisma.paciente.deleteMany({ where: { id: { in: pacientes } } });
}

beforeAll(async () => {
  for (const rol of ['bodega', 'farmacia', 'medico', 'preconsulta']) tokens[rol] = await login(rol);
  establecimientoId = (await prisma.usuario.findUnique({ where: { usuario: 'farmacia' } })).establecimientoId;
  farmaciaId = (await prisma.ubicacion.findFirst({ where: { establecimientoId, tipo: 'centro_salud' } })).id;
  servicioId = (await prisma.ubicacion.findFirst({ where: { establecimientoId, tipo: { in: ['puesto_salud', 'centro_comunitario'] }, activo: true } })).id;
  // Un cierre de hoy de otra corrida impediria probar el cierre.
  await prisma.cierreFarmacia.deleteMany({ where: { establecimientoId } });
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

describe('la farmacia entrega solo lo que tiene', () => {
  it('lo que está en bodega no se dispensa: se dice cuánto hay para pedirlo', async () => {
    const insumo = await nuevoInsumo();
    await recibir(insumo.id, 50);
    const { prescripciones } = await consultaConRecetas([[insumo.id, 10]]);
    const r = await farmacia(request(app).post('/api/v1/dispensaciones')).send({ prescripcionId: prescripciones[0].id, cantidad: 10 });
    expect(r.status).toBe(409);
    expect(r.body.error.mensaje).toContain('En bodega hay 50');
    // El faltante en farmacia queda contado como demanda no atendida.
    expect(await prisma.demandaNoAtendida.count({ where: { prescripcionId: prescripciones[0].id } })).toBe(1);
  });

  it('el traslado a farmacia no saca nada del centro: el lote solo cambia de lugar', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 40);
    const t = await aFarmacia(l.id, 25);
    expect(t.status).toBe(201);
    expect(t.body.traslado.renglones).toMatchObject([{ loteId: l.id, cantidad: 25 }]);
    const despues = await lote(l.id);
    expect(despues.cantidadActual).toBe(40);
    expect(despues.cantidadFarmacia).toBe(25);
    // A un servicio solo puede ir lo de bodega.
    const r = await bodega(request(app).post('/api/v1/bodega/traslados')).send({
      ubicacionId: servicioId, recibidoPor: 'Promotora', renglones: [{ loteId: l.id, cantidad: 20 }],
    });
    expect(r.status).toBe(409);
  });

  it('no se pasa a farmacia más de lo que hay en bodega', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 10);
    expect((await aFarmacia(l.id, 11)).status).toBe(409);
  });
});

describe('entrega por paciente', () => {
  it('la hoja trae lo que se copia al formato, con el lote que vence primero', async () => {
    const insumo = await nuevoInsumo();
    const tarde = await recibir(insumo.id, 30, 500);
    const pronto = await recibir(insumo.id, 5, 200);
    await aFarmacia(tarde.id, 30);
    await aFarmacia(pronto.id, 5);
    const { atencionId, paciente } = await consultaConRecetas([[insumo.id, 8]]);

    const hoja = await farmacia(request(app).get(`/api/v1/dispensaciones/atenciones/${atencionId}`));
    expect(hoja.status).toBe(200);
    expect(hoja.body.paciente.expediente).toBe(paciente.expediente);
    expect(hoja.body.diagnosticos[0].cie).toBe('R52');
    const [renglon] = hoja.body.renglones;
    expect(renglon).toMatchObject({ recetado: 8, pendiente: 8, aEntregar: 8, enFarmacia: 35, indicaciones: 'cada 8 horas' });
    // PEPE: primero los 5 del que vence antes, luego 3 del otro.
    expect(renglon.lotes.map((x) => [x.loteId, x.cantidad])).toEqual([[pronto.id, 5], [tarde.id, 3]]);

    const enCola = await farmacia(request(app).get('/api/v1/dispensaciones/por-atender'));
    expect(enCola.body.porAtender.some((a) => a.atencionId === atencionId)).toBe(true);
  });

  it('terminar la dispensación registra todo de una vez y lo que falta queda como demanda', async () => {
    const a = await nuevoInsumo();
    const b = await nuevoInsumo();
    const la = await recibir(a.id, 20);
    const lb = await recibir(b.id, 3);
    await aFarmacia(la.id, 20);
    await aFarmacia(lb.id, 3);
    const { atencionId, prescripciones } = await consultaConRecetas([[a.id, 6], [b.id, 5]]);

    const r = await farmacia(request(app).post(`/api/v1/dispensaciones/atenciones/${atencionId}`)).send({});
    expect(r.status).toBe(201);
    expect(r.body.renglones.map((x) => [x.entregado, x.noEntregado])).toEqual([[6, 0], [3, 2]]);
    expect((await lote(la.id)).cantidadFarmacia).toBe(14);
    expect((await lote(lb.id)).cantidadFarmacia).toBe(0);
    expect(await prisma.demandaNoAtendida.findFirst({ where: { prescripcionId: prescripciones[1].id } })).toMatchObject({ cantidad: 2 });

    // Lo que falto quedo registrado: la receta se cierra y el paciente sale de la cola.
    const cola = await farmacia(request(app).get('/api/v1/dispensaciones/por-atender'));
    expect(cola.body.porAtender.some((x) => x.atencionId === atencionId)).toBe(false);
  });

  it('si no alcanza y no se entrega incompleto, todo lo recetado queda como no entregado', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 6);
    await aFarmacia(l.id, 6);
    const { atencionId, prescripciones } = await consultaConRecetas([[insumo.id, 10]]);

    const r = await farmacia(request(app).post(`/api/v1/dispensaciones/atenciones/${atencionId}`)).send({
      renglones: [{ prescripcionId: prescripciones[0].id, cantidad: 0, noEntregar: true }],
    });
    expect(r.status).toBe(201);
    expect(r.body.renglones.map((x) => [x.entregado, x.noEntregado])).toEqual([[0, 10]]);
    // El estante no se toca y la demanda real cuenta los 10.
    expect((await lote(l.id)).cantidadFarmacia).toBe(6);
    expect(await prisma.demandaNoAtendida.findFirst({ where: { prescripcionId: prescripciones[0].id } })).toMatchObject({ cantidad: 10 });
    const cola = await farmacia(request(app).get('/api/v1/dispensaciones/por-atender'));
    expect(cola.body.porAtender.some((x) => x.atencionId === atencionId)).toBe(false);
  });

  it('anular una entrega la devuelve al mismo lote en farmacia', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 10);
    await aFarmacia(l.id, 10);
    const { prescripciones } = await consultaConRecetas([[insumo.id, 4]]);
    const d = await farmacia(request(app).post('/api/v1/dispensaciones')).send({ prescripcionId: prescripciones[0].id, cantidad: 4 });
    expect(d.status).toBe(201);
    expect((await lote(l.id)).cantidadFarmacia).toBe(6);

    const r = await farmacia(request(app).patch(`/api/v1/dispensaciones/${d.body.dispensacion.id}/anular`));
    expect(r.status).toBe(200);
    const despues = await lote(l.id);
    expect(despues).toMatchObject({ cantidadActual: 10, cantidadFarmacia: 10 });
    const t = await farmacia(request(app).get(`/api/v1/lotes/${l.id}/trazabilidad`));
    expect(t.body.cuadra).toBe(true);
    expect(t.body.pacientes[0].anulada).toBe(true);
  });
});

describe('control diario', () => {
  it('el resumen del día cuadra con los movimientos', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 30);
    await aFarmacia(l.id, 12);
    const { prescripciones } = await consultaConRecetas([[insumo.id, 5]]);
    await farmacia(request(app).post('/api/v1/dispensaciones')).send({ prescripcionId: prescripciones[0].id, cantidad: 5 });

    const r = await farmacia(request(app).get('/api/v1/farmacia/dia'));
    expect(r.status).toBe(200);
    const fila = r.body.filas.find((f) => f.insumoId === insumo.id);
    expect(fila).toMatchObject({ saldoInicial: 0, recibido: 12, entregado: 5, saldoFinal: 7 });
    expect(r.body.entregas.some((e) => e.renglones.some((x) => x.medicamento === insumo.nombreGenerico && x.cantidad === 5))).toBe(true);
    expect(r.body.movimientosBodega.some((m) => m.tipo === 'recibido' && m.numero?.startsWith('TRA-'))).toBe(true);
  });

  it('cerrar el día exige explicar las diferencias, las ajusta y no se cierra dos veces', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 20);
    await aFarmacia(l.id, 20);

    const sinMotivo = await farmacia(request(app).post('/api/v1/farmacia/dia/cierre')).send({ conteos: [{ insumoId: insumo.id, contado: 18 }] });
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.error.codigo).toBe('motivo_requerido');

    const r = await farmacia(request(app).post('/api/v1/farmacia/dia/cierre')).send({
      conteos: [{ insumoId: insumo.id, contado: 18, motivo: 'Dos tabletas dañadas en el estante' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.ajustes).toEqual([expect.objectContaining({ cantidad: -2 })]);
    expect(await lote(l.id)).toMatchObject({ cantidadActual: 18, cantidadFarmacia: 18 });

    const dia = await farmacia(request(app).get('/api/v1/farmacia/dia'));
    expect(dia.body.cierre.conteos.find((c) => c.insumoId === insumo.id)).toMatchObject({ enSistema: 20, contado: 18, diferencia: -2 });

    const otraVez = await farmacia(request(app).post('/api/v1/farmacia/dia/cierre')).send({ conteos: [{ insumoId: insumo.id, contado: 18 }] });
    expect(otraVez.status).toBe(409);
  });

  it('lo que va a vencer se devuelve a bodega, y desde ahí se puede dar de baja', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 15);
    await aFarmacia(l.id, 15);
    const r = await farmacia(request(app).post('/api/v1/farmacia/devoluciones')).send({
      renglones: [{ loteId: l.id, cantidad: 9 }], motivo: 'Vence el próximo mes',
    });
    expect(r.status).toBe(201);
    expect(await lote(l.id)).toMatchObject({ cantidadActual: 15, cantidadFarmacia: 6 });
    expect((await farmacia(request(app).post('/api/v1/farmacia/devoluciones')).send({
      renglones: [{ loteId: l.id, cantidad: 7 }], motivo: 'Más de lo que hay',
    })).status).toBe(409);
  });

  it('la existencia de farmacia sale por lote y todos los saldos cuadran con sus movimientos', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 9);
    await aFarmacia(l.id, 4);
    const e = await farmacia(request(app).get('/api/v1/farmacia/existencias'));
    expect(e.body.insumos.find((x) => x.insumoId === insumo.id)).toMatchObject({ enFarmacia: 4, enBodega: 5, lotes: [{ loteId: l.id, cantidad: 4 }] });

    // Ninguno de los lotes de estas pruebas descuadra: total y farmacia salen de sus movimientos.
    const v = await bodega(request(app).get('/api/v1/inventario/verificar-saldos'));
    expect(v.body.descuadrados.filter((d) => d.insumo.startsWith(MARCA))).toEqual([]);
  });
});

describe('trazabilidad en farmacia', () => {
  it('lo que entró sin lote recibe su lote real, se puede entregar y se rastrea hasta el paciente', async () => {
    const insumo = await nuevoInsumo();
    const l = await recibir(insumo.id, 40);
    await aFarmacia(l.id, 40);
    // Como la existencia importada sin número: en cuarentena, no se entrega.
    await prisma.lote.update({ where: { id: l.id }, data: { numeroLote: 'SIN-LOTE', estado: 'cuarentena', motivoEstado: 'Ingresó sin número de lote', estadoEn: new Date() } });

    const numero = `R${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
    const puesto = await farmacia(request(app).post('/api/v1/farmacia/poner-lote')).send({ loteId: l.id, numeroLote: numero, fechaVence: enDias(300), cantidad: 30 });
    expect(puesto.status).toBe(201);
    const nuevo = await prisma.lote.findFirst({ where: { insumoId: insumo.id, numeroLote: numero } });
    expect(nuevo).toMatchObject({ cantidadActual: 30, cantidadFarmacia: 30, estado: 'disponible' });
    expect(await lote(l.id)).toMatchObject({ cantidadActual: 10, cantidadFarmacia: 10 });
    // A un registro que ya tiene lote no se le cambia.
    expect((await farmacia(request(app).post('/api/v1/farmacia/poner-lote')).send({ loteId: nuevo.id, numeroLote: 'OTRO', fechaVence: enDias(300), cantidad: 1 })).status).toBe(409);

    // Ya se entrega, del lote identificado, y queda a nombre del paciente.
    const { atencionId, paciente } = await consultaConRecetas([[insumo.id, 12]]);
    const r = await farmacia(request(app).post(`/api/v1/dispensaciones/atenciones/${atencionId}`)).send({});
    expect(r.status).toBe(201);
    expect(r.body.renglones[0]).toMatchObject({ entregado: 12, lotes: [{ numeroLote: numero }] });

    const entregas = await farmacia(request(app).get(`/api/v1/dispensaciones/entregas?buscar=${encodeURIComponent(paciente.apellidos)}`));
    expect(entregas.body.entregas.find((e) => e.atencionId === atencionId)).toMatchObject({ estado: 'entregada', renglones: [{ entregado: 12, lotes: [{ numeroLote: numero, cantidad: 12 }] }] });

    const buscados = await bodega(request(app).get(`/api/v1/trazabilidad/pacientes?buscar=${encodeURIComponent(paciente.apellidos)}`));
    expect(buscados.body.pacientes.map((p) => p.id)).toContain(paciente.id);
    const traza = await bodega(request(app).get(`/api/v1/pacientes/${paciente.id}/insumos`));
    expect(traza.body.entregas[0]).toMatchObject({ cantidad: 12, lote: { numeroLote: numero } });

    const v = await bodega(request(app).get('/api/v1/inventario/verificar-saldos'));
    expect(v.body.descuadrados.filter((d) => d.insumo.startsWith(MARCA))).toEqual([]);
  });
});

describe('BRES de farmacia', () => {
  it('los meses anteriores al sistema toman el informe de post-consulta importado del Excel para el promedio', async () => {
    const { bresFarmacia } = await import('../src/services/farmaciaBres.service.js');
    const meses = ['2026-07', '2026-08', '2026-09'];
    const informes = await prisma.informeServicio.findMany({
      where: { periodo: { in: meses }, importado: true, ubicacionId: farmaciaId },
      include: { renglones: true },
    });
    if (informes.length !== meses.length) return; // base sin el historial importado
    const demanda = new Map();
    for (const i of informes) for (const r of i.renglones) demanda.set(r.insumoId, (demanda.get(r.insumoId) ?? 0) + r.entregado + r.noEntregado);
    const [insumoId, total] = [...demanda].find(([, n]) => n >= 30);
    const bres = await bresFarmacia(establecimientoId, '2026-10');
    const fila = bres.renglones.find((r) => r.insumoId === insumoId);
    expect(fila.pmdr).toBeCloseTo(total / 3, 0);
  });
});

describe('BRES de farmacia: meses escritos a mano', () => {
  // Meses sin informe ni movimientos en ninguna base de prueba.
  const MESES = ['2024-01', '2024-02', '2024-03', '2024-04'];
  const borrar = () => prisma.informeServicio.deleteMany({ where: { periodo: { in: MESES }, ubicacionId: farmaciaId } });
  afterAll(borrar);

  it('se escribe solo lo necesario; el saldo pasa al mes siguiente y da el promedio', async () => {
    await borrar();
    const insumo = await nuevoInsumo();
    const enero = await farmacia(request(app).get('/api/v1/farmacia/historial/2024-01'));
    expect(enero.status).toBe(200);
    expect(enero.body.bloqueado).toBeNull();
    expect(enero.body.saldoDelMesAnterior).toBe(false);

    const escribir = (mes, fila) => farmacia(request(app).put(`/api/v1/farmacia/historial/${mes}`)).send({ renglones: [{ insumoId: insumo.id, ...fila }] });
    expect((await escribir('2024-01', { saldoAnterior: 100, entradas: 50, entregado: 60, noEntregado: 10, reajustes: -5 })).status).toBe(200);
    // Febrero ya no pide saldo anterior: sale de enero (100 + 50 - 60 - 5 = 85).
    const febrero = await farmacia(request(app).get('/api/v1/farmacia/historial/2024-02'));
    expect(febrero.body.saldoDelMesAnterior).toBe(true);
    expect(febrero.body.renglones.find((r) => r.insumoId === insumo.id).saldoAnterior).toBe(85);
    expect((await escribir('2024-02', { saldoAnterior: 999, entradas: 0, entregado: 30, noEntregado: 0 })).status).toBe(200);
    expect((await escribir('2024-03', { entradas: 20, entregado: 30, noEntregado: 0 })).status).toBe(200);

    const bresFeb = (await farmacia(request(app).get('/api/v1/farmacia/bres/2024-02'))).body;
    expect(bresFeb.fuente).toBe('farmacia');
    const f = bresFeb.renglones.find((r) => r.insumoId === insumo.id);
    expect([f.saldoInicial, f.entregado, f.saldoFinal]).toEqual([85, 30, 55]);

    // Abril sin datos: su promedio es la demanda de enero a marzo, (70 + 30 + 30) / 3.
    const bresAbr = (await farmacia(request(app).get('/api/v1/farmacia/bres/2024-04'))).body;
    expect(bresAbr.fuente).toBe('vacio');
    expect(bresAbr.renglones.find((r) => r.insumoId === insumo.id).pmdr).toBeCloseTo(130 / 3, 5);

    // Corregir enero reencadena febrero y marzo.
    await escribir('2024-01', { saldoAnterior: 200, entradas: 50, entregado: 60, noEntregado: 10, reajustes: -5 });
    const marzo = (await farmacia(request(app).get('/api/v1/farmacia/bres/2024-03'))).body.renglones.find((r) => r.insumoId === insumo.id);
    expect(marzo.saldoInicial).toBe(155);
    await borrar();
  });

  it('un mes que ya lleva el sistema no se escribe a mano', async () => {
    const actual = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 7);
    const r = await farmacia(request(app).put(`/api/v1/farmacia/historial/${actual}`)).send({ renglones: [] });
    expect(r.status).toBe(409);
  });
});
