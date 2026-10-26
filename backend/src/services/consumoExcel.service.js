/**
 * El Excel del consumo de cada territorio, como lo maneja hoy la bodega: le da
 * a cada encargado su «pedazo» del balance (las filas de todos los insumos y un
 * bloque de seis columnas por cada lugar que tiene a su cargo), el encargado lo
 * llena con lo que entregó y lo que no hubo, y se pega en el balance.
 *
 * Aquí el pedazo se descarga ya llenado con lo que sabe el sistema (saldo
 * anterior, entradas por los traslados de la bodega, promedio) y, cuando el
 * encargado lo devuelve, se sube y queda cargado como el informe del mes de
 * cada lugar. Las filas y las secciones son las del balance (plantillaBalance).
 */
const ExcelJS = require('exceljs');
const prisma = require('../config/db');
const datos = require('./bodegaDatos.service');
const { normalizarAlias, periodoAnterior } = require('./bodega.service');
const { SECCIONES, NUMERO, NOMBRE_EN_BALANCE, COLUMNAS_LUGAR } = require('../data/plantillaBalance');

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const MESES_PROMEDIO = 3;
const PRIMERA_FILA = 5;

function fallo(status, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { status, codigo, mensaje });
}
/** '2026-09' → 'SEP26', el nombre de la hoja en el balance. */
const nombreHoja = (periodo) => `${MESES[Number(periodo.slice(5, 7)) - 1]}${periodo.slice(2, 4)}`;
/** 'SEP26' → '2026-09'. */
function periodoDeHoja(nombre) {
  const m = /^\s*([A-Za-z]{3})[A-Za-z]*\s*(\d{2})\s*$/.exec(String(nombre ?? ''));
  const mes = m ? MESES.indexOf(m[1].toUpperCase()) : -1;
  return mes < 0 ? null : `20${m[2]}-${String(mes + 1).padStart(2, '0')}`;
}
const clave = (t) => normalizarAlias(t).replace(/\s+/g, '');

/** Territorios con sus lugares, en el orden del balance. */
async function territorios(establecimientoId) {
  const lista = await prisma.territorio.findMany({
    where: { establecimientoId, activo: true },
    orderBy: { numero: 'asc' },
    include: { ubicaciones: { where: { activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }], select: { id: true, nombre: true } } },
  });
  return lista.map((t) => ({ id: t.id, numero: t.numero, encargado: t.encargado, ubicaciones: t.ubicaciones }));
}

/** El territorio de un encargado de servicio: el de su centro o puesto. */
async function territorioDeUsuario(usuario) {
  if (!usuario.ubicacionId) return null;
  const u = await prisma.ubicacion.findUnique({ where: { id: usuario.ubicacionId }, select: { territorioId: true } });
  return u?.territorioId ?? null;
}

/** Filas del Excel: el título de cada sección y cada insumo en su lugar del balance. */
async function filasDelBalance(establecimientoId) {
  const insumos = await prisma.insumo.findMany({
    where: { establecimientoId },
    select: { id: true, nombreGenerico: true, ordenFormulario: true, activo: true },
    orderBy: [{ ordenFormulario: 'asc' }, { nombreGenerico: 'asc' }],
  });
  const porOrden = new Map(insumos.filter((i) => i.ordenFormulario).map((i) => [i.ordenFormulario, i]));
  const filas = [];
  for (let orden = 1; orden <= NUMERO.length; orden += 1) {
    for (const s of SECCIONES.filter((x) => x.antesDe === orden)) filas.push({ seccion: s.titulo });
    const i = porOrden.get(orden);
    filas.push(i ? { insumo: i, numero: NUMERO[orden - 1] } : { vacia: true });
  }
  // Lo que se agregó en el sistema después del balance va al final.
  const nuevos = insumos.filter((i) => (!i.ordenFormulario || i.ordenFormulario > NUMERO.length) && i.activo);
  if (nuevos.length) {
    filas.push({ seccion: 'AGREGADOS EN EL SISTEMA' });
    for (const i of nuevos) filas.push({ insumo: i, numero: null });
  }
  return filas;
}

