/**
 * Carga la base de pacientes del centro desde el libro de Excel.
 *
 * Uso:
 *   node scripts/importarPacientes.js <filas.json>            (solo revisa)
 *   node scripts/importarPacientes.js <filas.json> --aplicar  (escribe)
 *
 * <filas.json> es la lista de filas crudas del libro, una por renglon, con
 * { hoja, anio, fila, fecha, codigo, nombre, sexo, edad, comunidad }.
 *
 * Al aplicar, en una sola transaccion:
 *   1. Borra los pacientes de prueba y todo lo que cuelga de ellos.
 *   2. Reemplaza el catalogo de comunidades por las que aparecen en el libro.
 *   3. Crea los pacientes, con expediente correlativo por anio de su primera
 *      visita y el codigo del papel como "expediente en papel".
 *   4. Deja constancia en la bitacora.
 *
 * Los reportes (comunidades agrupadas y filas que no se pudieron cargar) se
 * escriben en bd/importacion/.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../src/config/db');
const imp = require('../src/services/importacionPacientes.service');
const { formatearExpediente } = require('../src/services/expediente.service');
const { condicionesPorEdad } = require('../src/services/condiciones.service');

const [, , rutaFilas, bandera] = process.argv;
const APLICAR = bandera === '--aplicar';
const CARPETA_REPORTES = path.join(__dirname, '..', '..', 'bd', 'importacion');

function csv(filas) {
  const celda = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return filas.map((f) => f.map(celda).join(',')).join('\n');
}

async function main() {
  if (!rutaFilas) {
    console.error('Falta la ruta del archivo de filas.');
    process.exit(1);
  }

  const establecimiento = await prisma.establecimiento.findFirst();
  const catalogoActual = await prisma.lugarPoblado.findMany({ where: { establecimientoId: establecimiento.id } });

  // Las tildes salen del catalogo que ya se tenia y del nombre del municipio.
  const acentos = imp.diccionarioAcentos([
    ...catalogoActual.flatMap((l) => [l.nombre, l.sector, l.territorio]),
    'Camotán Jocotán Chiquimula Esquipulas Olopa',
  ]);

  const crudas = JSON.parse(fs.readFileSync(rutaFilas, 'utf8'))
    .filter((f) => !imp.esEncabezado(f))
    .map(imp.repararFila);
  const omitidas = [];

  // Codigos y su validez.
  const conCodigo = crudas.map((f) => ({ ...f, codigo: imp.normalizarCodigo(f.codigo) }));
  const invalidos = imp.codigosInvalidos(conCodigo);
  for (const f of conCodigo) if (invalidos.has(f.codigo)) f.codigo = null;

  const lexico = imp.construirLexico(conCodigo);
  const comunidades = imp.agruparComunidades(
    conCodigo.map((f) => f.comunidad),
    acentos,
    catalogoActual.flatMap((l) => [l.nombre, l.sector]).filter(Boolean),
  );

  const registros = [];
  for (const f of conCodigo) {
    const partes = imp.partirNombre(f.nombre, f.codigo, lexico);
    if (!partes) {
      omitidas.push([f.hoja, f.fila, 'Nombre incompleto', f.codigo, f.nombre, f.sexo, f.edad, f.comunidad]);
      continue;
    }
    const fecha = imp.fechaDeLaFila(f);
    const edad = imp.parsearEdad(f.edad);
    registros.push({
      ...partes,
      nombre: `${partes.nombres} ${partes.apellidos}`,
      sexo: imp.normalizarSexo(f.sexo),
      nacimiento: edad ? imp.nacimientoDesdeEdad(edad, fecha) : null,
      codigo: f.codigo,
      comunidad: comunidades.comunidadDe(f.comunidad),
      fecha,
      hoja: f.hoja,
      fila: f.fila,
      cruda: f,
    });
  }

  const personas = imp.agruparPersonas(registros);
  const cargables = [];
  for (const p of personas) {
    const motivo = !p.fechaNacimiento ? 'Sin edad' : !p.sexo ? 'Sin sexo' : null;
    if (motivo) {
      omitidas.push([p.origen.join(' / '), '', motivo, p.codigo, `${p.nombres} ${p.apellidos}`, p.sexo ?? '', '', p.comunidad ?? '']);
    } else {
      cargables.push(p);
    }
  }

  // Expediente correlativo por anio de la primera visita, en orden de llegada.
  cargables.sort((a, b) => a.primeraVez - b.primeraVez);
  const contadores = {};
  for (const p of cargables) {
    const anio = p.primeraVez.getUTCFullYear();
    contadores[anio] = (contadores[anio] ?? 0) + 1;
    p.expediente = formatearExpediente(anio, contadores[anio]);
  }

  // Reportes.
  fs.mkdirSync(CARPETA_REPORTES, { recursive: true });
  fs.writeFileSync(
    path.join(CARPETA_REPORTES, 'comunidades.csv'),
    `﻿${csv([['comunidad', 'categoria', 'pacientes_en_el_libro', 'formas_de_escribirla'],
      ...comunidades.comunidades.map((c) => [c.nombre, c.categoria, c.total, c.variantes.join(' | ')])])}`,
  );
  fs.writeFileSync(
    path.join(CARPETA_REPORTES, 'filas_no_cargadas.csv'),
    `﻿${csv([['hoja', 'fila', 'motivo', 'codigo', 'nombre', 'sexo', 'edad', 'comunidad'], ...omitidas])}`,
  );
  fs.writeFileSync(
    path.join(CARPETA_REPORTES, 'pacientes_cargados.csv'),
    `﻿${csv([['expediente', 'expediente_papel', 'apellidos', 'nombres', 'sexo', 'nacimiento_aprox', 'comunidad', 'veces_en_el_libro', 'origen'],
      ...cargables.map((p) => [p.expediente, p.codigo, p.apellidos, p.nombres, p.sexo,
        p.fechaNacimiento.toISOString().slice(0, 10), p.comunidad, p.registros, p.origen.join(' / ')])])}`,
  );

  console.log(`Filas leídas: ${crudas.length}`);
  console.log(`Códigos copiados por error (ignorados): ${[...invalidos].join(', ') || 'ninguno'}`);
  console.log(`Comunidades: ${comunidades.comunidades.length}`);
  console.log(`Personas distintas: ${personas.length}`);
  console.log(`Se cargan: ${cargables.length}`);
  console.log(`No se cargan: ${omitidas.length}`);
  console.log(`Expedientes por año: ${JSON.stringify(contadores)}`);

  if (!APLICAR) {
    console.log('\nRevisión sin cambios. Para escribir en la base agregue --aplicar.');
    return;
  }

  const admin = await prisma.usuario.findFirst({ where: { rol: 'admin', establecimientoId: establecimiento.id } });
  const eid = establecimiento.id;

  await prisma.$transaction(async (tx) => {
    // 1. Pacientes de prueba y todo lo que depende de ellos. Los movimientos
    // de inventario se conservan: el saldo no cambia, solo pierden el enlace
    // a la dispensacion borrada.
    const pacientesPrueba = await tx.paciente.findMany({ where: { establecimientoId: eid }, select: { id: true } });
    const idsPaciente = pacientesPrueba.map((p) => p.id);
    const atenciones = await tx.atencion.findMany({ where: { pacienteId: { in: idsPaciente } }, select: { id: true } });
    const idsAtencion = atenciones.map((a) => a.id);
    const prescripciones = await tx.prescripcion.findMany({ where: { atencionId: { in: idsAtencion } }, select: { id: true } });
    const idsPrescripcion = prescripciones.map((p) => p.id);

    await tx.demandaNoAtendida.deleteMany({
      where: { OR: [{ pacienteId: { in: idsPaciente } }, { prescripcionId: { in: idsPrescripcion } }] },
    });
    await tx.dispensacion.deleteMany({ where: { prescripcionId: { in: idsPrescripcion } } });
    await tx.prescripcion.deleteMany({ where: { id: { in: idsPrescripcion } } });
    await tx.notaCorreccion.deleteMany({ where: { atencionId: { in: idsAtencion } } });
    await tx.preconsulta.deleteMany({ where: { atencionId: { in: idsAtencion } } });
    await tx.antropometria.deleteMany({ where: { pacienteId: { in: idsPaciente } } });
    await tx.constanciaEntrega.deleteMany({ where: { atencionId: { in: idsAtencion } } });
    await tx.atencion.deleteMany({ where: { id: { in: idsAtencion } } });
    await tx.retiroPaciente.deleteMany({ where: { pacienteId: { in: idsPaciente } } });
    await tx.episodioEmbarazo.deleteMany({ where: { pacienteId: { in: idsPaciente } } });
    await tx.condicionPaciente.deleteMany({ where: { pacienteId: { in: idsPaciente } } });
    await tx.paciente.deleteMany({ where: { id: { in: idsPaciente } } });
    // Las alertas de pacientes y comunidades se recalculan solas.
    await tx.alerta.deleteMany({
      where: { establecimientoId: eid, entidadTipo: { in: ['paciente', 'lugar_poblado'] } },
    });

    // 2. Catalogo de comunidades: el del libro, sin territorio ni sector.
    await tx.lugarPoblado.deleteMany({ where: { establecimientoId: eid } });
    await tx.lugarPoblado.createMany({
      data: comunidades.comunidades.map((c) => ({ establecimientoId: eid, nombre: c.nombre, categoria: c.categoria })),
    });
    const lugares = await tx.lugarPoblado.findMany({ where: { establecimientoId: eid }, select: { id: true, nombre: true } });
    const idLugar = new Map(lugares.map((l) => [l.nombre, l.id]));

    // 3. Pacientes.
    const LOTE = 500;
    for (let i = 0; i < cargables.length; i += LOTE) {
      await tx.paciente.createMany({
        data: cargables.slice(i, i + LOTE).map((p) => ({
          establecimientoId: eid,
          expediente: p.expediente,
          expedientePapel: p.codigo,
          nombres: p.nombres,
          apellidos: p.apellidos,
          fechaNacimiento: p.fechaNacimiento,
          fechaNacimientoEstimada: true,
          sexo: p.sexo,
          comunidad: p.comunidad ?? 'Sin registrar',
          lugarPobladoId: p.comunidad ? idLugar.get(p.comunidad) : null,
          creadoEn: p.primeraVez,
        })),
      });
    }

    // Condiciones que se derivan de la edad (menor de 5, adulto mayor).
    const creados = await tx.paciente.findMany({
      where: { establecimientoId: eid },
      select: { id: true, fechaNacimiento: true },
    });
    const condiciones = creados.flatMap((p) =>
      condicionesPorEdad(p.fechaNacimiento).map((tipo) => ({ pacienteId: p.id, tipo })));
    if (condiciones.length) await tx.condicionPaciente.createMany({ data: condiciones });

    // Correlativos: el siguiente registro sigue la numeracion.
    await tx.correlativoExpediente.deleteMany({ where: { establecimientoId: eid } });
    await tx.correlativoExpediente.createMany({
      data: Object.entries(contadores).map(([anio, ultimo]) => ({ establecimientoId: eid, anio: Number(anio), ultimo })),
    });

    // 4. Bitacora.
    await tx.bitacora.createMany({
      data: [
        { usuarioId: admin.id, accion: 'eliminar', entidad: 'paciente',
          detalle: `Pacientes de prueba eliminados antes de la carga inicial: ${idsPaciente.length}` },
        { usuarioId: admin.id, accion: 'actualizar', entidad: 'lugar_poblado',
          detalle: `Catálogo de comunidades reemplazado por el del libro de Excel: ${lugares.length}` },
        { usuarioId: admin.id, accion: 'crear', entidad: 'paciente',
          detalle: `Carga inicial desde el libro de Excel: ${cargables.length} pacientes, ${omitidas.length} filas sin cargar` },
      ],
    });
  }, { timeout: 300000, maxWait: 20000 });

  // La cobertura por comunidad es una vista materializada: se refresca.
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW cobertura_comunidad');
  console.log('\nCarga aplicada.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
