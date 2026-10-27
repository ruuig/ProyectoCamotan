import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Encargado de un centro o puesto de salud: pide a la bodega con la
 * requisición ya llena y sube su informe del mes, solo de su ubicación.
 * Post-consulta: su propio kardex y su BRES.
 */

const MARCA = `ENC${Date.now()}`.toLowerCase();
const CLAVE = 'ContrasenaLarga2026';
let tokenAdmin;
let tokenBodega;
let tokenFarmacia;
let tokenEncargado;
let propio;
let ajeno;
let vecino;
let insumo;

const con = (t) => (p) => p.set('Authorization', `Bearer ${t}`);
const hoy = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const periodo = () => hoy().slice(0, 7);
const login = async (usuario, password = 'Camotan2026!') => (await request(app).post('/api/v1/auth/login').send({ usuario, password })).body;

beforeAll(async () => {
  [tokenAdmin, tokenBodega, tokenFarmacia] = (await Promise.all([login('admin'), login('bodega'), login('farmacia')])).map((r) => r.token);
  const u = (await con(tokenBodega)(request(app).get('/api/v1/bodega/ubicaciones'))).body.ubicaciones;
  const lugares = u.filter((x) => x.tipo === 'puesto_salud' || x.tipo === 'centro_comunitario');
  // propio: el suyo. vecino: otro de su territorio. ajeno: de otro territorio.
  propio = lugares.find((x) => x.territorioId && lugares.some((y) => y.id !== x.id && y.territorioId === x.territorioId)) ?? lugares[0];
  vecino = lugares.find((x) => x.id !== propio.id && x.territorioId === propio.territorioId);
  ajeno = lugares.find((x) => x.territorioId !== propio.territorioId);
  insumo = (await con(tokenBodega)(request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} Paracetamol`, categoria: 'medicamentos', presentacion: 'tableta', unidadMedida: 'unidad',
  })).body.insumo;
});

describe('usuario encargado de servicio', () => {
  it('no se crea sin el centro o puesto que maneja', async () => {
    const r = await con(tokenAdmin)(request(app).post('/api/v1/admin/usuarios')).send({
      usuario: `${MARCA}_sin`, password: CLAVE, nombre: 'Encargado sin lugar', rol: 'servicio',
    });
    expect(r.status).toBe(400);
  });

  it('se crea ligado a su ubicación y entra con su rol', async () => {
    const r = await con(tokenAdmin)(request(app).post('/api/v1/admin/usuarios')).send({
      usuario: `${MARCA}_enc`, password: CLAVE, nombre: 'Encargada de Prueba', rol: 'servicio', ubicacionId: propio.id,
    });
    expect(r.status).toBe(201);
    const sesion = await login(`${MARCA}_enc`, CLAVE);
    expect(sesion.usuario.rol).toBe('servicio');
    expect(sesion.usuario.ubicacionId).toBe(propio.id);
    tokenEncargado = sesion.token;
  });

  it('un rol que no es de servicio no queda ligado a una ubicación', async () => {
    const r = await con(tokenAdmin)(request(app).post('/api/v1/admin/usuarios')).send({
      usuario: `${MARCA}_far`, password: CLAVE, nombre: 'Farmacia de Prueba', rol: 'farmacia', ubicacionId: propio.id,
    });
    expect(r.status).toBe(201);
    expect(r.body.usuario.ubicacionId).toBeNull();
  });
});

describe('requisiciones del encargado', () => {
  let creada;

  it('trae la requisición sugerida de su ubicación, con el catálogo para agregar', async () => {
    const r = await con(tokenEncargado)(request(app).get('/api/v1/bodega/requisiciones/sugerida'));
    expect(r.status).toBe(200);
    expect(r.body.ubicacion.id).toBe(propio.id);
    expect(r.body.catalogo.some((c) => c.insumoId === insumo.id)).toBe(true);
    // La de otro lugar de su territorio, sí; la de otro territorio, no.
    if (vecino) {
      const delVecino = await con(tokenEncargado)(request(app).get(`/api/v1/bodega/requisiciones/sugerida?ubicacionId=${vecino.id}`));
      expect(delVecino.body.ubicacion.id).toBe(vecino.id);
    }
    const otra = await con(tokenEncargado)(request(app).get(`/api/v1/bodega/requisiciones/sugerida?ubicacionId=${ajeno.id}`));
    expect(otra.status).toBe(404);
  });

  it('crea la requisición para su lugar, otro de su territorio o el territorio; no para otro territorio', async () => {
    const pedir = (ubicacionId) => con(tokenEncargado)(request(app).post('/api/v1/bodega/requisiciones')).send({
      ubicacionId, fechaSolicitud: hoy(), solicitante: 'Encargada de Prueba',
      renglones: [{ insumoId: insumo.id, cantidadSolicitada: 12 }],
    });
    const r = await pedir(undefined);
    expect(r.status).toBe(201);
    expect(r.body.requisicion.ubicacion.id).toBe(propio.id);
    creada = r.body.requisicion;
    expect((await pedir(ajeno.id)).status).toBe(403);
    if (vecino) expect((await pedir(vecino.id)).body.requisicion.ubicacion.id).toBe(vecino.id);
    const t = (await con(tokenEncargado)(request(app).get('/api/v1/bodega/territorios'))).body.territorios[0];
    if (t?.destinoId) expect((await pedir(t.destinoId)).body.requisicion.ubicacion.tipo).toBe('territorio');
  });

  it('solo ve las de su territorio', async () => {
    const r = await con(tokenEncargado)(request(app).get('/api/v1/bodega/requisiciones'));
    expect(r.status).toBe(200);
    expect(r.body.requisiciones.some((x) => x.ubicacion === ajeno.nombre)).toBe(false);
    expect(r.body.requisiciones.some((x) => x.id === creada.id)).toBe(true);
  });

  it('no pide a la DDRISS, no autoriza ni despacha', async () => {
    const arriba = await con(tokenEncargado)(request(app).post('/api/v1/bodega/requisiciones')).send({
      direccion: 'superior', fechaSolicitud: hoy(), solicitante: 'Encargada de Prueba',
      renglones: [{ insumoId: insumo.id, cantidadSolicitada: 1 }],
    });
    expect(arriba.status).toBe(403);
    const autorizar = await con(tokenEncargado)(request(app).post(`/api/v1/bodega/requisiciones/${creada.id}/autorizar`)).send({});
    expect(autorizar.status).toBe(403);
  });

  it('la anula mientras bodega no la atiende; después ya no', async () => {
    const otra = (await con(tokenEncargado)(request(app).post('/api/v1/bodega/requisiciones')).send({
      fechaSolicitud: hoy(), solicitante: 'Encargada de Prueba', renglones: [{ insumoId: insumo.id, cantidadSolicitada: 3 }],
    })).body.requisicion;
    await con(tokenBodega)(request(app).post(`/api/v1/bodega/requisiciones/${otra.id}/autorizar`)).send({});
    const tarde = await con(tokenEncargado)(request(app).post(`/api/v1/bodega/requisiciones/${otra.id}/anular`)).send({ motivo: 'Ya no se necesita' });
    expect(tarde.status).toBe(409);
    const aTiempo = await con(tokenEncargado)(request(app).post(`/api/v1/bodega/requisiciones/${creada.id}/anular`)).send({ motivo: 'Ya no se necesita' });
    expect(aTiempo.status).toBe(200);
  });
});

describe('informe del mes del encargado', () => {
  it('envía el informe una sola vez; corregirlo le toca a bodega', async () => {
    await prisma.informeServicio.deleteMany({ where: { ubicacionId: propio.id, periodo: periodo() } });
    const f = await con(tokenEncargado)(request(app).get(`/api/v1/bodega/informes/${propio.id}/${periodo()}`));
    expect(f.status).toBe(200);
    const enviar = (t) => con(t)(request(app).put(`/api/v1/bodega/informes/${propio.id}/${periodo()}`)).send({
      renglones: [{ insumoId: insumo.id, entregado: 0, noEntregado: 2 }],
    });
    expect((await enviar(tokenEncargado)).status).toBe(200);
    const otraVez = await enviar(tokenEncargado);
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.error.codigo).toBe('informe_enviado');
    expect((await enviar(tokenBodega)).status).toBe(200);
  });

  it('ve el informe de otro lugar de su territorio', async () => {
    if (!vecino) return;
    const r = await con(tokenEncargado)(request(app).get(`/api/v1/bodega/informes/${vecino.id}/${periodo()}`));
    expect(r.status).toBe(200);
  });

  it('no ve el informe de un lugar de otro territorio', async () => {
    const r = await con(tokenEncargado)(request(app).get(`/api/v1/bodega/informes/${ajeno.id}/${periodo()}`));
    expect(r.status).toBe(403);
  });
});

describe('post-consulta: su kardex y su BRES', () => {
  it('farmacia obtiene la tarjeta de la farmacia, aunque pida la de bodega', async () => {
    const r = await con(tokenFarmacia)(request(app).get('/api/v1/bodega/kardex?ubicacion=bodega'));
    expect(r.status).toBe(200);
    expect(r.body.ubicacion).toBe('farmacia');
    expect(r.body.encabezado.servicio).toMatch(/Farmacia/);
  });

  it('el BRES de la farmacia trae las columnas del formulario', async () => {
    const r = await con(tokenFarmacia)(request(app).get(`/api/v1/farmacia/bres/${periodo()}`));
    expect(r.status).toBe(200);
    expect(r.body.servicio).toMatch(/Farmacia/);
    expect(Array.isArray(r.body.renglones)).toBe(true);
    for (const f of r.body.renglones) expect(f.saldoFinal).toBe(f.saldoInicial + f.entradas - f.entregado + f.reajustes);
  });

  it('farmacia registra la impresión de su kardex y su BRES', async () => {
    for (const documento of ['kardex', 'bres', 'inventario_farmacia', 'receta_paciente']) {
      const r = await con(tokenFarmacia)(request(app).post('/api/v1/impresiones')).send({ documento, referencia: periodo() });
      expect(r.status, documento).toBeLessThan(300);
    }
  });
});

describe('requisición de bodega a la DDRISS', () => {
  it('sale llena con la cantidad a pedir del BRES y solo la ve bodega', async () => {
    const r = await con(tokenBodega)(request(app).get(`/api/v1/bodega/requisiciones/sugerida-ddriss?periodo=${periodo()}`));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.renglones)).toBe(true);
    expect(r.body.catalogo.length).toBeGreaterThan(0);
    for (const g of r.body.renglones) expect(g.sugerido).toBeGreaterThan(0);
    const otro = await con(tokenEncargado)(request(app).get(`/api/v1/bodega/requisiciones/sugerida-ddriss?periodo=${periodo()}`));
    expect(otro.status).toBe(403);
  });

  it('acepta una requisición grande (el formulario se imprime en varias hojas)', async () => {
    const r = await con(tokenBodega)(request(app).get(`/api/v1/bodega/requisiciones/sugerida-ddriss?periodo=${periodo()}`));
    const ids = r.body.catalogo.slice(0, 120).map((c) => c.insumoId);
    expect(ids.length).toBeGreaterThan(60);
    const c = await con(tokenBodega)(request(app).post('/api/v1/bodega/requisiciones')).send({
      direccion: 'superior', fechaSolicitud: hoy(), solicitante: 'Encargado de bodega',
      renglones: ids.map((insumoId) => ({ insumoId, cantidadSolicitada: 5 })),
    });
    expect(c.status).toBe(201);
    expect(c.body.requisicion.renglones).toHaveLength(ids.length);
  });

  it('cada hoja del formulario lleva su número y no se repiten entre requisiciones', async () => {
    const base = String(Date.now()).slice(-5);
    const r = await con(tokenBodega)(request(app).get(`/api/v1/bodega/requisiciones/sugerida-ddriss?periodo=${periodo()}`));
    const ids = r.body.catalogo.slice(0, 30).map((c) => c.insumoId);
    const primera = await con(tokenBodega)(request(app).post('/api/v1/bodega/requisiciones')).send({
      direccion: 'superior', numero: `${base}0`, fechaSolicitud: hoy(), solicitante: 'Encargado de bodega',
      renglones: ids.map((insumoId) => ({ insumoId, cantidadSolicitada: 5 })),
    });
    expect(primera.status).toBe(201);
    expect(primera.body.requisicion.numeros.length).toBeGreaterThan(1);
    expect(primera.body.requisicion.numeros[1]).toBe(`${base}1`);
    const choca = await con(tokenBodega)(request(app).post('/api/v1/bodega/requisiciones')).send({
      direccion: 'superior', numero: `${base}1`, fechaSolicitud: hoy(), solicitante: 'Encargado de bodega',
      renglones: [{ insumoId: ids[0], cantidadSolicitada: 1 }],
    });
    expect(choca.status).toBe(409);
    expect(choca.body.error.mensaje).toMatch(/ya es de la requisición/);
  });

  it('si un renglón está mal, el mensaje dice cuál', async () => {
    const r = await con(tokenBodega)(request(app).post('/api/v1/bodega/requisiciones')).send({
      direccion: 'superior', fechaSolicitud: hoy(), solicitante: 'Encargado de bodega',
      renglones: [{ insumoId: insumo.id, cantidadSolicitada: 5 }, { insumoId: insumo.id, cantidadSolicitada: 0 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error.mensaje).toMatch(/renglón 2/);
    expect(r.body.error.detalles[0].campo).toBe('renglones.1.cantidadSolicitada');
  });

  it('lo que no está en el sistema se pide escrito a mano y, al llegar, se crea y entra con su lote', async () => {
    const c = await con(tokenBodega)(request(app).post('/api/v1/bodega/requisiciones')).send({
      direccion: 'superior', fechaSolicitud: hoy(), solicitante: 'Encargado de bodega',
      renglones: [
        { insumoId: insumo.id, cantidadSolicitada: 5 },
        { insumoId: null, descripcion: `${MARCA} Gasa estéril 10x10`, unidadMedida: 'Sobre', cantidadSolicitada: 40 },
        { insumoId: null, descripcion: `${MARCA} Hilo de sutura`, unidadMedida: 'Unidad', cantidadSolicitada: 12 },
      ],
    });
    expect(c.status).toBe(201);
    const [, gasa, hilo] = c.body.requisicion.renglones;
    expect(gasa.insumoId).toBeNull();
    expect(gasa.unidadMedida).toBe('Sobre');

    const nuevo = (await con(tokenBodega)(request(app).post('/api/v1/insumos')).send({
      nombreGenerico: `${MARCA} Gasa estéril`, concentracion: '10x10', categoria: 'medico_quirurgico',
      presentacion: 'Sobre', unidadMedida: 'sobre', unidadEntrega: 'sobre', ubicacionFisica: 'Estante 2',
    })).body.insumo;
    expect(nuevo.ubicacionFisica).toBe('Estante 2');

    const vence = `${Number(hoy().slice(0, 4)) + 2}-06-30`;
    const r = await con(tokenBodega)(request(app).post(`/api/v1/bodega/requisiciones/${c.body.requisicion.id}/recibir`)).send({
      renglones: [
        { id: gasa.id, insumoId: nuevo.id, lotes: [{ numeroLote: `${MARCA}G1`, fechaVence: vence, cantidad: 40 }] },
        { id: hilo.id, cantidad: 12 },
      ],
    });
    expect(r.status).toBe(200);
    const v = (await con(tokenBodega)(request(app).get(`/api/v1/bodega/requisiciones/${c.body.requisicion.id}`))).body.requisicion;
    const g = v.renglones.find((x) => x.id === gasa.id);
    expect(g.insumoId).toBe(nuevo.id);
    expect(g.cantidadDespachada).toBe(40);
    expect(v.renglones.find((x) => x.id === hilo.id).cantidadDespachada).toBe(12);
  });
});
