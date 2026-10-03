import { describe, it, expect } from 'vitest';
import {
  calcularPuntaje,
  explicarPuntaje,
  inicioEspera,
  minutosEsperando,
  puntajeDeAtencion,
  ordenarCola,
  siguienteEnCola,
  diaCalendario,
  mismaJornada,
  resumenCola,
} from '../src/services/priorizacion.service.js';

const AHORA = new Date('2026-09-19T15:00:00Z');
const haceMinutos = (n) => new Date(AHORA.getTime() - n * 60000);

describe('calcularPuntaje', () => {
  it('suma gravedad, condicion y espera', () => {
    // urgente 40 + embarazo 30 + espera menor a 30 min 5 = 75
    const puntaje = calcularPuntaje(
      { gravedad: 'urgente', condiciones: ['embarazo'], inicioEspera: haceMinutos(10), ausencias: 0 },
      AHORA,
    );
    expect(puntaje).toBe(75);
  });

  it('toma solo la condicion de mayor peso cuando coexisten varias', () => {
    // menor_5 (30) y discapacidad (25) juntas deben aportar 30, no 55.
    const puntaje = calcularPuntaje(
      {
        gravedad: 'leve',
        condiciones: ['discapacidad', 'menor_5'],
        inicioEspera: haceMinutos(5),
        ausencias: 0,
      },
      AHORA,
    );
    expect(puntaje).toBe(10 + 30 + 5);
  });

  it('aplica los cuatro tramos de espera', () => {
    const base = { gravedad: 'leve', condiciones: [], ausencias: 0 };
    const con = (min) => calcularPuntaje({ ...base, inicioEspera: haceMinutos(min) }, AHORA);

    expect(con(10)).toBe(10 + 5);
    expect(con(30)).toBe(10 + 15);
    expect(con(60)).toBe(10 + 25);
    expect(con(90)).toBe(10 + 30);
    expect(con(200)).toBe(10 + 30);
  });

  it('penaliza cada ausencia con 10 puntos', () => {
    const base = {
      gravedad: 'moderado',
      condiciones: [],
      inicioEspera: haceMinutos(10),
    };
    expect(calcularPuntaje({ ...base, ausencias: 0 }, AHORA)).toBe(30);
    expect(calcularPuntaje({ ...base, ausencias: 1 }, AHORA)).toBe(20);
    expect(calcularPuntaje({ ...base, ausencias: 2 }, AHORA)).toBe(10);
  });

  it('nunca devuelve un puntaje negativo', () => {
    const puntaje = calcularPuntaje(
      { gravedad: 'leve', condiciones: [], inicioEspera: haceMinutos(1), ausencias: 5 },
      AHORA,
    );
    expect(puntaje).toBe(0);
  });

  it('ignora gravedades y condiciones desconocidas', () => {
    const puntaje = calcularPuntaje(
      { gravedad: 'inventada', condiciones: ['inventada'], inicioEspera: haceMinutos(5), ausencias: 0 },
      AHORA,
    );
    expect(puntaje).toBe(5);
  });

  it('funciona sin condiciones', () => {
    expect(
      calcularPuntaje({ gravedad: 'leve', condiciones: [], inicioEspera: haceMinutos(5), ausencias: 0 }, AHORA),
    ).toBe(15);
    expect(
      calcularPuntaje({ gravedad: 'leve', inicioEspera: haceMinutos(5), ausencias: 0 }, AHORA),
    ).toBe(15);
  });
});

describe('inicio de espera', () => {
  it('usa registradaEn cuando no hubo reingreso', () => {
    const atencion = { registradaEn: haceMinutos(40), reingresoEn: null };
    expect(inicioEspera(atencion).getTime()).toBe(haceMinutos(40).getTime());
    expect(minutosEsperando(atencion, AHORA)).toBe(40);
  });

  it('reinicia el cronometro cuando el paciente vuelve de ausente', () => {
    const atencion = { registradaEn: haceMinutos(120), reingresoEn: haceMinutos(10) };
    expect(minutosEsperando(atencion, AHORA)).toBe(10);
  });

  it('el reingreso baja el puntaje aunque llevara mucho esperando', () => {
    const paciente = { condiciones: [] };
    const sinReingreso = puntajeDeAtencion(
      { gravedad: 'leve', ausencias: 0, registradaEn: haceMinutos(120), paciente },
      AHORA,
    );
    const conReingreso = puntajeDeAtencion(
      { gravedad: 'leve', ausencias: 1, registradaEn: haceMinutos(120), reingresoEn: haceMinutos(5), paciente },
      AHORA,
    );

    expect(sinReingreso).toBe(40); // 10 + 30 de espera larga
    expect(conReingreso).toBe(5); // 10 + 5 de espera corta - 10 de ausencia
  });
});

describe('puntajeDeAtencion', () => {
  it('toma solo las condiciones vigentes del paciente', () => {
    const atencion = {
      gravedad: 'leve',
      ausencias: 0,
      registradaEn: haceMinutos(5),
      paciente: {
        condiciones: [
          { tipo: 'embarazo', vigenteHasta: new Date('2026-01-01') }, // cerrada
          { tipo: 'menor_5', vigenteHasta: null },
        ],
      },
    };

    // Solo debe contar menor_5 (30), no el embarazo ya cerrado.
    expect(puntajeDeAtencion(atencion, AHORA)).toBe(10 + 30 + 5);
  });
});

