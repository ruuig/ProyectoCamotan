/**
 * El CUI (DPI) de RENAP: 8 digitos de correlativo, 1 verificador, 2 del
 * departamento y 2 del municipio donde se inscribio el nacimiento.
 *
 * Funciones puras. Lo mismo vive en frontend/src/dominio/cui.js.
 */
const { DEPARTAMENTOS, MUNICIPIOS } = require('./geografia.service');

// Municipios por departamento, en el orden de codigos del INE.
const MUNICIPIOS_POR_DEPTO = [17, 8, 16, 16, 14, 14, 19, 8, 24, 21, 9, 30, 33, 21, 8, 17, 14, 5, 11, 11, 7, 17];

function analizarCui(texto) {
  const cui = String(texto ?? '').replace(/\D/g, '');
  if (cui.length !== 13) return { valido: false, motivo: 'incompleto' };

  const numero = cui.slice(0, 8);
  const verificador = Number(cui[8]);
  const depto = Number(cui.slice(9, 11));
  const muni = Number(cui.slice(11, 13));

  if (depto < 1 || depto > DEPARTAMENTOS.length) return { valido: false, motivo: 'departamento' };
  if (muni < 1 || muni > MUNICIPIOS_POR_DEPTO[depto - 1]) return { valido: false, motivo: 'municipio' };

  const total = [...numero].reduce((t, d, i) => t + Number(d) * (i + 2), 0);
  if (total % 11 !== verificador) return { valido: false, motivo: 'verificador' };

  const departamento = DEPARTAMENTOS[depto - 1].nombre;
  return { valido: true, departamento, municipio: MUNICIPIOS[departamento]?.[muni - 1] ?? null };
}

module.exports = { analizarCui, MUNICIPIOS_POR_DEPTO };
