import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Caso real de punta a punta: llega una madre con su niño de 2 años, con
 * fiebre y tos desde hace tres días. Se registra, se le toman los signos, la
 * cola lo prioriza, el médico lo atiende y receta, farmacia le entrega y todo
 * queda en el SIGSA 3C/S y en el SIGSA 4 del mes.
 *
 * Usa medicamentos propios (con su lote y su traslado a farmacia) para no
 * mover existencias reales, y borra todo al terminar.
 */

const MARCA = `NIN${Date.now()}`;
const tokens = {};
let establecimientoId;
let farmaciaId;
const como = (rol) => (p) => p.set('Authorization', `Bearer ${tokens[rol]}`);
const bodega = como('bodega');
const farmacia = como('farmacia');
const medico = como('medico');
const pre = como('preconsulta');
const admin = como('admin');

const DIA = 86400000;
const hoyGt = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const enDias = (n) => new Date(Date.now() + n * DIA).toISOString().slice(0, 10);

const caso = {};

async function medicamento(nombre, lotes, categoria = 'medicamentos') {
  const r = await bodega(request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} ${nombre}`, categoria, presentacion: 'frasco', unidadMedida: 'unidad',
  });
  const insumo = r.body.insumo;
  insumo.lotes = [];
  for (const [numero, vence, cantidad] of lotes) {
    const l = await bodega(request(app).post(`/api/v1/insumos/${insumo.id}/lotes`)).send({ numeroLote: `${MARCA}${numero}`, fechaVence: enDias(vence), cantidad });
    insumo.lotes.push(l.body.lote);
    await bodega(request(app).post('/api/v1/bodega/traslados')).send({ ubicacionId: farmaciaId, recibidoPor: 'Farmacia', renglones: [{ loteId: l.body.lote.id, cantidad }] });
  }
  // Que el médico lo vea en su lista para recetar.
  await bodega(request(app).patch(`/api/v1/bodega/insumos/${insumo.id}/prescribible`)).send({ prescribible: true });
  return insumo;
}

async function limpiar() {
  const insumos = (await prisma.insumo.findMany({ where: { nombreGenerico: { startsWith: MARCA } }, select: { id: true } })).map((i) => i.id);
  const lotes = (await prisma.lote.findMany({ where: { insumoId: { in: insumos } }, select: { id: true } })).map((l) => l.id);
  const pacientes = (await prisma.paciente.findMany({ where: { expedientePapel: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id);
  const atenciones = (await prisma.atencion.findMany({ where: { pacienteId: { in: pacientes } }, select: { id: true } })).map((a) => a.id);
  await prisma.demandaNoAtendida.deleteMany({ where: { insumoId: { in: insumos } } });
  await prisma.movimientoInsumo.deleteMany({ where: { loteId: { in: lotes } } });
  await prisma.traslado.deleteMany({ where: { establecimientoId, movimientos: { none: {} } } });
  await prisma.dispensacion.deleteMany({ where: { prescripcion: { atencionId: { in: atenciones } } } });
  await prisma.prescripcion.deleteMany({ where: { atencionId: { in: atenciones } } });
  await prisma.insumoAlias.deleteMany({ where: { insumoId: { in: insumos } } });
  await prisma.lote.deleteMany({ where: { id: { in: lotes } } });
  await prisma.insumo.deleteMany({ where: { id: { in: insumos } } });
  await prisma.alerta.deleteMany({ where: { establecimientoId, entidadTipo: 'atencion', entidadId: { in: atenciones } } });
  await prisma.antropometria.deleteMany({ where: { atencionId: { in: atenciones } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: atenciones } } });
  await prisma.diagnosticoAtencion.deleteMany({ where: { atencionId: { in: atenciones } } });
  await prisma.atencion.deleteMany({ where: { id: { in: atenciones } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: pacientes } } });
  await prisma.paciente.deleteMany({ where: { id: { in: pacientes } } });
}

beforeAll(async () => {
  for (const rol of ['bodega', 'farmacia', 'medico', 'preconsulta', 'admin']) {
    tokens[rol] = (await request(app).post('/api/v1/auth/login').send({ usuario: rol, password: 'Camotan2026!' })).body.token;
  }
  establecimientoId = (await prisma.usuario.findUnique({ where: { usuario: 'farmacia' } })).establecimientoId;
  farmaciaId = (await prisma.ubicacion.findFirst({ where: { establecimientoId, tipo: 'centro_salud' } })).id;
  // Acetaminofén jarabe con dos lotes: el que vence antes debe salir primero.
  caso.acetaminofen = await medicamento('Acetaminofén jarabe 120 ml', [['A', 200, 5], ['B', 500, 5]]);
  caso.amoxicilina = await medicamento('Amoxicilina suspensión 250 mg/5 ml', [['C', 300, 3]]);
}, 60000);

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

describe('Un niño de 2 años con fiebre y tos, de la puerta a la farmacia', () => {
  it('1. Preconsulta lo registra con fecha de nacimiento y comunidad', async () => {
    const nacimiento = new Date(Date.now() - (2 * 365 + 90) * DIA).toISOString().slice(0, 10);
    const r = await pre(request(app).post('/api/v1/pacientes')).send({
      expedientePapel: `${MARCA}-1`, nombres: 'Josué', apellidos: 'Pérez Ramírez',
      fechaNacimiento: nacimiento, sexo: 'M', comunidad: 'Lantiquín', confirmarDuplicado: true,
      responsableNombre: 'María Ramírez', responsableParentesco: 'madre',
    });
    expect(r.status).toBe(201);
    caso.paciente = r.body.paciente;
  });

  it('2. Con fiebre de 39.6 y respiración rápida, el triaje no lo deja como leve', async () => {
    const r = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({
      pacienteId: caso.paciente.id,
      motivoConsulta: 'Fiebre y tos desde hace 3 días',
      peso: 11.5, talla: 86, temperatura: 39.6, frecCardiaca: 150, frecRespiratoria: 48, satOxigeno: 95,
    });
    expect(r.status).toBe(201);
    caso.atencion = { id: r.body.preconsulta.atencionId };
    // Fiebre alta y respiración rápida para su edad: moderado, con los dos motivos a la vista.
    expect(r.body.gravedad).toBe('moderado');
    expect(r.body.motivosTriaje.map((m) => m.etiqueta)).toEqual(expect.arrayContaining(['Fiebre alta', 'Respiración rápida']));
  });

  it('3. En la cola aparece con sus motivos y como menor de 5 años', async () => {
    const r = await pre(request(app).get('/api/v1/atenciones/cola'));
    const e = r.body.cola.find((x) => x.id === caso.atencion.id);
    expect(e).toBeTruthy();
    expect(e.tienePreconsulta).toBe(true);
    expect(e.paciente.condiciones).toContain('menor_5');
    expect(e.factores.some((f) => f.tipo === 'clinico')).toBe(true);
    caso.enCola = e;
  });

  it('4. El médico lo llama, receta lo que hay y cierra con su código CIE-10', async () => {
    expect((await medico(request(app).patch(`/api/v1/atenciones/${caso.atencion.id}/estado`)).send({ estado: 'en_atencion' })).status).toBe(200);
    const recetas = [[caso.acetaminofen.id, 1, '5 ml cada 6 horas si hay fiebre'], [caso.amoxicilina.id, 1, '5 ml cada 8 horas por 7 días']];
    for (const [insumoId, cantidad, indicaciones] of recetas) {
      const r = await medico(request(app).post(`/api/v1/atenciones/${caso.atencion.id}/prescripcion`)).send({ insumoId, cantidad, indicaciones });
      expect(r.status).toBe(201);
    }
    const r = await medico(request(app).patch(`/api/v1/atenciones/${caso.atencion.id}/consulta`)).send({
      diagnosticoCie: 'J06.9', diagnosticoTxt: 'Infección aguda de las vías respiratorias superiores', tipoConsulta: 1,
      tratamiento: 'Acetaminofén y amoxicilina. Líquidos abundantes. Volver si respira con dificultad.',
    });
    expect(r.status).toBe(200);
    expect(r.body.atencion.estado).toBe('atendido');
  });

  it('5. Al salir de consulta, farmacia lo ve esperando su receta', async () => {
    const r = await farmacia(request(app).get('/api/v1/dispensaciones/por-atender'));
    const p = r.body.porAtender.find((x) => x.atencionId === caso.atencion.id);
    expect(p).toBeTruthy();
    expect(p.medicamentos).toHaveLength(2);
  });

  it('6. Farmacia entrega todo, y el jarabe sale del lote que vence primero', async () => {
    const r = await farmacia(request(app).post(`/api/v1/dispensaciones/atenciones/${caso.atencion.id}`)).send({});
    expect(r.status).toBeLessThan(300);
    const [a, b] = caso.acetaminofen.lotes;
    const loteA = await prisma.lote.findUnique({ where: { id: a.id } });
    const loteB = await prisma.lote.findUnique({ where: { id: b.id } });
    expect(loteA.cantidadActual).toBe(4);
    expect(loteB.cantidadActual).toBe(5);
    const despues = await farmacia(request(app).get('/api/v1/dispensaciones/por-atender'));
    expect(despues.body.porAtender.some((x) => x.atencionId === caso.atencion.id)).toBe(false);
  });

  it('7. El SIGSA 3C/S de la semana lo trae como primera consulta, masculino, con J06.9 y su tratamiento', async () => {
    const r = await admin(request(app).get(`/api/v1/sigsa/3cs?desde=${hoyGt()}&hasta=${hoyGt()}`));
    const renglon = r.body.renglones.find((x) => x.atencionId === caso.atencion.id);
    expect(renglon).toBeTruthy();
    expect(renglon.sexo).toBe('M');
    expect(renglon.consulta).toBe('1');
    expect(renglon.diagnosticos.map((d) => d.cie)).toContain('J06.9');
    expect(renglon.tratamiento.length).toBeGreaterThan(0);
    caso.renglon3cs = renglon;
  });

  it('8. El SIGSA 4 del mes trae lo entregado a nombre del niño', async () => {
    const periodo = hoyGt().slice(0, 7);
    const r = await farmacia(request(app).get(`/api/v1/dispensaciones/sigsa4?periodo=${periodo}`));
    const delNino = r.body.renglones.filter((x) => JSON.stringify(x).includes(MARCA) || JSON.stringify(x).includes('Pérez Ramírez'));
    expect(delNino.length).toBeGreaterThan(0);
    caso.renglones4 = delNino;
  });

  it('9. El panel de dirección lo cuenta en la niñez y con su código', async () => {
    const r = await admin(request(app).get('/api/v1/indicadores/panel/admin?periodo=semana'));
    expect(r.body.etapas.lactante_ninez).toBeGreaterThan(0);
    expect(r.body.codificacion.codificadas).toBeLessThanOrEqual(r.body.codificacion.atendidas);
  });
});

describe('El médico receta más de lo que hay en farmacia', () => {
  it('se entrega lo que hay, el resto queda como no entregado en el SIGSA 4 y en el día de farmacia', async () => {
    const r = await pre(request(app).post('/api/v1/pacientes')).send({
      expedientePapel: `${MARCA}-2`, nombres: 'Ana', apellidos: 'López Díaz',
      fechaNacimiento: '1988-03-10', sexo: 'F', comunidad: 'Tisipe', confirmarDuplicado: true,
    });
    const pacienteId = r.body.paciente.id;
    const a = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({ pacienteId, motivoConsulta: 'Tos', temperatura: 37.2 });
    const atencionId = a.body.preconsulta.atencionId;
    await medico(request(app).patch(`/api/v1/atenciones/${atencionId}/estado`)).send({ estado: 'en_atencion' });
    // Quedan 2 frascos de amoxicilina (el niño se llevó uno); se recetan 5.
    await medico(request(app).post(`/api/v1/atenciones/${atencionId}/prescripcion`)).send({ insumoId: caso.amoxicilina.id, cantidad: 5, indicaciones: 'cada 8 horas' });
    await medico(request(app).patch(`/api/v1/atenciones/${atencionId}/consulta`)).send({ diagnosticoCie: 'J20.9', diagnosticoTxt: 'Bronquitis aguda', tipoConsulta: 1 });

    const entrega = await farmacia(request(app).post(`/api/v1/dispensaciones/atenciones/${atencionId}`)).send({});
    expect(entrega.status).toBeLessThan(300);

    const lote = await prisma.lote.findUnique({ where: { id: caso.amoxicilina.lotes[0].id } });
    expect(lote.cantidadActual).toBe(0);

    const dia = await farmacia(request(app).get('/api/v1/farmacia/dia'));
    const fila = dia.body.filas.find((f) => f.insumoId === caso.amoxicilina.id);
    expect(fila.noEntregado).toBe(3);

    const s4 = await farmacia(request(app).get(`/api/v1/dispensaciones/sigsa4?periodo=${hoyGt().slice(0, 7)}`));
    const renglon = s4.body.renglones.find((x) => JSON.stringify(x).includes('López Díaz'));
    expect(JSON.stringify(renglon)).toContain('3');

    // Ya no espera en farmacia: lo que faltó no se puede entregar hoy.
    const espera = await farmacia(request(app).get('/api/v1/dispensaciones/por-atender'));
    expect(espera.body.porAtender.some((x) => x.atencionId === atencionId)).toBe(false);
  });
});

describe('Post-consulta de planificación familiar', () => {
  it('a una usuaria nueva se le aplica la Depo-Provera aquí, se le orienta y cuenta en el mes', async () => {
    const depo = await medicamento('Medroxiprogest. Acetato DEPOPROVERA 150mg Amp.', [['D', 400, 5]], 'planificacion_familiar');
    const r = await pre(request(app).post('/api/v1/pacientes')).send({
      expedientePapel: `${MARCA}-3`, nombres: 'Rosa', apellidos: 'Pérez Méndez',
      fechaNacimiento: '1998-05-02', sexo: 'F', comunidad: 'Tisipe', confirmarDuplicado: true,
    });
    const a = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({ pacienteId: r.body.paciente.id, motivoConsulta: 'Planificación familiar', temperatura: 36.6 });
    const atencionId = a.body.preconsulta.atencionId;
    await medico(request(app).patch(`/api/v1/atenciones/${atencionId}/estado`)).send({ estado: 'en_atencion' });
    const receta = await medico(request(app).post(`/api/v1/atenciones/${atencionId}/prescripcion`)).send({ insumoId: depo.id, cantidad: 1, indicaciones: 'Una inyección cada 3 meses' });
    await medico(request(app).patch(`/api/v1/atenciones/${atencionId}/consulta`)).send({ diagnosticoCie: 'Z30.4', diagnosticoTxt: 'Supervisión de anticonceptivos', tipoConsulta: 1 });

    const hoja = await farmacia(request(app).get(`/api/v1/dispensaciones/atenciones/${atencionId}`));
    expect(hoja.body.renglones[0].aplicable).toBe(true);

    const entrega = await farmacia(request(app).post(`/api/v1/dispensaciones/atenciones/${atencionId}`)).send({
      renglones: [{ prescripcionId: receta.body.prescripcion.id, cantidad: 1, aplicada: true }],
      orientado: true,
    });
    expect(entrega.status).toBe(201);

    const despues = await farmacia(request(app).get(`/api/v1/dispensaciones/atenciones/${atencionId}`));
    expect(despues.body.renglones[0].aplicada).toBe(true);
    expect(despues.body.orientadoEn).toBeTruthy();

    const pf = await admin(request(app).get(`/api/v1/indicadores/planificacion?periodo=${hoyGt().slice(0, 7)}`));
    const iny = pf.body.metodos.find((m) => m.clave === 'inyectable');
    expect(iny.nueva).toBeGreaterThanOrEqual(1);
    expect(iny.aplicado).toBeGreaterThanOrEqual(1);
  });
});