describe('ordenarCola', () => {
  const paciente = (condiciones = []) => ({
    condiciones: condiciones.map((tipo) => ({ tipo, vigenteHasta: null })),
  });

  it('pone al urgente primero aunque otro tenga mas puntaje', () => {
    const urgenteRecien = {
      id: 1,
      gravedad: 'urgente',
      ausencias: 0,
      registradaEn: haceMinutos(1),
      paciente: paciente(),
    };
    const leveMuyEsperado = {
      id: 2,
      gravedad: 'leve',
      ausencias: 0,
      registradaEn: haceMinutos(200),
      paciente: paciente(['embarazo']),
    };

    const cola = ordenarCola([leveMuyEsperado, urgenteRecien], AHORA);

    // El leve acumula mas puntos, pero la urgencia va antes de ordenar.
    expect(cola[1].puntaje).toBeGreaterThan(cola[0].puntaje);
    expect(cola[0].atencion.id).toBe(1);
  });

  it('ordena por puntaje descendente entre no urgentes', () => {
    const atenciones = [
      { id: 1, gravedad: 'leve', ausencias: 0, registradaEn: haceMinutos(5), paciente: paciente() },
      { id: 2, gravedad: 'moderado', ausencias: 0, registradaEn: haceMinutos(5), paciente: paciente(['menor_5']) },
      { id: 3, gravedad: 'moderado', ausencias: 0, registradaEn: haceMinutos(5), paciente: paciente() },
    ];

    expect(ordenarCola(atenciones, AHORA).map((e) => e.atencion.id)).toEqual([2, 3, 1]);
  });

  it('desempata por tiempo de espera, primero el mas antiguo', () => {
    const atenciones = [
      { id: 1, gravedad: 'leve', ausencias: 0, registradaEn: haceMinutos(10), paciente: paciente() },
      { id: 2, gravedad: 'leve', ausencias: 0, registradaEn: haceMinutos(20), paciente: paciente() },
    ];

    expect(ordenarCola(atenciones, AHORA).map((e) => e.atencion.id)).toEqual([2, 1]);
  });

  it('entre dos urgentes gana el de mayor puntaje', () => {
    const atenciones = [
      { id: 1, gravedad: 'urgente', ausencias: 0, registradaEn: haceMinutos(5), paciente: paciente() },
      { id: 2, gravedad: 'urgente', ausencias: 0, registradaEn: haceMinutos(5), paciente: paciente(['embarazo']) },
    ];

    expect(ordenarCola(atenciones, AHORA)[0].atencion.id).toBe(2);
  });

  it('devuelve cola vacia sin atenciones', () => {
    expect(ordenarCola([], AHORA)).toEqual([]);
    expect(siguienteEnCola([], AHORA)).toBeNull();
  });
});

describe('explicarPuntaje', () => {
  // El personal no debe obedecer un numero opaco: la cola tiene que poder
  // decir en palabras por que cada paciente esta donde esta.
  it('nombra cada factor con los puntos que aporto', () => {
    const factores = explicarPuntaje(
      {
        gravedad: 'moderado',
        condiciones: ['embarazo'],
        inicioEspera: haceMinutos(65),
        ausencias: 0,
      },
      AHORA,
    );

    expect(factores).toEqual([
      { etiqueta: 'Caso moderado', puntos: 25, tipo: 'gravedad' },
      { etiqueta: 'Embarazada', puntos: 30, tipo: 'condicion' },
      { etiqueta: 'Más de 1 hora esperando', puntos: 25, tipo: 'espera' },
    ]);
  });

  it('explica solo la condicion de mayor peso, igual que el calculo', () => {
    const factores = explicarPuntaje(
      {
        gravedad: 'leve',
        condiciones: ['discapacidad', 'menor_5'],
        inicioEspera: haceMinutos(5),
        ausencias: 0,
      },
      AHORA,
    );

    const condiciones = factores.filter((f) => f.tipo === 'condicion');
    expect(condiciones).toHaveLength(1);
    expect(condiciones[0]).toEqual({ etiqueta: 'Menor de 5 años', puntos: 30, tipo: 'condicion' });
  });

  it('muestra la penalizacion por ausencia como puntos negativos', () => {
    const factores = explicarPuntaje(
      { gravedad: 'leve', condiciones: [], inicioEspera: haceMinutos(5), ausencias: 1 },
      AHORA,
    );

    expect(factores.find((f) => f.tipo === 'ausencia')).toEqual({
      etiqueta: '1 ausencia(s)',
      puntos: -10,
      tipo: 'ausencia',
    });
  });

  it('los factores suman lo mismo que el puntaje calculado', () => {
    const datos = {
      gravedad: 'urgente',
      condiciones: ['adulto_mayor'],
      inicioEspera: haceMinutos(95),
      ausencias: 1,
    };

    const suma = explicarPuntaje(datos, AHORA).reduce((s, f) => s + f.puntos, 0);
    expect(suma).toBe(calcularPuntaje(datos, AHORA));
  });

  it('la cola ordenada trae los factores de cada entrada', () => {
    const cola = ordenarCola(
      [
        {
          id: 1,
          gravedad: 'urgente',
          ausencias: 0,
          registradaEn: haceMinutos(5),
          paciente: { condiciones: [{ tipo: 'embarazo', vigenteHasta: null }] },
        },
      ],
      AHORA,
    );

    expect(cola[0].factores.map((f) => f.etiqueta)).toEqual([
      'Caso urgente',
      'Embarazada',
      'Recien llegado',
    ]);
  });
});

