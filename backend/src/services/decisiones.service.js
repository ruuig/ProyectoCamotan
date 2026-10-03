const prisma = require('../config/db');
const { existenciaTotal, diasParaVencer } = require('./inventario.service');
const { diasCobertura, excedenteProyectado } = require('./indicadores.service');
const { consumoDiario } = require('./consumo.service');

/**
 * Decisiones pendientes del panel de direccion.
 *
 * Es el bloque que va primero, porque es lo unico de la pantalla sobre lo que
 * hay que hacer algo hoy. Toma las alertas abiertas, se queda con las que
 * piden una decision de direccion y las redacta como una accion con su cifra.
 *
 * Las alertas de paciente (desnutricion, cita vencida, patron clinico) no
 * entran aqui: se resuelven en la consulta, no en la direccion. Aparecen en
 * el listado completo de alertas.
 */

const MS_POR_DIA = 86400000;

// Cuantas decisiones caben en la fila. Mas de tres dejan de ser decisiones y
// vuelven a ser una lista.
const MAXIMO = 3;

// Orden entre severidades: primero lo alto.
const PESO_SEVERIDAD = { alta: 0, media: 1, baja: 2 };

/**
 * Orden entre tipos dentro de una misma severidad. Sigue el criterio de la
 * direccion: quedarse sin un insumo detiene la atencion hoy; un lote por
 * vencer se puede redistribuir; una comunidad sin visitar se programa.
 */
const PESO_TIPO = {
  // Quedarse sin nada detiene la atencion hoy; estar bajo el minimo avisa
  // con tiempo; un lote por vencer se puede redistribuir; una comunidad sin
  // visitar se programa.
  desabastecimiento: 0,
  existencia_baja: 1,
  vencimiento: 2,
  comunidad_sin_atencion: 3,
};

const TIPOS_DE_DECISION = Object.keys(PESO_TIPO);

const CATEGORIA = {
  desabastecimiento: 'Desabastecimiento',
  existencia_baja: 'Existencia baja',
  vencimiento: 'Vencimiento',
  comunidad_sin_atencion: 'Cobertura territorial',
};

const ACCION = {
  desabastecimiento: 'despacho_solicitado',
  existencia_baja: 'despacho_solicitado',
  vencimiento: 'lote_revisado',
  comunidad_sin_atencion: 'visita_programada',
};

// Que dice la tarjeta cuando alguien ya actuo y la causa sigue viva.
const GESTION = {
  despacho_solicitado: 'Despacho solicitado',
  lote_revisado: 'Lote revisado',
  visita_programada: 'Visita programada',
};

/**
 * Compara dos decisiones ya medidas.
 *
 * `metrica` es el numero que ordena dentro del tipo, siempre en el sentido de
 * "mas urgente primero": menos dias de cobertura, menos dias para vencer,
 * mas dias sin atencion. Por eso la de comunidad se guarda negada, y aqui se
 * compara siempre de menor a mayor.
 */
function compararDecisiones(a, b) {
  const severidad = (PESO_SEVERIDAD[a.severidad] ?? 9) - (PESO_SEVERIDAD[b.severidad] ?? 9);
  if (severidad !== 0) return severidad;

  const tipo = (PESO_TIPO[a.tipo] ?? 9) - (PESO_TIPO[b.tipo] ?? 9);
  if (tipo !== 0) return tipo;

  const metrica = (a.metrica ?? Infinity) - (b.metrica ?? Infinity);
  if (metrica !== 0) return metrica;

  // Empate real: primero la mas antigua, que lleva mas tiempo esperando.
  return new Date(a.generadaEn) - new Date(b.generadaEn);
}

/** Dias enteros entre dos instantes, sin decimales que nadie va a leer. */
function diasEntre(desde, hasta) {
  return Math.floor((new Date(hasta) - new Date(desde)) / MS_POR_DIA);
}

