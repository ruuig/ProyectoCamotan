import { describe, it, expect } from 'vitest';
import respaldo from '../src/services/respaldo.service.js';

const { ultimoProgramado, tocaRespaldo, proximoProgramado, nombreRespaldo, rutaDe, entornoConexion } = respaldo;

// Las horas de la configuracion son de Guatemala (UTC-6).
const gt = (texto) => new Date(`${texto}-06:00`);
const diaria = { automatico: true, frecuencia: 'diaria', hora: 12, diaSemana: 1 };

describe('horario del respaldo automatico', () => {
  it('antes de la hora, el ultimo programado es el de ayer', () => {
    expect(ultimoProgramado(diaria, gt('2026-10-07T09:00:00'))).toEqual(gt('2026-10-06T12:00:00'));
  });

  it('despues de la hora, es el de hoy', () => {
    expect(ultimoProgramado(diaria, gt('2026-10-07T12:30:00'))).toEqual(gt('2026-10-07T12:00:00'));
  });

  it('la hora es de Guatemala aunque en UTC ya sea otro dia', () => {
    // 23:00 en Guatemala son las 05:00 del dia siguiente en UTC.
    const noche = { ...diaria, hora: 23 };
    expect(ultimoProgramado(noche, gt('2026-10-07T23:30:00'))).toEqual(gt('2026-10-07T23:00:00'));
  });

  it('el semanal cae en el dia indicado (0 = domingo)', () => {
    // 2026-10-07 es miercoles; el lunes anterior es el 5.
    const semanal = { ...diaria, frecuencia: 'semanal', diaSemana: 1 };
    expect(ultimoProgramado(semanal, gt('2026-10-07T15:00:00'))).toEqual(gt('2026-10-05T12:00:00'));
    expect(proximoProgramado(semanal, gt('2026-10-07T15:00:00'))).toEqual(gt('2026-10-12T12:00:00'));
  });

  it('toca si no se ha intentado desde el ultimo horario', () => {
    const ahora = gt('2026-10-07T12:10:00');
    expect(tocaRespaldo({ ...diaria, ultimoIntentoEn: null }, ahora)).toBe(true);
    expect(tocaRespaldo({ ...diaria, ultimoIntentoEn: gt('2026-10-06T12:00:00') }, ahora)).toBe(true);
    expect(tocaRespaldo({ ...diaria, ultimoIntentoEn: gt('2026-10-07T12:05:00') }, ahora)).toBe(false);
  });

  it('desactivado nunca toca', () => {
    expect(tocaRespaldo({ ...diaria, automatico: false }, gt('2026-10-07T12:10:00'))).toBe(false);
    expect(proximoProgramado({ ...diaria, automatico: false })).toBeNull();
  });
});

describe('archivos de respaldo', () => {
  it('el nombre lleva la fecha y hora de Guatemala', () => {
    expect(nombreRespaldo('manual', gt('2026-10-07T23:41:00'))).toBe('camotan_2026-10-07_2341_manual.sql');
  });

  it('solo acepta nombres de respaldo, nunca rutas', () => {
    expect(rutaDe('camotan_2026-10-07_2341_manual.sql')).not.toBeNull();
    expect(rutaDe('../.env')).toBeNull();
    expect(rutaDe('camotan_2026-10-07_2341_manual.sql/../../.env')).toBeNull();
  });

  it('toma de la URL de Prisma solo lo que entiende pg_dump', () => {
    const e = entornoConexion('postgresql://usu%40rio:cl%24ve@servidor:6543/camotan?schema=public&sslmode=require');
    expect(e).toEqual({
      PGHOST: 'servidor', PGPORT: '6543', PGUSER: 'usu@rio', PGPASSWORD: 'cl$ve', PGDATABASE: 'camotan', PGSSLMODE: 'require',
    });
  });
});