/** Promedio de demanda (entregado + no entregado) de los meses anteriores con informe. */
async function promedios(ubicacionIds, periodo) {
  const meses = [];
  for (let p = periodoAnterior(periodo), n = 0; n < MESES_PROMEDIO; n += 1, p = periodoAnterior(p)) meses.push(p);
  const renglones = await prisma.informeServicioRenglon.findMany({
    where: { informe: { ubicacionId: { in: ubicacionIds }, periodo: { in: meses } } },
    select: { insumoId: true, entregado: true, noEntregado: true, informe: { select: { ubicacionId: true, periodo: true } } },
  });
  const suma = new Map();
  const conInforme = new Map();
  for (const r of renglones) {
    const k = `${r.informe.ubicacionId}:${r.insumoId}`;
    suma.set(k, (suma.get(k) ?? 0) + r.entregado + r.noEntregado);
    const m = conInforme.get(r.informe.ubicacionId) ?? new Set();
    m.add(r.informe.periodo);
    conInforme.set(r.informe.ubicacionId, m);
  }
  return (ubicacionId, insumoId) => {
    const n = conInforme.get(ubicacionId)?.size ?? 0;
    return n ? Math.round((suma.get(`${ubicacionId}:${insumoId}`) ?? 0) / n) : 0;
  };
}

const BORDE = { style: 'thin', color: { argb: 'FF9CA3AF' } };
const BORDES = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };

/** Libro del territorio para el mes: el pedazo del balance de sus lugares. */
async function libroDelTerritorio(establecimientoId, territorioId, periodo) {
  const t = await prisma.territorio.findFirst({
    where: { id: territorioId, establecimientoId },
    include: { ubicaciones: { where: { activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] } },
  });
  if (!t) throw fallo(404, 'territorio_no_encontrado', 'Ese territorio no existe');
  const lugares = t.ubicaciones.filter(datos.esServicioQueInforma);
  if (!lugares.length) throw fallo(409, 'sin_lugares', `El territorio ${t.numero} no tiene centros ni puestos asignados`);

  const [filas, formularios, promedio] = await Promise.all([
    filasDelBalance(establecimientoId),
    Promise.all(lugares.map((u) => datos.formularioInforme(establecimientoId, u.id, periodo))),
    promedios(lugares.map((u) => u.id), periodo),
  ]);
  const deLugar = formularios.map((f) => new Map(f.renglones.map((r) => [r.insumoId, r])));

  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema de gestión clínica · Centro de Salud de Camotán';
  const hoja = libro.addWorksheet(nombreHoja(periodo));
  hoja.properties.defaultRowHeight = 15;
  hoja.getColumn(1).width = 5;
  hoja.getColumn(2).width = 46;
  hoja.getCell('B1').value = 'INFORME BALANCE MEDICAMENTOS';
  hoja.getCell('B1').font = { bold: true, size: 12 };
  hoja.getCell('B2').value = `Territorio ${t.numero} · ${t.encargado}`;
  hoja.getCell('B2').font = { italic: true };
  const fecha = hoja.getCell('G2');
  fecha.value = new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)) - 1, 1, 12));
  fecha.numFmt = 'mmmm yyyy';
  hoja.getCell('B4').value = 'MEDICAMENTOS';

  lugares.forEach((u, k) => {
    const c0 = 3 + k * 6;
    const nombre = hoja.getCell(3, c0 + 2);
    nombre.value = NOMBRE_EN_BALANCE[u.nombre] ?? u.nombre.toUpperCase();
    nombre.font = { bold: true };
    COLUMNAS_LUGAR.forEach((texto, j) => {
      hoja.getColumn(c0 + j).width = 11;
      const celda = hoja.getCell(4, c0 + j);
      celda.value = texto;
      celda.font = { bold: true, size: 9 };
      celda.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      celda.border = BORDES;
      // Lo que llena el encargado, en amarillo claro.
      if (j === 2 || j === 3) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    });
  });
  hoja.getRow(4).height = 30;
  hoja.getCell('B4').font = { bold: true };
  hoja.getCell('B4').border = BORDES;

  let fila = PRIMERA_FILA;
  for (const f of filas) {
    const r = hoja.getRow(fila);
    if (f.seccion) {
      r.getCell(2).value = f.seccion;
      r.getCell(2).font = { bold: true };
    } else if (f.insumo) {
      r.getCell(1).value = f.numero ?? null;
      r.getCell(2).value = f.insumo.nombreGenerico;
      r.getCell(2).border = BORDES;
      lugares.forEach((u, k) => {
        const c0 = 3 + k * 6;
        const d = deLugar[k].get(f.insumo.id);
        const capturado = d?.capturado;
        const valores = [d?.saldoAnterior ?? 0, d?.entradas ?? 0, capturado ? d.entregado : null, capturado ? d.noEntregado : null];
        valores.forEach((v, j) => { r.getCell(c0 + j).value = v; });
        const letra = (c) => hoja.getColumn(c).letter;
        const resultado = (d?.saldoAnterior ?? 0) + (d?.entradas ?? 0) - (capturado ? d.entregado : 0);
        r.getCell(c0 + 4).value = { formula: `(${letra(c0)}${fila}+${letra(c0 + 1)}${fila})-${letra(c0 + 2)}${fila}`, result: resultado };
        r.getCell(c0 + 5).value = promedio(u.id, f.insumo.id);
        for (let j = 0; j < 6; j += 1) {
          r.getCell(c0 + j).border = BORDES;
          r.getCell(c0 + j).numFmt = '#,##0';
          if (j === 2 || j === 3) r.getCell(c0 + j).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEA' } };
        }
      });
    }
    fila += 1;
  }
  hoja.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];
  return { libro, nombre: `Consumo ${nombreHoja(periodo)} - Territorio ${t.numero} ${t.encargado}.xlsx` };
}

