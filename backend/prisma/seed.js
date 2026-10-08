const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const COSTO_BCRYPT = 12;

// Contrasenas de prueba, validas SOLO en ambiente de desarrollo.
// Deben cambiarse antes de cualquier despliegue real.
const USUARIOS_PRUEBA = [
  { usuario: 'admin', nombre: 'Administrador de Prueba', rol: 'admin', esDirector: false, password: 'Camotan2026!' },
  { usuario: 'preconsulta', nombre: 'Personal de Preconsulta', rol: 'preconsulta', esDirector: false, password: 'Camotan2026!' },
  { usuario: 'medico', nombre: 'Medico de Prueba', rol: 'medico', esDirector: false, password: 'Camotan2026!' },
  { usuario: 'farmacia', nombre: 'Personal de Farmacia', rol: 'farmacia', esDirector: false, password: 'Camotan2026!' },
  { usuario: 'bodega', nombre: 'Encargado de Bodega', rol: 'bodega', esDirector: false, password: 'Camotan2026!' },
  // Usuario separado del admin normal: permite probar el flujo de
  // reautenticacion de director sin mezclarlo con el admin de uso diario.
  { usuario: 'director', nombre: 'Director del Establecimiento', rol: 'admin', esDirector: true, dpi: '1234567890101', password: 'Director2026!' },
];

const SIGNOS_PELIGRO = [
  ['conv', 'Convulsiones', 'todos', 'urgente', 1],
  ['no_bebe', 'No puede beber ni mamar', 'menor_5', 'urgente', 2],
  ['vomita_todo', 'Vomita todo lo que ingiere', 'menor_5', 'urgente', 3],
  ['letargico', 'Letargico o inconsciente', 'todos', 'urgente', 4],
  ['tiraje', 'Tiraje subcostal', 'menor_5', 'urgente', 5],
  ['estridor', 'Estridor en reposo', 'menor_5', 'urgente', 6],
  ['deshidratacion', 'Signos de deshidratacion grave', 'todos', 'urgente', 7],
  ['sangrado', 'Sangrado activo', 'todos', 'urgente', 8],
  ['fiebre_alta', 'Fiebre mayor a 39 grados C', 'todos', 'moderado', 9],
  ['dificultad_resp', 'Dificultad respiratoria', 'todos', 'urgente', 10],
  ['edema', 'Edema en ambos pies', 'menor_5', 'urgente', 11],
  ['sangrado_vaginal', 'Sangrado vaginal', 'embarazada', 'urgente', 12],
  ['cefalea_severa', 'Cefalea severa con vision borrosa', 'embarazada', 'urgente', 13],
  ['dolor_pecho', 'Dolor toracico', 'adulto_mayor', 'urgente', 14],
];

// Catalogo minimo de insumos, sin lotes: los lotes se cargan en la Fase 5
// junto con la logica de recepcion e inventario.
const INSUMOS_MINIMOS = [
  ['Amoxicilina 500mg', 'medicamentos', 'capsula', 'unidad', 100],
  ['Paracetamol 500mg', 'medicamentos', 'tableta', 'unidad', 200],
  ['Suero de rehidratacion oral', 'medicamentos', 'sobre', 'unidad', 100],
  ['Gasa esteril', 'medico_quirurgico', 'paquete', 'unidad', 50],
  ['Guantes de latex', 'medico_quirurgico', 'caja', 'caja', 20],
  ['Jeringa descartable 5ml', 'medico_quirurgico', 'unidad', 'unidad', 200],
  ['Vacuna BCG', 'medicamentos', 'frasco', 'dosis', 10],
];

async function sembrarEstablecimiento() {
  return prisma.establecimiento.upsert({
    where: { codigo: 'PENDIENTE-CAMOTAN' },
    update: {},
    create: {
      codigo: 'PENDIENTE-CAMOTAN',
      nombre: 'Centro de Salud de Camotan',
      municipio: 'Camotan',
      departamento: 'Chiquimula',
      tipo: 'centro_salud_b',
    },
  });
}

