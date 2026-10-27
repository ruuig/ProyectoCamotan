/**
 * Acomodo del balance de medicamentos del centro (hoja SEP26 de
 * BALANCENE25.xlsx), para que el Excel de cada encargado salga igual al que le
 * da la bodega: las mismas filas, los mismos títulos de sección y el mismo
 * bloque de seis columnas por lugar.
 *
 * Cada insumo va en su fila según su orden del formulario (Insumo.ordenFormulario).
 * SECCIONES dice antes de qué orden va cada título; NUMERO es el número de la
 * columna A de cada orden (algunos renglones del balance no lo tienen).
 */
const SECCIONES = [
  {
    "titulo": "MICRONUTRIENTES",
    "antesDe": 91
  },
  {
    "titulo": "MEDICAMENTOS ANTIMALÁRICOS",
    "antesDe": 94
  },
  {
    "titulo": "OTROS MEDICAMENTOS",
    "antesDe": 97
  },
  {
    "titulo": "PLANIFICACION FAMILIAR",
    "antesDe": 116
  },
  {
    "titulo": "MATERIALES MEDICO QUIRÚRGICOS",
    "antesDe": 129
  },
  {
    "titulo": "MEDICAMENTOS PARA TUBERCULOSIS",
    "antesDe": 211
  },
  {
    "titulo": "MATERIALES DE LABORATORIO",
    "antesDe": 226
  },
  {
    "titulo": "COVID-19",
    "antesDe": 253
  }
];

const NUMERO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 94, 10, null, 11, 12, null, 13, 14, null, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 249, 87, 88, 89, 90, 91, 92, 93, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, null, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null];

// Nombre de cada lugar como lo escribe el balance (fila 3).
const NOMBRE_EN_BALANCE = {
  "Post-consulta (Centro de Salud)": "POST CONSULTA",
  "P/S Caparjá": "P/S CAPARJÁ",
  "C/C Anicillo": "C/C ANICILLO",
  "P/S Shalaguá": "P/S SHALAGUÁ",
  "C/C Chapulín": "C/C CHAPULÍN",
  "P/S Lantiquín": "P/S LANTIQUÍN",
  "C/C Marimba": "C/C MARIMBA",
  "C/C Chaguitón": "C/C CHAGUITON",
  "C/C Cañón Tisipe": "C/C CAÑON TISIPE",
  "Centro Comunitario Tierra Blanca": "CENTRO COMUN. TIERRA BLANCA",
  "C/C Nuevo Porvenir Tesoro": "C/C NUEVO POR VENIR, TESORO",
  "Centro Comunitario Morola": "CENTRO COMUNITARIO MOROLA",
  "Centro Comunitario Volcán": "CENTRO COMUNITARIO VOLCAN",
  "Centro Comunitario Roblarcito": "CENTRO COMUNITARIO ROBLARCITO",
  "C/C Pententá Nearar": "C/C PENTENTÁ, NEARAR",
  "Centro Comunitario Nearar Cumbre": "CENTRO COMUNITARIO NEARAR CUMBRE",
  "C/C Muyurcó": "C/C MUYURCÓ",
  "Centro Comunitario Plan Tular": "CENTRO COMUNITARIO PLAN TULAR",
  "Centro Comunitario Limón Timoté": "CENTRO COMUNITARIO LIMON TIMOTÉ",
  "C/C Plan del Morro": "C/C PLAN DEL MORRO",
  "Centro Comunitario Despoblado": "CENTRO COMUNITARIO DESPOBLADO",
  "Centro Comunitario Pashapa": "CENTRO COMUNITARIO PASHAPA",
  "Centro Comunitario Rodeo": "CENTRO COMUNITARIO RODEO",
  "C/C Cajón del Río": "C/C CAJÓN DEL RIO",
  "Centro Comunitario Filincas": "CENTRO COMUNITARIO FILINCAS",
  "Centro Comunitario Guayabo": "CENTRO COMUNITARIO GUAYABO",
  "C/C San Antonio": "C/C SAN ANTONIO",
  "Centro Comunitario Shupa": "CENTRO COMUNITARIO SHUPA",
  "Centro Comunitario Calichal": "CENTRO COMUNITARIO CALICHAL",
  "Centro Comunitario Tizamarté": "CENTRO COMUNITARIO TIZAMARTÉ",
  "C/C Nearar Pitahaya": "C/C NEARAR PITAHAYA"
};

const COLUMNAS_LUGAR = ['Saldo anterior', 'Entradas', 'Entregado a usuarios', 'No entregado', 'Saldo siguiente', 'Promedio'];

module.exports = { SECCIONES, NUMERO, NOMBRE_EN_BALANCE, COLUMNAS_LUGAR };
