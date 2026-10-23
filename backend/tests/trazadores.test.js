import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { FORMATOS } from '../src/data/trazadores.js';

/**
 * Trazadores: el informe mensual de la bodega a la DDRISS sale del BRES del
 * mes, renglón por renglón y en el orden del formato.
 */
let token;
const bodega = (p) => p.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  token = (await request(app).post('/api/v1/auth/login').send({ usuario: 'bodega', password: 'Camotan2026!' })).body.token;
});
afterAll(() => prisma.$disconnect());

describe('trazadores', () => {
  it('cada formato trae su lista completa y en el mismo orden del papel', async () => {
    for (const [formato, def] of Object.entries(FORMATOS)) {
      const r = await bodega(request(app).get(`/api/v1/bodega/trazadores/${formato}?periodo=2026-09`));
      expect(r.status).toBe(200);
      expect(r.body.secciones.map((s) => s.titulo)).toEqual(def.secciones.map((s) => s.titulo));
      r.body.secciones.forEach((s, i) => {
        expect(s.renglones.map((x) => x.texto)).toEqual(def.secciones[i].renglones.map((x) => x.texto));
        expect(s.renglones.map((x) => x.no)).toEqual(s.renglones.map((_, j) => j + 1));
      });
    }
  });

  it('el promedio y la existencia son las columnas J e I del BRES guardado, sumando los productos del renglón', async () => {
    const guardado = await prisma.bres.findFirst({ where: { periodo: '2026-09' }, include: { renglones: { include: { insumo: { select: { nombreGenerico: true } } } } } });
    if (!guardado) return; // base sin el historial importado
    const r = (await bodega(request(app).get('/api/v1/bodega/trazadores/medicamentos?periodo=2026-09'))).body;
    const porNombre = new Map(guardado.renglones.map((g) => [g.insumo.nombreGenerico, g]));
    for (const ren of r.secciones.flatMap((s) => s.renglones).filter((x) => x.maneja)) {
      const g = ren.productos.map((n) => porNombre.get(n)).filter(Boolean);
      if (!g.length) continue;
      expect(ren.pmdr).toBeCloseTo(g.reduce((t, x) => t + Number(x.pmdr ?? 0), 0), 3);
      expect(ren.existencia).toBe(g.reduce((t, x) => t + (x.existenciaBodega ?? 0), 0));
    }
    expect(r.fuente).toBe('cerrado');
  });

  it('lo que el centro no maneja va vacío y un formato desconocido no existe', async () => {
    const r = (await bodega(request(app).get('/api/v1/bodega/trazadores/medicamentos?periodo=2026-09'))).body;
    const cloroquina = r.secciones.flatMap((s) => s.renglones).find((x) => x.texto.startsWith('Cloroquina'));
    expect([cloroquina.maneja, cloroquina.pmdr, cloroquina.existencia]).toEqual([false, null, null]);
    expect((await bodega(request(app).get('/api/v1/bodega/trazadores/otro'))).status).toBe(400);
  });
});
