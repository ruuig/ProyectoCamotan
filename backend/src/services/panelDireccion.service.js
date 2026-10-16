const prisma = require('../config/db');
const { describirPeriodo, MS_POR_DIA, DESFASE_LOCAL_HORAS } = require('./periodo.service');
const { decisionesPendientes } = require('./decisiones.service');
const bodegaDatos = require('./bodegaDatos.service');
const { situacionBres } = require('./bodega.service');
const { etapaDeVida } = require('./etapaVida.service');

/**
 * Reglas de lectura del panel de direccion.
 *
 * Son las que deciden que se puede afirmar y que no. El panel de un centro
 * pequeno trabaja con numeros chicos, y ahi es donde una comparacion de
 * porcentajes miente: pasar de 1 a 2 casos es "un 100% mas" y no significa
 * nada. Todo lo que hay en la primera mitad de este archivo existe para no
 * decir eso, y son funciones puras que se prueban sin base de datos.
 */

// Debajo de esta cantidad, un promedio dice mas del azar que del servicio.
const MINIMO_PARA_PROMEDIO = 10;

// Una linea de tendencia con menos puntos no es una tendencia.
const MINIMO_PERIODOS_TENDENCIA = 4;

// Un diagnostico solo se senala como repunte si ademas de subir mucho tiene
// casos suficientes para que la subida no sea ruido.
const REPUNTE_PORCENTAJE = 30;
const REPUNTE_CASOS = 5;

// Horizonte de la barra de abastecimiento, en dias.
const HORIZONTE_COBERTURA = 30;

// Horizonte de la barra de comunidades, en dias.
const HORIZONTE_REZAGO = 60;

// Sin una semana de registros no se dibuja la grafica de atenciones por dia.
const MINIMO_DIAS_GRAFICA = 7;

const SENTIDO = { mejora: 'mejora', empeora: 'empeora', neutro: 'neutro' };

const FRASE_SIN_ANTERIOR = 'Sin datos del período anterior para comparar';
const FRASE_SIN_ACTUAL = 'Sin datos registrados en el período';

/**
 * Variacion entre dos periodos.
 *
 * El porcentaje es null cuando el periodo anterior estaba en cero: no existe
 * "un 100% mas" respecto de nada, y mostrarlo haria que un establecimiento
 * que arranca pareciera estar disparandose.
 */
function variacionSegura(actual, anterior) {
  if (anterior === 0) return { absoluta: actual, porcentaje: null };
  return {
    absoluta: actual - anterior,
    porcentaje: Math.round(((actual - anterior) / anterior) * 100),
  };
}

/** Coletilla que aclara sobre cuantos casos se calculo un promedio. */
function aclaracionMuestra(casos) {
  if (casos >= MINIMO_PARA_PROMEDIO) return '';
  return ` sobre ${casos} ${casos === 1 ? 'paciente' : 'pacientes'}`;
}

/**
 * Frase de un indicador neutro, donde subir o bajar no es bueno ni malo.
 * Atenciones es el caso: mas atenciones puede ser mas demanda o mejor
 * cobertura, y el panel no tiene como saber cual.
 */
function fraseNeutra(actual, anterior, nombreAnterior) {
  if (anterior === 0) return { frase: FRASE_SIN_ANTERIOR, sentido: null };

  const diferencia = actual - anterior;
  if (diferencia === 0) return { frase: `Igual que ${nombreAnterior}`, sentido: SENTIDO.neutro };

  const palabra = diferencia > 0 ? 'más' : 'menos';
  return {
    frase: `${Math.abs(diferencia)} ${palabra} que ${nombreAnterior}`,
    sentido: SENTIDO.neutro,
  };
}

/**
 * Frase de un indicador donde bajar es mejorar: la espera y el ausentismo.
 *
 * El color sale de si la situacion mejoro o empeoro, nunca de si el numero
 * subio o bajo. Por eso una espera que baja se pinta igual que un ausentismo
 * que baja, aunque uno se mida en minutos y el otro en puntos.
 */
