import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  compararDecisiones,
  describirGestion,
  pluralizar,
  diasEntre,
  decisionExistencia,
  decisionVencimiento,
  decisionComunidad,
} = require('../src/services/decisiones.service');

const INSUMO = {
  id: 7,
  nombreGenerico: 'Suero de rehidratación oral',
  unidadMedida: 'sobres',
  stockMinimo: 100,
};

describe('compararDecisiones - severidad', () => {
  it('lo alto va antes que lo medio, aunque el medio sea mas urgente en su cifra', () => {
    const alta = { severidad: 'alta', tipo: 'vencimiento', metrica: 30, generadaEn: '2026-09-01' };
    const media = { severidad: 'media', tipo: 'existencia_baja', metrica: 1, generadaEn: '2026-09-01' };
    expect([media, alta].sort(compararDecisiones)[0]).toBe(alta);
  });
});

describe('compararDecisiones - tipo dentro de la misma severidad', () => {
  it('quedarse sin existencia pesa mas que un lote por vencer', () => {
    const existencia = { severidad: 'alta', tipo: 'existencia_baja', metrica: 9, generadaEn: '2026-09-01' };
    const vencimiento = { severidad: 'alta', tipo: 'vencimiento', metrica: 2, generadaEn: '2026-09-01' };
    expect([vencimiento, existencia].sort(compararDecisiones)[0]).toBe(existencia);
  });

  it('un lote por vencer pesa mas que una comunidad sin visitar', () => {
    const vencimiento = { severidad: 'media', tipo: 'vencimiento', metrica: 20, generadaEn: '2026-09-01' };
    const comunidad = { severidad: 'media', tipo: 'comunidad_sin_atencion', metrica: -90, generadaEn: '2026-09-01' };
    expect([comunidad, vencimiento].sort(compararDecisiones)[0]).toBe(vencimiento);
  });
});

describe('compararDecisiones - cifra dentro del mismo tipo', () => {
  it('menos dias de cobertura va primero', () => {
    const cuatro = { severidad: 'alta', tipo: 'existencia_baja', metrica: 4, generadaEn: '2026-09-01' };
    const doce = { severidad: 'alta', tipo: 'existencia_baja', metrica: 12, generadaEn: '2026-09-01' };
    expect([doce, cuatro].sort(compararDecisiones)[0]).toBe(cuatro);
  });

  it('mas dias sin atencion va primero, porque la metrica se guarda negada', () => {
    const cincuenta = { severidad: 'media', tipo: 'comunidad_sin_atencion', metrica: -50, generadaEn: '2026-09-01' };
    const treinta = { severidad: 'media', tipo: 'comunidad_sin_atencion', metrica: -30, generadaEn: '2026-09-01' };
    expect([treinta, cincuenta].sort(compararDecisiones)[0]).toBe(cincuenta);
  });

  it('la nunca atendida gana a cualquier cantidad de dias', () => {
    const nunca = { severidad: 'alta', tipo: 'comunidad_sin_atencion', metrica: -Infinity, generadaEn: '2026-09-01' };
    const anio = { severidad: 'alta', tipo: 'comunidad_sin_atencion', metrica: -365, generadaEn: '2026-09-01' };
    expect([anio, nunca].sort(compararDecisiones)[0]).toBe(nunca);
  });

  it('quedarse sin existencia encabeza, aunque no haya historial de consumo', () => {
    const sinNada = { severidad: 'alta', tipo: 'existencia_baja', metrica: 0, generadaEn: '2026-09-20' };
    const cuatroDias = { severidad: 'alta', tipo: 'existencia_baja', metrica: 4, generadaEn: '2026-09-01' };
    expect([cuatroDias, sinNada].sort(compararDecisiones)[0]).toBe(sinNada);
  });

  it('la que no se pudo medir queda al final de su tipo, no al frente', () => {
    const medida = { severidad: 'alta', tipo: 'existencia_baja', metrica: 20, generadaEn: '2026-09-01' };
    const sinMedir = { severidad: 'alta', tipo: 'existencia_baja', metrica: Infinity, generadaEn: '2026-09-01' };
    expect([sinMedir, medida].sort(compararDecisiones)[0]).toBe(medida);
  });

  it('empatadas en todo, primero la que lleva mas tiempo esperando', () => {
    const vieja = { severidad: 'alta', tipo: 'existencia_baja', metrica: 5, generadaEn: '2026-09-01' };
    const nueva = { severidad: 'alta', tipo: 'existencia_baja', metrica: 5, generadaEn: '2026-09-20' };
    expect([nueva, vieja].sort(compararDecisiones)[0]).toBe(vieja);
  });
});

describe('describirGestion', () => {
  it('no dice nada de una alerta que nadie ha tocado', () => {
    expect(describirGestion({ estado: 'nueva', estadoEn: null })).toBeNull();
  });

  it('nombra la accion, quien la hizo y cuando', () => {
    const texto = describirGestion({
      estado: 'en_gestion',
      accion: 'despacho_solicitado',
      estadoEn: new Date('2026-09-29T12:00:00Z'),
      nombreUsuario: 'Ana López',
    });
    expect(texto).toMatch(/^Despacho solicitado por Ana López el /);
  });

  it('sin nombre de usuario no se inventa uno', () => {
    const texto = describirGestion({
      estado: 'en_gestion',
      accion: 'visita_programada',
      estadoEn: new Date('2026-09-29T12:00:00Z'),
      nombreUsuario: null,
    });
    expect(texto).toMatch(/^Visita programada el /);
    expect(texto).not.toMatch(/por/);
  });
});

