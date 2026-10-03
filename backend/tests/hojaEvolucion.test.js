import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Hoja de evolución del médico: MC, HE, EF, IC (varios diagnósticos), Tx y
 * los datos del SIGSA 3CS, sin pedir dos veces lo mismo.
 */

const MARCA = `HEV${Date.now()}`;
let tokenMedico;
let tokenPre;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}
const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);
const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);

let pacienteId;

async function atencionEnCurso() {
  const a = await pre(request(app).post('/api/v1/atenciones')).send({ pacienteId, motivoConsulta: 'Tos y fiebre' });
  const id = a.body.atencion.id;
  await pre(request(app).patch(`/api/v1/atenciones/${id}/estado`)).send({ estado: 'en_atencion' });
  return id;
}

beforeAll(async () => {
  tokenMedico = await login('medico');
  tokenPre = await login('preconsulta');
  const p = await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-1`, nombres: 'Hoja', apellidos: 'Evolucion', fechaNacimiento: '1985-02-01',
    sexo: 'F', comunidad: 'Tisipe', confirmarDuplicado: true,
  });
  pacienteId = p.body.paciente.id;
});

afterAll(async () => {
  const atenciones = await prisma.atencion.findMany({ where: { pacienteId }, select: { id: true } });
  const ids = atenciones.map((a) => a.id);
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: ids } } });
  await prisma.notaCorreccion.deleteMany({ where: { atencionId: { in: ids } } });
  await prisma.diagnosticoAtencion.deleteMany({ where: { atencionId: { in: ids } } });
  await prisma.atencion.deleteMany({ where: { id: { in: ids } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId } });
  await prisma.paciente.delete({ where: { id: pacienteId } });
});

describe('cierre con la hoja de evolución', () => {
  it('guarda MC, HE, EF, varios diagnósticos, Tx y el 3CS', async () => {
    const id = await atencionEnCurso();
    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      motivoConsulta: 'Tos de 5 días y fiebre',
      historiaEnfermedad: 'Inicia hace 5 días con tos productiva.',
      examenFisico: 'Orofaringe hiperémica. Campos pulmonares limpios.',
      diagnosticos: [
        { descripcion: 'Faringitis aguda', cie: 'J02.9' },
        { descripcion: 'Anemia leve' },
      ],
      tratamiento: 'Amoxicilina 500 mg cada 8 horas por 7 días.',
      controlSigsa: 0,
      referenciaViene: 0,
      referenciaFue: 1,
      referidoA: 'Hospital de Chiquimula',
      acompanante: 'Esposo',
    });
    expect(r.status).toBe(200);

    const a = await prisma.atencion.findUnique({ where: { id }, include: { diagnosticos: { orderBy: { orden: 'asc' } } } });
    expect(a.motivoConsulta).toBe('Tos de 5 días y fiebre');
    expect(a.historiaEnfermedad).toContain('tos productiva');
    expect(a.diagnosticos.map((d) => [d.orden, d.descripcion, d.cie])).toEqual([
      [0, 'Faringitis aguda', 'J02.9'],
      [1, 'Anemia leve', null],
    ]);
    // El principal queda copiado para los informes.
    expect(a.diagnosticoCie).toBe('J02.9');
    // Sin indicarlo, el sistema sugiere primera consulta.
    expect(a.tipoConsulta).toBe(1);
    expect(a.referidoA).toBe('Hospital de Chiquimula');
  });

  it('sugiere reconsulta si ya consultó por lo mismo este año', async () => {
    const id = await atencionEnCurso();
    const s = await med(request(app).get(`/api/v1/atenciones/${id}/sugerencia-tipo?cie=J02.0`));
    expect(s.body.valor).toBe(2);
    await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({ diagnosticos: [{ descripcion: 'Faringitis', cie: 'J02.0' }] });
    expect((await prisma.atencion.findUnique({ where: { id } })).tipoConsulta).toBe(2);
  });

  it('si fue referido exige a dónde', async () => {
    const id = await atencionEnCurso();
    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({
      diagnosticos: [{ descripcion: 'Neumonía' }], referenciaFue: 1,
    });
    expect(r.status).toBe(400);
    await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({ diagnosticos: [{ descripcion: 'Neumonía' }] });
  });

  it('sin diagnóstico no cierra', async () => {
    const id = await atencionEnCurso();
    const r = await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({ diagnosticos: [] });
    expect(r.status).toBe(400);
    await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({ diagnosticoTxt: 'Control' });
  });

  it('la consulta trae el resumen de antecedentes y los catálogos del 3CS', async () => {
    await pre(request(app).put(`/api/v1/pacientes/${pacienteId}/ficha/medicos_adulto`)).send({ datos: { diabetes: true, asma: false } });
    const id = await atencionEnCurso();
    const r = await med(request(app).get(`/api/v1/atenciones/${id}`));
    const medicos = r.body.antecedentes.find((s) => s.clave === 'medicos_adulto');
    expect(medicos.positivos).toEqual(['Diabetes']);
    expect(r.body.catalogos3cs.tipoConsulta).toHaveLength(4);
    await med(request(app).patch(`/api/v1/atenciones/${id}/consulta`)).send({ diagnosticoTxt: 'Control' });
  });
});

describe('buscador de diagnósticos', () => {
  it('encuentra los diagnósticos ya usados en el centro aunque no haya catálogo', async () => {
    const r = await med(request(app).get('/api/v1/catalogos/cie10?q=faring'));
    expect(r.status).toBe(200);
    expect(r.body.resultados.some((x) => x.codigo === 'J02.9' && x.frecuente)).toBe(true);
  });

  it('preconsulta no usa el buscador', async () => {
    const r = await pre(request(app).get('/api/v1/catalogos/cie10?q=faring'));
    expect(r.status).toBe(403);
  });
});
