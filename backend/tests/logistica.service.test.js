import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  demandaReal,
  pmdr,
  med,
  diasDeCobertura,
  nivelMinimoMeses,
  nivelMaximoMeses,
  cantidadMinima,
  cantidadMaxima,
  cantidadASolicitar,
  evaluarInsumo,
  semaforoVencimientoMspas,
  mesesParaVencer,
  excedenteAlVencer,
  saldoDesdeMovimientos,
  periodoDe,
  periodosHasta,
} = require('../src/services/logistica.service');

// Un mes logistico son 30 dias.
const enMeses = (n, desde = new Date('2026-09-30T00:00:00Z')) =>
  new Date(desde.getTime() + n * 30 * 86400000);

describe('demandaReal', () => {
  it('suma lo entregado y lo que no se pudo entregar', () => {
    expect(demandaReal(120, 30)).toBe(150);
  });

  it('sin desabastecimiento es lo entregado', () => {
    expect(demandaReal(120, 0)).toBe(120);
  });

  it('un mes sin nada da cero', () => {
    expect(demandaReal(0, 0)).toBe(0);
  });

  it('ignora cantidades negativas en lugar de restar', () => {
    expect(demandaReal(-5, 10)).toBe(10);
  });
});

describe('pmdr', () => {
  it('promedia los seis meses mas recientes', () => {
    const r = pmdr([100, 100, 100, 100, 100, 100]);
    expect(r.valor).toBe(100);
    expect(r.mesesUsados).toBe(6);
    expect(r.completo).toBe(true);
  });

  it('descarta los meses mas viejos cuando hay mas de seis', () => {
    // El primer mes (1000) no debe pesar: ya no es reciente.
    const r = pmdr([1000, 60, 60, 60, 60, 60, 60]);
    expect(r.valor).toBe(60);
    expect(r.mesesUsados).toBe(6);
  });

  it('con menos de seis meses usa los que hay y lo informa', () => {
    const r = pmdr([90, 110]);
    expect(r.valor).toBe(100);
    expect(r.mesesUsados).toBe(2);
    expect(r.completo).toBe(false);
  });

  it('sin historia no devuelve cero, devuelve nada', () => {
    // Cero afirmaria que no hay demanda; la verdad es que no se sabe.
    const r = pmdr([]);
    expect(r.valor).toBeNull();
    expect(r.completo).toBe(false);
  });

  it('meses en cero si cuentan: son demanda observada', () => {
    const r = pmdr([0, 0, 60]);
    expect(r.valor).toBe(20);
    expect(r.mesesUsados).toBe(3);
  });
});

describe('med', () => {
  it('son los meses que alcanza el saldo', () => {
    expect(med(300, 100)).toBe(3);
  });

  it('sin promedio no se puede calcular', () => {
    expect(med(300, null)).toBeNull();
  });

  it('con demanda cero tampoco: dividir daria infinito', () => {
    expect(med(300, 0)).toBeNull();
  });

  it('saldo cero son cero meses, no un dato faltante', () => {
    expect(med(0, 100)).toBe(0);
  });
});

describe('diasDeCobertura', () => {
  it('convierte meses a dias de treinta', () => {
    expect(diasDeCobertura(3)).toBe(90);
  });

  it('trunca hacia abajo: no se promete un dia que no alcanza', () => {
    expect(diasDeCobertura(1.99)).toBe(59);
  });

  it('sin meses no hay dias', () => {
    expect(diasDeCobertura(null)).toBeNull();
  });
});

describe('niveles', () => {
  it('el minimo es el doble del tiempo de solicitud y recepcion', () => {
    expect(nivelMinimoMeses(1)).toBe(2);
    expect(nivelMinimoMeses(1.5)).toBe(3);
  });

  it('el maximo es el minimo mas la frecuencia de pedido', () => {
    expect(nivelMaximoMeses(1, 1)).toBe(3);
    expect(nivelMaximoMeses(1.5, 2)).toBe(5);
  });
});