function fraseBajarEsMejor(
  actual,
  anterior,
  { unidad, casos = null, hayAnterior = true, hayActual = true, fraseSinActual = null },
) {
  // Sin nada medido este periodo no hay nada que comparar. Tomar la ausencia
  // de registros como un cero convertiria una semana sin atenciones en una
  // mejora espectacular.
  if (!hayActual) return { frase: fraseSinActual ?? FRASE_SIN_ACTUAL, sentido: null };
  if (!hayAnterior) return { frase: FRASE_SIN_ANTERIOR, sentido: null };

  const diferencia = actual - anterior;
  const muestra = casos === null ? '' : aclaracionMuestra(casos);

  if (diferencia === 0) {
    return { frase: `Igual que antes${muestra}`, sentido: SENTIDO.neutro };
  }

  const magnitud = Math.abs(diferencia);
  const plural = magnitud === 1 ? unidad.singular : unidad.plural;

  return diferencia < 0
    ? { frase: `${unidad.mejoro} ${magnitud} ${plural}${muestra}`, sentido: SENTIDO.mejora }
    : { frase: `${unidad.empeoro} ${magnitud} ${plural}${muestra}`, sentido: SENTIDO.empeora };
}

/**
 * La linea de tendencia solo se dibuja con suficientes periodos medidos.
 * Devuelve null cuando no alcanza, y entonces no se dibuja nada: una linea
 * de dos puntos sugiere una direccion que no se ha observado.
 */
function tendenciaVisible(serie) {
  const conDato = serie.filter((v) => v !== null && v !== undefined);
  return conDato.length >= MINIMO_PERIODOS_TENDENCIA ? serie : null;
}

/**
 * Si un diagnostico subio lo suficiente como para senalarlo.
 *
 * Exige las dos cosas a la vez: que el salto sea grande y que haya casos.
 * De 2 a 4 es un 100% de subida y sigue siendo ruido.
 */
function esRepunte(actual, anterior) {
  if (actual < REPUNTE_CASOS) return false;
  if (anterior === 0) return false;
  const subida = ((actual - anterior) / anterior) * 100;
  return subida >= REPUNTE_PORCENTAJE;
}

/** Cuanto subio un diagnostico, redondeado, o null si no se puede comparar. */
function subidaPorcentual(actual, anterior) {
  if (anterior === 0) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

/**
 * Color de la barra de abastecimiento segun los dias que alcanza.
 * Por debajo del umbral es critico; hasta el doble, vigilar; arriba, normal.
 */
function colorCobertura(dias, umbral) {
  if (dias === null) return null;
  if (dias < umbral) return 'empeora';
  if (dias < umbral * 2) return 'advertencia';
  return 'marino';
}

/** Color de la fila de una comunidad segun cuanto lleva sin atenciones. */
function colorRezago(dias) {
  if (dias === null) return 'empeora';
  return dias > HORIZONTE_COBERTURA ? 'advertencia' : 'neutro';
}

/**
 * Que tan llena va una barra, entre 0 y 1.
 * Lo que se pasa del horizonte se recorta: una barra no puede decir mas que
 * "supera el horizonte".
 */
function proporcion(valor, horizonte) {
  if (valor === null || horizonte <= 0) return 0;
  return Math.min(1, Math.max(0, valor / horizonte));
}

/** Si hay registros suficientes para que la grafica diga algo. */
function graficaDibujable(diasConDatos) {
  return diasConDatos >= MINIMO_DIAS_GRAFICA;
}

// --- Armado desde la base --------------------------------------------------

// Cuantos periodos mira la linea de tendencia de cada indicador.
const PERIODOS_TENDENCIA = 7;

// Cuantas filas caben en cada lista sin dejar de ser una lectura rapida.
const FILAS = 5;

// Umbral minimo de cobertura. PENDIENTE DE CONFIRMAR con el area de salud;
// se asume el mismo que ya usa el panel de farmacia.
const UMBRAL_COBERTURA_DIAS = 15;

const DIAS_SEMANA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const MINUTOS = { singular: 'minuto', plural: 'minutos', mejoro: 'Mejoró', empeoro: 'Empeoró' };
const PUNTOS = { singular: 'punto', plural: 'puntos', mejoro: 'Bajó', empeoro: 'Subió' };

/** Partes de la fecha en hora de Guatemala. */
function enLocal(instante) {
  return new Date(new Date(instante).getTime() + DESFASE_LOCAL_HORAS * 3600000);
}

/** Primer instante de un mes local, desplazado n meses desde el de referencia. */
function inicioDeMesLocal(referencia, desplazamiento) {
  const base = enLocal(referencia);
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + desplazamiento, 1)
      - DESFASE_LOCAL_HORAS * 3600000,
  );
}

