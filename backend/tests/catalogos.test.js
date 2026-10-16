import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

const MARCA = 'CATQA';
let tokenAdmin;
let tokenPreconsulta;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}

const adm = (p) => p.set('Authorization', `Bearer ${tokenAdmin}`);
const pre = (p) => p.set('Authorization', `Bearer ${tokenPreconsulta}`);

beforeAll(async () => {
  [tokenAdmin, tokenPreconsulta] = await Promise.all([login('admin'), login('preconsulta')]);
});

afterAll(async () => {
  await prisma.lugarPoblado.deleteMany({ where: { nombre: { startsWith: MARCA } } });
  await prisma.$disconnect();
});

describe('GET /catalogos', () => {
  it('entrega los dieciseis catalogos del formulario', async () => {
    const r = await adm(request(app).get('/api/v1/catalogos'));

    expect(r.status).toBe(200);
    expect(Object.keys(r.body.catalogos)).toHaveLength(16);
  });

  it('usa los codigos del formulario oficial, no una numeracion propia', async () => {
    const r = await adm(request(app).get('/api/v1/catalogos?catalogo=pueblo'));
    const pueblo = r.body.catalogos.pueblo;

    expect(pueblo.find((p) => p.codigo === '2').etiqueta).toBe('Maya');
    expect(pueblo.find((p) => p.codigo === '3').etiqueta).toBe('Garífuna');
  });

  it('respeta que escolaridad empiece en 1 para "No aplica"', async () => {
    const r = await adm(request(app).get('/api/v1/catalogos?catalogo=escolaridad'));
    const escolaridad = r.body.catalogos.escolaridad;

    // Los demas catalogos usan 0 para "No aplica"; este no.
    expect(escolaridad.find((e) => e.codigo === '1').etiqueta).toBe('No aplica');
    expect(escolaridad.some((e) => e.codigo === '0')).toBe(false);
    expect(escolaridad.find((e) => e.codigo === '4').etiqueta).toBe('Básicos');
  });

  it('conserva los apostrofos de las comunidades linguisticas', async () => {
    const r = await adm(request(app).get('/api/v1/catalogos?catalogo=comunidad_linguistica'));
    const cl = r.body.catalogos.comunidad_linguistica;

    expect(cl).toHaveLength(23);
    // Ch'orti' es la de Camotan: si se escapa mal, se rompe el dato.
    expect(cl.find((c) => c.codigo === '4').etiqueta).toBe("Ch'orti'");
    expect(cl.find((c) => c.codigo === '16').etiqueta).toBe("Q'anjob'al");
  });

  it('lo puede leer cualquier rol autenticado', async () => {
    const r = await pre(request(app).get('/api/v1/catalogos'));

    expect(r.status).toBe(200);
  });

  it('no lo entrega sin sesion', async () => {
    const r = await request(app).get('/api/v1/catalogos');

    expect(r.status).toBe(401);
  });
});

describe('Lugares poblados', () => {
  it('devuelve los lugares del establecimiento', async () => {
    // Se crea el propio dato en vez de depender de lo sembrado: la base de
    // pruebas no tiene los pacientes de los que salieron las comunidades.
    await adm(request(app).post('/api/v1/catalogos/lugares')).send({
      nombre: `${MARCA} Listado`,
      categoria: 'aldea',
    });

    const r = await adm(request(app).get('/api/v1/catalogos/lugares'));

    expect(r.status).toBe(200);
    expect(r.body.lugares.some((l) => l.nombre === `${MARCA} Listado`)).toBe(true);
  });

  it('busca por nombre parcial', async () => {
    await adm(request(app).post('/api/v1/catalogos/lugares')).send({
      nombre: `${MARCA} Buscable`,
      categoria: 'aldea',
    });

    const r = await adm(request(app).get('/api/v1/catalogos/lugares?buscar=buscable'));

    expect(r.body.lugares).toHaveLength(1);
    expect(r.body.lugares[0].nombre).toBe(`${MARCA} Buscable`);
  });

  it('solo el administrador puede agregar uno', async () => {
    const r = await pre(request(app).post('/api/v1/catalogos/lugares')).send({
      nombre: `${MARCA} Prohibido`,
      categoria: 'aldea',
    });

    expect(r.status).toBe(403);
  });

  it('el administrador lo agrega', async () => {
    const r = await adm(request(app).post('/api/v1/catalogos/lugares')).send({
      nombre: `${MARCA} Nuevo`,
      categoria: 'caserio',
      territorio: 'Territorio 3',
    });

    expect(r.status).toBe(201);
    expect(r.body.lugar.categoria).toBe('caserio');
  });

  it('no admite el mismo nombre dos veces', async () => {
    const enviar = () =>
      adm(request(app).post('/api/v1/catalogos/lugares')).send({
        nombre: `${MARCA} Repetido`,
        categoria: 'aldea',
      });

    await enviar();
    const r = await enviar();

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('lugar_duplicado');
  });

  it('rechaza una categoria fuera del catalogo', async () => {
    const r = await adm(request(app).post('/api/v1/catalogos/lugares')).send({
      nombre: `${MARCA} Malo`,
      categoria: 'municipio',
    });

    expect(r.status).toBe(400);
  });
});

