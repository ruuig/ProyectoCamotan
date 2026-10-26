/**
 * Carga los territorios del municipio: cada uno con su encargado y los centros
 * y puestos que tiene a su cargo (la hoja que se tomó en el centro).
 *
 *   node scripts/cargarTerritorios.js [ruta del csv]
 *
 * Por defecto lee scripts/datos/territorios.csv. Se puede correr
 * las veces que haga falta: actualiza el encargado y vuelve a asignar los lugares.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/db');

const ruta = path.resolve(process.argv[2] ?? path.join(__dirname, 'datos', 'territorios.csv'));

function leerCsv(texto) {
  const [cabeza, ...filas] = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const columnas = cabeza.split(',');
  return filas.map((l) => {
    const partes = l.split(',');
    return Object.fromEntries(columnas.map((c, i) => [c.trim(), (partes[i] ?? '').trim()]));
  });
}

async function main() {
  const filas = leerCsv(fs.readFileSync(ruta, 'utf8'));
  const est = await prisma.establecimiento.findFirst({ orderBy: { id: 'asc' } });
  const ubicaciones = await prisma.ubicacion.findMany({ where: { establecimientoId: est.id } });
  const porNombre = new Map(ubicaciones.map((u) => [u.nombre, u]));
  const noEncontrados = [];

  await prisma.$transaction(async (tx) => {
    for (const f of filas) {
      const numero = Number(f.territorio);
      const t = await tx.territorio.upsert({
        where: { establecimientoId_numero: { establecimientoId: est.id, numero } },
        create: { establecimientoId: est.id, numero, encargado: f.encargado },
        update: { encargado: f.encargado, activo: true },
      });
      // Los lugares que ya no son de este territorio quedan libres.
      await tx.ubicacion.updateMany({ where: { territorioId: t.id }, data: { territorioId: null } });
      const lugares = f.lugares ? f.lugares.split('|').map((x) => x.trim()).filter(Boolean) : [];
      for (const nombre of lugares) {
        const u = porNombre.get(nombre);
        if (!u) { noEncontrados.push(`${numero}: ${nombre}`); continue; }
        await tx.ubicacion.update({ where: { id: u.id }, data: { territorioId: t.id } });
      }
      console.log(`Territorio ${numero} · ${f.encargado} · ${lugares.length} lugares`);
    }
  });
  if (noEncontrados.length) console.log('No se encontraron:', noEncontrados.join('; '));
  const sin = await prisma.ubicacion.findMany({
    where: { establecimientoId: est.id, territorioId: null, tipo: { in: ['puesto_salud', 'centro_comunitario'] }, activo: true },
    select: { nombre: true },
  });
  if (sin.length) console.log('Sin territorio:', sin.map((u) => u.nombre).join('; '));
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
