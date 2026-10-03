import { describe, it, expect } from 'vitest';
import {
  ventanaDias,
  diasParaVencer,
  semaforoVencimiento,
  lotesDisponibles,
  seleccionarLoteFEFO,
  planFraccionamiento,
  esLoteFEFO,
  existenciaTotal,
} from '../src/services/inventario.service.js';
import {
  diasCobertura,
  excedenteProyectado,
  evaluarCobertura,
  MENSAJE_SIN_HISTORIAL,
} from '../src/services/indicadores.service.js';

const AHORA = new Date('2026-09-19T12:00:00Z');
const enDias = (n) => new Date(AHORA.getTime() + n * 86400000);

// El estado forma parte del lote: uno en cuarentena esta fisicamente en la
// bodega pero no se puede entregar, y eso cambia todo calculo de existencia.
const lote = (id, cantidadActual, diasParaVencer, estado = 'disponible') => ({
  id,
  cantidadActual,
  fechaVence: enDias(diasParaVencer),
  numeroLote: `L${id}`,
  estado,
});

describe('el estado del lote manda sobre la existencia', () => {
  it('un lote en cuarentena no se puede entregar aunque tenga existencia', () => {
    const lotes = [lote(1, 100, 300, 'cuarentena'), lote(2, 40, 400)];
    expect(lotesDisponibles(lotes, AHORA).map((l) => l.id)).toEqual([2]);
    expect(existenciaTotal(lotes, AHORA)).toBe(40);
  });

  it('PEPE salta el retenido aunque venza primero', () => {
    // Si no se filtrara, se propondria el lote 1 y la entrega fallaria.
    const lotes = [lote(1, 100, 30, 'cuarentena'), lote(2, 100, 400)];
    expect(seleccionarLoteFEFO(lotes, 10, AHORA).lote.id).toBe(2);
  });

  it('un lote retirado o dado de baja tampoco cuenta', () => {
    const lotes = [
      lote(1, 50, 300, 'retirado'),
      lote(2, 50, 300, 'dado_de_baja'),
      lote(3, 25, 300),
    ];
    expect(existenciaTotal(lotes, AHORA)).toBe(25);
  });
});

describe('ventanas de vencimiento', () => {
  it('usa 6 meses para biologicos y 2 para material de un solo uso', () => {
    expect(ventanaDias('biologico')).toBe(183);
    expect(ventanaDias('medicamento')).toBe(91);
    expect(ventanaDias('material_curacion')).toBe(61);
    expect(ventanaDias('uso_unico')).toBe(61);
  });

  it('cuenta los dias que faltan para vencer', () => {
    expect(diasParaVencer(enDias(40), AHORA)).toBe(40);
    expect(diasParaVencer(enDias(-5), AHORA)).toBe(-5);
  });
});

describe('semaforo de vencimiento', () => {
  it('marca verde fuera de la ventana', () => {
    // Un medicamento con ventana de 91 dias, vence en 200.
    expect(semaforoVencimiento(enDias(200), 'medicamento', AHORA)).toBe('verde');
  });

  it('marca amarillo dentro de la ventana', () => {
    expect(semaforoVencimiento(enDias(80), 'medicamento', AHORA)).toBe('amarillo');
  });

  it('marca rojo bajo un tercio de la ventana', () => {
    // Un tercio de 91 son 30 dias.
    expect(semaforoVencimiento(enDias(25), 'medicamento', AHORA)).toBe('rojo');
  });

  it('marca rojo lo ya vencido', () => {
    expect(semaforoVencimiento(enDias(-1), 'medicamento', AHORA)).toBe('rojo');
    expect(semaforoVencimiento(AHORA, 'medicamento', AHORA)).toBe('rojo');
  });

  it('aplica ventana mas amplia a los biologicos', () => {
    // 150 dias es amarillo para un biologico y verde para un medicamento.
    expect(semaforoVencimiento(enDias(150), 'biologico', AHORA)).toBe('amarillo');
    expect(semaforoVencimiento(enDias(150), 'medicamento', AHORA)).toBe('verde');
  });
});

describe('seleccionarLoteFEFO', () => {
  it('propone el lote que vence primero entre los que alcanzan', () => {
    const lotes = [lote(1, 100, 300), lote(2, 50, 60), lote(3, 80, 120)];

    const resultado = seleccionarLoteFEFO(lotes, 20, AHORA);

    expect(resultado.requiereFraccionamiento).toBe(false);
    expect(resultado.lote.id).toBe(2);
  });

  it('descarta lotes vencidos aunque tengan existencia', () => {
    const lotes = [lote(1, 500, -10), lote(2, 50, 90)];

    expect(seleccionarLoteFEFO(lotes, 20, AHORA).lote.id).toBe(2);
  });

  it('descarta lotes sin existencia', () => {
    const lotes = [lote(1, 0, 30), lote(2, 50, 90)];

    expect(seleccionarLoteFEFO(lotes, 20, AHORA).lote.id).toBe(2);
  });

  it('salta al siguiente lote cuando el mas proximo no alcanza solo', () => {
    const lotes = [lote(1, 5, 30), lote(2, 100, 90)];

    const resultado = seleccionarLoteFEFO(lotes, 20, AHORA);
    expect(resultado.requiereFraccionamiento).toBe(false);
    expect(resultado.lote.id).toBe(2);
  });

  it('pide fraccionamiento si ningun lote alcanza por si solo', () => {
    const lotes = [lote(1, 10, 30), lote(2, 15, 90)];

    const resultado = seleccionarLoteFEFO(lotes, 20, AHORA);
    expect(resultado.requiereFraccionamiento).toBe(true);
    expect(resultado.lotes.map((l) => l.id)).toEqual([1, 2]);
  });
});

