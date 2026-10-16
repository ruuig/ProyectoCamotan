/**
 * Migra el historial de la bodega desde los Excel del centro.
 *
 *   python scripts/extraerBodega.py ../documentacion/Plantillas <bodega.json>
 *   node scripts/importarBodega.js <bodega.json>              (solo revisa)
 *   node scripts/importarBodega.js <bodega.json> --aplicar    (escribe)
 *
 * Fuentes (documentacion/Plantillas/):
 *   BALANCE*.xlsx            catalogo (ultimo mes), informes de los servicios y
 *                            totales del BRES de cada mes
 *   INVENTARIOS CIERRE*.xlsx existencia de la bodega al ultimo cierre y nombres
 *                            viejos (alias)
 *   SEMAFORO*.xlsx           lotes y vencimientos
 *
 * Los informes de revision se escriben en documentacion/bd/importacion/bodega/.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../src/config/db');
const ib = require('../src/services/importacionBodega.service');
const { normalizarAlias } = require('../src/services/bodega.service');
const { normalizarTexto } = require('../src/services/pacientes.service');
const { partirLinea } = require('../src/services/csvLugares.service');

const [, , rutaDatos, bandera] = process.argv;
const APLICAR = bandera === '--aplicar';
const CARPETA = path.join(__dirname, '..', '..', 'documentacion', 'bd', 'importacion', 'bodega');

function csv(filas) {
  const celda = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return `﻿${filas.map((f) => f.map(celda).join(',')).join('\n')}`;
}

async function main() {
  const datos = JSON.parse(fs.readFileSync(rutaDatos, 'utf8'));
  const establecimiento = await prisma.establecimiento.findFirst();
  const eid = establecimiento.id;
  const ubicaciones = await prisma.ubicacion.findMany({ where: { establecimientoId: eid } });

  // --- 1. Catalogo: el ultimo mes del balance, en su orden ------------------
  const meses = [...datos.balance].sort((a, b) => a.periodo.localeCompare(b.periodo));
  const ultimo = meses[meses.length - 1];
  const catalogo = ultimo.renglones.map((r, i) => {
    const { categoria, revisar } = ib.categoriaDe(r.seccion, r.nombre);
    return { clave: i + 1, orden: i + 1, nombre: r.nombre.replace(/\s+/g, ' ').trim(), seccion: r.seccion, categoria, revisar };
  });

  // Nombres repetidos en el catalogo (la misma fila escrita dos veces).
  const repetidos = catalogo.filter((c, i) => catalogo.findIndex((x) => normalizarTexto(x.nombre) === normalizarTexto(c.nombre)) !== i);

  // --- 2. Alias: cada nombre de los otros meses y archivos ------------------
  const nombres = new Map(); // nombre -> { fuentes:Set }
  const anotar = (nombre, fuente) => {
    const n = String(nombre ?? '').replace(/\s+/g, ' ').trim();
    if (!n) return;
    const x = nombres.get(n) ?? { fuentes: new Set() };
    x.fuentes.add(fuente);
    nombres.set(n, x);
  };
  for (const m of meses) for (const r of m.renglones) anotar(r.nombre, `balance ${m.hoja}`);
  for (const m of datos.cierres) for (const r of m.renglones) anotar(r.nombre, `cierre ${m.hoja}`);
  for (const [color, filas] of Object.entries(datos.semaforo)) for (const r of filas) anotar(r.nombre, `semáforo ${color}`);

  // Equivalencias escritas a mano (documentacion/Plantillas/equivalencias.csv): mandan
  // sobre cualquier regla.
  const rutaEquivalencias = path.join(__dirname, '..', '..', 'documentacion', 'Plantillas', 'equivalencias.csv');
  const BOM = String.fromCharCode(0xFEFF);
  const SALTO = String.fromCharCode(10);
  const equivalencias = fs.existsSync(rutaEquivalencias)
    ? fs.readFileSync(rutaEquivalencias, 'utf8').replace(BOM, '').split(SALTO).map((l) => l.trim()).slice(1).filter(Boolean)
      .map((linea) => partirLinea(linea))
      .map(([nombreExcel, nombreCatalogo]) => ({ nombreExcel, nombreCatalogo }))
    : [];

  const emparejados = new Map(); // nombre -> clave
  const alias = new Map(); // clave -> Set(nombres)
  const sinEmparejar = [];
  for (const [nombre, info] of nombres) {
    const e = ib.aplicarEquivalencias(nombre, equivalencias, catalogo) ?? ib.emparejar(nombre, catalogo);
    if (!e) { sinEmparejar.push([nombre, [...info.fuentes].slice(0, 4).join(' | '), info.fuentes.size]); continue; }
    emparejados.set(nombre, e.clave);
    const propio = catalogo.find((c) => c.clave === e.clave);
    if (normalizarAlias(nombre) !== normalizarAlias(propio.nombre)) {
      if (!alias.has(e.clave)) alias.set(e.clave, new Map());
      alias.get(e.clave).set(normalizarAlias(nombre), { nombre, metodo: e.metodo, puntaje: e.puntaje });
    }
  }
  // Un mismo alias no puede quedar en dos insumos: el de mayor puntaje se queda.
  const duenoAlias = new Map();
  for (const [clave, mapa] of alias) {
    for (const [norm, a] of mapa) {
      const previo = duenoAlias.get(norm);
      if (!previo || a.puntaje > previo.puntaje) duenoAlias.set(norm, { clave, ...a });
    }
  }

  // --- 3. Servicios del balance -> ubicaciones -------------------------------
  const serviciosExcel = new Set();
  for (const m of meses) for (const s of m.renglones[0]?.servicios ?? []) serviciosExcel.add(s.servicio);
  const mapaServicios = new Map([...serviciosExcel].map((s) => [s, ib.emparejarServicio(s, ubicaciones)]));

  // --- 4. Existencia inicial y lotes -----------------------------------------
  const cierreFinal = [...datos.cierres].sort((a, b) => a.periodo.localeCompare(b.periodo)).filter((c) => c.periodo <= ultimo.periodo).pop();
  const existencia = new Map();
  const cierreSinEmparejar = [];
  for (const r of cierreFinal.renglones) {
    const clave = emparejados.get(r.nombre.replace(/\s+/g, ' ').trim());
    if (!clave) { cierreSinEmparejar.push(r.nombre); continue; }
    existencia.set(clave, (existencia.get(clave) ?? 0) + ib.entero(r.saldoActual));
  }
  // El balance del mismo mes trae la existencia (I): deben coincidir.
  const descuadreI = [];
  ultimo.renglones.forEach((r, i) => {
    const I = ib.entero(r.totales?.I);
    const e = existencia.get(i + 1) ?? 0;
    if (I !== e) descuadreI.push([catalogo[i].nombre, I, e]);
  });

  const lotesPorClave = new Map();
  for (const [color, filas] of Object.entries(datos.semaforo)) {
    for (const r of filas) {
      const clave = emparejados.get(r.nombre.replace(/\s+/g, ' ').trim());
      if (!clave) continue;
      const lista = lotesPorClave.get(clave) ?? [];
      for (const l of r.lotes) lista.push({ ...l, color });
      lotesPorClave.set(clave, lista);
    }
  }
  // Post-consulta tiene existencia propia en el balance (saldo siguiente).
  const postConsulta = new Map(ultimo.renglones.map((r, i) => [i + 1, ib.entero(r.servicios.find((s) => /post/i.test(s.servicio ?? ''))?.saldoSiguiente)]));
  // Post-consulta es el propio centro: su existencia se junta con la de la
  // bodega y la lleva el sistema.
  const existenciaCentro = (clave) => (existencia.get(clave) ?? 0) + (postConsulta.get(clave) ?? 0);
  const conciliacion = catalogo.map((c) => ({ c, ...ib.conciliarLotes(lotesPorClave.get(c.clave) ?? [], existenciaCentro(c.clave)) }));


  // --- Informes de revision ----------------------------------------------------
  fs.mkdirSync(CARPETA, { recursive: true });
  const escribir = (archivo, filas) => fs.writeFileSync(path.join(CARPETA, archivo), csv(filas));
  escribir('catalogo.csv', [['orden', 'nombre', 'seccion_en_el_excel', 'categoria', 'revisar_categoria', 'existencia_bodega', 'existencia_post_consulta', 'alias'],
    ...catalogo.map((c) => [c.orden, c.nombre, c.seccion ?? '(medicamentos)', c.categoria, c.revisar ? 'sí' : '', existencia.get(c.clave) ?? 0, postConsulta.get(c.clave) ?? 0,
      [...duenoAlias.values()].filter((a) => a.clave === c.clave).map((a) => a.nombre).join(' | ')])]);
  escribir('sin_emparejar.csv', [['nombre', 'donde_aparece', 'en_cuantas_hojas'], ...sinEmparejar.sort((a, b) => b[2] - a[2])]);
  escribir('servicios.csv', [['servicio_en_el_balance', 'ubicacion_del_sistema'], ...[...mapaServicios].map(([s, u]) => [s, u?.nombre ?? 'SIN EMPAREJAR'])]);
  escribir('lotes.csv', [['insumo', 'existencia_cierre', 'lote', 'vence', 'cantidad', 'sin_lote', 'sobrante_semaforo', 'descartados_por_fecha'],
    ...conciliacion.flatMap(({ c, lotes, sinLote, sobranteSemaforo, descartados }) => {
      const base = [c.nombre, existencia.get(c.clave) ?? 0];
      if (!lotes.length) return [[...base, '', '', '', sinLote, sobranteSemaforo, descartados.map((d) => `${d.lote} ${d.vence}`).join(' | ')]];
      return lotes.map((l, i) => [...base, l.lote, l.vence, l.cantidad, i === 0 ? sinLote : '', i === 0 ? sobranteSemaforo : '', i === 0 ? descartados.map((d) => `${d.lote} ${d.vence}`).join(' | ') : '']);
    })]);
  escribir('existencia_no_cuadra.csv', [['insumo', 'I_del_balance', 'saldo_actual_del_cierre'], ...descuadreI]);

  const conLotes = conciliacion.filter((x) => x.lotes.length);
  const unidadesSinLote = conciliacion.reduce((s, x) => s + x.sinLote, 0);
  const unidades = [...existencia.values()].reduce((s, v) => s + v, 0);
  const porCategoria = {};
  for (const c of catalogo) porCategoria[c.categoria] = (porCategoria[c.categoria] ?? 0) + 1;

  console.log(`Equivalencias escritas a mano: ${equivalencias.length}`);
  console.log(`Catálogo: ${catalogo.length} insumos (${ultimo.hoja}). Por categoría: ${JSON.stringify(porCategoria)}`);
  console.log(`  Categoría por revisar (bloque COVID-19): ${catalogo.filter((c) => c.revisar).length}`);
  console.log(`  Nombres repetidos en el catálogo: ${repetidos.map((r) => r.nombre).join(' | ') || 'ninguno'}`);
  console.log(`Nombres distintos en los tres archivos: ${nombres.size}; emparejados: ${emparejados.size}; sin emparejar: ${sinEmparejar.length}`);
  console.log(`  Alias que se guardan: ${duenoAlias.size}`);
  console.log(`Servicios del balance: ${mapaServicios.size}; sin emparejar: ${[...mapaServicios].filter(([, u]) => !u).map(([s]) => s).join(', ') || 'ninguno'}`);
  console.log(`Historial: ${meses.length} meses (${meses[0].periodo} a ${ultimo.periodo})`);
  console.log(`Existencia de bodega al cierre de ${cierreFinal.hoja}: ${unidades} unidades en ${[...existencia.values()].filter((v) => v > 0).length} insumos`);
  console.log(`  Nombres del cierre sin emparejar: ${cierreSinEmparejar.length}`);
  console.log(`  I del balance vs saldo del cierre: ${descuadreI.length} insumos no cuadran`);
  console.log(`  Post-consulta tiene existencia propia: ${[...postConsulta.values()].reduce((s, v) => s + v, 0)} unidades en ${[...postConsulta.values()].filter((v) => v > 0).length} insumos`);
  console.log(`Lotes del semáforo: ${conLotes.reduce((s, x) => s + x.lotes.length, 0)} lotes para ${conLotes.length} insumos; ${unidadesSinLote} unidades quedan sin lote; ${conciliacion.reduce((s, x) => s + x.descartados.length, 0)} lotes con fecha imposible`);

  if (!APLICAR) {
    console.log('Revisión sin cambios. Informes en documentacion/bd/importacion/bodega/.');
    return;
  }
  await require('./aplicarBodega')({
    prisma, eid, catalogo, duenoAlias, mapaServicios, meses, conciliacion, existenciaCentro,
  });

}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