describe('cantidades', () => {
  it('la minima es el promedio por el nivel minimo', () => {
    expect(cantidadMinima(100, 1)).toBe(200);
  });

  it('la maxima es el promedio por el nivel maximo', () => {
    expect(cantidadMaxima(100, 1, 1)).toBe(300);
  });

  it('se redondean hacia arriba: media caja no se pide', () => {
    expect(cantidadMinima(33.3, 1)).toBe(67);
  });

  it('sin promedio no hay cantidades que calcular', () => {
    expect(cantidadMinima(null, 1)).toBeNull();
    expect(cantidadMaxima(null, 1, 1)).toBeNull();
  });

  it('a solicitar es lo que falta para llegar al maximo', () => {
    expect(cantidadASolicitar(300, 120)).toBe(180);
  });

  it('nunca es negativa: con exceso no se pide nada', () => {
    expect(cantidadASolicitar(300, 450)).toBe(0);
  });
});

describe('evaluarInsumo', () => {
  const BASE = { mesesSolicitudRecepcion: 1, mesesFrecuenciaPedido: 1 };

  it('calcula todo el renglon a partir de la demanda real', () => {
    const r = evaluarInsumo({
      saldoFinal: 120,
      demandaPorMes: [100, 100, 100, 100, 100, 100],
      ...BASE,
    });
    expect(r.pmdr).toBe(100);
    expect(r.med).toBe(1.2);
    expect(r.diasCobertura).toBe(36);
    expect(r.cantidadMinima).toBe(200);
    expect(r.cantidadMaxima).toBe(300);
    expect(r.cantidadSolicitar).toBe(180);
    expect(r.bajoMinimo).toBe(true);
    expect(r.historiaCompleta).toBe(true);
  });

  it('el desabastecimiento del mes pasado sube lo que hay que pedir', () => {
    // Mismo insumo: en un caso se entregaron 100 al mes; en el otro se
    // entregaron 60 porque se acabo, y 40 quedaron sin entregar.
    const soloEntregado = evaluarInsumo({
      saldoFinal: 0, demandaPorMes: [60, 60, 60], ...BASE,
    });
    const conDemandaReal = evaluarInsumo({
      saldoFinal: 0, demandaPorMes: [100, 100, 100], ...BASE,
    });
    expect(conDemandaReal.cantidadSolicitar).toBeGreaterThan(soloEntregado.cantidadSolicitar);
  });

  it('avisa cuando la historia no alcanza los seis meses', () => {
    const r = evaluarInsumo({ saldoFinal: 50, demandaPorMes: [40, 60], ...BASE });
    expect(r.mesesHistoria).toBe(2);
    expect(r.historiaCompleta).toBe(false);
    expect(r.pmdr).toBe(50);
  });

  it('sin historia no inventa niveles', () => {
    const r = evaluarInsumo({ saldoFinal: 50, demandaPorMes: [], ...BASE });
    expect(r.pmdr).toBeNull();
    expect(r.med).toBeNull();
    expect(r.cantidadMinima).toBeNull();
    expect(r.cantidadSolicitar).toBeNull();
    expect(r.bajoMinimo).toBe(false);
  });

  it('saldo en cero con demanda es desabastecimiento', () => {
    const r = evaluarInsumo({ saldoFinal: 0, demandaPorMes: [80, 80, 80], ...BASE });
    expect(r.desabastecido).toBe(true);
  });

  it('saldo en cero sin demanda no es desabastecimiento, pero sí es cero', () => {
    // Nadie lo ha pedido nunca, así que no le falta a nadie. Aun así hay que
    // poder verlo: no se puede entregar lo que no hay.
    const r = evaluarInsumo({ saldoFinal: 0, demandaPorMes: [0, 0, 0], ...BASE });
    expect(r.desabastecido).toBe(false);
    expect(r.sinExistencia).toBe(true);
  });

  it('sin demanda el mínimo calculado es cero y no marca "bajo el mínimo"', () => {
    // Con un mínimo de cero, cualquier saldo lo cumple: marcarlo sería ruido.
    const r = evaluarInsumo({ saldoFinal: 5, demandaPorMes: [0, 0, 0], ...BASE });
    expect(r.cantidadMinima).toBe(0);
    expect(r.bajoMinimo).toBe(false);
    expect(r.sinExistencia).toBe(false);
  });

  it('un tiempo de entrega mas largo exige guardar mas', () => {
    const cerca = evaluarInsumo({ saldoFinal: 100, demandaPorMes: [100], ...BASE });
    const lejos = evaluarInsumo({
      saldoFinal: 100, demandaPorMes: [100], mesesSolicitudRecepcion: 2, mesesFrecuenciaPedido: 1,
    });
    expect(lejos.cantidadMinima).toBeGreaterThan(cerca.cantidadMinima);
  });
});

