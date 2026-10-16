const ExcelJS = require('exceljs');
const { encabezadoEstablecimiento } = require('../services/encabezado.service');
const prisma = require('../config/db');
const { renglonesSigsa3cs } = require('../services/sigsa3cs.service');
const { puedeVerSensibles } = require('../services/fichaPaciente.service');

/**
 * FOR-SIGSA-3CS del centro: consultas cerradas en un rango de dias, de todos
 * los medicos o de uno. Se imprime para sellarlo y se exporta a Excel para
 * subirlo al SIGSA web.
 */

/** Limites de un rango de dias en hora de Guatemala (UTC-6). */
function rango(desde, hasta) {
  const inicio = new Date(`${desde}T06:00:00.000Z`);
  const fin = new Date(new Date(`${hasta}T06:00:00.000Z`).getTime() + 86400000);
  return { inicio, fin };
}

async function datos3cs(req) {
  const establecimientoId = req.usuario.establecimientoId;
  const { desde, hasta, medicoId } = req.query;
  const { inicio, fin } = rango(desde, hasta);
  const atenciones = await prisma.atencion.findMany({
    where: {
      establecimientoId,
      estado: 'atendido',
      cerradaEn: { gte: inicio, lt: fin },
      ...(medicoId ? { atendidaPor: Number(medicoId) } : {}),
    },
    include: {
      paciente: { include: { lugarPoblado: { select: { nombre: true } } } },
      diagnosticos: true,
      prescripciones: { include: { insumo: { select: { nombreGenerico: true, presentacion: true } } } },
      recetasExternas: { orderBy: { creadaEn: 'asc' } },
      medico: { select: { id: true, nombre: true } },
    },
  });
  const [establecimiento, medico] = await Promise.all([
    prisma.establecimiento.findUnique({ where: { id: establecimientoId } }),
    medicoId ? prisma.usuario.findFirst({ where: { id: Number(medicoId), establecimientoId }, select: { nombre: true, cargo: true } }) : null,
  ]);
  const renglones = renglonesSigsa3cs(atenciones, { sensibles: puedeVerSensibles(req.usuario) });
  const sinCodigo = (r) => !r.diagnosticos.some((d) => d.cie);
  const porAtencion = new Map(renglones.map((r) => [r.atencionId, r]));
  const porMedico = new Map();
  for (const a of atenciones) {
    if (!a.medico) continue;
    const m = porMedico.get(a.medico.id) ?? { medicoId: a.medico.id, nombre: a.medico.nombre, consultas: 0, sinCie: 0 };
    m.consultas += 1;
    if (sinCodigo(porAtencion.get(a.id) ?? { diagnosticos: [] })) m.sinCie += 1;
    porMedico.set(a.medico.id, m);
  }
  return {
    desde,
    hasta,
    encabezado: {
      ...encabezadoEstablecimiento(establecimiento),
      responsable: medico?.nombre ?? null,
      cargo: medico?.cargo ?? null,
    },
    renglones,
    // Se entrega un 3C/S por responsable: cuántas consultas tiene cada uno y
    // cuántas van sin código CIE-10, que el distrito rechazaría.
    porResponsable: [...porMedico.values()],
    sinCie: renglones.filter(sinCodigo).length,
  };
}

async function sigsa3cs(req, res) {
  const d = await datos3cs(req);
  await req.bitacora({ accion: 'leer', entidad: 'sigsa3cs', detalle: `SIGSA-3CS del ${d.desde} al ${d.hasta}` });
  res.json(d);
}