describe('planFraccionamiento', () => {
  it('reparte en orden de vencimiento, agotando el mas proximo primero', () => {
    const lotes = [lote(1, 10, 30), lote(2, 15, 90), lote(3, 100, 200)];

    const plan = planFraccionamiento(lotes, 20, AHORA);

    expect(plan).toEqual([
      expect.objectContaining({ loteId: 1, cantidad: 10 }),
      expect.objectContaining({ loteId: 2, cantidad: 10 }),
    ]);
  });

  it('devuelve null si la existencia total no alcanza', () => {
    const lotes = [lote(1, 10, 30), lote(2, 5, 90)];
    expect(planFraccionamiento(lotes, 20, AHORA)).toBeNull();
  });

  it('no cuenta lo vencido dentro del total disponible', () => {
    const lotes = [lote(1, 100, -1), lote(2, 5, 90)];
    expect(planFraccionamiento(lotes, 20, AHORA)).toBeNull();
  });

  it('usa un solo lote cuando basta', () => {
    const plan = planFraccionamiento([lote(1, 50, 30)], 20, AHORA);
    expect(plan).toHaveLength(1);
    expect(plan[0].cantidad).toBe(20);
  });
});

describe('esLoteFEFO', () => {
  const lotes = [lote(1, 100, 30), lote(2, 100, 90)];

  it('reconoce el lote que propone FEFO', () => {
    expect(esLoteFEFO(1, lotes, 20, AHORA)).toBe(true);
  });

  it('detecta cuando se eligio otro, lo que obliga a dar motivo', () => {
    expect(esLoteFEFO(2, lotes, 20, AHORA)).toBe(false);
  });
});

describe('existenciaTotal', () => {
  it('suma solo lo vigente con existencia', () => {
    expect(existenciaTotal([lote(1, 10, 30), lote(2, 5, -1), lote(3, 0, 90)], AHORA)).toBe(10);
  });
});

describe('diasCobertura', () => {
  it('divide la existencia entre el consumo diario', () => {
    expect(diasCobertura(340, 19)).toBe(17);
  });

  it('devuelve null sin consumo, nunca 0', () => {
    expect(diasCobertura(340, 0)).toBeNull();
    expect(diasCobertura(340, null)).toBeNull();
    expect(diasCobertura(340, undefined)).toBeNull();
  });

  it('redondea hacia abajo', () => {
    expect(diasCobertura(10, 3)).toBe(3);
  });
});

describe('excedenteProyectado', () => {
  it('estima lo que sobrara sin usar al vencer el lote', () => {
    // 340 unidades, 2 al dia, vence en 100 dias: se usaran 200, sobran 140.
    expect(excedenteProyectado(340, 2, enDias(100), AHORA)).toBe(140);
  });

  it('devuelve 0 si el consumo alcanza a agotarlo antes', () => {
    expect(excedenteProyectado(100, 5, enDias(100), AHORA)).toBe(0);
  });

  it('con el lote ya vencido, todo el saldo es excedente', () => {
    expect(excedenteProyectado(50, 2, enDias(-10), AHORA)).toBe(50);
  });
});

describe('evaluarCobertura', () => {
  it('no calcula sin 30 dias de historial y lo dice', () => {
    const r = evaluarCobertura({ saldoTotal: 300, consumoDiario: 10, diasHistorial: 12 });

    expect(r.calculable).toBe(false);
    expect(r.dias).toBeNull();
    expect(r.mensaje).toBe(MENSAJE_SIN_HISTORIAL);
  });

  it('no calcula si no hay historial en absoluto', () => {
    expect(evaluarCobertura({ saldoTotal: 300, consumoDiario: 0, diasHistorial: null }).calculable)
      .toBe(false);
  });

  it('distingue historial suficiente pero sin consumo', () => {
    const r = evaluarCobertura({ saldoTotal: 300, consumoDiario: 0, diasHistorial: 45 });

    expect(r.calculable).toBe(false);
    expect(r.dias).toBeNull();
    expect(r.mensaje).toMatch(/No se ha usado en el período/);
  });

  it('marca como critica una cobertura menor a 15 dias', () => {
    const r = evaluarCobertura({ saldoTotal: 100, consumoDiario: 10, diasHistorial: 40 });

    expect(r.dias).toBe(10);
    expect(r.critica).toBe(true);
  });

  it('no marca critica una cobertura holgada', () => {
    expect(evaluarCobertura({ saldoTotal: 900, consumoDiario: 10, diasHistorial: 40 }).critica)
      .toBe(false);
  });
});
