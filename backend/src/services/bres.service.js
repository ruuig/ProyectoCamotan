const prisma = require('../config/db');
const { demandaReal, periodoDe } = require('./logistica.service');
const { configuracion, limitesDePeriodo } = require('./abastecimiento.service');
const { balance } = require('./bodegaDatos.service');

/**
 * BRES: Balance, Requisicion y Envio de Suministros.
 *
 * Es el informe mensual oficial con el que el servicio reporta lo que se
 * movio y pide lo que necesita. El sistema lo arma solo desde los
 * movimientos, asi que nadie tiene que sumar a mano y el numero que se envia
 * al area de salud es el mismo que el de la tarjeta de control.
 *
 * Las cifras se congelan al generarlo. Un BRES que cambia despues de enviarse
 * deja de cuadrar con el que recibio el area de salud, y entonces el saldo
 * inicial del mes siguiente ya no coincide con nada.
 */

// Columnas del BRES del centro (MD/Bodega.md seccion 7), con la letra que
// tienen en el Excel de impresion.
const COLUMNAS = [
  { clave: 'codigoInterno', etiqueta: 'Código' },
  { clave: 'nombre', etiqueta: 'Insumo' },
  { clave: 'unidadEntrega', etiqueta: 'Unidad' },
  { clave: 'saldoInicial', letra: 'B', etiqueta: 'Saldo anterior' },
  { clave: 'entradas', letra: 'C', etiqueta: 'Entradas' },
  { clave: 'entregado', letra: 'D', etiqueta: 'Entregado a usuarios' },
  { clave: 'noEntregado', letra: 'E', etiqueta: 'No entregado' },
  { clave: 'demandaReal', letra: 'F', etiqueta: 'Demanda' },
  { clave: 'reajustes', letra: 'G', etiqueta: 'Reajustes' },
  { clave: 'saldoFinal', letra: 'H', etiqueta: 'Saldo siguiente del municipio' },
  { clave: 'existenciaBodega', letra: 'I', etiqueta: 'Existencia física en bodega' },
  { clave: 'pmdr', letra: 'J', etiqueta: 'Promedio' },
  { clave: 'med', letra: 'K', etiqueta: 'Meses de existencia' },
  { clave: 'cantidadMaxima', letra: 'L', etiqueta: 'Máximo' },
  { clave: 'cantidadSolicitar', letra: 'M', etiqueta: 'Cantidad a pedir' },
];

function fallo(status, codigo, mensaje) {
  const error = new Error(mensaje);
  error.status = status;
  error.codigo = codigo;
  error.mensaje = mensaje;
  return error;
}

/** El periodo anterior a uno dado. */
function periodoAnterior(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return periodoDe(new Date(Date.UTC(anio, mes - 2, 1)));
}

/**
 * Movimientos de un insumo dentro del periodo, ya clasificados por renglon
 * del BRES.
 */
function clasificar(movimientos) {
  const suma = { entradas: 0, reajustes: 0, entregado: 0, consumoInterno: 0, traslados: 0, bajas: 0 };

  for (const m of movimientos) {
    if (m.tipo === 'ingreso') suma.entradas += m.cantidad;
    else if (m.tipo === 'reajuste') suma.reajustes += m.cantidad;
    else if (m.tipo === 'entrega') suma.entregado += Math.abs(m.cantidad);
    else if (m.tipo === 'consumo_interno') suma.consumoInterno += Math.abs(m.cantidad);
    else if (m.tipo === 'traslado') suma.traslados += Math.abs(m.cantidad);
    else if (m.tipo === 'baja') suma.bajas += Math.abs(m.cantidad);
  }

  return suma;
}

/**
 * Calcula el BRES del periodo sin guardarlo, con la formula del centro.
 *
 * Es la columna de totales del balance consolidado: la bodega mas los
 * servicios. B sale del BRES anterior cuando lo hay; si no coincide con lo
 * que dicen los movimientos y los reportes, se avisa antes de imprimir.
 */
