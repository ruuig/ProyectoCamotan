const ExcelJS = require('exceljs');
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
      medico: { select: { id: true, nombre: true } },
    },
  });
  const [establecimiento, medico] = await Promise.all([
    prisma.establecimiento.findUnique({ where: { id: establecimientoId } }),
    medicoId ? prisma.usuario.findFirst({ where: { id: Number(medicoId), establecimientoId }, select: { nombre: true } }) : null,
  ]);
  return {
    desde,
    hasta,
    encabezado: {
      areaSalud: establecimiento.departamento,
      distrito: establecimiento.municipio,
      municipio: establecimiento.municipio,
      servicio: establecimiento.nombre,
      responsable: medico?.nombre ?? null,
    },
    renglones: renglonesSigsa3cs(atenciones, { sensibles: puedeVerSensibles(req.usuario) }),
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
  ['1/ Sexo', 6], ['2/ Pueblo', 7], ['3/ Comunidad lingüística', 9], ['4/ Nacimiento: día', 7], ['Mes', 5], ['Año', 6], ['Edad', 8],
  ['5/ Discapacidad', 9], ['6/ Orientación sexual', 9], ['7/ Escolaridad', 9], ['8/ Profesión u oficio', 16],
  ['Comunidad y/o dirección exacta', 22], ['Municipio', 14], ['9/ Agrícola migrante', 8], ['10/ Consulta', 8], ['11/ Control', 7],
  ['12/ Semana de gestación', 8], ['13/ Viene', 6], ['14/ Fue', 6], ['Referido a', 16],
  ['Descripción diagnóstico/control', 34], ['Código CIE-10', 10],
  ['Tratamiento: descripción', 34], ['Presentación', 14], ['Cantidad recetada', 9],
  ['15/ Lugar de notificación', 9], ['Número de notificación', 12], ['Nombres y apellidos del acompañante', 24],
];

async function sigsa3csExcel(req, res) {
  const d = await datos3cs(req);
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('SIGSA-3CS', { pageSetup: { orientation: 'landscape', paperSize: 5, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  hoja.addRow(['FOR-SIGSA-3CS · Registro diario de consulta en centro de salud']);
  hoja.addRow([`Área de Salud: ${d.encabezado.areaSalud}`, '', '', `Distrito de Salud: ${d.encabezado.distrito}`, '', '', '', `Municipio: ${d.encabezado.municipio}`, '', '', '', `Servicio de Salud: ${d.encabezado.servicio}`]);
  hoja.addRow([`Responsable de la información: ${d.encabezado.responsable ?? ''}`, '', '', `Del ${d.desde} al ${d.hasta}`]);
  hoja.addRow([]);
  const cabeza = hoja.addRow(COLUMNAS.map((c) => c[0]));
  cabeza.font = { bold: true, size: 9 };
  cabeza.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  cabeza.height = 42;
  COLUMNAS.forEach((c, i) => { hoja.getColumn(i + 1).width = c[1]; });
  const lineas = (lista, campo) => lista.map((x) => x[campo]).join('\n');
  for (const r of d.renglones) {
    const fila = hoja.addRow([
      r.dia, r.historiaClinica, r.nombre, r.cui, r.sexo, r.pueblo, r.comunidadLinguistica,
      r.nacimiento.dia, r.nacimiento.mes, r.nacimiento.anio, r.nacimiento.edad,
      r.discapacidad, r.orientacionSexual, r.escolaridad, r.profesion, r.comunidad, r.municipio, r.migrante,
      r.consulta, r.control, r.semanasGestacion, r.viene, r.fue, r.referidoA,
      lineas(r.diagnosticos, 'descripcion'), lineas(r.diagnosticos, 'cie'),
      lineas(r.tratamiento, 'descripcion'), lineas(r.tratamiento, 'presentacion'), lineas(r.tratamiento, 'cantidad'),
      r.notificacionLugar, r.notificacionNumero, r.acompanante,
    ]);
    fila.alignment = { wrapText: true, vertical: 'top' };
    fila.font = { size: 9 };
  }
  hoja.views = [{ state: 'frozen', ySplit: 5 }];
  await req.bitacora({ accion: 'exportar', entidad: 'sigsa3cs', detalle: `SIGSA-3CS del ${d.desde} al ${d.hasta} en Excel (${d.renglones.length} consultas)` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="sigsa3cs-${d.desde}-${d.hasta}.xlsx"`);
  await libro.xlsx.write(res);
  res.end();
}

module.exports = { sigsa3cs, sigsa3csExcel, medicos, rango };
