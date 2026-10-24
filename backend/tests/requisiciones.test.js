import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { filasKardex } from '../src/services/kardex.service.js';
import { cantidadADespachar, tiposSugeridos } from '../src/services/requisiciones.service.js';

/**
 * Requisición Despacho de Almacén (FOR-ASB-01): el servicio pide, la bodega
 * autoriza y despacha por PEPE; el despacho queda en el kardex del producto
 * con el número de la requisición.
 */

const MARCA = `REQ${Date.now()}`;
const sufijo = String(Date.now()).slice(-6);
let token;
let tokenFarmacia;
let servicio;
let farmacia;
let n = 0;
const numero = () => `${sufijo}${String((n += 1)).padStart(2, '0')}`;

const bod = (p) => p.set('Authorization', `Bearer ${token}`);
const far = (p) => p.set('Authorization', `Bearer ${tokenFarmacia}`);
const enDias = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const hoy = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);

async function insumoConLotes(lotes) {
  const insumo = (await bod(request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} ${Math.random().toString(36).slice(2, 7)}`,
    categoria: 'medicamentos', presentacion: 'tableta', unidadMedida: 'unidad',
  })).body.insumo;
  const creados = [];
  for (const [cantidad, dias] of lotes) {
    creados.push((await bod(request(app).post(`/api/v1/insumos/${insumo.id}/lotes`)).send({
      numeroLote: `L${Math.random().toString(36).slice(2, 8)}`, fechaVence: enDias(dias), cantidad,
    })).body.lote);
  }
  return { insumo, lotes: creados };
}

const nueva = (ubicacionId, renglones, extra = {}) => ({
  numero: numero(), ubicacionId, fechaSolicitud: hoy(), solicitante: 'Enfermera del servicio', renglones, ...extra,
});

beforeAll(async () => {
  const login = async (usuario) => (await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' })).body.token;
  [token, tokenFarmacia] = await Promise.all([login('bodega'), login('farmacia')]);
  const u = (await bod(request(app).get('/api/v1/bodega/ubicaciones'))).body.ubicaciones;
  servicio = u.find((x) => x.nombre === 'C/C Anicillo');
  farmacia = u.find((x) => x.tipo === 'centro_salud');
});

describe('reglas', () => {
  it('no se despacha más de lo autorizado', () => {
    expect(cantidadADespachar({ cantidadSolicitada: 10, cantidadAutorizada: 6, descripcion: 'X' }, 8).error).toMatch(/autorizaron 6/);
    expect(cantidadADespachar({ cantidadSolicitada: 10, cantidadAutorizada: null }, undefined).cantidad).toBe(10);
  });

  it('marca el tipo del formulario según lo que se pide', () => {
    expect(tiposSugeridos([{ categoria: 'medicamentos' }, { categoria: 'laboratorio' }])).toEqual(['reactivos', 'medicamentos']);
  });

  it('la tarjeta pone cada movimiento en su columna, desde el saldo anterior', () => {
    const lote = { numeroLote: 'A', fechaVence: null, costoUnitario: 2 };
    const r = filasKardex([
      { id: 1, cantidad: 100, tipo: 'ingreso', lote: { ...lote, origen: 'despacho', requisicion: { numero: '16601', almacen: 'Almacén DDRISS Chiquimula' } } },
      { id: 2, cantidad: -30, tipo: 'traslado', lote, traslado: { numero: 'TRA-1', ubicacion: { nombre: 'C/C X' }, requisicion: { numero: '016618' } } },
      { id: 3, cantidad: -5, tipo: 'reajuste', causa: 'faltante_inventario_fisico', lote },
    ], 20, 40);
    expect(r.filas.map((f) => [f.referencia, f.remitenteDestinatario, f.entrada, f.valorEntrada, f.salida, f.reajuste, f.saldo])).toEqual([
      ['Req. 16601', 'Almacén DDRISS Chiquimula', 100, 200, null, null, 120],
      ['Req. 016618', 'C/C X', null, null, 30, null, 90],
      ['', '', null, null, null, -5, 85],
    ]);
    expect(r.filas[2].observaciones).toMatch(/Faltante/);
    expect(r.valorFinal).toBe(170);
  });

  it('lo que falta por reclamar viaja aparte, para anotarlo solo si se quiere', () => {
    const lote = { numeroLote: 'B', fechaVence: null, costoUnitario: null, origen: 'donacion', actaDonacion: '09-2023', cantidadPorReponer: 1 };
    const [conFaltante, sinFaltante] = filasKardex([
      { id: 1, cantidad: 70, tipo: 'ingreso', lote },
      { id: 2, cantidad: 10, tipo: 'ingreso', lote: { ...lote, cantidadPorReponer: 0 } },
    ]).filas;
    expect(conFaltante).toMatchObject({ observaciones: 'Donación', porReclamar: 1 });
    expect(sinFaltante).toMatchObject({ observaciones: 'Donación', porReclamar: null });
  });
});

describe('requisición', () => {
  it('se registra con el número del formulario y el nombre del catálogo', async () => {
    const { insumo } = await insumoConLotes([[50, 600]]);
    const r = await bod(request(app).post('/api/v1/bodega/requisiciones')).send(nueva(servicio.id, [{ insumoId: insumo.id, cantidadSolicitada: 20 }]));
    expect(r.status).toBe(201);
    expect(r.body.requisicion).toMatchObject({ estado: 'solicitada', unidadSeccion: 'C/C Anicillo', tipos: ['medicamentos'] });
    expect(r.body.requisicion.renglones[0]).toMatchObject({ descripcion: insumo.nombreGenerico, cantidadSolicitada: 20 });

    const otra = await bod(request(app).post('/api/v1/bodega/requisiciones')).send({
      ...nueva(servicio.id, [{ insumoId: insumo.id, cantidadSolicitada: 1 }]), numero: r.body.requisicion.numero,
    });
    expect(otra.status).toBe(409);
    expect(otra.body.error.codigo).toBe('numero_repetido');
  });

  it('autoriza menos, despacha por PEPE y deja el kardex con el número', async () => {
    const { insumo, lotes } = await insumoConLotes([[50, 700], [20, 400]]);
    const creada = (await bod(request(app).post('/api/v1/bodega/requisiciones')).send(
      nueva(servicio.id, [{ insumoId: insumo.id, cantidadSolicitada: 40 }, { descripcion: 'Nebulizador portátil', unidadMedida: 'Unidad', cantidadSolicitada: 1 }]),
    )).body.requisicion;
    const [med, equipo] = creada.renglones;

    const aut = await bod(request(app).post(`/api/v1/bodega/requisiciones/${creada.id}/autorizar`)).send({ renglones: [{ id: med.id, cantidadAutorizada: 30, motivo: 'Se reparte entre los servicios' }, { id: equipo.id, cantidadAutorizada: 0, motivo: 'No hay existencia' }] });
    expect(aut.body.requisicion.estado).toBe('autorizada');

    const demas = await bod(request(app).post(`/api/v1/bodega/requisiciones/${creada.id}/despachar`)).send({ recibidoPor: 'Promotora', renglones: [{ id: med.id, cantidadDespachada: 35 }] });
    expect(demas.status).toBe(400);

    const d = await bod(request(app).post(`/api/v1/bodega/requisiciones/${creada.id}/despachar`)).send({ recibidoPor: 'Promotora' });
    expect(d.status).toBe(200);
    expect(d.body.requisicion.estado).toBe('despachada');
    expect(d.body.requisicion.traslado.numero).toMatch(/^TRA-/);
    const r0 = d.body.requisicion.renglones[0];
    expect(r0.cantidadDespachada).toBe(30);
    expect(r0.lotes.map((l) => [l.loteId, l.cantidad])).toEqual([[lotes[1].id, 20], [lotes[0].id, 10]]);
    expect(d.body.requisicion.renglones[1].cantidadDespachada).toBe(0);

    const k = await bod(request(app).get(`/api/v1/bodega/kardex?insumoId=${insumo.id}`));
    const [tarjeta] = k.body.tarjetas;
    expect(tarjeta.saldoFinal).toBe(40);
    const salidas = tarjeta.filas.filter((f) => f.salida);
    expect(salidas.every((f) => f.referencia === `Req. ${creada.numero}` && f.remitenteDestinatario === 'C/C Anicillo')).toBe(true);
    expect(salidas.reduce((s, f) => s + f.salida, 0)).toBe(30);

    const otraVez = await bod(request(app).post(`/api/v1/bodega/requisiciones/${creada.id}/despachar`)).send({ recibidoPor: 'Promotora' });
    expect(otraVez.status).toBe(409);
  });

  it('si no alcanza, no despacha nada', async () => {
    const { insumo, lotes } = await insumoConLotes([[5, 500]]);
    const creada = (await bod(request(app).post('/api/v1/bodega/requisiciones')).send(nueva(servicio.id, [{ insumoId: insumo.id, cantidadSolicitada: 8 }]))).body.requisicion;
    const d = await bod(request(app).post(`/api/v1/bodega/requisiciones/${creada.id}/despachar`)).send({ recibidoPor: 'Promotora' });
    expect(d.status).toBe(409);
    expect(d.body.error.codigo).toBe('sin_existencia');
    expect((await prisma.lote.findUnique({ where: { id: lotes[0].id } })).cantidadActual).toBe(5);
  });

  it('la de farmacia la registra farmacia y el despacho pasa el lote a farmacia', async () => {
    const { insumo, lotes } = await insumoConLotes([[60, 500]]);
    const r = await far(request(app).post('/api/v1/bodega/requisiciones')).send(nueva(farmacia.id, [{ insumoId: insumo.id, cantidadSolicitada: 25 }]));
    expect(r.status).toBe(201);
    const aServicio = await far(request(app).post('/api/v1/bodega/requisiciones')).send(nueva(servicio.id, [{ insumoId: insumo.id, cantidadSolicitada: 1 }]));
    expect(aServicio.status).toBe(403);
    expect((await far(request(app).post(`/api/v1/bodega/requisiciones/${r.body.requisicion.id}/despachar`)).send({ recibidoPor: 'Farmacia' })).status).toBe(403);

    await bod(request(app).post(`/api/v1/bodega/requisiciones/${r.body.requisicion.id}/despachar`)).send({ recibidoPor: 'Auxiliar de farmacia' });
    const lote = await prisma.lote.findUnique({ where: { id: lotes[0].id } });
    expect(lote).toMatchObject({ cantidadActual: 60, cantidadFarmacia: 25 });
  });

  it('hacia arriba: se pide a la DDRISS y lo que llega entra con sus lotes', async () => {
    const { insumo } = await insumoConLotes([]);
    const r = await bod(request(app).post('/api/v1/bodega/requisiciones')).send({
      direccion: 'superior', numero: numero(), fechaSolicitud: hoy(), solicitante: 'Encargado de bodega',
      renglones: [{ insumoId: insumo.id, cantidadSolicitada: 100 }, { descripcion: 'Archivo de metal', unidadMedida: 'Unidad', cantidadSolicitada: 1 }],
    });
    expect(r.status).toBe(201);
    const q = r.body.requisicion;
    expect(q).toMatchObject({ direccion: 'superior', almacen: 'Almacén DDRISS Chiquimula', unidadSeccion: 'Bodega' });

    expect((await bod(request(app).post(`/api/v1/bodega/requisiciones/${q.id}/despachar`)).send({ recibidoPor: 'Nadie' })).body.error.codigo).toBe('es_hacia_arriba');

    const [med, equipo] = q.renglones;
    const parte = await bod(request(app).post(`/api/v1/bodega/requisiciones/${q.id}/recibir`)).send({
      renglones: [{ id: med.id, lotes: [{ numeroLote: `R${sufijo}A`, fechaVence: enDias(500), cantidad: 60, costoUnitario: 1.5 }] }],
    });
    expect(parte.status).toBe(200);
    expect(parte.body.requisicion.estado).toBe('parcial');

    const resto = await bod(request(app).post(`/api/v1/bodega/requisiciones/${q.id}/recibir`)).send({
      completa: true,
      renglones: [
        { id: med.id, lotes: [{ numeroLote: `R${sufijo}B`, fechaVence: enDias(700), cantidad: 40 }] },
        { id: equipo.id, cantidad: 1 },
      ],
    });
    expect(resto.body.requisicion.estado).toBe('recibida');
    expect(resto.body.requisicion.renglones.map((g) => g.cantidadDespachada)).toEqual([100, 1]);
    expect(resto.body.requisicion.renglones[0].lotes).toHaveLength(2);

    const k = (await bod(request(app).get(`/api/v1/bodega/kardex?insumoId=${insumo.id}`))).body;
    expect(k.encabezado).toHaveProperty('nivelMinimo');
    const [tarjeta] = k.tarjetas;
    expect(tarjeta.saldoFinal).toBe(100);
    expect(tarjeta.filas.map((f) => [f.referencia, f.remitenteDestinatario, f.entrada])).toEqual([
      [`Req. ${q.numero}`, 'Almacén DDRISS Chiquimula', 60],
      [`Req. ${q.numero}`, 'Almacén DDRISS Chiquimula', 40],
    ]);
    expect(tarjeta.filas[0].valorEntrada).toBe(90);

    const dup = await bod(request(app).post(`/api/v1/bodega/requisiciones/${q.id}/recibir`)).send({ renglones: [{ id: med.id, cantidad: 1 }] });
    expect(dup.body.error.codigo).toBe('no_recibible');
  });

  it('farmacia no pide a la DDRISS', async () => {
    const r = await far(request(app).post('/api/v1/bodega/requisiciones')).send({
      direccion: 'superior', fechaSolicitud: hoy(), solicitante: 'Farmacia', renglones: [{ descripcion: 'X', cantidadSolicitada: 1 }],
    });
    expect(r.status).toBe(403);
  });

  it('sin número del formulario no se despacha; anulada sale del flujo', async () => {
    const { insumo } = await insumoConLotes([[10, 500]]);
    const sin = (await bod(request(app).post('/api/v1/bodega/requisiciones')).send({ ...nueva(servicio.id, [{ insumoId: insumo.id, cantidadSolicitada: 2 }]), numero: null })).body.requisicion;
    const d = await bod(request(app).post(`/api/v1/bodega/requisiciones/${sin.id}/despachar`)).send({ recibidoPor: 'Promotora' });
    expect(d.body.error.codigo).toBe('sin_numero');
    const an = await bod(request(app).post(`/api/v1/bodega/requisiciones/${sin.id}/anular`)).send({ motivo: 'Se llenó dos veces' });
    expect(an.body.requisicion.estado).toBe('anulada');
    expect((await bod(request(app).post(`/api/v1/bodega/requisiciones/${sin.id}/despachar`)).send({ recibidoPor: 'Promotora', numero: numero() })).status).toBe(409);
  });
});

describe('Pedido de farmacia: pedir, autorizar, despachar o rechazar', () => {
  it('bodega puede dar menos de lo pedido sin decir por qué, y si lo dice queda anotado', async () => {
    const { insumo } = await insumoConLotes([[30, 400]]);
    const r = await far(request(app).post('/api/v1/bodega/requisiciones')).send({ ubicacionId: farmacia.id, fechaSolicitud: hoy(), solicitante: 'Personal de Farmacia', renglones: [{ insumoId: insumo.id, cantidadSolicitada: 50 }] });
    expect(r.status).toBe(201);
    const id = r.body.requisicion.id;
    const renglon = r.body.requisicion.renglones[0].id;

    const sinMotivo = await bod(request(app).post(`/api/v1/bodega/requisiciones/${id}/autorizar`)).send({ renglones: [{ id: renglon, cantidadAutorizada: 30 }] });
    expect(sinMotivo.status).toBe(200);
    expect(sinMotivo.body.requisicion.renglones[0].motivo).toBeNull();

    const ok = await bod(request(app).post(`/api/v1/bodega/requisiciones/${id}/autorizar`)).send({ renglones: [{ id: renglon, cantidadAutorizada: 30, motivo: 'No hay existencia' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.requisicion.renglones[0].motivo).toBe('No hay existencia');

    // Farmacia ve en su lista que se autorizó menos.
    const lista = await far(request(app).get('/api/v1/bodega/requisiciones'));
    const suya = lista.body.requisiciones.find((x) => x.id === id);
    expect(suya.estado).toBe('autorizada');
    expect(suya.autorizado).toBe(30);

    // Al despachar, entra al estante de farmacia.
    const d = await bod(request(app).post(`/api/v1/bodega/requisiciones/${id}/despachar`)).send({ numero: numero(), recibidoPor: 'Personal de Farmacia' });
    expect(d.status).toBe(200);
    expect(d.body.requisicion.estado).toBe('despachada');
    const lotes = await prisma.lote.findMany({ where: { insumoId: insumo.id } });
    expect(lotes.reduce((t, l) => t + l.cantidadFarmacia, 0)).toBe(30);
  });

  it('un pedido rechazado lleva su motivo, y farmacia puede cancelar el suyo antes de que lo atiendan', async () => {
    const { insumo } = await insumoConLotes([[10, 400]]);
    const pedir = () => far(request(app).post('/api/v1/bodega/requisiciones')).send({ ubicacionId: farmacia.id, fechaSolicitud: hoy(), solicitante: 'Personal de Farmacia', renglones: [{ insumoId: insumo.id, cantidadSolicitada: 5 }] });
    const a = (await pedir()).body.requisicion.id;
    await bod(request(app).post(`/api/v1/bodega/requisiciones/${a}/anular`)).send({ motivo: 'Pedido repetido, ya se despachó ayer' });
    const b = (await pedir()).body.requisicion.id;
    expect((await far(request(app).post(`/api/v1/bodega/requisiciones/${b}/anular`)).send({ motivo: 'Farmacia canceló el pedido' })).status).toBe(200);

    const lista = (await far(request(app).get('/api/v1/bodega/requisiciones'))).body.requisiciones;
    expect(lista.find((x) => x.id === a)).toMatchObject({ estado: 'anulada', motivoAnulacion: 'Pedido repetido, ya se despachó ayer' });
    expect(lista.find((x) => x.id === b).estado).toBe('anulada');
  });
});