describe('pluralizar', () => {
  it('usa el singular solo con uno', () => {
    expect(pluralizar(1, 'día', 'días')).toBe('día');
    expect(pluralizar(0, 'día', 'días')).toBe('días');
    expect(pluralizar(2, 'día', 'días')).toBe('días');
  });
});

describe('diasEntre', () => {
  it('cuenta dias enteros', () => {
    expect(diasEntre('2026-09-01T00:00:00Z', '2026-09-29T00:00:00Z')).toBe(28);
  });

  it('una diferencia de horas todavia no es un dia', () => {
    expect(diasEntre('2026-09-29T00:00:00Z', '2026-09-29T23:00:00Z')).toBe(0);
  });
});

describe('decisionExistencia', () => {
  it('la cifra son los dias de cobertura cuando se pueden calcular', () => {
    const d = decisionExistencia({
      insumo: INSUMO, saldo: 60, diasCobertura: 4, diasProximoDespacho: 12,
    });
    expect(d.accion).toBe('Solicitar despacho de Suero de rehidratación oral');
    expect(d.cifra).toBe(4);
    expect(d.unidad).toBe('días');
    expect(d.descripcionCifra).toBe('de cobertura');
    expect(d.contexto).toContain('llega en 12 días');
    expect(d.contexto).toContain('Quedan 60 sobres');
    expect(d.boton).toBe('Solicitar despacho');
  });

  it('sin historial de consumo no inventa dias: muestra la existencia', () => {
    const d = decisionExistencia({
      insumo: INSUMO, saldo: 40, diasCobertura: null, diasProximoDespacho: 30,
    });
    expect(d.cifra).toBe(40);
    expect(d.unidad).toBe('sobres');
    expect(d.descripcionCifra).toBe('en existencia');
    expect(d.contexto).toContain('no se puede estimar');
  });

  it('sin existencia lo dice y no habla de lo que queda', () => {
    const d = decisionExistencia({
      insumo: INSUMO, saldo: 0, diasCobertura: null, diasProximoDespacho: 12,
    });
    expect(d.contexto).toMatch(/^Sin existencia\./);
    expect(d.contexto).not.toContain('Quedan');
  });

  it('sin existencia la cobertura es cero dias, aunque no haya historial', () => {
    // No hace falta consumo para afirmarlo: no queda nada que consumir.
    const d = decisionExistencia({
      insumo: INSUMO, saldo: 0, diasCobertura: null, diasProximoDespacho: 12,
    });
    expect(d.cifra).toBe(0);
    expect(d.unidad).toBe('días');
    expect(d.descripcionCifra).toBe('de cobertura');
  });

  it('un solo dia de cobertura va en singular', () => {
    const d = decisionExistencia({
      insumo: INSUMO, saldo: 15, diasCobertura: 1, diasProximoDespacho: 12,
    });
    expect(d.unidad).toBe('día');
  });
});

describe('decisionVencimiento', () => {
  const LOTE = { id: 3, numeroLote: 'DTP632', cantidadActual: 80, fechaVence: '2026-10-18' };

  it('la cifra es lo que se va a perder, no lo que hay', () => {
    const d = decisionVencimiento({
      insumo: INSUMO, lote: LOTE, diasParaVencer: 19, excedente: 60,
    });
    expect(d.accion).toBe('Redistribuir el lote DTP632');
    expect(d.cifra).toBe(60);
    expect(d.descripcionCifra).toBe('sin usar');
    expect(d.contexto).toContain('Vencen en 19 días');
  });

  it('sin proyeccion la cifra es la existencia del lote y lo aclara', () => {
    const d = decisionVencimiento({
      insumo: INSUMO, lote: LOTE, diasParaVencer: 19, excedente: null,
    });
    expect(d.cifra).toBe(80);
    expect(d.contexto).toContain('no se puede proyectar');
  });

  it('un lote ya vencido dice hace cuanto, no en cuanto vence', () => {
    const d = decisionVencimiento({
      insumo: INSUMO, lote: LOTE, diasParaVencer: -5, excedente: 80,
    });
    expect(d.descripcionCifra).toBe('vencidas');
    expect(d.contexto).toContain('venció hace 5 días');
  });
});

describe('decisionComunidad', () => {
  const LUGAR = { id: 11, nombre: 'El Volcán', sector: 'Tisipe' };

  it('la cifra son los dias sin atenciones y el contexto pesa los menores', () => {
    const d = decisionComunidad({
      lugar: LUGAR, diasSinAtencion: 58, pacientes: 14, menoresDeCinco: 5,
    });
    expect(d.accion).toBe('Programar visita a El Volcán');
    expect(d.cifra).toBe(58);
    expect(d.unidad).toBe('días');
    expect(d.contexto).toContain('14 pacientes registrados');
    expect(d.contexto).toContain('5 de ellos menores de 5 años');
  });

  it('la nunca atendida no muestra un cero: lo dice con palabras', () => {
    const d = decisionComunidad({
      lugar: LUGAR, diasSinAtencion: null, pacientes: 2, menoresDeCinco: 0,
    });
    expect(d.cifra).toBeNull();
    expect(d.textoSinCifra).toBe('Nunca atendida');
    expect(d.contexto).toContain('ninguno menor de 5 años');
  });

  it('el contexto distingue la aldea cuando el nombre se repite', () => {
    const d = decisionComunidad({
      lugar: LUGAR, diasSinAtencion: 40, pacientes: 1, menoresDeCinco: 1,
    });
    expect(d.contexto).toContain('El Volcán (Tisipe)');
    expect(d.contexto).toContain('1 paciente registrado');
    expect(d.contexto).toContain('1 de ellos menor de 5 años');
  });
});