/**
 * Frase que describe la gestion en curso.
 *
 * "Despacho solicitado por Ana Lopez el 29/09/2026". Sin nombre no se
 * inventa uno: se dice solo la fecha.
 */
function describirGestion(alerta) {
  if (alerta.estado !== 'en_gestion' || !alerta.estadoEn) return null;

  const etiqueta = GESTION[alerta.accion] ?? 'En gestión';
  const fecha = new Date(alerta.estadoEn).toLocaleDateString('es-GT');
  return alerta.nombreUsuario
    ? `${etiqueta} por ${alerta.nombreUsuario} el ${fecha}`
    : `${etiqueta} el ${fecha}`;
}

/** Plural del castellano para las unidades contables de la tarjeta. */
function pluralizar(cantidad, singular, plural) {
  return cantidad === 1 ? singular : plural;
}

// --- Redaccion de cada tipo ------------------------------------------------

/**
 * Tarjeta de desabastecimiento.
 *
 * La cifra son los dias que alcanza la existencia al consumo actual. Si no
 * hay historial de consumo no se puede calcular, y entonces la cifra es el
 * saldo: decir "0 dias" seria afirmar algo que no se sabe.
 */
function decisionExistencia({ insumo, saldo, diasCobertura, diasProximoDespacho }) {
  const sinExistencia = saldo === 0;
  // Sin existencia la cobertura es cero dias, y eso si se puede afirmar sin
  // historial de consumo: no queda nada que consumir.
  const dias = sinExistencia ? 0 : diasCobertura;
  const enDias = dias !== null;

  const contexto = sinExistencia
    ? `Sin existencia. El próximo despacho del área de salud llega en ${diasProximoDespacho} días.`
    : enDias
      ? `El próximo despacho del área de salud llega en ${diasProximoDespacho} días. Quedan ${saldo} ${insumo.unidadMedida}.`
      : `Quedan ${saldo} ${insumo.unidadMedida}, bajo el mínimo de ${insumo.stockMinimo}. Sin consumo registrado no se puede estimar cuánto alcanzan.`;

  return {
    categoria: sinExistencia ? CATEGORIA.desabastecimiento : CATEGORIA.existencia_baja,
    accion: `Solicitar despacho de ${insumo.nombreGenerico}`,
    cifra: enDias ? dias : saldo,
    unidad: enDias ? pluralizar(dias, 'día', 'días') : insumo.unidadMedida,
    descripcionCifra: enDias ? 'de cobertura' : 'en existencia',
    contexto,
    boton: 'Solicitar despacho',
    ruta: `/inventario/${insumo.id}`,
    codigoAccion: ACCION.existencia_baja,
  };
}

/**
 * Tarjeta de vencimiento.
 *
 * La cifra es lo que se va a perder si nadie lo mueve, no lo que hay: el
 * excedente proyectado al consumo actual. Sin historial no hay proyeccion y
 * la cifra pasa a ser la existencia completa del lote.
 */
function decisionVencimiento({ insumo, lote, diasParaVencer, excedente }) {
  const cantidad = excedente ?? lote.cantidadActual;
  const vencido = diasParaVencer <= 0;

  const contexto = vencido
    ? `El lote venció hace ${Math.abs(diasParaVencer)} ${pluralizar(Math.abs(diasParaVencer), 'día', 'días')} y sigue en existencia.`
    : excedente === null
      ? `Vence en ${diasParaVencer} ${pluralizar(diasParaVencer, 'día', 'días')}. Sin consumo registrado no se puede proyectar cuánto se alcanzará a entregar.`
      : `Vencen en ${diasParaVencer} ${pluralizar(diasParaVencer, 'día', 'días')} y al consumo actual no se alcanzarán a entregar.`;

  return {
    categoria: CATEGORIA.vencimiento,
    accion: `Redistribuir el lote ${lote.numeroLote}`,
    cifra: cantidad,
    unidad: insumo.unidadMedida,
    descripcionCifra: vencido ? 'vencidas' : 'sin usar',
    contexto,
    boton: 'Ver lote',
    ruta: `/inventario/${insumo.id}`,
    codigoAccion: ACCION.vencimiento,
  };
}

