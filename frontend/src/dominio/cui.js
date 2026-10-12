/**
 * El CUI (DPI) de RENAP: 8 dígitos de correlativo, 1 verificador, 2 del
 * departamento y 2 del municipio donde se inscribió el nacimiento.
 * Lo mismo vive en backend/src/services/cui.service.js.
 */
const DEPARTAMENTOS = [
  'Guatemala', 'El Progreso', 'Sacatepéquez', 'Chimaltenango', 'Escuintla', 'Santa Rosa', 'Sololá', 'Totonicapán',
  'Quetzaltenango', 'Suchitepéquez', 'Retalhuleu', 'San Marcos', 'Huehuetenango', 'Quiché', 'Baja Verapaz',
  'Alta Verapaz', 'Petén', 'Izabal', 'Zacapa', 'Chiquimula', 'Jalapa', 'Jutiapa',
];
const MUNICIPIOS_POR_DEPTO = [17, 8, 16, 16, 14, 14, 19, 8, 24, 21, 9, 30, 33, 21, 8, 17, 14, 5, 11, 11, 7, 17];
const CHIQUIMULA = ['Chiquimula', 'San José La Arada', 'San Juan Ermita', 'Jocotán', 'Camotán', 'Olopa', 'Esquipulas', 'Concepción Las Minas', 'Quezaltepeque', 'San Jacinto', 'Ipala'];

export const MOTIVO_CUI = {
  verificador: 'No es un CUI válido: revise los números',
  departamento: 'No es un CUI válido: el departamento no existe',
  municipio: 'No es un CUI válido: el municipio no existe',
};

export function analizarCui(texto) {
  const cui = String(texto ?? '').replace(/\D/g, '');
  if (cui.length !== 13) return { valido: false, motivo: 'incompleto' };
  const depto = Number(cui.slice(9, 11));
  const muni = Number(cui.slice(11, 13));
  if (depto < 1 || depto > 22) return { valido: false, motivo: 'departamento' };
  if (muni < 1 || muni > MUNICIPIOS_POR_DEPTO[depto - 1]) return { valido: false, motivo: 'municipio' };
  const total = [...cui.slice(0, 8)].reduce((t, d, i) => t + Number(d) * (i + 2), 0);
  if (total % 11 !== Number(cui[8])) return { valido: false, motivo: 'verificador' };
  const departamento = DEPARTAMENTOS[depto - 1];
  return { valido: true, departamento, municipio: depto === 20 ? CHIQUIMULA[muni - 1] : null };
}