// El establecimiento atiende con mas de una clinica: la cola asigna al
// paciente de mayor puntaje a la primera que quede libre.
const CLINICAS = ['Clinica 1', 'Clinica 2'];

async function sembrarClinicas(establecimientoId) {
  for (const nombre of CLINICAS) {
    const existente = await prisma.clinica.findFirst({ where: { establecimientoId, nombre } });
    if (!existente) {
      await prisma.clinica.create({ data: { establecimientoId, nombre } });
    }
  }
}

async function sembrarSignosPeligro(establecimientoId) {
  for (const [codigo, descripcion, grupoEtario, gravedadSugerida, orden] of SIGNOS_PELIGRO) {
    await prisma.signoPeligro.upsert({
      where: { establecimientoId_codigo: { establecimientoId, codigo } },
      update: {},
      create: { establecimientoId, codigo, descripcion, grupoEtario, gravedadSugerida, orden },
    });
  }
}

async function sembrarUsuarios(establecimientoId) {
  for (const u of USUARIOS_PRUEBA) {
    const passwordHash = await bcrypt.hash(u.password, COSTO_BCRYPT);
    await prisma.usuario.upsert({
      where: { usuario: u.usuario },
      update: {},
      create: {
        establecimientoId,
        usuario: u.usuario,
        passwordHash,
        nombre: u.nombre,
        rol: u.rol,
        esDirector: u.esDirector,
        dpi: u.dpi ?? null,
      },
    });
  }
}

async function sembrarInsumos(establecimientoId) {
  for (const [nombreGenerico, categoria, presentacion, unidadMedida, stockMinimo] of INSUMOS_MINIMOS) {
    const existente = await prisma.insumo.findFirst({ where: { establecimientoId, nombreGenerico } });
    if (existente) continue;
    await prisma.insumo.create({
      data: {
        establecimientoId, nombreGenerico, categoria, presentacion, unidadMedida, stockMinimo,
        prescribible: !['medico_quirurgico', 'laboratorio'].includes(categoria),
      },
    });
  }
}

// Patrones de crecimiento de la OMS. Ver prisma/datos/FUENTE.md.
// Son ~2770 filas, asi que se insertan en bloque y solo si faltan.
async function sembrarReferenciaOms() {
  const existentes = await prisma.referenciaOms.count();
  if (existentes > 0) {
    console.log(`Referencias OMS ya cargadas (${existentes} filas).`);
    return;
  }

  let datos;
  try {
    datos = require('./datos/referencia-oms.json');
  } catch {
    // El sistema debe seguir funcionando sin las tablas: los puntajes Z
    // quedan en null con el aviso correspondiente, nunca con valores falsos.
    console.warn('No se encontro datos/referencia-oms.json. Los puntajes Z quedaran sin calcular.');
    return;
  }

  const filas = datos.filas.map(([indicador, sexo, x, l, m, s]) => ({ indicador, sexo, x, l, m, s }));
  await prisma.referenciaOms.createMany({ data: filas, skipDuplicates: true });
  console.log(`Referencias OMS cargadas: ${filas.length} filas.`);
}

async function main() {
  const establecimiento = await sembrarEstablecimiento();
  await sembrarClinicas(establecimiento.id);
  await sembrarSignosPeligro(establecimiento.id);
  await sembrarUsuarios(establecimiento.id);
  // Con --solo-usuarios no se tocan catalogos: sirve en una base con datos reales.
  if (process.argv.includes('--solo-usuarios')) return;
  await sembrarInsumos(establecimiento.id);
  await sembrarReferenciaOms();

  console.log('Seed completado.');
  console.log('');
  console.log('Usuarios de prueba (usuario / password / rol):');
  for (const u of USUARIOS_PRUEBA) {
    console.log(`  ${u.usuario} / ${u.password} / ${u.rol}${u.esDirector ? ' (director)' : ''}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
