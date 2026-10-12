const prisma = require('../config/db');
const { parametros } = require('./parametrosPriorizacion.service');
const {
  ordenarCola,
  resumenCola,
  minutosEsperando,
  diaCalendario,
} = require('./priorizacion.service');

// Horario de atencion del establecimiento. No bloquea nada: solo sirve para
// avisar "fin de horario, quedan N en cola".
//
// PENDIENTE DE CONFIRMAR con el establecimiento. Esta aqui, en un solo lugar,
// para que pasarlo a configuracion por establecimiento sea un cambio menor.
const FIN_HORARIO = { hora: 16, minuto: 30 };

const INCLUIR_PACIENTE = {
  paciente: {
    select: {
      id: true,
      expediente: true,
      expedientePapel: true,
      nombres: true,
      apellidos: true,
      fechaNacimiento: true,
      // Una fecha estimada arrastra incertidumbre a todo calculo de edad, y
      // el puntaje Z depende de la edad: quien lo lea tiene que saberlo.
      fechaNacimientoEstimada: true,
      sexo: true,
      comunidad: true,
      telefono: true,
      responsableNombre: true,
      responsableParentesco: true,
      discapacidad: true,
      fichaCompleta: true,
      condiciones: { where: { vigenteHasta: null }, select: { tipo: true, vigenteHasta: true } },
      // El tiempo de viaje de su comunidad da peso en la cola.
      lugarPoblado: { select: { tiempoViajeMinutos: true } },
      // El embarazo ya no es una condicion permanente del paciente: la
      // prioridad la da el episodio mientras este activo.
      embarazos: {
        where: { estado: 'activo' },
        select: { id: true, fechaUltimaRegla: true, fechaProbableParto: true },
      },
    },
  },
  preconsulta: true,
};

/**
 * Condiciones que pesan en la cola: las registradas mas el embarazo, que vive
 * en su propio episodio y solo cuenta mientras esta activo.
 */
function condicionesDe(paciente) {
  const tipos = paciente.condiciones.map((c) => c.tipo);
  if ((paciente.embarazos ?? []).length > 0) tipos.push('embarazo');
  return tipos;
}

function horaLocal(fecha, zona = 'America/Guatemala') {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(fecha));

  const valor = (tipo) => Number(partes.find((p) => p.type === tipo).value);
  return { hora: valor('hour'), minuto: valor('minute') };
}

function pasoElHorario(ahora = new Date()) {
  const { hora, minuto } = horaLocal(ahora);
  return hora > FIN_HORARIO.hora || (hora === FIN_HORARIO.hora && minuto >= FIN_HORARIO.minuto);
}

// Da forma a lo que consume la interfaz, con el dato ya interpretado.
function aEntradaDeCola(entrada, posicion = null) {
  const { atencion, puntaje, factores, minutosEsperando: espera } = entrada;
  return {
    id: atencion.id,
    posicion,
    estado: atencion.estado,
    gravedad: atencion.gravedad,
    // Nivel con el que se ordena: sube si un leve paso su tiempo maximo.
    nivel: entrada.nivel ?? atencion.gravedad,
    subio: entrada.subio ?? false,
    excedido: entrada.excedido ?? false,
    triaje: atencion.preconsulta?.triaje ?? null,
    motivoConsulta: atencion.motivoConsulta,
    ausencias: atencion.ausencias,
    registradaEn: atencion.registradaEn,
    reingresoEn: atencion.reingresoEn,
    puntaje,
    factores: factores ?? [],
    minutosEsperando: espera,
    tienePreconsulta: Boolean(atencion.preconsulta),
    paciente: atencion.paciente && {
      id: atencion.paciente.id,
      expediente: atencion.paciente.expediente,
      expedientePapel: atencion.paciente.expedientePapel,
      nombreCompleto: `${atencion.paciente.apellidos}, ${atencion.paciente.nombres}`,
      comunidad: atencion.paciente.comunidad,
      condiciones: condicionesDe(atencion.paciente),
    },
  };
}

/**
 * Cola vigente. El puntaje se calcula al leer, nunca con un UPDATE masivo.
 */
async function obtenerCola(establecimientoId, ahora = new Date()) {
  const [enEspera, enAtencion] = await Promise.all([
    prisma.atencion.findMany({
      where: { establecimientoId, estado: 'en_espera' },
      include: INCLUIR_PACIENTE,
    }),
    prisma.atencion.findMany({
      where: { establecimientoId, estado: 'en_atencion' },
      include: INCLUIR_PACIENTE,
    }),
  ]);

  const { puntos } = await parametros(establecimientoId);
  const ordenada = ordenarCola(enEspera, ahora, puntos);
  const resumen = resumenCola(ordenada);

  return {
    cola: ordenada.map((e, i) => aEntradaDeCola(e, i + 1)),
    tiempoMaximo: puntos.tiempoMaximo,
    enAtencion: enAtencion.map((a) =>
      aEntradaDeCola({ atencion: a, puntaje: 0, minutosEsperando: minutosEsperando(a, ahora) }),
    ),
    resumen: {
      enEspera: resumen.enEspera,
      esperaPromedio: resumen.esperaPromedio,
      esperaMaxima: resumen.esperaMaxima,
      masAntiguo: resumen.masAntiguo ? aEntradaDeCola(resumen.masAntiguo) : null,
      superan90: resumen.superan90.length,
    },
    // La jornada no se cierra con pacientes en cola: solo se avisa.
    jornada: {
      finDeHorario: pasoElHorario(ahora),
      aviso:
        pasoElHorario(ahora) && resumen.enEspera > 0
          ? `Fin de horario: ${resumen.enEspera} pacientes aun en cola, espera del más antiguo: ${resumen.esperaMaxima} minutos`
          : null,
    },
  };
}

/**
 * Resumen del dia para el panel del medico, al vaciarse la cola.
 */
async function resumenDelDia(establecimientoId, ahora = new Date()) {
  const dia = diaCalendario(ahora);
  const inicio = new Date(`${dia}T00:00:00-06:00`);
  const fin = new Date(inicio.getTime() + 86400000);

  const atenciones = await prisma.atencion.findMany({
    // Las canceladas fueron un error de registro: no son pacientes del dia.
    where: { establecimientoId, registradaEn: { gte: inicio, lt: fin }, estado: { not: 'cancelada' } },
    select: {
      estado: true,
      gravedad: true,
      iniciadaEn: true,
      cerradaEn: true,
    },
  });

  const atendidas = atenciones.filter((a) => a.estado === 'atendido');
  const duraciones = atendidas
    .filter((a) => a.iniciadaEn && a.cerradaEn)
    .map((a) => (new Date(a.cerradaEn) - new Date(a.iniciadaEn)) / 60000);

  return {
    fecha: dia,
    atendidos: atendidas.length,
    urgentesAtendidos: atendidas.filter((a) => a.gravedad === 'urgente').length,
    ausentes: atenciones.filter((a) => a.estado === 'ausente').length,
    enCola: atenciones.filter((a) => a.estado === 'en_espera').length,
    duracionPromedioMin:
      duraciones.length > 0
        ? Math.round(duraciones.reduce((s, n) => s + n, 0) / duraciones.length)
        : null,
  };
}

module.exports = {
  FIN_HORARIO,
  INCLUIR_PACIENTE,
  horaLocal,
  pasoElHorario,
  aEntradaDeCola,
  obtenerCola,
  resumenDelDia,
};