async function calcular(establecimientoId, periodo) {
  const { desde, hasta } = limitesDePeriodo(periodo);
  const anterior = periodoAnterior(periodo);

  // El balance ya trae los totales: los guardados si el BRES se cerro, y los
  // calculados con las formulas del centro si esta abierto.
  const [consolidado, bresAnterior] = await Promise.all([
    balance(establecimientoId, periodo),
    prisma.bres.findUnique({
      where: { establecimientoId_periodo: { establecimientoId, periodo: anterior } },
      include: { renglones: true },
    }),
  ]);
  const congelado = consolidado.cerrado;

  const saldoAnteriorPorInsumo = new Map((bresAnterior?.renglones ?? []).map((r) => [r.insumoId, r.saldoFinal]));
  const descuadres = [];

  const renglones = consolidado.filas.map((f) => {
    const b = f.bres;
    if (!congelado && saldoAnteriorPorInsumo.has(f.insumoId) && saldoAnteriorPorInsumo.get(f.insumoId) !== b.B) {
      descuadres.push({
        insumoId: f.insumoId,
        nombre: f.nombre,
        saldoSegunBresAnterior: saldoAnteriorPorInsumo.get(f.insumoId),
        saldoSegunMovimientos: b.B,
        diferencia: saldoAnteriorPorInsumo.get(f.insumoId) - b.B,
      });
    }
    return {
      insumoId: f.insumoId,
      codigoInterno: f.codigoInterno,
      nombre: f.nombre,
      formaFarmaceutica: f.formaFarmaceutica,
      concentracion: f.concentracion,
      unidadEntrega: f.unidadEntrega,
      categoria: f.categoria,
      saldoInicial: b.B,
      entradas: b.C,
      entregado: b.D,
      noEntregado: b.E,
      demandaReal: b.F,
      reajustes: b.G,
      saldoFinal: b.H,
      existenciaBodega: b.I,
      pmdr: b.J,
      med: b.K,
      cantidadMaxima: b.L,
      cantidadSolicitar: b.M,
      saldoPorDemanda: b.saldoPorDemanda,
      existenciaMesAnterior: b.mesAnterior,
      cantidadMinima: b.minimo,
      bajoMinimo: b.bajoMinimo,
      sinConsumo: b.sinConsumo,
      mesesHistoria: b.mesesConDatos,
      // El consumo interno va en D y las bajas en G: el BRES del centro no
      // tiene columnas aparte para eso.
      consumoInterno: 0,
      traslados: 0,
      bajas: 0,
    };
  });

  // Observaciones de recepcion del periodo: diferencias contra el documento.
  const lotesDelPeriodo = await prisma.lote.findMany({
    where: {
      insumo: { establecimientoId },
      recibidoEn: { gte: desde, lt: hasta },
      NOT: { cantidadDocumento: null },
    },
    include: { insumo: { select: { nombreGenerico: true } } },
  });

  const observacionesRecepcion = lotesDelPeriodo
    .filter((l) => l.cantidadDocumento !== l.cantidadInicial)
    .map((l) => ({
      insumo: l.insumo.nombreGenerico,
      numeroLote: l.numeroLote,
      segunDocumento: l.cantidadDocumento,
      recibido: l.cantidadInicial,
      diferencia: l.cantidadInicial - l.cantidadDocumento,
      observacion: l.observacionRecepcion,
    }));

  const config = await configuracion(establecimientoId);
  return {
    periodo,
    periodoAnterior: anterior,
    hayBresAnterior: Boolean(bresAnterior),
    columnas: COLUMNAS,
    renglones,
    descuadres,
    observacionesRecepcion,
    serviciosSinReporte: consolidado.pendientesDeReporte,
    // Casillas del formulario: servicios que deben reportar (post-consulta
    // incluido) y cuantos reportaron. Post-consulta reporta por el sistema.
    serviciosTotal: consolidado.servicios.length + 1,
    serviciosReportaron: consolidado.servicios.filter((s) => s.reportado).length + 1,
    provisional: config.provisional,
    configuracion: consolidado.configuracion,
    firmas: consolidado.firmas,
  };
}

/**
 * Genera y guarda el BRES del periodo, congelando sus cifras.
 */