describe('Carga de lugares por CSV', () => {
  it('crea los nuevos y actualiza los que ya existen', async () => {
    const csv = [
      'nombre,categoria,territorio,sector',
      `${MARCA} Uno,aldea,Territorio 1,Sector A`,
      `${MARCA} Dos,caserío,Territorio 2,`,
    ].join('\n');

    const primera = await adm(request(app).post('/api/v1/catalogos/lugares/importar')).send({ csv });
    expect(primera.status).toBe(200);
    expect(primera.body.creados).toBe(2);

    // El mismo archivo, con la categoria corregida: actualiza, no duplica.
    const corregido = csv.replace(`${MARCA} Uno,aldea`, `${MARCA} Uno,barrio`);
    const segunda = await adm(request(app).post('/api/v1/catalogos/lugares/importar'))
      .send({ csv: corregido });

    expect(segunda.body.creados).toBe(0);
    expect(segunda.body.actualizados).toBe(2);

    const guardado = await prisma.lugarPoblado.findFirst({ where: { nombre: `${MARCA} Uno` } });
    expect(guardado.categoria).toBe('barrio');
  });

  it('carga lo valido y informa la linea con error', async () => {
    const csv = [
      'nombre,categoria,territorio,sector',
      `${MARCA} Bueno,aldea,,`,
      `${MARCA} Malo,municipio,,`,
    ].join('\n');

    const r = await adm(request(app).post('/api/v1/catalogos/lugares/importar')).send({ csv });

    expect(r.body.creados).toBe(1);
    expect(r.body.errores).toHaveLength(1);
    expect(r.body.errores[0].linea).toBe(3);
  });


  it('une las variantes de escritura en vez de duplicar el lugar', async () => {
    // Asi estaba sembrado, sin tilde, tal como lo escribio el personal.
    await adm(request(app).post('/api/v1/catalogos/lugares')).send({
      nombre: `${MARCA} Volcan`,
      categoria: 'otro',
    });

    // El archivo oficial lo trae con tilde: es el mismo lugar.
    const csv = `nombre,categoria,territorio,sector
${MARCA} Volcán,caserío,Territorio 9,`;
    const r = await adm(request(app).post('/api/v1/catalogos/lugares/importar')).send({ csv });

    expect(r.body.creados).toBe(0);
    expect(r.body.actualizados).toBe(1);
    expect(r.body.renombrados).toEqual([
      { antes: `${MARCA} Volcan`, ahora: `${MARCA} Volcán` },
    ]);

    // Queda uno solo, con la escritura del archivo.
    const guardados = await prisma.lugarPoblado.findMany({
      where: { nombre: { contains: `${MARCA} Volc` } },
    });
    expect(guardados).toHaveLength(1);
    expect(guardados[0].nombre).toBe(`${MARCA} Volcán`);
  });

  it('no deja crear a mano una variante de uno que ya existe', async () => {
    await adm(request(app).post('/api/v1/catalogos/lugares')).send({
      nombre: `${MARCA} Lantiquin`,
      categoria: 'aldea',
    });

    const r = await adm(request(app).post('/api/v1/catalogos/lugares')).send({
      nombre: `${MARCA} LANTIQUÍN`,
      categoria: 'aldea',
    });

    expect(r.status).toBe(409);
    expect(r.body.error.mensaje).toContain(`${MARCA} Lantiquin`);
  });

  it('rechaza un archivo sin las columnas que se esperan', async () => {
    const r = await adm(request(app).post('/api/v1/catalogos/lugares/importar'))
      .send({ csv: 'nombre\nTisipe' });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('csv_sin_filas');
  });

  it('no deja importar a quien no es administrador', async () => {
    const r = await pre(request(app).post('/api/v1/catalogos/lugares/importar'))
      .send({ csv: 'nombre,categoria,territorio,sector\nX,aldea,,' });

    expect(r.status).toBe(403);
  });
});

describe('tiempo de viaje de los lugares', () => {
  it('el administrador lo guarda y queda en la lista; preconsulta no puede', async () => {
    const lista = (await adm(request(app).get('/api/v1/catalogos/lugares'))).body.lugares;
    const lugar = lista[0];
    const antes = lugar.tiempoViajeMinutos ?? null;
    try {
      const r = await adm(request(app).put('/api/v1/catalogos/lugares/tiempos')).send({ tiempos: [{ id: lugar.id, minutos: 75 }] });
      expect(r.status).toBe(200);
      const despues = (await adm(request(app).get('/api/v1/catalogos/lugares'))).body.lugares.find((l) => l.id === lugar.id);
      expect(despues.tiempoViajeMinutos).toBe(75);
      expect((await pre(request(app).put('/api/v1/catalogos/lugares/tiempos')).send({ tiempos: [{ id: lugar.id, minutos: 5 }] })).status).toBe(403);
      expect((await adm(request(app).put('/api/v1/catalogos/lugares/tiempos')).send({ tiempos: [{ id: lugar.id, minutos: 5000 }] })).status).toBe(400);
    } finally {
      await adm(request(app).put('/api/v1/catalogos/lugares/tiempos')).send({ tiempos: [{ id: lugar.id, minutos: antes }] });
    }
  });

  it('la lista trae todos los lugares, no solo los primeros 200', async () => {
    const lista = (await adm(request(app).get('/api/v1/catalogos/lugares'))).body.lugares;
    const total = await prisma.lugarPoblado.count({ where: { activo: true, establecimientoId: lista[0]?.establecimientoId } });
    expect(lista.length).toBe(total);
  });
});
