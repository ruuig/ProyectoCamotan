import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Bodega: traslados a los servicios con su lote, reporte mensual de cada
 * servicio con entradas precargadas, y balance/BRES del municipio con la
 * fórmula del centro (MD/Bodega.md).
 */

const MARCA = `BOD${Date.now()}`;
let token;
let servicio;
let bodega;

const farm = (p) => p.set('Authorization', `Bearer ${token}`);
const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const periodoActual = () => {
  const d = new Date(Date.now() - 6 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function insumoConLotes(lotes, extra = {}) {
  const r = await farm(request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} ${Math.random().toString(36).slice(2, 7)}`,
    categoria: 'medicamentos',
    presentacion: 'tableta',
    unidadMedida: 'unidad',
    ...extra,
  });
  const insumo = r.body.insumo;
  const creados = [];
  for (const [cantidad, dias] of lotes) {
    const l = await farm(request(app).post(`/api/v1/insumos/${insumo.id}/lotes`)).send({
      numeroLote: `L${Math.random().toString(36).slice(2, 8)}`,
      fechaVence: enDias(dias),
      cantidad,
    });
    creados.push(l.body.lote);
  }
  return { insumo, lotes: creados };
}

beforeAll(async () => {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario: 'bodega', password: 'Camotan2026!' });
  token = r.body.token;
  const u = await farm(request(app).get('/api/v1/bodega/ubicaciones'));
  servicio = u.body.ubicaciones.find((x) => x.nombre === 'C/C Anicillo');
  bodega = u.body.ubicaciones.find((x) => x.tipo === 'bodega');
});

describe('ubicaciones', () => {
  it('trae la bodega y los servicios del balance del centro', async () => {
    const r = await farm(request(app).get('/api/v1/bodega/ubicaciones'));
    expect(r.body.ubicaciones.filter((x) => x.reporta).length).toBe(30);
    expect(bodega).toBeTruthy();
    expect(r.body.ubicaciones.some((x) => x.nombre === 'Post-consulta (Centro de Salud)')).toBe(true);
  });
});

describe('traslados', () => {
  it('propone primero el lote que vence primero', async () => {
    const { insumo, lotes } = await insumoConLotes([[50, 700], [20, 400]]);
    const r = await farm(request(app).get(`/api/v1/bodega/traslados/propuesta-lotes?insumoId=${insumo.id}&cantidad=30`));
    expect(r.body.propuesta.map((p) => [p.loteId, p.cantidad])).toEqual([[lotes[1].id, 20], [lotes[0].id, 10]]);
  });

  it('registra el traslado con su lote, número y quién recibe', async () => {
    const { lotes } = await insumoConLotes([[100, 500]]);
    const r = await farm(request(app).post('/api/v1/bodega/traslados')).send({
      ubicacionId: servicio.id,
      recibidoPor: 'Promotora de salud',
      renglones: [{ loteId: lotes[0].id, cantidad: 30 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.traslado.numero).toMatch(/^TRA-\d{4}-\d{4}$/);
    expect(r.body.traslado.renglones[0]).toMatchObject({ loteId: lotes[0].id, cantidad: 30 });
    const lote = await prisma.lote.findUnique({ where: { id: lotes[0].id } });
    expect(lote.cantidadActual).toBe(70);
  });

  it('no traslada a la bodega ni más de lo que hay', async () => {
    const { lotes } = await insumoConLotes([[10, 500]]);
    const aBodega = await farm(request(app).post('/api/v1/bodega/traslados')).send({
      ubicacionId: bodega.id, recibidoPor: 'Nadie', renglones: [{ loteId: lotes[0].id, cantidad: 1 }],
    });
    expect(aBodega.status).toBe(400);
    const demasiado = await farm(request(app).post('/api/v1/bodega/traslados')).send({
      ubicacionId: servicio.id, recibidoPor: 'Promotora', renglones: [{ loteId: lotes[0].id, cantidad: 11 }],
    });
    expect(demasiado.status).toBe(409);
  });

  it('desde el lote se ve a qué servicio fue', async () => {
    const { lotes } = await insumoConLotes([[40, 500]]);
    await farm(request(app).post('/api/v1/bodega/traslados')).send({
      ubicacionId: servicio.id, recibidoPor: 'Promotora', renglones: [{ loteId: lotes[0].id, cantidad: 15 }],
    });
    const r = await farm(request(app).get(`/api/v1/lotes/${lotes[0].id}/trazabilidad`));
    expect(r.body.servicios.some((s) => s.ubicacion === 'C/C Anicillo' && s.cantidad === 15)).toBe(true);
  });
});

describe('reporte mensual del servicio y balance', () => {
  it('las entradas vienen precargadas desde los traslados y el balance cuadra', async () => {
    const { insumo, lotes } = await insumoConLotes([[100, 500]]);
    await farm(request(app).post('/api/v1/bodega/traslados')).send({
      ubicacionId: servicio.id, recibidoPor: 'Promotora', renglones: [{ loteId: lotes[0].id, cantidad: 30 }],
    });

    const periodo = periodoActual();
    const form = await farm(request(app).get(`/api/v1/bodega/reportes/${servicio.id}/${periodo}`));
    const fila = form.body.renglones.find((x) => x.insumoId === insumo.id);
    expect(fila.entradas).toBe(30);
    expect(fila.maneja).toBe(true);

    const guardado = await farm(request(app).put(`/api/v1/bodega/reportes/${servicio.id}/${periodo}`)).send({
      renglones: [{ insumoId: insumo.id, entregado: 20, noEntregado: 5, saldoReportado: 9 }],
    });
    expect(guardado.body.diferencias).toBe(1);

    const estado = await farm(request(app).get(`/api/v1/bodega/reportes?periodo=${periodo}`));
    const anicillo = estado.body.servicios.find((s) => s.ubicacionId === servicio.id);
    expect(anicillo.reportado).toBe(true);
    expect(anicillo.diferencias).toBeGreaterThanOrEqual(1);

    const b = await farm(request(app).get(`/api/v1/bodega/balance?periodo=${periodo}`));
    const renglon = b.body.filas.find((x) => x.insumoId === insumo.id);
    expect(renglon.bodega.saldoSiguiente).toBe(70);
    const col = renglon.servicios.find((s) => s.ubicacionId === servicio.id);
    expect(col.saldoSiguiente).toBe(10);
    // H = B + C − D ± G, y coincide con bodega + servicios.
    expect(renglon.bres).toMatchObject({ C: 100, D: 20, E: 5, F: 25, H: 80, I: 70 });
    // Máximo = promedio × 4; a pedir = máximo − existencia de bodega, como en
    // el balance del centro: negativa si sobra.
    expect(renglon.bres.L).toBe(renglon.bres.J * 4);
    expect(renglon.bres.M).toBe(renglon.bres.L - 70);
  });

  it('el BRES usa las mismas cifras y se exporta a Excel', async () => {
    const periodo = periodoActual();
    const r = await farm(request(app).get(`/api/v1/inventario/bres/${periodo}/vista-previa`));
    expect(r.body.columnas.map((c) => c.letra).filter(Boolean)).toEqual(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
    const x = await farm(request(app).get(`/api/v1/bodega/bres/${periodo}/excel`));
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
  });

  it('se acepta una diferencia solo explicando por qué', async () => {
    const periodo = periodoActual();
    const sinMotivo = await farm(request(app).post(`/api/v1/bodega/reportes/${servicio.id}/${periodo}/revisar`)).send({});
    expect(sinMotivo.status).toBe(400);
    const ok = await farm(request(app).post(`/api/v1/bodega/reportes/${servicio.id}/${periodo}/revisar`)).send({ observacion: 'Se perdió una tableta en el traslado' });
    expect(ok.status).toBe(200);
  });
});

describe('distribución a los servicios', () => {
  it('reparte en partes iguales redondeando a la caja', async () => {
    const { insumo } = await insumoConLotes([[1000, 500]], { unidadesPorEmpaque: 10 });
    const r = await farm(request(app).get(`/api/v1/bodega/distribucion?insumoId=${insumo.id}&modo=iguales`));
    expect(r.body.filas).toHaveLength(30);
    expect(r.body.filas.every((f) => f.cantidad % 10 === 0)).toBe(true);
    expect(r.body.asignado).toBeLessThanOrEqual(1000);
  });
});

describe('semáforo e inventario de cierre', () => {
  it('el semáforo usa los rangos del centro', async () => {
    const { insumo } = await insumoConLotes([[5, 200], [5, 450], [5, 700]]);
    const r = await farm(request(app).get('/api/v1/bodega/semaforo'));
    const fila = r.body.filas.find((x) => x.insumoId === insumo.id);
    expect(fila.lotes.map((l) => l.semaforo)).toEqual(['rojo', 'amarillo', 'verde']);
    expect(r.body.rangos).toEqual({ rojo: 12, amarillo: 18 });
  });

  it('el inventario de cierre cuenta los traslados como salidas', async () => {
    const { insumo, lotes } = await insumoConLotes([[60, 500]]);
    await farm(request(app).post('/api/v1/bodega/traslados')).send({
      ubicacionId: servicio.id, recibidoPor: 'Promotora', renglones: [{ loteId: lotes[0].id, cantidad: 25 }],
    });
    const r = await farm(request(app).get(`/api/v1/bodega/inventario-cierre?periodo=${periodoActual()}`));
    expect(r.body.filas.find((x) => x.insumoId === insumo.id)).toMatchObject({ entradas: 60, entregado: 25, saldoActual: 35 });
  });
});

describe('alias del catálogo', () => {
  it('un mismo nombre viejo no puede ser alias de dos insumos', async () => {
    const a = await insumoConLotes([]);
    const b = await insumoConLotes([]);
    const nombre = `${MARCA} Condón masculino, unidad`;
    expect((await farm(request(app).post(`/api/v1/bodega/insumos/${a.insumo.id}/alias`)).send({ alias: nombre })).status).toBe(201);
    const otro = await farm(request(app).post(`/api/v1/bodega/insumos/${b.insumo.id}/alias`)).send({ alias: nombre.toUpperCase().replace('Ó', 'O') });
    expect(otro.status).toBe(409);
  });
});

describe('roles: bodega maneja el inventario, farmacia dispensa', () => {
  const entrar = async (usuario) => (await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' })).body.token;

  it('farmacia no entra a la bodega ni recibe lotes', async () => {
    const t = await entrar('farmacia');
    expect((await request(app).get('/api/v1/bodega/balance').set('Authorization', `Bearer ${t}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/bodega/traslados').set('Authorization', `Bearer ${t}`)).status).toBe(403);
    expect((await request(app).post('/api/v1/insumos').set('Authorization', `Bearer ${t}`).send({})).status).toBe(403);
  });

  it('farmacia sí consulta existencias para dispensar', async () => {
    const t = await entrar('farmacia');
    expect((await request(app).get('/api/v1/insumos').set('Authorization', `Bearer ${t}`)).status).toBe(200);
  });

  it('bodega busca lotes por número o insumo; farmacia no', async () => {
    const tb = await entrar('bodega');
    const r = await request(app).get('/api/v1/bodega/lotes?buscar=ac').set('Authorization', `Bearer ${tb}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.lotes)).toBe(true);
    const corto = await request(app).get('/api/v1/bodega/lotes?buscar=a').set('Authorization', `Bearer ${tb}`);
    expect(corto.body.lotes).toEqual([]);
    const tf = await entrar('farmacia');
    expect((await request(app).get('/api/v1/bodega/lotes?buscar=ac').set('Authorization', `Bearer ${tf}`)).status).toBe(403);
  });

  it('bodega no dispensa a pacientes', async () => {
    const t = await entrar('bodega');
    expect((await request(app).get('/api/v1/dispensaciones/pendientes').set('Authorization', `Bearer ${t}`)).status).toBe(403);
  });
});