/** Medicos que cerraron consultas: para elegir de quien es la hoja. */
async function medicos(req, res) {
  const lista = await prisma.usuario.findMany({
    where: { establecimientoId: req.usuario.establecimientoId, atencionesAtendidas: { some: {} } },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
  res.json({ medicos: lista });
}

const COLUMNAS = [
  ['Día de la consulta', 8], ['No. historia clínica', 12], ['Nombres y apellidos del paciente', 30], ['CUI', 16],
  ['1/ Sexo', 6], ['2/ Pueblo', 7], ['3/ Comunidad lingüística', 9], ['4/ Nacimiento: día', 7], ['Mes', 5], ['Año', 6],
  ['5/ Discapacidad', 9], ['6/ Orientación sexual', 9], ['7/ Escolaridad', 9], ['8/ Profesión u oficio', 16],
  ['Comunidad y/o dirección exacta', 22], ['Municipio', 14], ['9/ Agrícola migrante', 8], ['10/ Consulta', 8], ['11/ Control', 7],
  ['12/ Semana de gestación', 8], ['13/ Viene', 6], ['14/ Fue', 6], ['Referido a', 16],
  ['Descripción diagnóstico/control', 34], ['Código CIE-10', 10],
  ['Tratamiento: descripción', 34], ['Presentación', 14], ['Cantidad recetada', 9],
  ['15/ Lugar de notificación', 9], ['Número de notificación', 12], ['Nombres y apellidos del acompañante', 24],
];

/** Varios valores en una misma celda, uno por línea, como se escribe a mano. */
const unoPorLinea = (lista, campo) => lista.map((elemento) => elemento[campo]).join('\n');

/** Valores de una fila de la hoja, en el orden de las columnas del formulario. */
function filaDelRenglon(renglon) {
  const { nacimiento, diagnosticos, tratamiento } = renglon;
  return [
    renglon.dia, renglon.historiaClinica, renglon.nombre, renglon.cui,
    renglon.sexo, renglon.pueblo, renglon.comunidadLinguistica,
    nacimiento.dia, nacimiento.mes, nacimiento.anio,
    renglon.discapacidad, renglon.orientacionSexual, renglon.escolaridad, renglon.profesion,
    renglon.comunidad, renglon.municipio, renglon.migrante,
    renglon.consulta, renglon.control, renglon.semanasGestacion,
    renglon.viene, renglon.fue, renglon.referidoA,
    unoPorLinea(diagnosticos, 'descripcion'), unoPorLinea(diagnosticos, 'cie'),
    unoPorLinea(tratamiento, 'descripcion'), unoPorLinea(tratamiento, 'presentacion'),
    unoPorLinea(tratamiento, 'cantidad'),
    renglon.notificacionLugar, renglon.notificacionNumero, renglon.acompanante,
  ];
}

/** Las filas del encabezado del formulario, sobre la tabla. */
function escribirEncabezado(hoja, { encabezado, desde, hasta }) {
  hoja.addRow(['FOR-SIGSA-3CS · Registro diario de consulta en centro de salud']);
  hoja.addRow([
    `Área de Salud: ${encabezado.areaSalud}`, '', '', `Distrito de Salud: ${encabezado.distrito}`, '', '', '',
    `Municipio: ${encabezado.municipio}`, '', '', '', `Servicio de Salud: ${encabezado.servicio}`,
  ]);
  hoja.addRow([
    `Responsable de la información: ${encabezado.responsable ?? ''}`, '', '',
    `Cargo: ${encabezado.cargo ?? ''}`, '', '', `Del ${desde} al ${hasta}`,
  ]);
  hoja.addRow([]);
}

/** Registro diario de consulta en hoja de cálculo, para trasladarlo al SIGSA web. */
async function sigsa3csExcel(req, res) {
  const datos = await datos3cs(req);
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('SIGSA-3CS', {
    pageSetup: { orientation: 'landscape', paperSize: 5, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  escribirEncabezado(hoja, datos);

  const titulos = hoja.addRow(COLUMNAS.map(([titulo]) => titulo));
  titulos.font = { bold: true, size: 9 };
  titulos.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  titulos.height = 42;
  COLUMNAS.forEach(([, ancho], indice) => { hoja.getColumn(indice + 1).width = ancho; });

  for (const renglon of datos.renglones) {
    const fila = hoja.addRow(filaDelRenglon(renglon));
    fila.alignment = { wrapText: true, vertical: 'top' };
    fila.font = { size: 9 };
  }

  // Los títulos quedan fijos al desplazarse por la hoja.
  hoja.views = [{ state: 'frozen', ySplit: 5 }];
  await req.bitacora({
    accion: 'exportar',
    entidad: 'sigsa3cs',
    detalle: `SIGSA-3CS del ${datos.desde} al ${datos.hasta} en Excel (${datos.renglones.length} consultas)`,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="sigsa3cs-${datos.desde}-${datos.hasta}.xlsx"`);
  await libro.xlsx.write(res);
  res.end();
}

module.exports = { sigsa3cs, sigsa3csExcel, medicos, rango };
