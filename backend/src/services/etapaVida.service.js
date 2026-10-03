// Etapa de vida y visibilidad de campos segun la edad.
//
// Las fichas del MSPAS cambian por etapa, y el registro de paciente muestra u
// oculta campos segun la edad: no tiene sentido preguntar escolaridad a un
// lactante ni antecedentes perinatales a una persona mayor.
//
// Funciones puras: reciben la edad en meses y devuelven que aplica.

const MESES_POR_ANIO = 12;

// Cortes de las fichas oficiales, en meses cumplidos.
const ETAPAS = [
  { clave: 'recien_nacido', etiqueta: 'Recién nacido', desdeDias: 0, hastaDias: 28 },
  { clave: 'lactante_ninez', etiqueta: 'Lactante, niña y niño', desdeMeses: 0, hastaMeses: 120 },
  { clave: 'adolescente_joven', etiqueta: 'Adolescente y joven', desdeMeses: 120, hastaMeses: 360 },
  { clave: 'adulto', etiqueta: 'Persona adulta', desdeMeses: 360, hastaMeses: 720 },
  { clave: 'persona_mayor', etiqueta: 'Persona mayor', desdeMeses: 720, hastaMeses: Infinity },
];

/**
 * Etapa de vida a la que pertenece una edad.
 *
 * El recien nacido se separa por dias, no por meses: de 0 a 28 dias. Su ficha
 * todavia no esta confirmada, pero la etapa si existe y se distingue.
 */
function etapaDeVida(edadMeses, edadDias = null) {
  if (edadMeses == null) return null;

  if (edadDias != null && edadDias <= 28) {
    return ETAPAS[0];
  }

  return ETAPAS.slice(1).find((e) => edadMeses >= e.desdeMeses && edadMeses < e.hastaMeses)
    ?? ETAPAS[ETAPAS.length - 1];
}

/**
 * Campos del registro que aplican a esa edad.
 *
 * Devuelve un objeto de banderas en vez de una lista, para que la vista
 * pregunte por nombre y no dependa del orden.
 */
function camposVisibles(edadMeses) {
  const anios = edadMeses == null ? null : Math.floor(edadMeses / MESES_POR_ANIO);

  if (anios === null) {
    // Sin edad conocida no se decide nada: se muestra lo minimo.
    return {
      responsable: false,
      referenteAdulto: false,
      escolaridadNinez: false,
      escolaridadAdolescente: false,
      escolaridad: true,
      trabaja: false,
      estadoCivil: false,
      religion: false,
      contactoDigital: false,
      orientacionSexual: false,
    };
  }

  return {
    // Menor de 18: el responsable es obligatorio.
    responsable: anios < 18,
    // De 10 a 17 el formulario lo llama "referente adulto", no "responsable".
    referenteAdulto: anios >= 10 && anios < 18,
    escolaridadNinez: anios >= 5 && anios < 10,
    escolaridadAdolescente: anios >= 10 && anios < 30,
    escolaridad: true,
    trabaja: anios >= 10,
    estadoCivil: anios >= 10,
    religion: anios >= 10 && anios < 30,
    contactoDigital: anios >= 30,
    // Dato sensible: ademas de la edad, el acceso esta restringido por rol.
    orientacionSexual: anios > 20,
  };
}

/**
 * Condiciones que se derivan solas de la edad. No se preguntan ni se marcan a
 * mano: el sistema las mantiene al dia.
 */
function condicionesPorEdad(edadMeses) {
  if (edadMeses == null) return [];

  const condiciones = [];
  if (edadMeses < 60) condiciones.push('menor_5');
  if (edadMeses >= 60 * MESES_POR_ANIO) condiciones.push('adulto_mayor');
  return condiciones;
}

module.exports = {
  MESES_POR_ANIO,
  ETAPAS,
  etapaDeVida,
  camposVisibles,
  condicionesPorEdad,
};
