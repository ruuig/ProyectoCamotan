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
    include: { ubicaciones: { where: { activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }], select: { id: true, nombre: true, tipo: true } } },
  });
  // destinoId: el territorio como destino de la bodega (el encargado reparte).
  return lista.map((t) => ({
    id: t.id,
    numero: t.numero,
    encargado: t.encargado,
    destinoId: t.ubicaciones.find((u) => u.tipo === 'territorio')?.id ?? null,
    ubicaciones: t.ubicaciones.filter((u) => u.tipo !== 'territorio').map(({ id, nombre }) => ({ id, nombre })),
  }));
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

/**
 * Promedio de demanda (entregado + no entregado), como el del BRES: el mes que
 * se informa y los dos anteriores (los que tengan informe). Devuelve, por lugar
 * e insumo, lo de los meses anteriores; el mes que se informa lo suma quien lo
 * llena: promedio = (anterior + entregado + no entregado) / (meses + 1).
 */
async function promedios(ubicacionIds, periodo) {
  const meses = [];
  for (let p = periodoAnterior(periodo), n = 0; n < MESES_PROMEDIO - 1; n += 1, p = periodoAnterior(p)) meses.push(p);
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
  return (ubicacionId, insumoId) => ({
    anterior: suma.get(`${ubicacionId}:${insumoId}`) ?? 0,
    meses: conInforme.get(ubicacionId)?.size ?? 0,
  });
}

/*
 * Formato del balance del centro (hoja SEP26 de BALANCENE25.xlsx): las mismas
 * letras, colores y bordes. Los colores de tema del libro ya convertidos:
 * azul de los nombres B7DEE8, saldo anterior DCE6F2, saldo siguiente C6D9F1,
 * secciones E6E0EC, promedio 66FF99 / 00FF99, títulos en azul oscuro 003366.
 * Mejoras: títulos y nombres fijos al desplazarse, cifras con separador de
 * miles, solo enteros en lo que llena el encargado y hoja lista para imprimir.
 */
const COLOR = {
  nombreLugar: 'FFB7DEE8',
  saldoAnterior: 'FFDCE6F2',
  saldoSiguiente: 'FFC6D9F1',
  seccion: 'FFE6E0EC',
  promedioTitulo: 'FF66FF99',
  promedio: 'FF00FF99',
  blanco: 'FFFFFFFF',
  titulo: 'FF003366',
};
const relleno = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const DELGADO = { style: 'thin', color: { argb: 'FF000000' } };
const BORDES = { top: DELGADO, left: DELGADO, bottom: DELGADO, right: DELGADO };
const MEDIANO = { style: 'medium', color: { argb: 'FF000000' } };
const LETRA = {
  titulo: { name: 'Arial', size: 14, bold: true },
  fecha: { name: 'Arial', size: 14 },
  lugar: { name: 'Arial', size: 12, bold: true },
  encabezado: { name: 'Arial', size: 11, color: { argb: COLOR.titulo } },
  medicamentos: { name: 'Bodoni MT Black', size: 11, bold: true, color: { argb: COLOR.titulo } },
  seccion: { name: 'Bodoni MT Black', size: 11 },
  numero: { name: 'Comic Sans MS', size: 11 },
  dato: { name: 'Calibri', size: 11 },
  saldo: { name: 'Arial', size: 11, color: { argb: COLOR.titulo } },
};
// Relleno de cada columna del bloque, en el título (fila 4) y en los datos.
const RELLENO_TITULO = [COLOR.saldoAnterior, COLOR.blanco, COLOR.blanco, COLOR.blanco, COLOR.nombreLugar, COLOR.promedioTitulo];
const RELLENO_DATO = [COLOR.saldoAnterior, null, null, null, COLOR.saldoSiguiente, COLOR.promedio];

