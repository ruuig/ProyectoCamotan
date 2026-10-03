// Lista las mediciones antropometricas que quedan fuera de rango, para
// revisarlas con el expediente en la mano.
//
// Uso:  node scripts/revisarMediciones.js
//
// No corrige nada: solo informa. La correccion la decide quien atiende, que
// es el unico que sabe si fue un error de captura o un caso real.

const prisma = require('../src/config/db');
const { Z_MINIMO, Z_MAXIMO } = require('../src/services/plausibilidad.service');

function fuera(z) {
  if (z === null || z === undefined) return false;
  const valor = Number(z);
  return valor < Z_MINIMO || valor > Z_MAXIMO;
}

function edadLegible(meses) {
  if (meses < 12) return `${meses} m`;
  return `${Math.floor(meses / 12)} a`;
}

async function principal() {
  const mediciones = await prisma.antropometria.findMany({
    include: {
      paciente: {
        select: { id: true, expediente: true, nombres: true, apellidos: true, sexo: true },
      },
    },
    orderBy: { fecha: 'desc' },
  });

  const sospechosas = mediciones.filter(
    (m) =>
      m.improbable ||
      fuera(m.zPesoEdad) ||
      fuera(m.zTallaEdad) ||
      fuera(m.zPesoTalla) ||
      fuera(m.zImcEdad),
  );

  console.log(`Mediciones revisadas: ${mediciones.length}`);
  console.log(`Fuera de rango o marcadas: ${sospechosas.length}\n`);

  if (sospechosas.length === 0) {
    console.log('No hay mediciones que revisar.');
    return;
  }

  for (const m of sospechosas) {
    const p = m.paciente;
    console.log(`Expediente ${p.expediente} — ${p.apellidos}, ${p.nombres} (${p.sexo})`);
    console.log(`  Medicion #${m.id} del ${m.fecha.toISOString().slice(0, 10)}`
      + `, edad ${edadLegible(m.edadMeses)}`);
    console.log(`  Peso ${m.peso} kg · Talla ${m.talla} cm`
      + (m.perimetroBraquial ? ` · PB ${m.perimetroBraquial} mm` : ''));
    console.log(`  Z peso/edad ${m.zPesoEdad ?? '—'}`
      + ` · Z talla/edad ${m.zTallaEdad ?? '—'}`
      + ` · Z peso/talla ${m.zPesoTalla ?? '—'}`
      + ` · Z IMC/edad ${m.zImcEdad ?? '—'}`);
    console.log(`  Marcada como improbable: ${m.improbable ? 'si' : 'no'}`);
    if (m.motivoImprobable) console.log(`  Motivo: ${m.motivoImprobable}`);
    console.log('');
  }
}

principal()
  .catch((error) => {
    console.error('Fallo la revision:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
