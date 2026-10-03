import { describe, it, expect } from 'vitest';

const b = require('../src/services/bodega.service');

const AHORA = new Date('2026-10-02T12:00:00Z');
const enMeses = (m) => new Date(AHORA.getTime() + m * 30.4375 * 86400000);

describe('semáforo con los rangos del centro', () => {
  it('rojo a menos de 12 meses, amarillo de 12 a 18, verde a más de 18', () => {
    expect(b.semaforoBodega(enMeses(2), AHORA)).toBe('rojo');
    expect(b.semaforoBodega(enMeses(11.9), AHORA)).toBe('rojo');
    expect(b.semaforoBodega(enMeses(12), AHORA)).toBe('amarillo');
    expect(b.semaforoBodega(enMeses(18), AHORA)).toBe('amarillo');
    expect(b.semaforoBodega(enMeses(18.5), AHORA)).toBe('verde');
  });

  it('lo vencido va aparte', () => {
    expect(b.semaforoBodega(enMeses(-1), AHORA)).toBe('vencido');
  });

  it('los rangos se configuran', () => {
    expect(b.semaforoBodega(enMeses(5), AHORA, { rojo: 3, amarillo: 12 })).toBe('amarillo');
  });
});

describe('validarFechasLote', () => {
  it('el vencimiento no puede ser anterior a la fabricación', () => {
    expect(b.validarFechasLote({ fechaVence: enMeses(12), fechaFabricacion: enMeses(13) }, AHORA).errores).toHaveLength(2);
  });

  it('no se recibe un lote vencido', () => {
    expect(b.validarFechasLote({ fechaVence: enMeses(-1) }, AHORA).errores[0]).toMatch(/vencido/);
  });

  it('avisa, sin impedir, si vence en menos de 3 meses', () => {
    const r = b.validarFechasLote({ fechaVence: enMeses(2) }, AHORA);
    expect(r.errores).toEqual([]);
    expect(r.avisos[0]).toMatch(/3 meses/);
  });
});

describe('lotesPepe', () => {
  const lotes = [
    { id: 1, numeroLote: 'A', fechaVence: enMeses(20), cantidadActual: 100, estado: 'disponible' },
    { id: 2, numeroLote: 'B', fechaVence: enMeses(5), cantidadActual: 30, estado: 'disponible' },
    { id: 3, numeroLote: 'C', fechaVence: enMeses(1), cantidadActual: 50, estado: 'cuarentena' },
    { id: 4, numeroLote: 'D', fechaVence: enMeses(-1), cantidadActual: 50, estado: 'disponible' },
  ];

  it('propone primero el que vence primero, solo disponibles y no vencidos', () => {
    const r = b.lotesPepe(lotes, 50, AHORA);
    expect(r.propuesta.map((p) => [p.loteId, p.cantidad])).toEqual([[2, 30], [1, 20]]);
    expect(r.faltante).toBe(0);
  });

  it('dice cuánto falta si no alcanza', () => {
    expect(b.lotesPepe(lotes, 200, AHORA).faltante).toBe(70);
  });
});

describe('propuestaDistribucion', () => {
  const servicios = [
    { id: 1, nombre: 'P/S Caparjá', promedio: 30 },
    { id: 2, nombre: 'C/C Anicillo', promedio: 10 },
    { id: 3, nombre: 'C/C Marimba', promedio: 0 },
  ];

  it('partes iguales redondeadas hacia abajo al empaque', () => {
    const r = b.propuestaDistribucion({ cantidad: 100, servicios, modo: 'iguales', empaque: 10 });
    expect(r.filas.map((f) => f.cantidad)).toEqual([30, 30, 30]);
    expect(r.sobrante).toBe(10);
  });

  it('según el consumo de cada servicio', () => {
    const r = b.propuestaDistribucion({ cantidad: 100, servicios, modo: 'consumo', empaque: 1 });
    expect(r.filas.map((f) => f.cantidad)).toEqual([75, 25, 0]);
  });

  it('sin consumo reportado, reparte en partes iguales y lo avisa', () => {
    const r = b.propuestaDistribucion({ cantidad: 9, servicios: servicios.map((s) => ({ ...s, promedio: 0 })), modo: 'consumo' });
    expect(r.modo).toBe('iguales');
    expect(r.aviso).toMatch(/partes iguales/);
  });

  it('nunca reparte más de lo que hay', () => {
    const r = b.propuestaDistribucion({ cantidad: 7, servicios, modo: 'iguales', empaque: 1 });
    expect(r.asignado).toBeLessThanOrEqual(7);
  });
});