/** Libro del territorio para el mes: el pedazo del balance de sus lugares. */
async function libroDelTerritorio(establecimientoId, territorioId, periodo) {
  const t = await prisma.territorio.findFirst({
    where: { id: territorioId, establecimientoId },
    include: { ubicaciones: { where: { activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] } },
  });
  if (!t) throw fallo(404, 'territorio_no_encontrado', 'Ese territorio no existe');
  const lugares = t.ubicaciones.filter(datos.esServicioQueInforma);
  if (!lugares.length) throw fallo(409, 'sin_lugares', `El territorio ${t.numero} no tiene centros ni puestos asignados`);

  const [filas, formularios, promedio, reparto] = await Promise.all([
    filasDelBalance(establecimientoId),
    Promise.all(lugares.map((u) => datos.formularioInforme(establecimientoId, u.id, periodo))),
    promedios(lugares.map((u) => u.id), periodo),
    datos.repartoDelTerritorio(establecimientoId, t.id, periodo),
  ]);
  const deLugar = formularios.map((f) => new Map(f.renglones.map((r) => [r.insumoId, r])));

  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema de gestión clínica · Centro de Salud de Camotán';
  const hoja = libro.addWorksheet(nombreHoja(periodo), {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4, zoomScale: 89 }],
    pageSetup: { orientation: 'landscape', paperSize: 5, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:4' },
  });
  const ultima = 2 + lugares.length * 6;
  hoja.getColumn(1).width = 8;
  hoja.getColumn(2).width = 49;
  for (let c = 3; c <= ultima; c += 1) hoja.getColumn(c).width = 13;

  hoja.getCell('B1').value = 'INFORME BALANCE MEDICAMENTOS';
  hoja.getCell('B1').font = LETRA.titulo;
  hoja.getCell('B2').value = `Territorio ${t.numero} · ${t.encargado}`;
  hoja.getCell('B2').font = { name: 'Arial', size: 11, italic: true, color: { argb: COLOR.titulo } };
  const fecha = hoja.getCell('G2');
  fecha.value = new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)) - 1, 1, 12));
  fecha.numFmt = 'mmm-yy';
  fecha.font = LETRA.fecha;
  fecha.alignment = { horizontal: 'center' };
  [1, 2, 3].forEach((n) => { hoja.getRow(n).height = 18; });

  const m = hoja.getCell('B4');
  m.value = 'MEDICAMENTOS';
  m.font = LETRA.medicamentos;
  m.fill = relleno(COLOR.blanco);
  m.alignment = { horizontal: 'center', vertical: 'middle' };
  m.border = BORDES;
  hoja.getRow(4).height = 30;

  lugares.forEach((u, k) => {
    const c0 = 3 + k * 6;
    // El nombre del lugar a lo ancho de su bloque, como en el balance.
    hoja.mergeCells(3, c0, 3, c0 + 5);
    const nombre = hoja.getCell(3, c0);
    nombre.value = NOMBRE_EN_BALANCE[u.nombre] ?? u.nombre.toUpperCase();
    nombre.font = LETRA.lugar;
    nombre.fill = relleno(COLOR.nombreLugar);
    nombre.alignment = { horizontal: 'center', vertical: 'middle' };
    nombre.border = { top: MEDIANO, bottom: MEDIANO, left: DELGADO, right: DELGADO };
    COLUMNAS_LUGAR.forEach((texto, j) => {
      const celda = hoja.getCell(4, c0 + j);
      celda.value = texto;
      celda.font = LETRA.encabezado;
      celda.fill = relleno(RELLENO_TITULO[j]);
      celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      celda.border = BORDES;
    });
  });

  let fila = PRIMERA_FILA;
  for (const f of filas) {
    const r = hoja.getRow(fila);
    if (f.seccion) {
      r.height = 18;
      r.getCell(2).value = f.seccion;
      for (let c = 1; c <= ultima; c += 1) {
        const celda = r.getCell(c);
        celda.fill = relleno(COLOR.seccion);
        celda.border = BORDES;
        celda.font = c === 2 ? LETRA.seccion : LETRA.dato;
      }
    } else if (f.insumo) {
      r.height = 15.6;
      const no = r.getCell(1);
      no.value = f.numero ?? null;
      no.font = LETRA.numero;
      no.alignment = { horizontal: 'center' };
      no.border = BORDES;
      const nombre = r.getCell(2);
      nombre.value = f.insumo.nombreGenerico;
      nombre.font = LETRA.dato;
      nombre.border = BORDES;
      lugares.forEach((u, k) => {
        const c0 = 3 + k * 6;
        const d = deLugar[k].get(f.insumo.id);
        const capturado = d?.capturado;
        const valores = [d?.saldoAnterior ?? 0, d?.entradas ?? 0, capturado ? d.entregado : null, capturado ? d.noEntregado : null];
        valores.forEach((v, j) => { r.getCell(c0 + j).value = v; });
        const letra = (c) => hoja.getColumn(c).letter;
        const resultado = (d?.saldoAnterior ?? 0) + (d?.entradas ?? 0) - (capturado ? d.entregado : 0);
        r.getCell(c0 + 4).value = { formula: `(${letra(c0)}${fila}+${letra(c0 + 1)}${fila})-${letra(c0 + 2)}${fila}`, result: resultado };
        // Fórmula: cambia al llenar lo entregado y lo no entregado del mes.
        const p = promedio(u.id, f.insumo.id);
        r.getCell(c0 + 5).value = {
          formula: `ROUND((${p.anterior}+${letra(c0 + 2)}${fila}+${letra(c0 + 3)}${fila})/${p.meses + 1},0)`,
          result: Math.round((p.anterior + (capturado ? d.entregado + d.noEntregado : 0)) / (p.meses + 1)),
        };
        for (let j = 0; j < 6; j += 1) {
          const celda = r.getCell(c0 + j);
          celda.border = BORDES;
          celda.numFmt = '#,##0';
          celda.font = j === 4 ? LETRA.saldo : LETRA.dato;
          if (RELLENO_DATO[j]) celda.fill = relleno(RELLENO_DATO[j]);
          // Lo que llena el encargado: solo números enteros, cero o más. Las
          // entradas también, por si reparte lo que la bodega le dio al territorio.
          if (j >= 1 && j <= 3) {
            celda.dataValidation = {
              type: 'whole', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true,
              showErrorMessage: true, errorTitle: 'Cantidad', error: 'Escriba un número entero, sin decimales.',
            };
          }
        }
      });
    }
    fila += 1;
  }
  hojaDelReparto(libro, filas, reparto);
  return { libro, nombre: `Consumo ${nombreHoja(periodo)} - Territorio ${t.numero} ${t.encargado}.xlsx` };
}

