// Fases C y D: registro rápido, ficha completa, edad aproximada, embarazo
// como episodio, datos sensibles y búsqueda tolerante a errores.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

const MARCA = 'CDQA';
let tokenPre;
let tokenMedico;
let tokenAdmin;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}

const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);
const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);
const adm = (p) => p.set('Authorization', `Bearer ${tokenAdmin}`);

const sufijo = () => Math.random().toString(36).slice(2, 8);
const hace = (anios) => {
  const f = new Date();
  f.setFullYear(f.getFullYear() - anios);
  return f.toISOString().slice(0, 10);
};

async function crear(datos = {}, como = pre) {
  return como(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${sufijo()}`,
    nombres: 'Registro',
    apellidos: `Prueba ${sufijo()}`,
    fechaNacimiento: hace(35),
    sexo: 'F',
    comunidad: 'Tisipe',
    confirmarDuplicado: true,
    ...datos,
  });
}

beforeAll(async () => {
  [tokenPre, tokenMedico, tokenAdmin] = await Promise.all([
    login('preconsulta'), login('medico'), login('admin'),
  ]);
});

afterAll(async () => {
  const ids = (await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } }, select: { id: true },
  })).map((p) => p.id);

  if (ids.length > 0) {
    await prisma.episodioEmbarazo.deleteMany({ where: { pacienteId: { in: ids } } });
    await prisma.antropometria.deleteMany({ where: { pacienteId: { in: ids } } });
    const at = await prisma.atencion.findMany({ where: { pacienteId: { in: ids } }, select: { id: true } });
    await prisma.preconsulta.deleteMany({ where: { atencionId: { in: at.map((a) => a.id) } } });
    await prisma.atencion.deleteMany({ where: { id: { in: at.map((a) => a.id) } } });
    await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
    await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.lugarPoblado.deleteMany({ where: { nombre: { startsWith: MARCA } } });
  await prisma.$disconnect();
});

describe('C1. Registro rápido', () => {
  it('se completa con lo mínimo para poder atender', async () => {
    const r = await crear();

    expect(r.status).toBe(201);
    // El registro rápido nunca deja la ficha completa: falta el resto.
    expect(r.body.paciente.ficha.completa).toBe(false);
    expect(r.body.paciente.ficha.faltantes.length).toBeGreaterThan(0);
  });

  it('exige responsable en menores de 18', async () => {
    const r = await crear({ fechaNacimiento: hace(8), responsableNombre: undefined });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('responsable_requerido');
  });

  it('lo llama referente adulto de 10 a 17', async () => {
    const r = await crear({ fechaNacimiento: hace(14), responsableNombre: undefined });

    expect(r.body.error.mensaje).toContain('referente adulto');
  });

  it('no pide responsable a un adulto', async () => {
    const r = await crear({ fechaNacimiento: hace(40) });

    expect(r.status).toBe(201);
  });
});

describe('C2. Campos según la edad', () => {
  it('no pregunta escolaridad de niñez a un adulto', async () => {
    const r = await crear({ fechaNacimiento: hace(40) });
    const c = r.body.paciente.camposVisibles;

    expect(c.escolaridadNinez).toBe(false);
    expect(c.contactoDigital).toBe(true);
    expect(c.orientacionSexual).toBe(true);
  });

  it('pide referente adulto y escolaridad de adolescencia a los 14', async () => {
    const r = await crear({
      fechaNacimiento: hace(14),
      responsableNombre: 'Ana López',
      responsableParentesco: 'madre',
    });
    const c = r.body.paciente.camposVisibles;

    expect(c.referenteAdulto).toBe(true);
    expect(c.escolaridadAdolescente).toBe(true);
    expect(c.contactoDigital).toBe(false);
  });

  it('devuelve la etapa de vida que corresponde a la ficha', async () => {
    const r = await crear({ fechaNacimiento: hace(70) });

    expect(r.body.paciente.etapa.clave).toBe('persona_mayor');
  });
});

describe('C3. Edad aproximada', () => {
  it('acepta la edad declarada cuando no se conoce la fecha', async () => {
    const r = await crear({ fechaNacimiento: undefined, edadDeclarada: { valor: 45, unidad: 'anios' } });

    expect(r.status).toBe(201);
    expect(r.body.paciente.edadEstimada).toBe(true);
    expect(r.body.paciente.edad.anios).toBe(45);
  });

  it('avisa cuando la unidad no corresponde a la edad', async () => {
    const r = await crear({ fechaNacimiento: undefined, edadDeclarada: { valor: 40, unidad: 'dias' } });

    expect(r.status).toBe(400);
    expect(r.body.error.mensaje).toContain('menores de un mes');
  });

  it('exige fecha o edad, no puede faltar ninguna', async () => {
    const r = await crear({ fechaNacimiento: undefined });

    expect(r.status).toBe(400);
  });

  it('deja de ser aproximada al corregirla con la fecha real', async () => {
    const creado = await crear({ fechaNacimiento: undefined, edadDeclarada: { valor: 30, unidad: 'anios' } });
    const r = await pre(request(app).patch(`/api/v1/pacientes/${creado.body.paciente.id}`))
      .send({ fechaNacimiento: hace(31) });

    expect(r.body.paciente.edadEstimada).toBe(false);
  });
});

describe('C4. Comunidad como catálogo', () => {
  it('toma el nombre del catálogo, no el texto escrito', async () => {
    const nombre = `${MARCA} Shalaguá ${sufijo()}`;
    const creado = await adm(request(app).post('/api/v1/catalogos/lugares'))
      .send({ nombre, categoria: 'aldea', territorio: 'Región VI' });
    const lugarId = creado.body.lugar.id;

    const r = await crear({ comunidad: undefined, lugarPobladoId: lugarId });

    expect(r.status).toBe(201);
    // Se guarda el nombre oficial del catálogo, con su tilde.
    expect(r.body.paciente.comunidad).toBe(nombre);
    expect(r.body.paciente.lugarPobladoId).toBe(lugarId);
  });

  it('rechaza un lugar que no existe', async () => {
    const r = await crear({ comunidad: undefined, lugarPobladoId: 999999 });

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe('lugar_invalido');
  });
});

describe('C5. El embarazo es un episodio', () => {
  it('se abre, da prioridad y se cierra', async () => {
    const paciente = (await crear({ sexo: 'F', fechaNacimiento: hace(25) })).body.paciente;

    const abierto = await pre(request(app).post(`/api/v1/pacientes/${paciente.id}/embarazos`))
      .send({ semanasAlRegistrar: 10 });

    expect(abierto.status).toBe(201);
    expect(abierto.body.embarazo.estado).toBe('activo');

    const conEmbarazo = await pre(request(app).get(`/api/v1/pacientes/${paciente.id}`));
    expect(conEmbarazo.body.paciente.embarazo.semanas).toBeGreaterThanOrEqual(10);

    const cerrado = await pre(request(app).patch(`/api/v1/pacientes/${paciente.id}/embarazos/cerrar`))
      .send({ motivo: 'Parto registrado' });

    expect(cerrado.body.embarazo.estado).toBe('finalizado');

    const sinEmbarazo = await pre(request(app).get(`/api/v1/pacientes/${paciente.id}`));
    expect(sinEmbarazo.body.paciente.embarazo).toBeNull();
  });

  it('no permite dos embarazos activos a la vez', async () => {
    const paciente = (await crear({ sexo: 'F', fechaNacimiento: hace(25) })).body.paciente;

    await pre(request(app).post(`/api/v1/pacientes/${paciente.id}/embarazos`)).send({ semanasAlRegistrar: 8 });
    const segundo = await pre(request(app).post(`/api/v1/pacientes/${paciente.id}/embarazos`))
      .send({ semanasAlRegistrar: 8 });

    expect(segundo.status).toBe(409);
    expect(segundo.body.error.codigo).toBe('embarazo_activo');
  });

  it('calcula la fecha probable de parto desde la última regla', async () => {
    const paciente = (await crear({ sexo: 'F', fechaNacimiento: hace(28) })).body.paciente;

    const r = await pre(request(app).post(`/api/v1/pacientes/${paciente.id}/embarazos`))
      .send({ fechaUltimaRegla: '2026-01-01' });

    expect(r.body.embarazo.fechaProbableParto).toContain('2026-10-08');
  });

  it('no registra embarazo en pacientes de sexo masculino', async () => {
    const paciente = (await crear({ sexo: 'M', fechaNacimiento: hace(30) })).body.paciente;

    const r = await pre(request(app).post(`/api/v1/pacientes/${paciente.id}/embarazos`))
      .send({ semanasAlRegistrar: 10 });

    expect(r.status).toBe(400);
  });
});

describe('C6. Datos sensibles', () => {
  it('el médico los guarda y los ve', async () => {
    const paciente = (await crear({ fechaNacimiento: hace(30) })).body.paciente;

    const guardado = await med(request(app).patch(`/api/v1/pacientes/${paciente.id}`))
      .send({ orientacionSexual: '1', antecedenteViolencia: 'Refiere violencia intrafamiliar' });

    expect(guardado.status).toBe(200);
    expect(guardado.body.paciente.antecedenteViolencia).toBe('Refiere violencia intrafamiliar');
  });

  it('preconsulta no los ve en la ficha', async () => {
    const paciente = (await crear({ fechaNacimiento: hace(30) })).body.paciente;
    await med(request(app).patch(`/api/v1/pacientes/${paciente.id}`))
      .send({ antecedenteViolencia: 'Dato reservado' });

    const r = await pre(request(app).get(`/api/v1/pacientes/${paciente.id}`));

    expect(r.status).toBe(200);
    expect(r.body.paciente).not.toHaveProperty('antecedenteViolencia');
  });

  it('preconsulta los registra una vez, pero no puede cambiarlos ni verlos después', async () => {
    const paciente = (await crear({ fechaNacimiento: hace(30) })).body.paciente;
    const ruta = `/api/v1/pacientes/${paciente.id}`;

    const alta = await pre(request(app).patch(ruta)).send({ ideasSuicidas: 'Registro desde la ficha de papel' });
    expect(alta.status).toBe(200);
    expect(alta.body.paciente.ideasSuicidas).toBeUndefined();

    const cambio = await pre(request(app).patch(ruta)).send({ ideasSuicidas: 'Otro valor' });
    expect(cambio.status).toBe(403);
  });

  it('no aparecen en los listados', async () => {
    const r = await med(request(app).get('/api/v1/pacientes').query({ limite: 5 }));

    expect(r.body.pacientes.every((p) => !('antecedenteViolencia' in p))).toBe(true);
  });

  it('su consulta queda en bitácora', async () => {
    const paciente = (await crear({ fechaNacimiento: hace(30) })).body.paciente;
    await med(request(app).patch(`/api/v1/pacientes/${paciente.id}`))
      .send({ ideasSuicidas: 'Registro de prueba' });

    await med(request(app).get(`/api/v1/pacientes/${paciente.id}`));

    const registros = await prisma.bitacora.findMany({
      where: { entidad: 'paciente_datos_sensibles', entidadId: paciente.id },
    });
    expect(registros.length).toBeGreaterThan(0);
  });
});

describe('D. Búsqueda tolerante', () => {
  it('encuentra "Ramírez" buscando "ramires"', async () => {
    await crear({ nombres: 'Juana', apellidos: 'Ramírez Interiano', fechaNacimiento: hace(33) });

    const r = await pre(request(app).get('/api/v1/pacientes').query({ buscar: 'ramires interiano' }));

    expect(r.body.pacientes.some((p) => p.apellidos === 'Ramírez Interiano')).toBe(true);
  });

  it('encuentra sin tildes', async () => {
    await crear({ nombres: 'Mónica', apellidos: 'Pérez Solís', fechaNacimiento: hace(29) });

    const r = await pre(request(app).get('/api/v1/pacientes').query({ buscar: 'perez solis' }));

    expect(r.body.pacientes.some((p) => p.apellidos === 'Pérez Solís')).toBe(true);
  });

  it('encuentra a los hijos buscando el nombre de la madre', async () => {
    const madre = `Rosaura Guzmán ${sufijo()}`;
    await crear({
      nombres: 'Hijo',
      apellidos: `Guzman ${sufijo()}`,
      fechaNacimiento: hace(6),
      responsableNombre: madre,
      responsableParentesco: 'madre',
    });

    const r = await pre(request(app).get('/api/v1/pacientes').query({ buscar: madre }));

    const encontrado = r.body.pacientes.find((p) => p.responsableNombre === madre);
    expect(encontrado).toBeTruthy();
    expect(encontrado.razonCoincidencia).toContain('responsable');
  });

  it('busca por expediente en papel', async () => {
    const papel = `${MARCA}-PAPEL-${sufijo()}`;
    await crear({ expedientePapel: papel, fechaNacimiento: hace(50) });

    const r = await pre(request(app).get('/api/v1/pacientes').query({ buscar: papel }));

    expect(r.body.pacientes.some((p) => p.expedientePapel === papel)).toBe(true);
  });

  it('filtra por etapa de vida sin texto de búsqueda', async () => {
    await crear({ fechaNacimiento: hace(3), responsableNombre: 'Madre', responsableParentesco: 'madre' });

    const r = await pre(request(app).get('/api/v1/pacientes').query({ etapa: 'lactante_ninez' }));

    expect(r.body.pacientes.length).toBeGreaterThan(0);
    expect(r.body.pacientes.every((p) => p.edad.anios < 10)).toBe(true);
  });

  it('filtra por ficha incompleta', async () => {
    const r = await pre(request(app).get('/api/v1/pacientes').query({ fichaIncompleta: 'true' }));

    expect(r.body.pacientes.every((p) => p.ficha.completa === false)).toBe(true);
  });

  it('filtra por embarazo activo', async () => {
    const paciente = (await crear({ sexo: 'F', fechaNacimiento: hace(24) })).body.paciente;
    await pre(request(app).post(`/api/v1/pacientes/${paciente.id}/embarazos`)).send({ semanasAlRegistrar: 12 });

    const r = await pre(request(app).get('/api/v1/pacientes').query({ embarazoActivo: 'true' }));

    expect(r.body.pacientes.every((p) => p.embarazoActivo === true)).toBe(true);
    expect(r.body.pacientes.some((p) => p.id === paciente.id)).toBe(true);
  });

  it('combina filtros sin texto: menores de 5 de una comunidad', async () => {
    const r = await pre(request(app).get('/api/v1/pacientes').query({
      etapa: 'lactante_ninez',
      comunidad: 'Tisipe',
    }));

    expect(r.status).toBe(200);
    expect(r.body.pacientes.every((p) => p.comunidad === 'Tisipe')).toBe(true);
  });

  it('pagina de 25 en 25 por omisión', async () => {
    const r = await pre(request(app).get('/api/v1/pacientes'));

    expect(r.body.paginacion.limite).toBe(25);
  });
});