describe('filaReporte', () => {
  it('saldo siguiente = anterior + entradas − entregado', () => {
    expect(b.filaReporte({ saldoAnterior: 10, entradas: 50, entregado: 35, noEntregado: 4 }).saldoSiguiente).toBe(25);
  });

  it('marca la diferencia con el saldo y las entradas que reporta el servicio', () => {
    const r = b.filaReporte({ saldoAnterior: 10, entradas: 50, entregado: 35, saldoReportado: 20, entradasReportadas: 40 });
    expect(r.diferenciaSaldo).toBe(-5);
    expect(r.diferenciaEntradas).toBe(-10);
  });

  it('sin saldo reportado no hay diferencia que marcar', () => {
    expect(b.filaReporte({ saldoAnterior: 1 }).diferenciaSaldo).toBeNull();
  });
});

describe('filaBres con la fórmula del centro', () => {
  const config = { nivelMinimoMeses: 2, nivelMaximoMeses: 4, formulaPedido: 'centro' };

  it('calcula F, H, J, K, L y M', () => {
    const f = b.filaBres({ B: 100, C: 200, D: 90, E: 10, G: -5, I: 150, demandas: [100, 100, 100], config });
    expect(f.F).toBe(100);
    expect(f.H).toBe(205);
    expect(f.J).toBe(100);
    expect(f.K).toBe(2.1);
    expect(f.L).toBe(400);
    // El centro resta la existencia de bodega (I), no el saldo total.
    expect(f.M).toBe(250);
  });

  it('con la fórmula del MSPAS resta el saldo total', () => {
    const f = b.filaBres({ B: 100, C: 200, D: 90, E: 10, G: -5, I: 150, demandas: [100], config: { ...config, formulaPedido: 'mspas' } });
    expect(f.M).toBe(195);
  });

  it('si la cantidad a pedir sale negativa, se muestra 0', () => {
    expect(b.filaBres({ B: 0, C: 1000, D: 10, E: 0, G: 0, I: 990, demandas: [10], config }).M).toBe(0);
  });

  it('sin consumo, meses de existencia queda vacío en lugar de dividir entre cero', () => {
    const f = b.filaBres({ B: 5, C: 0, D: 0, E: 0, G: 0, I: 5, demandas: [0, 0], config });
    expect(f.K).toBeNull();
    expect(f.sinConsumo).toBe(true);
  });

  it('marca bajo el mínimo', () => {
    expect(b.filaBres({ B: 50, C: 0, D: 0, E: 0, G: 0, I: 50, demandas: [100], config }).bajoMinimo).toBe(true);
  });
});

describe('ordenarInsumos', () => {
  const lista = [
    { nombre: 'Zinc', categoria: 'suplementos', existencia: 5, semaforo: 'verde' },
    { nombre: 'Amoxicilina', categoria: 'medicamentos', existencia: 50, semaforo: 'rojo' },
    { nombre: 'Condón', categoria: 'planificacion_familiar', existencia: 1, semaforo: 'amarillo' },
  ];
  it('por categoría sigue el orden de colores del centro', () => {
    expect(b.ordenarInsumos(lista, 'categoria').map((x) => x.nombre)).toEqual(['Amoxicilina', 'Zinc', 'Condón']);
  });
  it('por semáforo, primero lo más urgente', () => {
    expect(b.ordenarInsumos(lista, 'semaforo')[0].nombre).toBe('Amoxicilina');
  });
});

describe('periodos', () => {
  it('cuenta hacia atrás cruzando el año', () => {
    expect(b.periodoAnterior('2026-01')).toBe('2025-12');
    expect(b.ultimosPeriodos('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('alias', () => {
  it('se comparan sin tildes ni signos', () => {
    expect(b.normalizarAlias('Condón masculino, unidad')).toBe(b.normalizarAlias('CONDON MASCULINO UNIDAD'));
  });
});
