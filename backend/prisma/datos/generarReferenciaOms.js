// Genera prisma/datos/referencia-oms.json a partir de los archivos LMS
// oficiales de la OMS. Se ejecuta a mano, solo cuando haya que regenerar:
//
//   node prisma/datos/generarReferenciaOms.js
//
// No forma parte del arranque del sistema. El seed lee el JSON ya generado,
// para que sembrar no dependa de tener internet.

const fs = require('fs');
const path = require('path');

const BASE =
  'https://raw.githubusercontent.com/WorldHealthOrganization/anthro/master/data-raw/growthstandards';

// La OMS expresa la edad en dias. Sus tablas mensuales publicadas usan
// 30.4375 dias por mes (365.25 / 12). Se muestrea en esos mismos dias para
// que el mes 0..60 corresponda exactamente a la tabla oficial.
const DIAS_POR_MES = 30.4375;
const MESES_MAX = 60;

const ARCHIVOS = [
  { archivo: 'weianthro.txt', indicador: 'peso_edad', tipo: 'edad' },
  { archivo: 'lenanthro.txt', indicador: 'talla_edad', tipo: 'edad' },
  { archivo: 'bmianthro.txt', indicador: 'imc_edad', tipo: 'edad' },
  // La OMS separa el peso segun como se mide la estatura: acostado en
  // menores de 2 anios, de pie desde los 2. Los valores difieren en el
  // tramo que comparten, por eso se cargan como indicadores distintos.
  { archivo: 'wflanthro.txt', indicador: 'peso_longitud', tipo: 'estatura' },
  { archivo: 'wfhanthro.txt', indicador: 'peso_talla', tipo: 'estatura' },
];

const SEXO = { 1: 'M', 2: 'F' };

function leerTsv(texto) {
  const lineas = texto.trim().split(/\r?\n/);
  const cabecera = lineas[0].split('\t');
  return lineas.slice(1).map((linea) => {
    const valores = linea.split('\t');
    return Object.fromEntries(cabecera.map((col, i) => [col, valores[i]]));
  });
}

async function descargar(archivo) {
  const respuesta = await fetch(`${BASE}/${archivo}`);
  if (!respuesta.ok) {
    throw new Error(`No se pudo descargar ${archivo}: HTTP ${respuesta.status}`);
  }
  return respuesta.text();
}

function filasPorEdad(registros, indicador) {
  // Indice por sexo y dia, para poder tomar el dia exacto de cada mes.
  const porSexoDia = new Map();
  for (const r of registros) {
    porSexoDia.set(`${r.sex}|${Number(r.age)}`, r);
  }

  const filas = [];
  for (const sexoNum of ['1', '2']) {
    for (let mes = 0; mes <= MESES_MAX; mes += 1) {
      const dia = Math.round(mes * DIAS_POR_MES);
      const r = porSexoDia.get(`${sexoNum}|${dia}`);
      if (!r) throw new Error(`Falta el dia ${dia} (mes ${mes}) en ${indicador}`);
      filas.push([indicador, SEXO[sexoNum], mes, Number(r.l), Number(r.m), Number(r.s)]);
    }
  }
  return filas;
}

function filasPorEstatura(registros, indicador) {
  const columna = registros[0].length !== undefined ? 'length' : 'height';
  return registros.map((r) => [
    indicador,
    SEXO[r.sex],
    Number(r[columna]),
    Number(r.l),
    Number(r.m),
    Number(r.s),
  ]);
}

async function main() {
  const filas = [];

  for (const { archivo, indicador, tipo } of ARCHIVOS) {
    process.stdout.write(`Descargando ${archivo}... `);
    const registros = leerTsv(await descargar(archivo));
    const generadas =
      tipo === 'edad' ? filasPorEdad(registros, indicador) : filasPorEstatura(registros, indicador);
    filas.push(...generadas);
    console.log(`${generadas.length} filas de ${indicador}`);
  }

  // Ninguna combinacion puede repetirse: la tabla tiene unique(indicador,sexo,x).
  const claves = new Set(filas.map(([i, s, x]) => `${i}|${s}|${x}`));
  if (claves.size !== filas.length) {
    throw new Error(`Hay claves repetidas: ${filas.length - claves.size}`);
  }

  const salida = {
    fuente: BASE,
    descripcion:
      'Patrones de crecimiento infantil de la OMS (0 a 60 meses), parametros LMS. ' +
      'Archivos oficiales del paquete WorldHealthOrganization/anthro.',
    generadoEn: new Date().toISOString().slice(0, 10),
    columnas: ['indicador', 'sexo', 'x', 'l', 'm', 's'],
    filas,
  };

  const destino = path.join(__dirname, 'referencia-oms.json');
  fs.writeFileSync(destino, JSON.stringify(salida));
  console.log(`\n${filas.length} filas escritas en ${destino}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
