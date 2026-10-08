// Series de tiempo para las graficas de los paneles.
//
// La agregacion se hace en JavaScript sobre las filas minimas necesarias:
// un establecimiento de primer nivel maneja unos pocos miles de atenciones al
// semestre, y asi se respeta la regla de no escribir SQL fuera de las vistas
// materializadas.

const prisma = require('../config/db');

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

// Ventana horaria que se grafica. Fuera de ella el establecimiento no atiende,
// y un eje de 24 horas seria casi todo vacio.
const HORA_APERTURA = 6;
const HORA_CIERRE = 18;

// Las marcas de tiempo se guardan en UTC (ver config/db.js). Para decir "a que
// hora llega la gente" hay que pasarlas a hora local, o el grafico saldria
// corrido seis horas. Guatemala no aplica horario de verano, asi que un
// desfase fijo es correcto todo el anio.
const DESFASE_LOCAL_HORAS = -6;

const MS_POR_DIA = 86400000;

function claveMes(fecha) {
  const f = new Date(fecha);
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Los ultimos `cantidad` meses en orden cronologico, terminando en el mes de
 * `ahora`. Se devuelven aunque no tengan atenciones: un mes sin datos es
 * informacion, y omitirlo deformaria la tendencia.
 */
function mesesDelPeriodo(ahora, cantidad) {
  const meses = [];
  const base = new Date(ahora);

  for (let i = cantidad - 1; i >= 0; i -= 1) {
    const f = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    meses.push({
      clave: claveMes(f),
      etiqueta: MESES[f.getUTCMonth()],
      anio: f.getUTCFullYear(),
    });
  }

  return meses;
}

/**
 * Atenciones agrupadas por mes, con la variacion porcentual respecto al mes
 * anterior. La variacion es null cuando no hay mes previo con que comparar o
 * cuando el mes previo fue cero: un porcentaje sobre cero no significa nada.
 */
function agruparPorMes(atenciones, ahora, cantidad = 6) {
  const conteo = new Map();
  for (const a of atenciones) {
    const clave = claveMes(a.registradaEn);
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }

  return mesesDelPeriodo(ahora, cantidad).map((mes, indice, todos) => {
    const total = conteo.get(mes.clave) ?? 0;
    const previo = indice > 0 ? (conteo.get(todos[indice - 1].clave) ?? 0) : null;

    return {
      ...mes,
      total,
      variacion: previo ? Math.round(((total - previo) / previo) * 1000) / 10 : null,
    };
  });
}

/**
 * Llegadas por hora del dia dentro del horario de atencion. Sirve para decidir
 * a que hora reforzar preconsulta, que es una decision de organizacion, no un
 * dato clinico.
 */
function agruparPorHora(atenciones, diasObservados, desfase = DESFASE_LOCAL_HORAS) {
  const conteo = new Map();
  for (const a of atenciones) {
    const hora = (new Date(a.registradaEn).getUTCHours() + desfase + 24) % 24;
    if (hora < HORA_APERTURA || hora > HORA_CIERRE) continue;
    conteo.set(hora, (conteo.get(hora) ?? 0) + 1);
  }

  const horas = [];
  for (let h = HORA_APERTURA; h <= HORA_CIERRE; h += 1) {
    const total = conteo.get(h) ?? 0;
    horas.push({
      hora: h,
      etiqueta: `${String(h).padStart(2, '0')}:00`,
      total,
      // Promedio por dia observado: comparar dias sueltos con un acumulado de
      // 30 dias daria una lectura falsa de "cuanta gente llega a esta hora".
      promedioDiario: diasObservados > 0 ? Math.round((total / diasObservados) * 10) / 10 : 0,
    });
  }

  return horas;
}

/**
 * Indice del valor que la grafica debe destacar: el mas alto del periodo.
 * Devuelve null si todos son cero, para no resaltar una barra vacia.
 */
function indiceDestacado(valores) {
  let mejor = null;
  for (let i = 0; i < valores.length; i += 1) {
    if (valores[i] > 0 && (mejor === null || valores[i] > valores[mejor])) mejor = i;
  }
  return mejor;
}

/**
 * Espera promedio por mes, en minutos. Solo cuenta atenciones que llegaron a
 * ser llamadas: una atencion que sigue en espera no tiene espera final.
 */
function esperaPorMes(atenciones, ahora, cantidad = 6) {
  const acumulado = new Map();

  for (const a of atenciones) {
    if (!a.llamadaEn) continue;
    const inicio = a.reingresoEn ?? a.registradaEn;
    const minutos = (new Date(a.llamadaEn) - new Date(inicio)) / 60000;
    if (minutos < 0) continue;

    const clave = claveMes(a.registradaEn);
    const actual = acumulado.get(clave) ?? { suma: 0, casos: 0 };
    acumulado.set(clave, { suma: actual.suma + minutos, casos: actual.casos + 1 });
  }

  return mesesDelPeriodo(ahora, cantidad).map((mes) => {
    const dato = acumulado.get(mes.clave);
    return {
      ...mes,
      // Sin casos no se inventa un cero: se dice que no hay dato.
      promedioMin: dato && dato.casos > 0 ? Math.round(dato.suma / dato.casos) : null,
      casos: dato?.casos ?? 0,
    };
  });
}

/**
 * Todas las series que consumen los paneles, en una sola lectura.
 */
async function seriesDelEstablecimiento(establecimientoId, ahora = new Date(), meses = 6) {
  const desdeMeses = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - (meses - 1), 1),
  );
  const DIAS_LLEGADAS = 30;
  const desdeLlegadas = new Date(ahora.getTime() - DIAS_LLEGADAS * MS_POR_DIA);

  const [delPeriodo, recientes] = await Promise.all([
    prisma.atencion.findMany({
      where: { establecimientoId, registradaEn: { gte: desdeMeses }, estado: { not: 'cancelada' } },
      select: { registradaEn: true, reingresoEn: true, llamadaEn: true, gravedad: true },
    }),
    prisma.atencion.findMany({
      where: { establecimientoId, registradaEn: { gte: desdeLlegadas }, estado: { not: 'cancelada' } },
      select: { registradaEn: true },
    }),
  ]);

  const porMes = agruparPorMes(delPeriodo, ahora, meses);

  return {
    atencionesPorMes: {
      datos: porMes,
      destacado: indiceDestacado(porMes.map((m) => m.total)),
    },
    esperaPorMes: esperaPorMes(delPeriodo, ahora, meses),
    llegadasPorHora: {
      datos: agruparPorHora(recientes, DIAS_LLEGADAS),
      diasObservados: DIAS_LLEGADAS,
    },
  };
}

module.exports = {
  HORA_APERTURA,
  HORA_CIERRE,
  DESFASE_LOCAL_HORAS,
  MESES,
  mesesDelPeriodo,
  agruparPorMes,
  agruparPorHora,
  indiceDestacado,
  esperaPorMes,
  seriesDelEstablecimiento,
};