/**
 * Tarjeta de cobertura territorial.
 *
 * Los menores de cinco son lo que convierte el dato en una decision: una
 * comunidad con veinte adultos y una con cinco ninos pequenos no pesan igual.
 */
function decisionComunidad({ lugar, diasSinAtencion, pacientes, menoresDeCinco }) {
  const nunca = diasSinAtencion === null;
  const nombre = lugar.sector ? `${lugar.nombre} (${lugar.sector})` : lugar.nombre;

  const contexto = `La comunidad tiene ${pacientes} ${pluralizar(pacientes, 'paciente registrado', 'pacientes registrados')}`
    + (menoresDeCinco > 0
      ? `, ${menoresDeCinco} de ellos ${pluralizar(menoresDeCinco, 'menor', 'menores')} de 5 años.`
      : ', ninguno menor de 5 años.');

  return {
    categoria: CATEGORIA.comunidad_sin_atencion,
    accion: `Programar visita a ${lugar.nombre}`,
    cifra: nunca ? null : diasSinAtencion,
    unidad: nunca ? null : pluralizar(diasSinAtencion, 'día', 'días'),
    descripcionCifra: nunca ? null : 'sin atenciones',
    textoSinCifra: nunca ? 'Nunca atendida' : null,
    contexto: `${nombre}. ${contexto}`,
    boton: 'Ver comunidad',
    ruta: `/pacientes?lugarPobladoId=${lugar.id}`,
    codigoAccion: ACCION.comunidad_sin_atencion,
  };
}


// --- Armado desde la base --------------------------------------------------

// Cada cuanto llega el despacho del almacen departamental.
// PENDIENTE DE CONFIRMAR con el area de salud: se asume mensual.
const DIAS_PROXIMO_DESPACHO = 30;

const EDAD_MENOR = 5;

/** Mide una alerta de existencia y la redacta como decision. */
async function medirExistencia(alerta, ahora) {
  const insumo = await prisma.insumo.findUnique({
    where: { id: alerta.entidadId },
    include: { lotes: true },
  });
  if (!insumo || !insumo.activo) return null;

  const saldo = existenciaTotal(insumo.lotes, ahora);
  const consumo = await consumoDiario(insumo.id, ahora);
  const dias = consumo.historialSuficiente ? diasCobertura(saldo, consumo.consumoDia) : null;

  return {
    ...decisionExistencia({
      insumo,
      saldo,
      diasCobertura: dias,
      diasProximoDespacho: DIAS_PROXIMO_DESPACHO,
    }),
    // Sin existencia es lo mas urgente que puede pasar. Sin historial de
    // consumo no compite por el primer puesto: no se puede afirmar que sea
    // mas urgente que otra que si se midio.
    metrica: saldo === 0 ? 0 : (dias ?? Infinity),
  };
}

/** Mide una alerta de vencimiento y la redacta como decision. */
async function medirVencimiento(alerta, ahora) {
  const lote = await prisma.lote.findUnique({
    where: { id: alerta.entidadId },
    include: { insumo: true },
  });
  if (!lote || lote.cantidadActual <= 0) return null;

  const consumo = await consumoDiario(lote.insumoId, ahora);
  const dias = diasParaVencer(lote.fechaVence, ahora);
  const excedente = consumo.historialSuficiente
    ? excedenteProyectado(lote.cantidadActual, consumo.consumoDia, lote.fechaVence, ahora)
    : null;

  return {
    ...decisionVencimiento({ insumo: lote.insumo, lote, diasParaVencer: dias, excedente }),
    metrica: dias,
  };
}

