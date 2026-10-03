/**
 * Division politico-administrativa de Guatemala.
 *
 * Las fichas piden departamento y municipio como catalogo, no como texto
 * libre. Los 22 departamentos son una lista nacional fija, con los codigos
 * del INE.
 *
 * De municipios solo se incluyen los de Chiquimula, que es de donde viene casi
 * toda la poblacion del centro. Los demas se escriben a mano: no se cargan de
 * memoria 340 nombres sin una fuente a la vista. Si hace falta el catalogo
 * completo, se carga como los lugares poblados.
 */

const DEPARTAMENTOS = [
  { codigo: '01', nombre: 'Guatemala' },
  { codigo: '02', nombre: 'El Progreso' },
  { codigo: '03', nombre: 'Sacatepéquez' },
  { codigo: '04', nombre: 'Chimaltenango' },
  { codigo: '05', nombre: 'Escuintla' },
  { codigo: '06', nombre: 'Santa Rosa' },
  { codigo: '07', nombre: 'Sololá' },
  { codigo: '08', nombre: 'Totonicapán' },
  { codigo: '09', nombre: 'Quetzaltenango' },
  { codigo: '10', nombre: 'Suchitepéquez' },
  { codigo: '11', nombre: 'Retalhuleu' },
  { codigo: '12', nombre: 'San Marcos' },
  { codigo: '13', nombre: 'Huehuetenango' },
  { codigo: '14', nombre: 'Quiché' },
  { codigo: '15', nombre: 'Baja Verapaz' },
  { codigo: '16', nombre: 'Alta Verapaz' },
  { codigo: '17', nombre: 'Petén' },
  { codigo: '18', nombre: 'Izabal' },
  { codigo: '19', nombre: 'Zacapa' },
  { codigo: '20', nombre: 'Chiquimula' },
  { codigo: '21', nombre: 'Jalapa' },
  { codigo: '22', nombre: 'Jutiapa' },
];

const MUNICIPIOS = {
  Chiquimula: [
    'Chiquimula',
    'San José La Arada',
    'San Juan Ermita',
    'Jocotán',
    'Camotán',
    'Olopa',
    'Esquipulas',
    'Concepción Las Minas',
    'Quezaltepeque',
    'San Jacinto',
    'Ipala',
  ],
};

/** Municipios conocidos de un departamento, o lista vacia si no se cargaron. */
function municipiosDe(departamento) {
  return MUNICIPIOS[departamento] ?? [];
}

function esDepartamento(nombre) {
  return DEPARTAMENTOS.some((d) => d.nombre === nombre);
}

module.exports = { DEPARTAMENTOS, MUNICIPIOS, municipiosDe, esDepartamento };