describe('jornada', () => {
  it('agrupa por dia calendario de Guatemala, no por UTC', () => {
    // 03:00 UTC del dia 20 son las 21:00 del dia 19 en Guatemala.
    expect(diaCalendario(new Date('2026-09-20T03:00:00Z'))).toBe('2026-09-19');
    expect(diaCalendario(new Date('2026-09-19T18:00:00Z'))).toBe('2026-09-19');
  });

  it('reconoce dos momentos de la misma jornada', () => {
    expect(mismaJornada(new Date('2026-09-19T14:00:00Z'), new Date('2026-09-20T03:00:00Z'))).toBe(true);
    expect(mismaJornada(new Date('2026-09-19T14:00:00Z'), new Date('2026-09-20T14:00:00Z'))).toBe(false);
  });
});

describe('resumenCola', () => {
  const entrada = (min) => ({ minutosEsperando: min, atencion: { id: min } });

  it('calcula promedio, maximo y quien lleva mas tiempo', () => {
    const resumen = resumenCola([entrada(10), entrada(50), entrada(30)]);

    expect(resumen.enEspera).toBe(3);
    expect(resumen.esperaPromedio).toBe(30);
    expect(resumen.esperaMaxima).toBe(50);
    expect(resumen.masAntiguo.minutosEsperando).toBe(50);
  });

  it('senala a quienes superan los 90 minutos', () => {
    const resumen = resumenCola([entrada(95), entrada(20), entrada(120)]);
    expect(resumen.superan90).toHaveLength(2);
  });

  it('no reporta espera con la cola vacia', () => {
    expect(resumenCola([])).toEqual({
      enEspera: 0,
      esperaPromedio: 0,
      esperaMaxima: 0,
      masAntiguo: null,
      superan90: [],
    });
  });
});

describe('peso por tiempo de viaje', () => {
  const base = { gravedad: 'leve', condiciones: [], inicioEspera: haceMinutos(10), ausencias: 0 };

  it('sin tiempo registrado no suma: el puntaje queda como antes', () => {
    // leve 10 + espera 5 = 15
    expect(calcularPuntaje(base, AHORA)).toBe(15);
    expect(calcularPuntaje({ ...base, tiempoViaje: null }, AHORA)).toBe(15);
  });

  it('suma por tramos: menos de 30 min 0, 30 a 59 min 5, 1 a 2 h 10, más de 2 h 15', () => {
    expect(calcularPuntaje({ ...base, tiempoViaje: 20 }, AHORA)).toBe(15);
    expect(calcularPuntaje({ ...base, tiempoViaje: 30 }, AHORA)).toBe(20);
    expect(calcularPuntaje({ ...base, tiempoViaje: 59 }, AHORA)).toBe(20);
    expect(calcularPuntaje({ ...base, tiempoViaje: 60 }, AHORA)).toBe(25);
    expect(calcularPuntaje({ ...base, tiempoViaje: 119 }, AHORA)).toBe(25);
    expect(calcularPuntaje({ ...base, tiempoViaje: 120 }, AHORA)).toBe(30);
    expect(calcularPuntaje({ ...base, tiempoViaje: 300 }, AHORA)).toBe(30);
  });

  it('nunca pesa más que la gravedad: un urgente cercano sigue arriba de un leve lejano', () => {
    const urgenteCerca = calcularPuntaje({ ...base, gravedad: 'urgente', tiempoViaje: 10 }, AHORA);
    const leveLejos = calcularPuntaje({ ...base, tiempoViaje: 240 }, AHORA);
    expect(urgenteCerca).toBeGreaterThan(leveLejos);
  });

  it('se explica en palabras y toma el tiempo de la comunidad del paciente', () => {
    const atencion = {
      gravedad: 'leve',
      registradaEn: haceMinutos(10),
      ausencias: 0,
      paciente: { condiciones: [], embarazos: [], lugarPoblado: { tiempoViajeMinutos: 90 } },
    };
    expect(puntajeDeAtencion(atencion, AHORA)).toBe(25);
    const factor = explicarPuntaje({ ...base, tiempoViaje: 90 }, AHORA).find((f) => f.tipo === 'distancia');
    expect(factor).toEqual({ etiqueta: 'Viene de lejos: 1 a 2 h de viaje', puntos: 10, tipo: 'distancia' });
    expect(explicarPuntaje({ ...base, tiempoViaje: 15 }, AHORA).some((f) => f.tipo === 'distancia')).toBe(false);
  });
});
