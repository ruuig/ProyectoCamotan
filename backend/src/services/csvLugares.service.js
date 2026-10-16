// Lectura del CSV de lugares poblados.
//
// El municipio tiene sus propias aldeas, caserios y sectores, y el sistema no
// los inventa: los carga la direccion desde un archivo. Por eso el lector es
// tolerante con la forma del archivo pero estricto con el contenido, y informa
// cada problema con su numero de linea para poder corregirlo.
//
// Funcion pura: recibe el texto y devuelve filas y errores. No toca la base.

const COLUMNAS = ['nombre', 'categoria', 'territorio', 'sector'];

const CATEGORIAS = ['aldea', 'caserio', 'barrio', 'colonia', 'otro'];

// Como suele escribirse la categoria en un archivo hecho a mano.
const SINONIMOS = {
  aldea: 'aldea',
  caserio: 'caserio',
  caserío: 'caserio',
  barrio: 'barrio',
  colonia: 'colonia',
  otro: 'otro',
  otros: 'otro',
  '': 'otro',
};

function sinAcentos(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Parte una linea de CSV respetando las comillas, para que un nombre con coma
 * ("San Juan, sector 2") no se rompa en dos columnas.
 */
function partirLinea(linea) {
  const campos = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];

    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',' || c === ';') {
      campos.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }

  campos.push(actual.trim());
  return campos;
}

/**
 * Normaliza la categoria escrita en el archivo al codigo que guarda la base.
 * Devuelve null si no se reconoce, para poder avisarlo con su linea.
 */
function normalizarCategoria(texto) {
  const clave = sinAcentos(texto);
  const directo = SINONIMOS[clave];
  if (directo) return directo;
  return CATEGORIAS.includes(clave) ? clave : null;
}

/**
 * Lee el CSV completo.
 *
 * Devuelve { filas, errores }. Una fila con error no entra en `filas`: se
 * prefiere cargar lo valido y informar el resto antes que rechazar el archivo
 * entero por una linea mal escrita.
 */
function parsearCsvLugares(texto) {
  const errores = [];
  const filas = [];

  // Quita la marca de orden de bytes que agrega Excel al guardar como CSV.
  const limpio = String(texto ?? '').replace(/^﻿/, '');
  const lineas = limpio.split(/\r?\n/);

  const indiceEncabezado = lineas.findIndex((l) => l.trim() !== '');
  if (indiceEncabezado === -1) {
    return { filas, errores: [{ linea: 0, mensaje: 'El archivo está vacío' }] };
  }

  const encabezado = partirLinea(lineas[indiceEncabezado]).map(sinAcentos);
  const faltantes = COLUMNAS.filter((c) => !encabezado.includes(c));

  if (faltantes.length > 0) {
    return {
      filas,
      errores: [{
        linea: indiceEncabezado + 1,
        mensaje: `Faltan columnas en el encabezado: ${faltantes.join(', ')}. `
          + `Se esperaba: ${COLUMNAS.join(',')}`,
      }],
    };
  }

  const posicion = Object.fromEntries(COLUMNAS.map((c) => [c, encabezado.indexOf(c)]));
  const vistos = new Set();

  for (let i = indiceEncabezado + 1; i < lineas.length; i += 1) {
    const cruda = lineas[i];
    if (cruda.trim() === '') continue;

    const numero = i + 1;
    const campos = partirLinea(cruda);
    const valor = (col) => (campos[posicion[col]] ?? '').trim();

    const nombre = valor('nombre');
    if (nombre === '') {
      errores.push({ linea: numero, mensaje: 'El nombre está vacío' });
      continue;
    }

    // Lo que identifica al lugar es nombre + aldea: hay un Descombro en La
    // Lima y otro en Lela Obraje, y ambos deben poder cargarse.
    const sectorFila = valor('sector');
    const clave = `${sinAcentos(nombre)}|${sinAcentos(sectorFila)}`;

    if (vistos.has(clave)) {
      errores.push({
        linea: numero,
        mensaje: sectorFila
          ? `"${nombre}" de ${sectorFila} está repetido en el archivo`
          : `"${nombre}" está repetido en el archivo`,
      });
      continue;
    }

    const categoria = normalizarCategoria(valor('categoria'));
    if (categoria === null) {
      errores.push({
        linea: numero,
        mensaje: `Categoría no reconocida en "${nombre}": "${valor('categoria')}". `
          + `Use una de: ${CATEGORIAS.join(', ')}`,
      });
      continue;
    }

    vistos.add(clave);
    filas.push({
      nombre,
      categoria,
      territorio: valor('territorio') || null,
      sector: sectorFila || null,
    });
  }

  return { filas, errores };
}

module.exports = {
  COLUMNAS,
  CATEGORIAS,
  sinAcentos,
  partirLinea,
  normalizarCategoria,
  parsearCsvLugares,
};