/**
 * Si la bodega le entregó al territorio (no a cada lugar), una hoja más con lo
 * que recibió el encargado: lo que le da a cada lugar lo suma en sus «Entradas».
 */
function hojaDelReparto(libro, filas, reparto) {
  const conReparto = filas.filter((f) => f.insumo && reparto.get(f.insumo.id)?.entregado);
  if (!conReparto.length) return;
  const hoja = libro.addWorksheet('Entregado al territorio', { views: [{ state: 'frozen', ySplit: 3 }] });
  hoja.getColumn(1).width = 49;
  [2, 3].forEach((c) => { hoja.getColumn(c).width = 18; });
  hoja.getCell('A1').value = 'Lo que la bodega le entregó al territorio. Lo que le dio a cada lugar, súmelo en sus «Entradas».';
  hoja.getCell('A1').font = { name: 'Arial', size: 11, bold: true, color: { argb: COLOR.titulo } };
  ['Producto', 'Entregado este mes', 'Sin repartir'].forEach((texto, j) => {
    const celda = hoja.getCell(3, j + 1);
    celda.value = texto;
    celda.font = LETRA.encabezado;
    celda.fill = relleno(COLOR.nombreLugar);
    celda.border = BORDES;
    celda.alignment = { horizontal: 'center', wrapText: true };
  });
  conReparto.forEach((f, k) => {
    const r = reparto.get(f.insumo.id);
    const valores = [f.insumo.nombreGenerico, r.entregadoMes, Math.max(0, r.entregado - r.repartido)];
    valores.forEach((v, j) => {
      const celda = hoja.getCell(4 + k, j + 1);
      celda.value = v;
      celda.font = LETRA.dato;
      celda.border = BORDES;
      if (j) celda.numFmt = '#,##0';
    });
  });
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
 * El archivo es de un territorio y trae todos sus lugares juntos. Cada bloque
 * se reconoce por el nombre; si le cambiaron el nombre, por su posición dentro
 * del territorio (el mismo orden con que se descargó).
 *
 * Sin territorio (territorioId null) es el balance completo del mes, como lo
 * lleva la bodega: todos los lugares y post-consulta, cada uno por su nombre.
 */
async function cargarLibro(establecimientoId, buffer, periodo, usuarioId, territorioId, { soloNuevos = false } = {}) {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(buffer);
  } catch {
    throw fallo(400, 'archivo_invalido', 'El archivo no es un Excel (.xlsx)');
  }
  // La hoja del balance: la que tiene «Saldo anterior» en la fila 4.
  const hoja = libro.worksheets.find((h) => [...Array(40).keys()].some((c) => clave(texto(h.getRow(4).getCell(c + 1).value)) === 'saldoanterior'));
  if (!hoja) throw fallo(400, 'sin_balance', 'El Excel no tiene la hoja del balance (fila 4 con «Saldo anterior»)');
  // Un mes con el BRES cerrado ya no cambia.
  const cerrado = await prisma.bres.findUnique({ where: { establecimientoId_periodo: { establecimientoId, periodo } }, select: { estado: true } });
  if (cerrado?.estado === 'cerrado') throw fallo(409, 'mes_cerrado', `El BRES de ${nombreHoja(periodo)} está cerrado: ya no se cargan informes de ese mes`);
  const delArchivo = periodoDeHoja(hoja.name);
  if (delArchivo && delArchivo !== periodo) throw fallo(409, 'otro_mes', `El Excel es de ${hoja.name} y se está cargando ${nombreHoja(periodo)}`);

  const ubicaciones = await prisma.ubicacion.findMany({ where: { establecimientoId, activo: true } });
  const completo = territorioId == null;
  const informan = (x) => datos.esServicioQueInforma(x) || (completo && x.tipo === 'centro_salud');
  const porClave = new Map();
  for (const u of ubicaciones.filter(informan)) {
    porClave.set(clave(u.nombre), u);
    if (NOMBRE_EN_BALANCE[u.nombre]) porClave.set(clave(NOMBRE_EN_BALANCE[u.nombre]), u);
  }

  // Bloques: donde la fila 4 dice «Saldo anterior»; el lugar es el nombre de la fila 3 sobre el bloque.
  const todos = [];
  const filaTitulos = hoja.getRow(4);
  for (let c = 1; c <= Math.max(filaTitulos.cellCount, 400); c += 1) {
    if (clave(texto(filaTitulos.getCell(c).value)) !== 'saldoanterior') continue;
    const nombre = [0, 1, 2, 3, 4, 5].map((j) => texto(hoja.getRow(3).getCell(c + j).value)).find(Boolean) ?? '';
    // Los totales del balance (B a M) no son un lugar.
    if (/^totales?$/i.test(nombre)) continue;
    todos.push({ c, nombre, u: porClave.get(clave(nombre)) });
  }
  if (!todos.length) throw fallo(400, 'sin_bloques', 'El Excel no tiene ningún bloque con «Saldo anterior» en la fila 4');

  const delTerritorio = ubicaciones
    .filter((x) => (completo || x.territorioId === territorioId) && informan(x))
    .sort((a, b) => a.orden - b.orden || a.id - b.id);
  if (!delTerritorio.length) throw fallo(409, 'sin_lugares', 'Ese territorio no tiene centros ni puestos asignados');
  const suyo = new Set(delTerritorio.map((u) => u.id));
  // En el balance completo solo por nombre: el orden de las columnas varía.
  const mismoOrden = !completo && todos.length === delTerritorio.length;
  const bloques = [];
  const lugaresNoReconocidos = [];
  todos.forEach((b, k) => {
    // Por nombre; si no se reconoce, por su lugar en el orden del territorio.
    const u = b.u && suyo.has(b.u.id) ? b.u : mismoOrden && !b.u ? delTerritorio[k] : null;
    if (!u) { if (b.nombre) lugaresNoReconocidos.push(b.u ? `${b.nombre} (de otro territorio)` : b.nombre); return; }
    if (bloques.some((x) => x.u.id === u.id)) { lugaresNoReconocidos.push(`${b.nombre} (repetido)`); return; }
    bloques.push({ c: b.c, u });
  });
  // El encargado no cambia lo que ya envió: eso lo corrige bodega.
  const yaEnviados = [];
  if (soloNuevos) {
    const enviados = new Set((await prisma.informeServicio.findMany({
      where: { periodo, ubicacionId: { in: bloques.map(({ u }) => u.id) }, enviadoEn: { not: null } }, select: { ubicacionId: true },
    })).map((x) => x.ubicacionId));
    for (let k = bloques.length - 1; k >= 0; k -= 1) {
      if (enviados.has(bloques[k].u.id)) { yaEnviados.unshift(bloques[k].u.nombre); bloques.splice(k, 1); }
    }
    if (!bloques.length) throw fallo(409, 'informe_enviado', 'Los informes de ese mes ya se enviaron. Para corregirlos, avise a bodega');
  }
  if (!bloques.length) throw fallo(400, 'sin_lugares', `No se reconoció ningún centro o puesto${completo ? '' : ' del territorio'} en la fila 3 del Excel`);

  // Insumos por su nombre y por los nombres con que aparecen en los Excel.
  const [insumos, alias] = await Promise.all([
    prisma.insumo.findMany({ where: { establecimientoId }, select: { id: true, nombreGenerico: true, formaFarmaceutica: true, concentracion: true } }),
    prisma.insumoAlias.findMany({ where: { insumo: { establecimientoId } }, select: { insumoId: true, aliasNormalizado: true } }),
  ]);
  const insumoDe = new Map(insumos.map((i) => [clave(i.nombreGenerico), i.id]));
  // Como lo escribe el balance que baja el sistema: nombre, forma y concentración.
  for (const i of insumos) {
    const largo = clave([i.nombreGenerico, i.formaFarmaceutica, i.concentracion].filter(Boolean).join(' '));
    if (!insumoDe.has(largo)) insumoDe.set(largo, i.id);
  }
  for (const a of alias) insumoDe.set(a.aliasNormalizado.replace(/\s+/g, ''), a.insumoId);
  const secciones = new Set([...SECCIONES.map((s) => clave(s.titulo)), clave('AGREGADOS EN EL SISTEMA')]);

  // Lo que la bodega entregó al territorio: lo que el encargado sume en las
  // entradas de un lugar, sobre lo que la bodega le entregó directo, es lo
  // que le dio de eso.
  const territoriosDe = [...new Set(bloques.map(({ u }) => u.territorioId).filter((t) => t != null))];
  const repartos = new Map(await Promise.all(territoriosDe.map(async (t) => [t, await datos.repartoDelTerritorio(establecimientoId, t, periodo)])));
  const formularios = new Map(await Promise.all(bloques.map(async ({ u }) => {
    const form = await datos.formularioInforme(establecimientoId, u.id, periodo);
    return [u.id, new Map(form.renglones.map((x) => [x.insumoId, x]))];
  })));

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
      // Si el saldo siguiente se escribió a mano (sin fórmula), es lo que contó el
      // servicio. En el balance completo es la cifra calculada: no se toma.
      const saldo = r.getCell(c + 4).value;
      const saldoInformado = !completo && typeof saldo === 'number' ? Math.max(0, Math.round(saldo)) : null;
      // Las entradas como las dice el lugar (lo que pase de lo de bodega se suma).
      const leidas = numeroDe(r.getCell(c + 1).value);
      const entradas = leidas === null ? null : Math.max(0, Math.round(leidas));
      const cambian = entradas !== null && entradas !== (formularios.get(u.id).get(insumoId)?.entradas ?? 0);
      if (entregado || noEntregado || saldoInformado !== null || cambian) {
        porLugar.get(u.id).push({ insumoId, entregado, noEntregado, saldoInformado, entradas });
      }
    }
  }

  const lugares = [];
  for (const { u } of bloques) {
    const renglones = porLugar.get(u.id);
    const r = await datos.guardarInforme(establecimientoId, u.id, periodo, { renglones, observacion: 'Cargado desde Excel' }, usuarioId);
    lugares.push({ ubicacionId: u.id, nombre: u.nombre, renglones: renglones.length, diferencias: r?.diferencias ?? 0 });
  }
  // Lo que el encargado recibió para el territorio y no aparece repartido.
  const nombres = new Map(insumos.map((i) => [i.id, i.nombreGenerico]));
  const sinRepartir = [];
  for (const t of territoriosDe) {
    const numero = completo ? (await prisma.territorio.findUnique({ where: { id: t }, select: { numero: true } }))?.numero : null;
    for (const [insumoId, r] of await datos.repartoDelTerritorio(establecimientoId, t, periodo)) {
      if (!r.entregado || r.entregado === r.repartido) continue;
      sinRepartir.push({ insumoId, nombre: numero ? `${nombres.get(insumoId)} (territorio ${numero})` : nombres.get(insumoId), entregado: r.entregado, repartido: r.repartido });
    }
  }
  return { periodo, lugares, noReconocidos, lugaresNoReconocidos, sinRepartir, yaEnviados };
}

module.exports = { territorios, territorioDeUsuario, libroDelTerritorio, cargarLibro, nombreHoja, promedios };
