import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { vencimiento } from '../src/controllers/recepciones.controller.js';

/**
 * Recepción con documento (la entrada es lo que dice el documento y lo que no
 * llegó queda por reclamar) y entrega en un paso que genera la requisición.
 */

const MARCA = `RCP${Date.now()}`;
const sufijo = String(Date.now()).slice(-6);
let token;
let servicio;
let emergencia;

const bod = (p) => p.set('Authorization', `Bearer ${token}`);
const hoy = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const enMeses = (n) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

async function nuevoInsumo() {
  return (await bod(request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} ${Math.random().toString(36).slice(2, 7)}`,
    categoria: 'medicamentos', presentacion: 'tableta', unidadMedida: 'unidad',
  })).body.insumo;
}

beforeAll(async () => {
  token = (await request(app).post('/api/v1/auth/login').send({ usuario: 'bodega', password: 'Camotan2026!' })).body.token;
  const u = (await bod(request(app).get('/api/v1/bodega/ubicaciones'))).body.ubicaciones;
  servicio = u.find((x) => x.nombre === 'C/C Anicillo');
  emergencia = u.find((x) => x.tipo === 'unidad_interna' && /Emergencia/.test(x.nombre));
});

describe('vencimiento de mes y año', () => {
  it('10/2026 sirve hasta el 31 de octubre', () => {
    expect(vencimiento('2026-10').toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(vencimiento('2027-02').toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(vencimiento('2026-10-15').toISOString().slice(0, 10)).toBe('2026-10-15');
  });
});

describe('recepción con documento', () => {
  it('entra lo del documento, lo que no llegó queda por reclamar y no se entrega', async () => {
    const [a, b] = [await nuevoInsumo(), await nuevoInsumo()];
    const r = await bod(request(app).post('/api/v1/bodega/recepciones')).send({
      numeroDocumento: `D${sufijo}`, procedencia: 'despacho', remitente: 'Almacén DDRISS Chiquimula', fecha: hoy(),
      renglones: [
        { insumoId: a.id, numeroLote: `A${sufijo}`, vence: enMeses(14), cantidadDocumento: 50, cantidadRecibida: 45, costoUnitario: 2 },
        { insumoId: b.id, numeroLote: `B${sufijo}`, vence: enMeses(20), cantidadDocumento: 30, cantidadRecibida: 30 },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.faltantes).toBe(1);
    const loteA = await prisma.lote.findFirst({ where: { insumoId: a.id } });
    expect(loteA).toMatchObject({ cantidadActual: 50, cantidadPorReponer: 5 });

    const f = (await bod(request(app).get('/api/v1/bodega/recepciones/faltantes'))).body.faltantes;
    expect(f.find((x) => x.loteId === loteA.id)).toMatchObject({ porReponer: 5, documento: `D${sufijo}` });

    // Solo hay 45 para entregar.
    const demas = await bod(request(app).post('/api/v1/bodega/requisiciones/entregar')).send({
      ubicacionId: servicio.id, solicitante: 'Promotora de salud', renglones: [{ insumoId: a.id, cantidad: 46 }],
    });
    expect(demas.status).toBe(409);

    const k = (await bod(request(app).get(`/api/v1/bodega/kardex?insumoId=${a.id}`))).body.tarjetas[0];
    expect(k.filas[0]).toMatchObject({ referencia: `D${sufijo}`, remitenteDestinatario: 'Almacén DDRISS Chiquimula', entrada: 50, valorEntrada: 100 });
    // El faltante viaja aparte: la pantalla y la tarjeta deciden si lo anotan.
    expect(k.filas[0].porReclamar).toBe(5);

    const rep = await bod(request(app).post(`/api/v1/bodega/lotes/${loteA.id}/reponer`)).send({ cantidad: 5 });
    expect(rep.body.lote.porReponer).toBe(0);
    const ahora = await bod(request(app).post('/api/v1/bodega/requisiciones/entregar')).send({
      ubicacionId: servicio.id, solicitante: 'Promotora de salud', renglones: [{ insumoId: a.id, cantidad: 50 }],
    });
    expect(ahora.status).toBe(201);
  });

  it('no recibe más de lo que dice el documento ni un lote vencido', async () => {
    const a = await nuevoInsumo();
    const mas = await bod(request(app).post('/api/v1/bodega/recepciones')).send({
      remitente: 'Almacén DDRISS Chiquimula', fecha: hoy(),
      renglones: [{ insumoId: a.id, numeroLote: `M${sufijo}`, vence: enMeses(10), cantidadDocumento: 10, cantidadRecibida: 12 }],
    });
    expect(mas.body.error.codigo).toBe('mas_que_el_documento');
    const vencido = await bod(request(app).post('/api/v1/bodega/recepciones')).send({
      remitente: 'Almacén DDRISS Chiquimula', fecha: hoy(),
      renglones: [{ insumoId: a.id, numeroLote: `V${sufijo}`, vence: enMeses(-2), cantidadDocumento: 10, cantidadRecibida: 10 }],
    });
    expect(vencido.body.error.codigo).toBe('fechas_invalidas');
  });
});

describe('entregar en un paso', () => {
  it('genera la requisición despachada, sin número, y recuerda al solicitante', async () => {
    const a = await nuevoInsumo();
    await bod(request(app).post('/api/v1/bodega/recepciones')).send({
      remitente: 'Almacén DDRISS Chiquimula', fecha: hoy(),
      renglones: [{ insumoId: a.id, numeroLote: `E${sufijo}`, vence: enMeses(12), cantidadDocumento: 100, cantidadRecibida: 100 }],
    });
    const r = await bod(request(app).post('/api/v1/bodega/requisiciones/entregar')).send({
      ubicacionId: emergencia.id, solicitante: 'A.E. Yohana Patricia Figueroa', renglones: [{ insumoId: a.id, cantidad: 30 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.requisicion).toMatchObject({ estado: 'despachada', numero: null });
    expect(r.body.requisicion.renglones[0]).toMatchObject({ cantidadSolicitada: 30, cantidadAutorizada: 30, cantidadDespachada: 30 });

    // A una unidad del centro es consumo interno: no queda como traslado a un servicio que informa.
    const mov = await prisma.movimientoInsumo.findFirst({ where: { lote: { insumoId: a.id }, cantidad: -30 } });
    expect(mov.tipo).toBe('consumo_interno');

    const h = (await bod(request(app).get('/api/v1/bodega/hoy'))).body.pendientes;
    expect(h.find((p) => p.clave === 'sin_numero').cantidad).toBeGreaterThan(0);

    const n = await bod(request(app).patch(`/api/v1/bodega/requisiciones/${r.body.requisicion.id}/numero`)).send({ numero: `${sufijo}9` });
    expect(n.body.requisicion.numero).toBe(`${sufijo}9`);

    const s = (await bod(request(app).get('/api/v1/bodega/requisiciones/solicitantes'))).body.solicitantes;
    expect(s[emergencia.id].solicitante).toBe('A.E. Yohana Patricia Figueroa');
  });
});
