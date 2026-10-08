import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { borradorReferencia, antecedentesDe, numeroReferencia } from '../src/services/referencia.service.js';
import { seccionesDe } from '../src/services/fichaSecciones.service.js';

/**
 * Boleta de Referencia y Contrarreferencia: se llena con lo que ya se sabe,
 * lleva correlativo por anio y guarda la contrarreferencia al regreso.
 */

const MARCA = `REF${Date.now()}`;
let tokenPre;
let tokenMedico;

async function login(usuario) {
  return (await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' })).body.token;
}
const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);
const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);

async function atencionNueva() {
  const p = (await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres: 'Referida', apellidos: `Prueba ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento: '1990-03-03', sexo: 'F', comunidad: 'Tisipe', telefono: '55551234', confirmarDuplicado: true,
  })).body.paciente;
  const r = await pre(request(app).post('/api/v1/atenciones/con-preconsulta')).send({
    pacienteId: p.id, motivoConsulta: 'Dolor abdominal', temperatura: 38.2, frecCardiaca: 96, presionSis: 120, presionDia: 80, peso: 60,
  });
  return r.body.preconsulta.atencionId;
}

const boleta = (id) => ({
  tipo: 'emergencia',
  servicioDestino: 'Hospital Regional de Chiquimula, Cirugía',
  horaTraslado: '14:30',
  motivo: 'Sospecha de apendicitis',
  antecedentes: { medicos: 'Niega', alergicos: 'Sí' },
  examenFisico: { pa: '120/80', fcf: '' },
});

beforeAll(async () => {
  [tokenPre, tokenMedico] = await Promise.all([login('preconsulta'), login('medico')]);
});

afterAll(async () => {
  const ids = (await prisma.paciente.findMany({ where: { expedientePapel: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id);
  const aIds = (await prisma.atencion.findMany({ where: { pacienteId: { in: ids } }, select: { id: true } })).map((a) => a.id);
  await prisma.referencia.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.antropometria.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.atencion.deleteMany({ where: { id: { in: aIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('borrador de la boleta', () => {
  const defAdulto = seccionesDe('adulto', { sexo: 'F', edadMeses: 400 });

  it('separa alergias, cirugías y traumas de los antecedentes médicos', () => {
    const a = antecedentesDe({
      paciente: { sexo: 'F' },
      secciones: [
        { seccion: 'medicos_adulto', datos: { diabetes: true, alergias: true, cirugias: false, traumas: false, otrosMedicos: 'Gastritis' } },
        { seccion: 'personales_adulto', datos: { embarazos: 3, hijos: 2, hijosVivos: 1, abortos: 1 } },
      ],
      seccionesDef: defAdulto,
    });
    expect(a).toMatchObject({
      medicos: 'Diabetes, Gastritis', alergicos: 'Sí', quirurgicos: 'Niega', traumaticos: 'Niega',
      gestas: '3', abortos: '1', hijosVivos: '1', hijosMuertos: '1', mentales: '',
    });
  });

  it('lo no preguntado queda en blanco para escribirlo a mano', () => {
    const a = antecedentesDe({ paciente: { sexo: 'M' }, secciones: [], seccionesDef: defAdulto });
    expect(a.medicos).toBe('');
    expect(a.alergicos).toBe('');
  });

  it('toma signos, diagnósticos y lo recetado', () => {
    const b = borradorReferencia({
      atencion: {
        gravedad: 'urgente', referidoA: 'Hospital', motivoConsulta: 'Dolor',
        preconsulta: { peso: 60, talla: 155, frecCardiaca: 90, presionSis: 110, presionDia: 70, frecRespiratoria: 20, temperatura: 37.5 },
        diagnosticos: [{ orden: 2, cie: 'R10', descripcion: 'Dolor abdominal' }, { orden: 1, cie: 'K35', descripcion: 'Apendicitis' }],
        prescripciones: [{ cantidad: 10, indicaciones: '1 c/8h', insumo: { nombreGenerico: 'Acetaminofén', concentracion: '500 mg' } }],
      },
      paciente: { sexo: 'F', telefono: '5555' },
    });
    expect(b.tipo).toBe('emergencia');
    expect(b.examenFisico).toMatchObject({ peso: '60 kg', pa: '110/70', pulso: '90', temperatura: '37.5 °C' });
    expect(b.impresionClinica).toBe('K35 Apendicitis; R10 Dolor abdominal');
    expect(b.tratamiento).toContain('Acetaminofén 500 mg #10, 1 c/8h');
    expect(b.historia).toBe('Dolor');
  });

  it('número con cuatro cifras y el año', () => {
    expect(numeroReferencia({ correlativo: 7, anio: 2026 })).toBe('0007-2026');
  });
});

describe('guardar la boleta', () => {
  it('el borrador ya trae los signos de la preconsulta', async () => {
    const id = await atencionNueva();
    const r = await med(request(app).get(`/api/v1/atenciones/${id}/referencia`));
    expect(r.status).toBe(200);
    expect(r.body.referencia).toBeNull();
    expect(r.body.borrador.examenFisico).toMatchObject({ pa: '120/80', pulso: '96' });
    expect(r.body.borrador.telefono).toBe('55551234');
    expect(r.body.paciente.edad).toMatch(/años/);
  });

  it('asigna correlativos seguidos y no los cambia al corregir', async () => {
    const [a, b] = [await atencionNueva(), await atencionNueva()];
    const r1 = await med(request(app).put(`/api/v1/atenciones/${a}/referencia`)).send(boleta(a));
    const r2 = await med(request(app).put(`/api/v1/atenciones/${b}/referencia`)).send(boleta(b));
    expect(r1.status).toBe(201);
    expect(r2.body.referencia.correlativo).toBe(r1.body.referencia.correlativo + 1);

    const otra = await med(request(app).put(`/api/v1/atenciones/${a}/referencia`)).send({ ...boleta(a), motivo: 'Abdomen agudo' });
    expect(otra.status).toBe(200);
    expect(otra.body.referencia).toMatchObject({ correlativo: r1.body.referencia.correlativo, motivo: 'Abdomen agudo' });
  });

  it('exige el servicio y el motivo; solo el médico la llena', async () => {
    const id = await atencionNueva();
    expect((await med(request(app).put(`/api/v1/atenciones/${id}/referencia`)).send({ tipo: 'emergencia', servicioDestino: '', motivo: '' })).status).toBe(400);
    expect((await pre(request(app).put(`/api/v1/atenciones/${id}/referencia`)).send(boleta(id))).status).toBe(403);
  });

  it('la contrarreferencia se registra después, sobre la misma boleta', async () => {
    const id = await atencionNueva();
    expect((await pre(request(app).put(`/api/v1/atenciones/${id}/contrarreferencia`)).send({ resumen: 'x' })).status).toBe(409);
    await med(request(app).put(`/api/v1/atenciones/${id}/referencia`)).send(boleta(id));
    const r = await pre(request(app).put(`/api/v1/atenciones/${id}/contrarreferencia`)).send({
      servicio: 'Cirugía', diagnostico: 'Apendicitis aguda', recomendaciones: 'Control en 8 días', fechaAlta: '2026-10-05',
    });
    expect(r.status).toBe(200);
    expect(r.body.referencia.contraDiagnostico).toBe('Apendicitis aguda');
    expect(r.body.referencia.contraRecibidaEn).toBeTruthy();
  });
});