/** Número de una celda de Excel: valor, resultado de fórmula o texto con número. */
function numeroDe(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'object' && 'result' in valor) return numeroDe(valor.result);
  const n = Number(String(valor).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const texto = (valor) => (valor && typeof valor === 'object' ? valor.richText?.map((x) => x.text).join('') ?? valor.result ?? '' : String(valor ?? '')).trim();

/**
 * Carga el Excel devuelto: por cada bloque de lugar, lo entregado y lo no
 * entregado de cada insumo quedan como el informe del mes de ese lugar.
 * `permitidos`: los lugares que puede cargar quien sube (null = todos).
 */
async function cargarLibro(establecimientoId, buffer, periodo, usuarioId, permitidos = null) {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(buffer);
  } catch {
    throw fallo(400, 'archivo_invalido', 'El archivo no es un Excel (.xlsx)');
  }
  // La hoja del balance: la que tiene «Saldo anterior» en la fila 4.
  const hoja = libro.worksheets.find((h) => [...Array(40).keys()].some((c) => clave(texto(h.getRow(4).getCell(c + 1).value)) === 'saldoanterior'));
  if (!hoja) throw fallo(400, 'sin_balance', 'El Excel no tiene la hoja del balance (fila 4 con «Saldo anterior»)');
  const delArchivo = periodoDeHoja(hoja.name);
  if (delArchivo && delArchivo !== periodo) throw fallo(409, 'otro_mes', `El Excel es de ${hoja.name} y se está cargando ${nombreHoja(periodo)}`);

  const ubicaciones = await prisma.ubicacion.findMany({ where: { establecimientoId, activo: true } });
  const porClave = new Map();
  for (const u of ubicaciones.filter(datos.esServicioQueInforma)) {
    porClave.set(clave(u.nombre), u);
    if (NOMBRE_EN_BALANCE[u.nombre]) porClave.set(clave(NOMBRE_EN_BALANCE[u.nombre]), u);
  }

  // Bloques: donde la fila 4 dice «Saldo anterior»; el lugar es el nombre de la fila 3 sobre el bloque.
  const bloques = [];
  const lugaresNoReconocidos = [];
  const filaTitulos = hoja.getRow(4);
  for (let c = 1; c <= Math.max(filaTitulos.cellCount, 400); c += 1) {
    if (clave(texto(filaTitulos.getCell(c).value)) !== 'saldoanterior') continue;
    const nombre = [0, 1, 2, 3, 4, 5].map((j) => texto(hoja.getRow(3).getCell(c + j).value)).find(Boolean) ?? '';
    const u = porClave.get(clave(nombre));
    if (!u) { if (nombre) lugaresNoReconocidos.push(nombre); continue; }
    if (permitidos && !permitidos.has(u.id)) { lugaresNoReconocidos.push(`${nombre} (no es de su territorio)`); continue; }
    bloques.push({ c, u });
  }
  if (!bloques.length) throw fallo(400, 'sin_lugares', 'No se reconoció ningún centro o puesto en la fila 3 del Excel');

  // Insumos por su nombre y por los nombres con que aparecen en los Excel.
  const [insumos, alias] = await Promise.all([
    prisma.insumo.findMany({ where: { establecimientoId }, select: { id: true, nombreGenerico: true } }),
    prisma.insumoAlias.findMany({ where: { insumo: { establecimientoId } }, select: { insumoId: true, aliasNormalizado: true } }),
  ]);
  const insumoDe = new Map(insumos.map((i) => [clave(i.nombreGenerico), i.id]));
  for (const a of alias) insumoDe.set(a.aliasNormalizado.replace(/\s+/g, ''), a.insumoId);
  const secciones = new Set([...SECCIONES.map((s) => clave(s.titulo)), clave('AGREGADOS EN EL SISTEMA')]);

  const porLugar = new Map(bloques.map((b) => [b.u.id, []]));
  const noReconocidos = [];
  for (let f = PRIMERA_FILA; f <= hoja.rowCount; f += 1) {
    const r = hoja.getRow(f);
    const nombre = texto(r.getCell(2).value);
    if (!nombre || secciones.has(clave(nombre))) continue;
    const insumoId = insumoDe.get(clave(nombre));
    const conDatos = bloques.some(({ c }) => numeroDe(r.getCell(c + 2).value) || numeroDe(r.getCell(c + 3).value));
    if (!insumoId) { if (conDatos) noReconocidos.push(nombre); continue; }
    for (const { c, u } of bloques) {
      const entregado = Math.max(0, Math.round(numeroDe(r.getCell(c + 2).value) ?? 0));
      const noEntregado = Math.max(0, Math.round(numeroDe(r.getCell(c + 3).value) ?? 0));
      // Si el saldo siguiente se escribió a mano (sin fórmula), es lo que contó el servicio.
      const saldo = r.getCell(c + 4).value;
      const saldoInformado = typeof saldo === 'number' ? Math.max(0, Math.round(saldo)) : null;
      if (entregado || noEntregado || saldoInformado !== null) porLugar.get(u.id).push({ insumoId, entregado, noEntregado, saldoInformado });
    }
  }

  const lugares = [];
  for (const { u } of bloques) {
    const renglones = porLugar.get(u.id);
    const r = await datos.guardarInforme(establecimientoId, u.id, periodo, { renglones, observacion: 'Cargado desde Excel' }, usuarioId);
    lugares.push({ ubicacionId: u.id, nombre: u.nombre, renglones: renglones.length, diferencias: r?.diferencias ?? 0 });
  }
  return { periodo, lugares, noReconocidos, lugaresNoReconocidos };
}

module.exports = { territorios, territorioDeUsuario, libroDelTerritorio, cargarLibro, nombreHoja };
