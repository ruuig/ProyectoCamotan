/**
 * Periodos del panel de direccion.
 *
 * Todo el panel mira una misma ventana de tiempo, y el selector Semana | Mes
 * la cambia. Aqui se calcula esa ventana, la del periodo anterior con el que
 * se compara, y la frase que la nombra en pantalla.
 *
 * Las funciones son puras: reciben el instante y devuelven fechas. Asi se
 * pueden probar sin base de datos y sin depender del reloj de la maquina.
 */

const MS_POR_DIA = 86400000;

// Guatemala no aplica horario de verano: su desfase es constante.
const DESFASE_LOCAL_HORAS = -6;

const PERIODOS = ['semana', 'mes'];

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Inicio del dia local expresado en UTC. Sin esto, una atencion de las 20:00
 * de un lunes caeria en el martes, porque el servidor razona en UTC.
 */
function inicioDiaLocal(instante) {
  const local = new Date(instante.getTime() + DESFASE_LOCAL_HORAS * 3600000);
  const medianoche = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(medianoche - DESFASE_LOCAL_HORAS * 3600000);
}

/** Partes de la fecha en hora local, para nombrar el periodo. */
function partesLocales(instante) {
  const local = new Date(instante.getTime() + DESFASE_LOCAL_HORAS * 3600000);
  return {
    anio: local.getUTCFullYear(),
    mes: local.getUTCMonth(),
    dia: local.getUTCDate(),
    diaSemana: local.getUTCDay(), // 0 domingo
  };
}

/**
 * Rango del periodo y el del periodo anterior.
 *
 * La semana empieza el lunes, como el resto de los registros del ministerio.
 * El rango incluye `desde` y excluye `hasta`, para que una atencion no pueda
 * contarse en dos periodos.
 */
function rangoPeriodo(periodo, ahora = new Date()) {
  if (!PERIODOS.includes(periodo)) {
    throw new Error(`Periodo desconocido: ${periodo}`);
  }

  if (periodo === 'semana') {
    const { diaSemana } = partesLocales(ahora);
    // Domingo es 0, pero cierra la semana: retrocede 6 dias, no 0.
    const diasDesdeLunes = (diaSemana + 6) % 7;
    const desde = new Date(inicioDiaLocal(ahora).getTime() - diasDesdeLunes * MS_POR_DIA);
    const hasta = new Date(desde.getTime() + 7 * MS_POR_DIA);
    return {
      periodo,
      desde,
      hasta,
      anterior: { desde: new Date(desde.getTime() - 7 * MS_POR_DIA), hasta: desde },
    };
  }

  const { anio, mes } = partesLocales(ahora);
  const inicioDeMes = (a, m) => new Date(Date.UTC(a, m, 1) - DESFASE_LOCAL_HORAS * 3600000);
  const desde = inicioDeMes(anio, mes);
  const hasta = inicioDeMes(anio, mes + 1);
  return {
    periodo,
    desde,
    hasta,
    anterior: { desde: inicioDeMes(anio, mes - 1), hasta: desde },
  };
}

/**
 * Como se nombra el periodo en pantalla.
 *
 * "Semana del 22 al 28 de septiembre" cuando cae dentro de un mes, y
 * "Semana del 29 de septiembre al 5 de octubre" cuando lo cruza: sin el
 * segundo mes la frase enganaria.
 */
function etiquetaPeriodo(periodo, ahora = new Date()) {
  const rango = rangoPeriodo(periodo, ahora);

  if (periodo === 'mes') {
    const { anio, mes } = partesLocales(rango.desde);
    const nombre = MESES[mes];
    return `${nombre[0].toUpperCase()}${nombre.slice(1)} de ${anio}`;
  }

  const primero = partesLocales(rango.desde);
  // `hasta` es exclusivo: el ultimo dia del rango es el anterior.
  const ultimo = partesLocales(new Date(rango.hasta.getTime() - MS_POR_DIA));

  if (primero.mes === ultimo.mes) {
    return `Semana del ${primero.dia} al ${ultimo.dia} de ${MESES[ultimo.mes]}`;
  }
  return `Semana del ${primero.dia} de ${MESES[primero.mes]} al ${ultimo.dia} de ${MESES[ultimo.mes]}`;
}

/** Como se nombra el periodo anterior dentro de una frase de comparacion. */
function nombreAnterior(periodo) {
  return periodo === 'mes' ? 'el mes anterior' : 'la semana anterior';
}

/** Descripcion completa del periodo, lista para enviarse al panel. */
function describirPeriodo(periodo, ahora = new Date()) {
  const rango = rangoPeriodo(periodo, ahora);
  return {
    ...rango,
    etiqueta: etiquetaPeriodo(periodo, ahora),
    nombreAnterior: nombreAnterior(periodo),
  };
}

module.exports = {
  PERIODOS,
  MS_POR_DIA,
  DESFASE_LOCAL_HORAS,
  inicioDiaLocal,
  rangoPeriodo,
  etiquetaPeriodo,
  nombreAnterior,
  describirPeriodo,
};