/** Mide una alerta de cobertura territorial y la redacta como decision. */
async function medirComunidad(alerta, ahora) {
  const lugar = await prisma.lugarPoblado.findUnique({ where: { id: alerta.entidadId } });
  if (!lugar || !lugar.activo) return null;

  const pacientes = await prisma.paciente.findMany({
    where: { establecimientoId: alerta.establecimientoId, activo: true, lugarPobladoId: lugar.id },
    select: {
      fechaNacimiento: true,
      atenciones: {
        where: { estado: 'atendido' },
        orderBy: { registradaEn: 'desc' },
        take: 1,
        select: { registradaEn: true },
      },
    },
  });
  if (pacientes.length === 0) return null;

  let ultima = null;
  for (const p of pacientes) {
    const fecha = p.atenciones[0]?.registradaEn ?? null;
    if (fecha && (!ultima || new Date(fecha) > new Date(ultima))) ultima = fecha;
  }

  const limiteMenor = new Date(ahora);
  limiteMenor.setFullYear(limiteMenor.getFullYear() - EDAD_MENOR);
  const menoresDeCinco = pacientes.filter((p) => new Date(p.fechaNacimiento) > limiteMenor).length;

  const dias = ultima ? diasEntre(ultima, ahora) : null;

  return {
    ...decisionComunidad({
      lugar,
      diasSinAtencion: dias,
      pacientes: pacientes.length,
      menoresDeCinco,
    }),
    // Mas dias sin atencion es mas urgente, y el orden compara de menor a
    // mayor: por eso se guarda negado. La nunca atendida es la mas urgente.
    metrica: dias === null ? -Infinity : -dias,
  };
}

const MEDIDORES = {
  desabastecimiento: medirExistencia,
  existencia_baja: medirExistencia,
  vencimiento: medirVencimiento,
  comunidad_sin_atencion: medirComunidad,
};

/**
 * Las decisiones pendientes del establecimiento.
 *
 * Devuelve las tres mas urgentes ya redactadas, y el total de alertas
 * abiertas, que es el numero del enlace "Ver las N alertas".
 */
async function decisionesPendientes(establecimientoId, ahora = new Date()) {
  const [candidatas, totalAlertas] = await Promise.all([
    prisma.alerta.findMany({
      where: {
        establecimientoId,
        estado: { not: 'resuelta' },
        tipo: { in: TIPOS_DE_DECISION },
      },
      orderBy: [{ severidad: 'asc' }, { generadaEn: 'asc' }],
      include: { usuario: { select: { nombre: true } } },
    }),
    prisma.alerta.count({ where: { establecimientoId, estado: { not: 'resuelta' } } }),
  ]);

  const medidas = [];
  for (const alerta of candidatas) {
    const medir = MEDIDORES[alerta.tipo];
    const decision = await medir(alerta, ahora);
    // La causa ya no existe: el proceso horario la resolvera, y mientras
    // tanto no se muestra una decision sobre algo que ya no esta.
    if (!decision) continue;

    medidas.push({
      id: alerta.id,
      tipo: alerta.tipo,
      severidad: alerta.severidad,
      estado: alerta.estado,
      generadaEn: alerta.generadaEn,
      gestion: describirGestion({ ...alerta, nombreUsuario: alerta.usuario?.nombre }),
      ...decision,
    });
  }

  medidas.sort(compararDecisiones);

  return { decisiones: medidas.slice(0, MAXIMO), totalAlertas };
}

module.exports = {
  MAXIMO,
  DIAS_PROXIMO_DESPACHO,
  decisionesPendientes,
  MS_POR_DIA,
  PESO_SEVERIDAD,
  PESO_TIPO,
  TIPOS_DE_DECISION,
  CATEGORIA,
  ACCION,
  GESTION,
  compararDecisiones,
  diasEntre,
  describirGestion,
  pluralizar,
  decisionExistencia,
  decisionVencimiento,
  decisionComunidad,
};
