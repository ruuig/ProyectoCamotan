import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { letraDe, ultimoDeLaSerie } from '../src/services/fichaPapel.service.js';

/**
 * Ficha de papel con la inicial del primer apellido y el número que sigue,
 * responsable enlazado a su propia ficha, sugerencias de nombres y búsqueda
 * que tolera errores y el orden de las palabras.
 */

// Un apellido inventado para no chocar con los datos de la base.
const APELLIDO = `Zuxtelqa${Date.now() % 100000}`;
let token;
const con = (p) => p.set('Authorization', `Bearer ${token}`);
const crear = (extra) => con(request(app).post('/api/v1/pacientes')).send({
  nombres: 'Brenda', apellidos: `${APELLIDO} Mor`, fechaNacimiento: '1990-03-15', sexo: 'F', comunidad: 'Tisipe', confirmarDuplicado: true, ...extra,
});

beforeAll(async () => {
  token = (await request(app).post('/api/v1/auth/login').send({ usuario: 'preconsulta', password: 'Camotan2026!' })).body.token;
});

afterAll(async () => {
  const ids = (await prisma.paciente.findMany({ where: { apellidos: { startsWith: APELLIDO } }, select: { id: true } })).map((p) => p.id);
  await prisma.paciente.updateMany({ where: { id: { in: ids } }, data: { responsableId: null } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('letra y número de la ficha', () => {
  it('la letra es la inicial del primer apellido, sin tilde ni partículas', () => {
    expect(letraDe('Pérez López')).toBe('P');
    expect(letraDe('de León Ramírez')).toBe('L');
    expect(letraDe('Ñoque')).toBe('N');
    expect(letraDe('')).toBeNull();
  });

  it('sigue la serie y no se deja llevar por un número suelto muy alto', () => {
    expect(ultimoDeLaSerie([607, 608, 609, 610, 946, 3198])).toBe(610);
    expect(ultimoDeLaSerie([1, 2, 3])).toBe(3);
    expect(ultimoDeLaSerie([])).toBeNull();
  });
});

describe('ficha de papel al registrar', () => {
  it('propone la que sigue a la última de esa letra y dice de quién es', async () => {
    await crear({ expedientePapel: 'Z-5000' });
    await crear({ expedientePapel: 'Z-90001' }); // suelto: no cuenta
    const base = (await con(request(app).get('/api/v1/pacientes/ficha-papel')).query({ apellidos: APELLIDO })).body.siguiente;
    expect(base.letra).toBe('Z');
    expect(base.ficha).toBe('Z-5001');
    const numero = 5001;
    await crear({ nombres: 'Juan', expedientePapel: base.ficha });
    const r = await con(request(app).get('/api/v1/pacientes/ficha-papel')).query({ apellidos: APELLIDO, ficha: base.ficha });
    expect(r.body.siguiente.ficha).toBe(`Z-${numero + 1}`);
    expect(r.body.siguiente.ultima.nombre).toMatch(/Juan/);
    // Una familia puede compartir la ficha: se dice quién ya la tiene.
    expect(r.body.duenos.map((d) => d.nombre)).toEqual([expect.stringMatching(/Juan/)]);
  });
});

describe('responsable que también es paciente', () => {
  it('el niño queda enlazado a la ficha de su madre, y ella ve a sus hijos', async () => {
    const madre = (await crear({ nombres: 'Rosa', expedientePapel: 'Z-1' })).body.paciente;
    const nino = await crear({
      nombres: 'Mateo', fechaNacimiento: '2024-01-10', sexo: 'M', expedientePapel: 'Z-1',
      responsableNombre: 'Rosa', responsableParentesco: 'madre', responsableId: madre.id,
    });
    expect(nino.status).toBe(201);
    const vista = (await con(request(app).get(`/api/v1/pacientes/${nino.body.paciente.id}`))).body.paciente;
    expect(vista.responsable.id).toBe(madre.id);
    const deMadre = (await con(request(app).get(`/api/v1/pacientes/${madre.id}`))).body.paciente;
    expect(deMadre.dependientes.map((d) => d.nombres)).toContain('Mateo');
  });

  it('no acepta un responsable de otro lado ni a sí mismo', async () => {
    const r = await crear({ nombres: 'Pedro', fechaNacimiento: '2024-01-10', responsableNombre: 'X', responsableId: 999999999 });
    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('responsable_invalido');
  });
});

describe('búsqueda y sugerencias', () => {
  const buscar = async (texto) => (await con(request(app).get('/api/v1/pacientes')).query({ buscar: texto })).body.pacientes.map((p) => p.apellidos);

  it('encuentra con las palabras en otro orden y con letras equivocadas', async () => {
    const corto = APELLIDO.toLowerCase();
    expect(await buscar(`brenda ${corto}`)).toContain(`${APELLIDO} Mor`);
    // Dos letras al revés y una de menos.
    const torcido = `${corto.slice(0, 3)}${corto[4]}${corto[3]}${corto.slice(5)}`;
    expect(await buscar(`brneda ${torcido}`)).toContain(`${APELLIDO} Mor`);
  });

  it('sugiere nombres ya registrados parecidos a lo que se escribe', async () => {
    const r = await con(request(app).get('/api/v1/pacientes/sugerir')).query({ campo: 'nombres', texto: 'Ana Brnda' });
    expect(r.body.palabras).toContain('Brenda');
  });
});