/** Minutos de espera entre que el paciente se registra y lo llaman. */
function esperaEnMinutos(a) {
  if (!a.llamadaEn) return null;
  const inicio = a.reingresoEn ?? a.registradaEn;
  return (new Date(a.llamadaEn) - new Date(inicio)) / 60000;
}

/** Promedio de una lista, o null si esta vacia. */
function promedio(valores) {
  if (valores.length === 0) return null;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

/**
 * Los cuatro indicadores del periodo, ya redactados.
 *
 * Cada uno trae su cifra, la frase que la compara y el sentido con el que
 * debe pintarse. La linea de tendencia solo viaja si hay periodos suficientes.
 */
function armarIndicadores({ actual, anterior, tendencias, nombreAnterior }) {
  const cerradas = (lista) => lista.filter((a) => a.estado === 'atendido');
  const esperas = (lista) => lista.map(esperaEnMinutos).filter((m) => m !== null);
  const llamados = (lista) => lista.filter((a) => a.llamadaEn !== null);
  const ausentes = (lista) => lista.filter((a) => a.estado === 'ausente' || a.ausencias > 0);

  const atencionesActual = cerradas(actual).length;
  const atencionesAnterior = cerradas(anterior).length;

  const esperasActual = esperas(actual);
  const esperasAnterior = esperas(anterior);
  const esperaActual = promedio(esperasActual);
  const esperaAnterior = promedio(esperasAnterior);

  const urgentesActual = cerradas(actual).filter((a) => a.gravedad === 'urgente');
  const esperaUrgentes = promedio(esperas(urgentesActual));

  // Ausentismo: de los que fueron llamados, cuantos no estaban.
  const tasa = (lista) => {
    const base = llamados(lista).length;
    return base === 0 ? null : Math.round((ausentes(lista).length / base) * 100);
  };
  const ausentismoActual = tasa(actual);
  const ausentismoAnterior = tasa(anterior);

  const atenciones = fraseNeutra(atencionesActual, atencionesAnterior, nombreAnterior);

  const espera = fraseBajarEsMejor(
    Math.round(esperaActual ?? 0),
    Math.round(esperaAnterior ?? 0),
    {
      unidad: MINUTOS,
      casos: esperasActual.length,
      hayActual: esperasActual.length > 0,
      hayAnterior: esperasAnterior.length > 0,
      fraseSinActual: 'Todavía no se ha llamado a nadie en el período',
    },
  );

  const ausentismo = fraseBajarEsMejor(
    ausentismoActual ?? 0,
    ausentismoAnterior ?? 0,
    {
      unidad: PUNTOS,
      casos: llamados(actual).length,
      hayActual: ausentismoActual !== null,
      hayAnterior: ausentismoAnterior !== null,
      fraseSinActual: 'Todavía no se ha llamado a nadie en el período',
    },
  );

  // Urgentes no se compara con nada: lo que importa es cuanto esperaron.
  const minutosUrgentes = esperaUrgentes === null ? null : Math.round(esperaUrgentes);
  const fraseUrgentes = minutosUrgentes === null
    ? { frase: `Sin urgentes en ${nombreAnterior === 'el mes anterior' ? 'el mes' : 'la semana'}`, sentido: null }
    : {
        frase: `Esperaron ${minutosUrgentes} ${minutosUrgentes === 1 ? 'minuto' : 'minutos'} en promedio${aclaracionMuestra(urgentesActual.length)}`,
        sentido: SENTIDO.neutro,
      };

  return [
    {
      clave: 'atenciones',
      etiqueta: 'Atenciones',
      valor: atencionesActual,
      unidad: null,
      ...atenciones,
      tendencia: tendenciaVisible(tendencias.atenciones),
    },
    {
      clave: 'espera',
      etiqueta: 'Espera promedio',
      valor: esperaActual === null ? null : Math.round(esperaActual),
      unidad: 'min',
      ...espera,
      tendencia: tendenciaVisible(tendencias.espera),
    },
    {
      clave: 'urgentes',
      etiqueta: 'Urgentes atendidos',
      valor: urgentesActual.length,
      unidad: null,
      ...fraseUrgentes,
      tendencia: tendenciaVisible(tendencias.urgentes),
    },
    {
      clave: 'ausentismo',
      etiqueta: 'Ausentismo',
      valor: ausentismoActual,
      unidad: '%',
      ...ausentismo,
      tendencia: tendenciaVisible(tendencias.ausentismo),
    },
  ];
}

/**
 * Los siete periodos anteriores de cada indicador, para la linea de tendencia.
 * Un periodo sin registros deja null, no un cero: no es lo mismo no haber
 * atendido a nadie que no haber registrado nada.
 */
function armarTendencias(atenciones, rango, periodo) {
  const cortes = [];

  for (let i = PERIODOS_TENDENCIA - 1; i >= 0; i -= 1) {
    if (periodo === 'mes') {
      cortes.push({
        desde: inicioDeMesLocal(rango.desde, -i),
        hasta: inicioDeMesLocal(rango.desde, -i + 1),
      });
    } else {
      const desde = new Date(rango.desde.getTime() - i * 7 * MS_POR_DIA);
      cortes.push({ desde, hasta: new Date(desde.getTime() + 7 * MS_POR_DIA) });
    }
  }

  const series = { atenciones: [], espera: [], urgentes: [], ausentismo: [] };

  for (const corte of cortes) {
    const dentro = atenciones.filter(
      (a) => new Date(a.registradaEn) >= corte.desde && new Date(a.registradaEn) < corte.hasta,
    );
    const cerradas = dentro.filter((a) => a.estado === 'atendido');
    const esperas = dentro.map(esperaEnMinutos).filter((m) => m !== null);
    const llamados = dentro.filter((a) => a.llamadaEn !== null).length;
    const ausentes = dentro.filter((a) => a.estado === 'ausente' || a.ausencias > 0).length;

    series.atenciones.push(dentro.length === 0 ? null : cerradas.length);
    series.espera.push(esperas.length === 0 ? null : Math.round(promedio(esperas)));
    series.urgentes.push(
      dentro.length === 0 ? null : cerradas.filter((a) => a.gravedad === 'urgente').length,
    );
    series.ausentismo.push(llamados === 0 ? null : Math.round((ausentes / llamados) * 100));
  }

  return series;
}

/**
 * Atenciones por dia del periodo y del anterior, separadas para que la
 * grafica pueda pintar el pasado en tono apagado.
 */
function armarAtencionesPorDia(atenciones, rango, periodo) {
  const paso = periodo === 'mes' ? 7 * MS_POR_DIA : MS_POR_DIA;

  const cubetas = (desde, hasta) => {
    const lista = [];
    for (let t = desde.getTime(); t < hasta.getTime(); t += paso) {
      const fin = new Date(Math.min(t + paso, hasta.getTime()));
      const dentro = atenciones.filter(
        (a) => new Date(a.registradaEn) >= new Date(t) && new Date(a.registradaEn) < fin,
      );
      const cerradas = dentro.filter((a) => a.estado === 'atendido');
      const urgentes = cerradas.filter((a) => a.gravedad === 'urgente').length;
      const local = enLocal(new Date(t));

      lista.push({
        etiqueta: periodo === 'mes'
          ? `${local.getUTCDate()}/${local.getUTCMonth() + 1}`
          : DIAS_SEMANA[local.getUTCDay()],
        fecha: new Date(t),
        noUrgentes: cerradas.length - urgentes,
        urgentes,
        registros: dentro.length,
      });
    }
    return lista;
  };

  const anterior = cubetas(rango.anterior.desde, rango.anterior.hasta);
  const actual = cubetas(rango.desde, rango.hasta);

  const total = (lista) => lista.reduce((s, d) => s + d.noUrgentes + d.urgentes, 0);
  const conDatos = [...anterior, ...actual].filter((d) => d.registros > 0).length;

  return {
    anterior,
    actual,
    totalAnterior: total(anterior),
    totalActual: total(actual),
    periodosConDatos: conDatos,
    dibujable: graficaDibujable(conDatos),
  };
}

/**
 * Los cinco diagnosticos mas frecuentes del mes.
 *
 * PENDIENTE DE CONFIRMAR: el sistema no tiene el catalogo oficial CIE-10, asi
 * que el nombre visible es el texto que escribio quien atendio, tomando el
 * mas repetido de cada codigo. No se inventa una descripcion. Con el catalogo
 * cargado bastaria con cambiar esta lectura por una consulta a la tabla.
 */
async function armarDiagnosticos(establecimientoId, ahora) {
  const desdeMes = inicioDeMesLocal(ahora, 0);
  const desdeMesAnterior = inicioDeMesLocal(ahora, -1);
  const hastaMes = inicioDeMesLocal(ahora, 1);

  const atenciones = await prisma.atencion.findMany({
    where: {
      establecimientoId,
      estado: 'atendido',
      diagnosticoCie: { not: null },
      registradaEn: { gte: desdeMesAnterior, lt: hastaMes },
    },
    select: { diagnosticoCie: true, diagnosticoTxt: true, registradaEn: true },
  });

  const conteo = new Map();
  for (const a of atenciones) {
    const delMes = new Date(a.registradaEn) >= desdeMes;
    const fila = conteo.get(a.diagnosticoCie) ?? {
      codigo: a.diagnosticoCie,
      mes: 0,
      mesAnterior: 0,
      textos: new Map(),
    };
    if (delMes) {
      fila.mes += 1;
      if (a.diagnosticoTxt) {
        fila.textos.set(a.diagnosticoTxt, (fila.textos.get(a.diagnosticoTxt) ?? 0) + 1);
      }
    } else {
      fila.mesAnterior += 1;
    }
    conteo.set(a.diagnosticoCie, fila);
  }

  const lista = [...conteo.values()]
    .filter((d) => d.mes > 0)
    .sort((a, b) => b.mes - a.mes)
    .slice(0, FILAS);

  const mayor = lista[0]?.mes ?? 0;

  return {
    desde: desdeMes,
    desdeAnterior: desdeMesAnterior,
    lista: lista.map((d) => {
      const nombre = [...d.textos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const repunte = esRepunte(d.mes, d.mesAnterior);
      return {
        codigo: d.codigo,
        nombre,
        casos: d.mes,
        casosAnterior: d.mesAnterior,
        subida: repunte ? subidaPorcentual(d.mes, d.mesAnterior) : null,
        repunte,
        proporcion: mayor === 0 ? 0 : d.mes / mayor,
      };
    }),
  };
}

/**
 * Abastecimiento con la regla del BRES, la misma de Existencias: cuantos
 * insumos estan agotados en bodega o con el municipio bajo el minimo, y
 * cuales son, primero los que mas se consumen (los que mas pacientes dejan
 * sin medicamento).
 */
async function armarAbastecimiento(establecimientoId, ahora) {
  const local = new Date(new Date(ahora).getTime() - DESFASE_LOCAL_HORAS * 3600000);
  const periodo = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
  const b = await bodegaDatos.balance(establecimientoId, periodo);

  const conteo = { agotado: 0, bajo: 0, bien: 0, sin_consumo: 0 };
  const lista = [];
  for (const f of b.filas) {
    const situacion = situacionBres(f.bres);
    conteo[situacion] += 1;
    if (situacion === 'agotado' || situacion === 'bajo') {
      lista.push({
        insumoId: f.insumoId,
        nombre: f.nombre,
        unidad: f.unidadEntrega,
        situacion,
        bodega: f.bres.I,
        municipio: f.bres.H,
        promedio: f.bres.J,
        meses: f.bres.K == null ? null : Math.round(f.bres.K * 10) / 10,
      });
    }
  }
  lista.sort((x, y) => y.promedio - x.promedio);

  return {
    periodo,
    nivelMinimoMeses: b.configuracion.nivelMinimoMeses,
    conteo,
    total: b.filas.length,
    lista: lista.slice(0, 8),
  };
}

/**
 * Pacientes atendidos en el periodo por etapa de vida: los programas del
 * MSPAS se organizan por curso de vida, y es lo primero que se pregunta al
 * planificar personal e insumos.
 */
function armarEtapas(atenciones) {
  const conteo = { lactante_ninez: 0, adolescente_joven: 0, adulto: 0, persona_mayor: 0 };
  for (const a of atenciones) {
    if (!a.paciente?.fechaNacimiento) continue;
    const meses = (new Date(a.registradaEn) - new Date(a.paciente.fechaNacimiento)) / (MS_POR_DIA * 30.4375);
    const etapa = etapaDeVida(Math.max(0, Math.floor(meses)));
    const clave = etapa?.clave === 'recien_nacido' ? 'lactante_ninez' : etapa?.clave;
    if (clave in conteo) conteo[clave] += 1;
  }
  return conteo;
}

/** Comunidades ordenadas por lo que llevan sin una atencion registrada. */
async function armarComunidades(establecimientoId, ahora) {
  const lugares = await prisma.lugarPoblado.findMany({
    where: { establecimientoId, activo: true },
    select: {
      id: true,
      nombre: true,
      sector: true,
      pacientes: {
        where: { activo: true },
        select: {
          atenciones: {
            where: { estado: 'atendido' },
            orderBy: { registradaEn: 'desc' },
            take: 1,
            select: { registradaEn: true },
          },
        },
      },
    },
  });

  const filas = lugares
    // Una aldea sin un solo paciente no es un vacio de cobertura.
    .filter((l) => l.pacientes.length > 0)
    .map((l) => {
      let ultima = null;
      for (const p of l.pacientes) {
        const fecha = p.atenciones[0]?.registradaEn ?? null;
        if (fecha && (!ultima || new Date(fecha) > new Date(ultima))) ultima = fecha;
      }
      const dias = ultima ? Math.floor((new Date(ahora) - new Date(ultima)) / MS_POR_DIA) : null;

      return {
        lugarId: l.id,
        nombre: l.nombre,
        sector: l.sector,
        pacientes: l.pacientes.length,
        dias,
        color: colorRezago(dias),
        proporcion: dias === null ? 1 : proporcion(dias, HORIZONTE_REZAGO),
      };
    });

  // La nunca atendida encabeza: es el rezago maximo, no un dato faltante.
  filas.sort((a, b) => (b.dias ?? Infinity) - (a.dias ?? Infinity));

  return { horizonte: HORIZONTE_REZAGO, lista: filas.slice(0, FILAS) };
}

/**
 * Todo lo que el panel de direccion necesita, en una sola lectura.
 */
async function panelDireccion(establecimientoId, ahora = new Date(), periodo = 'semana') {
  const rango = describirPeriodo(periodo, ahora);

  // Se lee una sola vez el tramo mas largo que hace falta: el de la linea de
  // tendencia, que cubre tambien el periodo actual y el anterior.
  const desdeTendencia = periodo === 'mes'
    ? inicioDeMesLocal(rango.desde, -(PERIODOS_TENDENCIA - 1))
    : new Date(rango.desde.getTime() - (PERIODOS_TENDENCIA - 1) * 7 * MS_POR_DIA);

  const atenciones = await prisma.atencion.findMany({
    where: { establecimientoId, registradaEn: { gte: desdeTendencia, lt: rango.hasta }, estado: { not: 'cancelada' } },
    select: {
      estado: true,
      gravedad: true,
      ausencias: true,
      registradaEn: true,
      reingresoEn: true,
      llamadaEn: true,
      cerradaEn: true,
      diagnosticoCie: true,
      paciente: { select: { fechaNacimiento: true } },
    },
  });

  const enRango = (desde, hasta) =>
    atenciones.filter((a) => new Date(a.registradaEn) >= desde && new Date(a.registradaEn) < hasta);

  const actuales = enRango(rango.desde, rango.hasta);

  const [decisiones, diagnosticos, abastecimiento, comunidades, fichasIncompletas] =
    await Promise.all([
      decisionesPendientes(establecimientoId, ahora),
      armarDiagnosticos(establecimientoId, ahora),
      armarAbastecimiento(establecimientoId, ahora),
      armarComunidades(establecimientoId, ahora),
      prisma.paciente.count({ where: { establecimientoId, activo: true, fichaCompleta: false } }),
    ]);

  return {
    periodo: {
      clave: rango.periodo,
      etiqueta: rango.etiqueta,
      nombreAnterior: rango.nombreAnterior,
      desde: rango.desde,
      hasta: rango.hasta,
    },
    decisiones: decisiones.decisiones,
    totalAlertas: decisiones.totalAlertas,
    indicadores: armarIndicadores({
      actual: enRango(rango.desde, rango.hasta),
      anterior: enRango(rango.anterior.desde, rango.anterior.hasta),
      tendencias: armarTendencias(atenciones, rango, periodo),
      nombreAnterior: rango.nombreAnterior,
    }),
    atencionesPorDia: armarAtencionesPorDia(atenciones, rango, periodo),
    diagnosticos,
    abastecimiento,
    comunidades,
    fichasIncompletas,
    etapas: armarEtapas(actuales),
    // Calidad del dato para el SIGSA: de lo atendido en el periodo, cuanto
    // ya tiene su codigo CIE-10.
    codificacion: {
      atendidas: actuales.filter((a) => a.estado === 'atendido').length,
      codificadas: actuales.filter((a) => a.estado === 'atendido' && a.diagnosticoCie).length,
    },
  };
}

module.exports = {
  panelDireccion,
  PERIODOS_TENDENCIA,
  UMBRAL_COBERTURA_DIAS,
  FILAS,
  armarIndicadores,
  armarTendencias,
  armarAtencionesPorDia,
  esperaEnMinutos,
  inicioDeMesLocal,
  MINIMO_PARA_PROMEDIO,
  MINIMO_PERIODOS_TENDENCIA,
  REPUNTE_PORCENTAJE,
  REPUNTE_CASOS,
  HORIZONTE_COBERTURA,
  HORIZONTE_REZAGO,
  MINIMO_DIAS_GRAFICA,
  SENTIDO,
  FRASE_SIN_ANTERIOR,
  FRASE_SIN_ACTUAL,
  variacionSegura,
  aclaracionMuestra,
  fraseNeutra,
  fraseBajarEsMejor,
  tendenciaVisible,
  esRepunte,
  subidaPorcentual,
  colorCobertura,
  colorRezago,
  proporcion,
  graficaDibujable,
};