describe('semaforoVencimientoMspas', () => {
  const AHORA = new Date('2026-09-30T00:00:00Z');

  it('rojo de uno a tres meses', () => {
    expect(semaforoVencimientoMspas(enMeses(1), AHORA)).toBe('rojo');
    expect(semaforoVencimientoMspas(enMeses(3), AHORA)).toBe('rojo');
  });

  it('rojo tambien lo ya vencido', () => {
    expect(semaforoVencimientoMspas(enMeses(-1), AHORA)).toBe('rojo');
  });

  it('amarillo de cuatro a doce meses', () => {
    expect(semaforoVencimientoMspas(enMeses(4), AHORA)).toBe('amarillo');
    expect(semaforoVencimientoMspas(enMeses(12), AHORA)).toBe('amarillo');
  });

  it('verde a mas de doce meses', () => {
    expect(semaforoVencimientoMspas(enMeses(13), AHORA)).toBe('verde');
  });

  it('no depende de la categoria del insumo', () => {
    // El semaforo viejo daba verde a un medicamento con cuatro meses de vida.
    expect(semaforoVencimientoMspas(enMeses(4), AHORA)).toBe('amarillo');
  });
});

describe('excedenteAlVencer', () => {
  const AHORA = new Date('2026-09-30T00:00:00Z');

  it('es lo que sobrara sin usar al ritmo de la demanda', () => {
    // 100 unidades, se usan 20 al mes, vence en 2 meses: sobran 60.
    expect(excedenteAlVencer(100, 20, enMeses(2, AHORA), AHORA)).toBe(60);
  });

  it('no hay excedente si alcanza a consumirse', () => {
    expect(excedenteAlVencer(100, 60, enMeses(2, AHORA), AHORA)).toBe(0);
  });

  it('un lote vencido sobra entero', () => {
    expect(excedenteAlVencer(100, 20, enMeses(-1, AHORA), AHORA)).toBe(100);
  });

  it('sin demanda conocida no se proyecta nada', () => {
    expect(excedenteAlVencer(100, null, enMeses(2, AHORA), AHORA)).toBeNull();
  });
});

describe('saldoDesdeMovimientos', () => {
  it('el saldo es la suma de los movimientos', () => {
    const movimientos = [
      { cantidad: 100 }, { cantidad: -30 }, { cantidad: -5 }, { cantidad: 2 },
    ];
    expect(saldoDesdeMovimientos(movimientos)).toBe(67);
  });

  it('sin movimientos el saldo es cero', () => {
    expect(saldoDesdeMovimientos([])).toBe(0);
  });

  it('un reajuste negativo baja el saldo', () => {
    expect(saldoDesdeMovimientos([{ cantidad: 50 }, { cantidad: -8 }])).toBe(42);
  });
});

describe('periodos', () => {
  it('nombra el periodo de una fecha', () => {
    expect(periodoDe('2026-09-15T00:00:00Z')).toBe('2026-09');
    expect(periodoDe('2026-01-01T00:00:00Z')).toBe('2026-01');
  });

  it('lista los seis periodos hasta uno dado, del mas viejo al mas nuevo', () => {
    expect(periodosHasta('2026-09')).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);
  });

  it('cruza el cambio de ano hacia atras', () => {
    expect(periodosHasta('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});
