import { describe, it, expect } from 'vitest';
import { metodoDe, tipoDeUsuaria } from '../src/services/planificacion.service.js';

describe('Planificación familiar: método y tipo de usuaria', () => {
  it('reconoce los métodos del catálogo del centro y deja fuera lo que no es método', () => {
    expect(metodoDe('Medroxiprogest. Acetato DEPOPROVERA 150mg Amp.')).toBe('inyectable');
    expect(metodoDe('Enantato de Noristerona NORISTERAT 200mg vial Amp.')).toBe('inyectable');
    expect(metodoDe('Levonogestrel+etinilestradiol+fumarato BLISTER')).toBe('pildora');
    expect(metodoDe('Condon masculino')).toBe('condon');
    expect(metodoDe('Levonogestrel, Implante subdérmico JADELLE 75mg')).toBe('implante');
    expect(metodoDe('T de cobre (DIU), Dispositivo Intrauterino')).toBe('diu');
    expect(metodoDe('Jeringa para planificación familiar')).toBeNull();
    expect(metodoDe('Lubricante, sobre')).toBeNull();
  });

  const desde = new Date('2026-10-01T06:00:00Z');
  const hoy = new Date('2026-10-10T15:00:00Z');
  it('sin entregas antes del mes es usuaria nueva', () => {
    expect(tipoDeUsuaria([hoy], hoy, desde)).toBe('nueva');
  });
  it('con entregas anteriores de menos de un año es reconsulta', () => {
    expect(tipoDeUsuaria([new Date('2026-07-10T15:00:00Z'), hoy], hoy, desde)).toBe('reconsulta');
  });
  it('con un año o más en el programa es usuaria activa', () => {
    expect(tipoDeUsuaria([new Date('2025-09-01T15:00:00Z'), hoy], hoy, desde)).toBe('activa');
  });
});
