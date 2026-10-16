const prisma = require('../config/db');
const { calcularEdad } = require('./pacientes.service');

// Grupos de edad del consolidado. PENDIENTE DE CONFIRMAR con el formato
// SIGSA vigente: el documento pide "atenciones por servicio y grupo de edad"
// pero no fija los cortes. Estan aqui, en un solo lugar, para ajustarlos.
const GRUPOS_EDAD = [
  { clave: 'menor_1', etiqueta: 'Menor de 1 año', hastaMeses: 12 },
  { clave: 'de_1_a_4', etiqueta: '1 a 4 años', hastaMeses: 60 },
  { clave: 'de_5_a_9', etiqueta: '5 a 9 años', hastaMeses: 120 },
  { clave: 'de_10_a_19', etiqueta: '10 a 19 años', hastaMeses: 240 },
  { clave: 'de_20_a_59', etiqueta: '20 a 59 años', hastaMeses: 720 },
  { clave: 'de_60_mas', etiqueta: '60 años y mas', hastaMeses: Infinity },
];

function grupoDeEdad(edadMeses) {
  return GRUPOS_EDAD.find((g) => edadMeses < g.hastaMeses) ?? GRUPOS_EDAD[GRUPOS_EDAD.length - 1];
}

function rangoDelMes(mes) {
  // mes llega como 'AAAA-MM'. Sin el, se toma el mes en curso.
  const [anio, numeroMes] = mes
    ? mes.split('-').map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1];

  const desde = new Date(anio, numeroMes - 1, 1);
  const hasta = new Date(anio, numeroMes, 1);
  return { desde, hasta, etiqueta: `${anio}-${String(numeroMes).padStart(2, '0')}` };
}

/**
 * Consolidado del mes. Se mantiene actualizado permanentemente: no hay un
 * boton de "generar", solo se consulta y se exporta lo que ya estaba armado.
 */
async function consolidadoDelMes(establecimientoId, mes) {
  const { desde, hasta, etiqueta } = rangoDelMes(mes);

  const [atenciones, movimientos, lotes, establecimiento] = await Promise.all([
    prisma.atencion.findMany({
      where: { establecimientoId, registradaEn: { gte: desde, lt: hasta }, estado: { not: 'cancelada' } },
      include: {
        paciente: { select: { fechaNacimiento: true, sexo: true, comunidad: true } },
      },
    }),
    prisma.movimientoInsumo.findMany({
      where: {
        tipo: 'salida',
        registradoEn: { gte: desde, lt: hasta },
        lote: { insumo: { establecimientoId } },
      },
      include: {
        lote: {
          include: { insumo: { select: { id: true, nombreGenerico: true, unidadMedida: true } } },
        },
      },
    }),
    prisma.lote.findMany({
      where: { insumo: { establecimientoId }, cantidadActual: { gt: 0 } },
      include: { insumo: { select: { nombreGenerico: true, unidadMedida: true, categoria: true } } },
      orderBy: { fechaVence: 'asc' },
    }),
    prisma.establecimiento.findUnique({ where: { id: establecimientoId } }),
  ]);

  const atendidas = atenciones.filter((a) => a.estado === 'atendido');

  // 1. Atenciones por grupo de edad y sexo.
  const porGrupo = new Map();
  for (const a of atendidas) {
    const { edadMeses } = calcularEdad(a.paciente.fechaNacimiento, a.registradaEn);
    const grupo = grupoDeEdad(edadMeses);
    const actual = porGrupo.get(grupo.clave) ?? { grupo: grupo.etiqueta, M: 0, F: 0, total: 0 };
    actual[a.paciente.sexo] += 1;
    actual.total += 1;
    porGrupo.set(grupo.clave, actual);
  }

  const atencionesPorGrupo = GRUPOS_EDAD.map(
    (g) => porGrupo.get(g.clave) ?? { grupo: g.etiqueta, M: 0, F: 0, total: 0 },
  );

  // 2. Diagnosticos por CIE-10.
  const porDiagnostico = new Map();
  for (const a of atendidas) {
    if (!a.diagnosticoCie) continue;
    const actual = porDiagnostico.get(a.diagnosticoCie) ?? {
      codigo: a.diagnosticoCie,
      descripcion: a.diagnosticoTxt,
      veces: 0,
    };
    actual.veces += 1;
    porDiagnostico.set(a.diagnosticoCie, actual);
  }
  const diagnosticos = [...porDiagnostico.values()].sort((a, b) => b.veces - a.veces);

  // Consultas cerradas sin codigo CIE-10. Se cuentan aparte en vez de quedar
  // fuera en silencio: quien exporta debe saber que al consolidado le faltan
  // esas atenciones antes de informarlo.
  const sinCodificar = atendidas.filter((a) => !a.diagnosticoCie).length;

  // 3. Consumo de insumos del periodo.
  const porInsumo = new Map();
  for (const m of movimientos) {
    const insumo = m.lote.insumo;
    const actual = porInsumo.get(insumo.id) ?? {
      nombreGenerico: insumo.nombreGenerico,
      unidadMedida: insumo.unidadMedida,
      consumo: 0,
    };
    actual.consumo += Math.abs(m.cantidad);
    porInsumo.set(insumo.id, actual);
  }
  const consumoInsumos = [...porInsumo.values()].sort((a, b) => b.consumo - a.consumo);

  // 4. Existencias por lote.
  const existencias = lotes.map((l) => ({
    nombreGenerico: l.insumo.nombreGenerico,
    categoria: l.insumo.categoria,
    numeroLote: l.numeroLote,
    fechaVence: l.fechaVence,
    cantidadActual: l.cantidadActual,
    unidadMedida: l.insumo.unidadMedida,
  }));

  // 5. Tiempos de espera promedio por categoria de prioridad.
  const porGravedad = new Map();
  for (const a of atendidas) {
    if (!a.iniciadaEn) continue;
    const espera = (new Date(a.iniciadaEn) - new Date(a.reingresoEn ?? a.registradaEn)) / 60000;
    const actual = porGravedad.get(a.gravedad) ?? { gravedad: a.gravedad, suma: 0, casos: 0 };
    actual.suma += espera;
    actual.casos += 1;
    porGravedad.set(a.gravedad, actual);
  }

  const tiemposEspera = ['urgente', 'moderado', 'leve'].map((gravedad) => {
    const d = porGravedad.get(gravedad);
    return {
      gravedad,
      casos: d?.casos ?? 0,
      // Sin casos no se inventa un promedio.
      promedioMin: d && d.casos > 0 ? Math.round(d.suma / d.casos) : null,
    };
  });

  return {
    establecimiento,
    mes: etiqueta,
    desde,
    hasta,
    resumen: {
      atencionesRegistradas: atenciones.length,
      atendidas: atendidas.length,
      ausentes: atenciones.filter((a) => a.estado === 'ausente').length,
      enCola: atenciones.filter((a) => a.estado === 'en_espera').length,
      urgentes: atendidas.filter((a) => a.gravedad === 'urgente').length,
      sinCodificar,
    },
    atencionesPorGrupo,
    diagnosticos,
    consumoInsumos,
    existencias,
    tiemposEspera,
  };
}

module.exports = { GRUPOS_EDAD, grupoDeEdad, rangoDelMes, consolidadoDelMes };
