/**
 * Cargos del responsable de la información en los formularios SIGSA, con el
 * código del catálogo oficial (MAN-SIGSA-001 v3.1, casilla "Cargo"). El SIGSA 6
 * cuenta la producción por tipo de personal con este código: un cargo escrito
 * a mano no se puede contar.
 */
export const CARGOS_SIGSA = [
  { codigo: 1, nombre: 'Médico local' },
  { codigo: 2, nombre: 'Médico EPS' },
  { codigo: 3, nombre: 'Médico ambulatorio' },
  { codigo: 4, nombre: 'Médico de cooperación internacional' },
  { codigo: 5, nombre: 'Enfermera graduada o profesional' },
  { codigo: 6, nombre: 'Enfermera ambulatoria' },
  { codigo: 7, nombre: 'Psicólogo profesional' },
  { codigo: 8, nombre: 'Psiquiatra residente' },
  { codigo: 9, nombre: 'EPS de psicología' },
  { codigo: 10, nombre: 'Auxiliar de enfermería' },
  { codigo: 11, nombre: 'Técnico en salud rural (TSR)' },
  { codigo: 12, nombre: 'Inspector de saneamiento ambiental (ISA)' },
  { codigo: 13, nombre: 'Trabajador social' },
  { codigo: 14, nombre: 'Personal de vectores' },
  { codigo: 15, nombre: 'Facilitador institucional' },
  { codigo: 16, nombre: 'Facilitador comunitario' },
  { codigo: 17, nombre: 'Guardián itinerante de la salud' },
  { codigo: 18, nombre: 'Laboratorista' },
  { codigo: 19, nombre: 'Otro' },
];

// Cargos que no son del catálogo SIGSA pero sí firman documentos (bodega, farmacia, dirección).
export const CARGOS_OTROS = ['Director del Centro de Salud', 'Coordinador Municipal de Salud', 'Encargado de farmacia', 'Auxiliar de farmacia', 'Encargado de bodega', 'Digitador'];

const normal = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Código SIGSA del cargo escrito, o null si no es del catálogo. */
export function codigoSigsa(cargo) {
  const c = normal(cargo);
  if (!c) return null;
  return CARGOS_SIGSA.find((x) => normal(x.nombre) === c)?.codigo ?? null;
}