async function generar(establecimientoId, { periodo, observaciones, usuarioId }, ahora = new Date()) {
  const existente = await prisma.bres.findUnique({
    where: { establecimientoId_periodo: { establecimientoId, periodo } },
  });

  if (existente && existente.estado === 'cerrado') {
    throw fallo(
      409,
      'bres_cerrado',
      `El BRES de ${periodo} ya está cerrado. Sus cifras no se pueden cambiar`,
    );
  }

  const calculado = await calcular(establecimientoId, periodo, ahora);

  return prisma.$transaction(async (tx) => {
    const bres = existente
      ? await tx.bres.update({
          where: { id: existente.id },
          data: { observaciones, generadoPor: usuarioId, generadoEn: new Date() },
        })
      : await tx.bres.create({
          data: { establecimientoId, periodo, observaciones, generadoPor: usuarioId },
        });

    // Se rehacen los renglones: mientras este en borrador refleja el estado
    // actual, y al cerrarlo quedan congelados.
    await tx.bresRenglon.deleteMany({ where: { bresId: bres.id } });

    for (const r of calculado.renglones) {
      await tx.bresRenglon.create({
        data: {
          bresId: bres.id,
          insumoId: r.insumoId,
          saldoInicial: r.saldoInicial,
          entradas: r.entradas,
          reajustes: r.reajustes,
          entregado: r.entregado,
          consumoInterno: r.consumoInterno,
          noEntregado: r.noEntregado,
          demandaReal: r.demandaReal,
          saldoFinal: r.saldoFinal,
          existenciaBodega: r.existenciaBodega,
          pmdr: r.pmdr,
          med: r.med,
          cantidadMinima: r.cantidadMinima,
          cantidadMaxima: r.cantidadMaxima,
          cantidadSolicitar: r.cantidadSolicitar,
          saldoPorDemanda: r.saldoPorDemanda,
          existenciaMesAnterior: r.existenciaMesAnterior,
          mesesHistoria: r.mesesHistoria,
        },
      });
    }

    return { bres, ...calculado };
  });
}

/** Cierra el BRES: a partir de aqui sus cifras ya no cambian. */
async function cerrar(establecimientoId, periodo) {
  const bres = await prisma.bres.findUnique({
    where: { establecimientoId_periodo: { establecimientoId, periodo } },
  });

  if (!bres) throw fallo(404, 'no_encontrado', 'Ese BRES no se ha generado');
  if (bres.estado === 'cerrado') {
    throw fallo(409, 'bres_cerrado', 'Ese BRES ya está cerrado');
  }

  return prisma.bres.update({
    where: { id: bres.id },
    data: { estado: 'cerrado', cerradoEn: new Date() },
  });
}

/** El BRES guardado de un periodo, con sus renglones congelados. */
async function obtener(establecimientoId, periodo) {
  return prisma.bres.findUnique({
    where: { establecimientoId_periodo: { establecimientoId, periodo } },
    include: {
      renglones: {
        include: {
          insumo: {
            select: { codigoInterno: true, nombreGenerico: true, unidadEntrega: true, formaFarmaceutica: true, concentracion: true },
          },
        },
      },
      usuario: { select: { nombre: true } },
    },
  });
}

/**
 * Registro diario de demanda real: lo entregado y lo no entregado por insumo
 * cada dia. Se deriva de los movimientos, no se captura.
 */
async function registroDiario(establecimientoId, periodo) {
  const { desde, hasta } = limitesDePeriodo(periodo);

  const [entregas, faltantes] = await Promise.all([
    prisma.movimientoInsumo.findMany({
      where: {
        tipo: 'entrega',
        registradoEn: { gte: desde, lt: hasta },
        lote: { insumo: { establecimientoId } },
      },
      include: { lote: { include: { insumo: { select: { id: true, nombreGenerico: true, unidadEntrega: true } } } } },
    }),
    prisma.demandaNoAtendida.findMany({
      where: { establecimientoId, registradaEn: { gte: desde, lt: hasta } },
      include: { insumo: { select: { id: true, nombreGenerico: true, unidadEntrega: true } } },
    }),
  ]);

  const porDia = new Map();
  const clave = (fecha) => new Date(fecha).toISOString().slice(0, 10);

  const asegurar = (dia, insumo) => {
    if (!porDia.has(dia)) porDia.set(dia, new Map());
    const delDia = porDia.get(dia);
    if (!delDia.has(insumo.id)) {
      delDia.set(insumo.id, {
        insumoId: insumo.id,
        nombre: insumo.nombreGenerico,
        unidadEntrega: insumo.unidadEntrega,
        entregado: 0,
        noEntregado: 0,
      });
    }
    return delDia.get(insumo.id);
  };

  for (const e of entregas) {
    asegurar(clave(e.registradoEn), e.lote.insumo).entregado += Math.abs(e.cantidad);
  }
  for (const f of faltantes) {
    asegurar(clave(f.registradaEn), f.insumo).noEntregado += f.cantidad;
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, insumos]) => ({
      dia,
      insumos: [...insumos.values()].map((i) => ({
        ...i,
        demandaReal: demandaReal(i.entregado, i.noEntregado),
      })),
    }));
}

module.exports = {
  COLUMNAS,
  periodoAnterior,
  clasificar,
  calcular,
  generar,
  cerrar,
  obtener,
  registroDiario,
};
