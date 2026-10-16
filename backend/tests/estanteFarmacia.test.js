import { describe, it, expect } from 'vitest';
import { situacionEstante } from '../src/services/farmacia.service.js';

/**
 * El estante de farmacia (post-consulta) se mide en meses de demanda real
 * (entregado + no entregado). Mínimo 1 mes, máximo 2: se pide para volver al
 * máximo, como el BRES de cualquier servicio.
 */
describe('Estante de farmacia: cuándo pedir y cuánto', () => {
  it('con más de un mes de existencia está bien y no se pide', () => {
    expect(situacionEstante({ demandaMensual: 100, entregable: 150, enBodega: 999 })).toMatchObject({ situacion: 'bien', meses: 1.5, pedir: 0 });
  });

  it('con menos de un mes se pide hasta el máximo de dos meses', () => {
    expect(situacionEstante({ demandaMensual: 100, entregable: 40, enBodega: 999 })).toMatchObject({ situacion: 'pedir', pedir: 160 });
  });

  it('en cero está agotado y se pide el máximo completo', () => {
    expect(situacionEstante({ demandaMensual: 30, entregable: 0, enBodega: 999 })).toMatchObject({ situacion: 'agotado', pedir: 60 });
  });

  it('dice cuánto de lo pedido puede dar bodega', () => {
    expect(situacionEstante({ demandaMensual: 100, entregable: 0, enBodega: 50 }).alcanzaBodega).toBe(50);
  });

  it('sin entregas ni faltas en tres meses no inventa un pedido', () => {
    expect(situacionEstante({ demandaMensual: 0, entregable: 20 })).toMatchObject({ situacion: 'sin_movimiento', pedir: 0, meses: null });
  });

  it('lo que está sin número de lote no se vuelve a pedir: se le pone el lote', () => {
    expect(situacionEstante({ demandaMensual: 100, entregable: 0, sinLote: 500, enBodega: 999 })).toMatchObject({ situacion: 'poner_lote', pedir: 0 });
    expect(situacionEstante({ demandaMensual: 0, entregable: 0, sinLote: 50 }).situacion).toBe('poner_lote');
  });
});
