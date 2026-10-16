import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { asignarClinicaLibre } from '../src/jobs/recalcularCola.js';

const MARCA = `COLA${Date.now()}`;
let tokenPre;
let tokenMedico;
let establecimientoId;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}

const pre = (p) => p.set('Authorization', `Bearer ${tokenPre}`);
const med = (p) => p.set('Authorization', `Bearer ${tokenMedico}`);

function hacemeses(n) {
  const f = new Date();
  f.setMonth(f.getMonth() - n);
  return f.toISOString().slice(0, 10);
}

async function nuevoPaciente({ meses = 300, nombres = 'Paciente', condiciones = [] } = {}) {
  const r = await pre(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres,
    apellidos: `Cola ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento: hacemeses(meses),
    sexo: condiciones.includes('embarazo') ? 'F' : 'M',
    comunidad: 'Tisipe',
    responsableNombre: 'Maria Lopez',
    responsableParentesco: 'madre',
    condiciones,
    confirmarDuplicado: true,
  });
  return r.body.paciente;
}

async function nuevaAtencion(opciones = {}) {
  const paciente = await nuevoPaciente(opciones);
  const r = await pre(request(app).post('/api/v1/atenciones')).send({
    pacienteId: paciente.id,
    motivoConsulta: opciones.motivo ?? 'Dolor de cabeza',
    gravedad: opciones.gravedad ?? 'leve',
  });
  return { paciente, atencion: r.body.atencion };
}

async function limpiar() {
  const pacientes = await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = pacientes.map((p) => p.id);
  if (ids.length === 0) return;

  const atenciones = await prisma.atencion.findMany({
    where: { pacienteId: { in: ids } },
    select: { id: true },
  });
  const aIds = atenciones.map((a) => a.id);

  await prisma.prescripcion.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.antropometria.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: aIds } } });
  await prisma.atencion.deleteMany({ where: { id: { in: aIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  [tokenPre, tokenMedico] = await Promise.all([login('preconsulta'), login('medico')]);
  const usuario = await prisma.usuario.findUnique({ where: { usuario: 'preconsulta' } });
  establecimientoId = usuario.establecimientoId;
});

beforeEach(async () => {
  // Cada prueba arranca con la cola y la clinica limpias.
  await limpiar();
  await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });
});

afterAll(async () => {
  await limpiar();
  await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });
  await prisma.$disconnect();
});

describe('GET /atenciones/cola', () => {
  it('devuelve la cola con puntaje y minutos de espera calculados', async () => {
    await nuevaAtencion();

    const r = await pre(request(app).get('/api/v1/atenciones/cola'));

    expect(r.status).toBe(200);
    expect(r.body.cola).toHaveLength(1);
    expect(r.body.cola[0].puntaje).toBeGreaterThan(0);
    expect(r.body.cola[0]).toHaveProperty('minutosEsperando');
    expect(r.body.resumen.enEspera).toBe(1);
  });

  it('pone al urgente primero aunque otro acumule mas puntaje', async () => {
    // Embarazada moderada con 3 horas de espera: 25 + 30 + 30 = 85 puntos.
    const { atencion: acumulado } = await nuevaAtencion({
      gravedad: 'moderado',
      nombres: 'Embarazada',
      condiciones: ['embarazo'],
    });
    await prisma.atencion.update({
      where: { id: acumulado.id },
      data: { registradaEn: new Date(Date.now() - 180 * 60000) },
    });

    // Urgente recien llegado sin condiciones: 40 + 0 + 5 = 45 puntos.
    const { atencion: urgente } = await nuevaAtencion({ gravedad: 'urgente', nombres: 'Urgente' });

    const r = await pre(request(app).get('/api/v1/atenciones/cola'));

    // La urgencia se resuelve antes de ordenar por puntaje.
    expect(r.body.cola[0].id).toBe(urgente.id);
    expect(r.body.cola[1].id).toBe(acumulado.id);
    expect(r.body.cola[1].puntaje).toBeGreaterThan(r.body.cola[0].puntaje);
  });

  it('quien quedó en espera de otra jornada no encabeza la cola: va aparte para cerrarlo', async () => {
    const { atencion: deAyer } = await nuevaAtencion({ gravedad: 'leve', nombres: 'Se fue ayer' });
    await prisma.atencion.update({ where: { id: deAyer.id }, data: { registradaEn: new Date(Date.now() - 20 * 3600000) } });
    const { atencion: deHoy } = await nuevaAtencion({ gravedad: 'leve', nombres: 'Llegó hoy' });

    const r = await pre(request(app).get('/api/v1/atenciones/cola'));

    expect(r.body.cola.some((e) => e.id === deAyer.id)).toBe(false);
    expect(r.body.cola.some((e) => e.id === deHoy.id)).toBe(true);
    expect(r.body.anteriores.map((e) => e.id)).toContain(deAyer.id);
  });

  it('el paciente que no fue atendido ayer se registra de nuevo hoy sin cancelar nada a mano', async () => {
    const { paciente, atencion: deAyer } = await nuevaAtencion({ nombres: 'Vuelve hoy' });
    await prisma.atencion.update({ where: { id: deAyer.id }, data: { registradaEn: new Date(Date.now() - 20 * 3600000) } });

    const r = await pre(request(app).post('/api/v1/atenciones')).send({ pacienteId: paciente.id, motivoConsulta: 'Sigue con dolor' });

    expect(r.status).toBe(201);
    const ayer = await prisma.atencion.findUnique({ where: { id: deAyer.id } });
    expect(ayer.estado).toBe('cancelada');
    expect(ayer.motivoCancelacion).toMatch(/jornada anterior/);
  });

  it('si su atención es de hoy, no se abre otra', async () => {
    const { paciente } = await nuevaAtencion({ nombres: 'Ya está en cola' });
    const r = await pre(request(app).post('/api/v1/atenciones')).send({ pacienteId: paciente.id, motivoConsulta: 'Otra vez' });
    expect(r.status).toBe(409);
  });

  it('informa cuando alguien supera los 90 minutos', async () => {
    const { atencion } = await nuevaAtencion();
    await prisma.atencion.update({
      where: { id: atencion.id },
      data: { registradaEn: new Date(Date.now() - 100 * 60000) },
    });

    const r = await pre(request(app).get('/api/v1/atenciones/cola'));

    expect(r.body.resumen.superan90).toBe(1);
    expect(r.body.resumen.esperaMaxima).toBeGreaterThanOrEqual(100);
    expect(r.body.resumen.masAntiguo.id).toBe(atencion.id);
  });

  it('niega el acceso a farmacia', async () => {
    const token = await login('farmacia');
    const r = await request(app)
      .get('/api/v1/atenciones/cola')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });
});

describe('PATCH /atenciones/:id/estado', () => {
  it('llama al paciente y ocupa la clinica', async () => {
    const { atencion } = await nuevaAtencion();

    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({
      estado: 'en_atencion',
    });

    expect(r.status).toBe(200);
    expect(r.body.atencion.estado).toBe('en_atencion');
    expect(r.body.atencion.clinicaId).not.toBeNull();
    // El puntaje se persiste justo al cambiar de estado, no antes.
    expect(r.body.atencion.puntaje).toBeGreaterThan(0);

    const clinica = await prisma.clinica.findUnique({ where: { id: r.body.atencion.clinicaId } });
    expect(clinica.disponible).toBe(false);
  });

  it('impide llamar a un segundo paciente sin clinica libre', async () => {
    const { atencion: primera } = await nuevaAtencion();
    const { atencion: segunda } = await nuevaAtencion();

    await pre(request(app).patch(`/api/v1/atenciones/${primera.id}/estado`)).send({ estado: 'en_atencion' });
    const r = await pre(request(app).patch(`/api/v1/atenciones/${segunda.id}/estado`)).send({
      estado: 'en_atencion',
    });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('sin_clinica');
  });

  it('rechaza una transicion no permitida', async () => {
    const { atencion } = await nuevaAtencion();
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'ausente' });
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_espera' });
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_atencion' });

    // Ya en atencion, cerrar es por /consulta; pasar a en_atencion otra vez no.
    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({
      estado: 'en_atencion',
    });
    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('transicion_invalida');
  });
});

describe('varias clinicas', () => {
  // El establecimiento atiende con mas de una clinica: la cola debe poder
  // tener dos pacientes en atencion a la vez, uno en cada una.
  it('atiende a dos pacientes a la vez, uno por clinica', async () => {
    const segunda = await prisma.clinica.create({
      data: { establecimientoId, nombre: `QA-Clinica-${Date.now()}` },
    });

    try {
      const { atencion: a } = await nuevaAtencion();
      const { atencion: b } = await nuevaAtencion();

      const r1 = await pre(request(app).patch(`/api/v1/atenciones/${a.id}/estado`)).send({
        estado: 'en_atencion',
      });
      const r2 = await pre(request(app).patch(`/api/v1/atenciones/${b.id}/estado`)).send({
        estado: 'en_atencion',
      });

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      // Cada uno en una clinica distinta.
      expect(r1.body.atencion.clinicaId).not.toBe(r2.body.atencion.clinicaId);
    } finally {
      await prisma.atencion.updateMany({
        where: { clinicaId: segunda.id },
        data: { clinicaId: null, estado: 'ausente' },
      });
      await prisma.clinica.delete({ where: { id: segunda.id } });
    }
  });

  it('rechaza al tercero cuando ambas clinicas estan ocupadas', async () => {
    const segunda = await prisma.clinica.create({
      data: { establecimientoId, nombre: `QA-Clinica-${Date.now()}` },
    });

    try {
      const { atencion: a } = await nuevaAtencion();
      const { atencion: b } = await nuevaAtencion();
      const { atencion: c } = await nuevaAtencion();

      await pre(request(app).patch(`/api/v1/atenciones/${a.id}/estado`)).send({ estado: 'en_atencion' });
      await pre(request(app).patch(`/api/v1/atenciones/${b.id}/estado`)).send({ estado: 'en_atencion' });
      const tercero = await pre(request(app).patch(`/api/v1/atenciones/${c.id}/estado`)).send({
        estado: 'en_atencion',
      });

      expect(tercero.status).toBe(409);
      expect(tercero.body.error.codigo).toBe('sin_clinica');
    } finally {
      await prisma.atencion.updateMany({
        where: { clinicaId: segunda.id },
        data: { clinicaId: null, estado: 'ausente' },
      });
      await prisma.clinica.delete({ where: { id: segunda.id } });
    }
  });
});

describe('disponibilidad de la clinica', () => {
  it('no rompe si el campo disponible quedo desincronizado', async () => {
    const { atencion: primera } = await nuevaAtencion();
    await pre(request(app).patch(`/api/v1/atenciones/${primera.id}/estado`)).send({
      estado: 'en_atencion',
    });

    // Se simula la desincronizacion: la clinica esta ocupada de verdad, pero
    // el campo dice que esta libre (un proceso interrumpido, una correccion
    // manual). Antes esto provocaba un error 500 de restriccion unica.
    await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });

    const { atencion: segunda } = await nuevaAtencion();
    const r = await pre(request(app).patch(`/api/v1/atenciones/${segunda.id}/estado`)).send({
      estado: 'en_atencion',
    });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('sin_clinica');
  });

  it('corrige el campo disponible al cambiar de estado', async () => {
    const { atencion } = await nuevaAtencion();
    await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: false } });

    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({
      estado: 'ausente',
    });

    // Sin nadie en atencion, la clinica debe quedar marcada como libre.
    const clinica = await prisma.clinica.findFirst({ where: { establecimientoId } });
    expect(clinica.disponible).toBe(true);
  });

  it('el job no falla si la clinica se ocupo entre la lectura y la escritura', async () => {
    const { atencion } = await nuevaAtencion();
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({
      estado: 'en_atencion',
    });
    await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });

    await nuevaAtencion();
    // Devuelve null en lugar de lanzar.
    expect(await asignarClinicaLibre(establecimientoId)).toBeNull();
  });
});

describe('ausencias', () => {
  it('reinicia el cronometro y penaliza al volver de ausente', async () => {
    const { atencion } = await nuevaAtencion();
    await prisma.atencion.update({
      where: { id: atencion.id },
      data: { registradaEn: new Date(Date.now() - 120 * 60000) },
    });

    const buscar = (cuerpo) => cuerpo.cola.find((e) => e.id === atencion.id);

    const antes = await pre(request(app).get('/api/v1/atenciones/cola'));
    const puntajeAntes = buscar(antes.body).puntaje;

    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'ausente' });
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_espera' });

    const despues = await pre(request(app).get('/api/v1/atenciones/cola'));
    const entrada = buscar(despues.body);

    expect(entrada.ausencias).toBe(1);
    expect(entrada.minutosEsperando).toBeLessThan(5);
    expect(entrada.puntaje).toBeLessThan(puntajeAntes);
  });

  it('saca del sistema al paciente tras la segunda ausencia', async () => {
    const { atencion } = await nuevaAtencion();

    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'ausente' });
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_espera' });
    const segunda = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({
      estado: 'ausente',
    });

    expect(segunda.body.atencion.ausencias).toBe(2);
    expect(segunda.body.mensaje).toMatch(/debe registrarse de nuevo/);

    // Ya no puede volver a la cola.
    const reingreso = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({
      estado: 'en_espera',
    });
    expect(reingreso.status).toBe(409);
    expect(reingreso.body.error.codigo).toBe('ausencia_definitiva');
  });
});

describe('job de recalculo de cola', () => {
  it('asigna la clinica libre al de mayor prioridad', async () => {
    await nuevaAtencion({ gravedad: 'leve', nombres: 'Leve' });
    const { atencion: urgente } = await nuevaAtencion({ gravedad: 'urgente', nombres: 'Urgente' });

    const asignada = await asignarClinicaLibre(establecimientoId);

    expect(asignada.id).toBe(urgente.id);
    expect(asignada.estado).toBe('en_atencion');
  });

  it('no hace nada si la clinica ya esta ocupada', async () => {
    const { atencion } = await nuevaAtencion();
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_atencion' });

    await nuevaAtencion();
    expect(await asignarClinicaLibre(establecimientoId)).toBeNull();
  });

  it('no hace nada con la cola vacia', async () => {
    expect(await asignarClinicaLibre(establecimientoId)).toBeNull();
  });
});

describe('consulta medica', () => {
  async function pacienteEnAtencion(opciones = {}) {
    const { paciente, atencion } = await nuevaAtencion(opciones);
    await pre(request(app).post(`/api/v1/atenciones/${atencion.id}/preconsulta`)).send({ motivoConsulta: 'Control', 
      peso: 70,
      talla: 170,
      temperatura: 39.5,
      ...opciones.preconsulta,
    });
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_atencion' });
    return { paciente, atencion };
  }

  it('entrega al medico el siguiente paciente con sus alertas', async () => {
    await pacienteEnAtencion();

    const r = await med(request(app).get('/api/v1/atenciones/siguiente'));

    expect(r.status).toBe(200);
    expect(r.body.atencion).not.toBeNull();
    // La fiebre de 39.5 debe llegar como alerta ya calculada.
    expect(r.body.alertas.some((a) => a.tipo === 'signo_vital')).toBe(true);
  });

  it('registra diagnostico CIE-10 y libera la clinica', async () => {
    const { atencion } = await pacienteEnAtencion();

    const r = await med(request(app).patch(`/api/v1/atenciones/${atencion.id}/consulta`)).send({
      diagnosticoCie: 'J06.9',
      diagnosticoTxt: 'Infeccion aguda de las vias respiratorias superiores',
      tratamiento: 'Paracetamol y abundantes liquidos',
    });

    expect(r.status).toBe(200);
    expect(r.body.atencion.estado).toBe('atendido');
    expect(r.body.atencion.diagnosticoCie).toBe('J06.9');
    expect(r.body).toHaveProperty('duracionMin');

    const clinica = await prisma.clinica.findFirst({ where: { establecimientoId } });
    expect(clinica.disponible).toBe(true);
  });

  it('rechaza un codigo CIE-10 mal formado', async () => {
    const { atencion } = await pacienteEnAtencion();

    const r = await med(request(app).patch(`/api/v1/atenciones/${atencion.id}/consulta`)).send({
      diagnosticoCie: 'gripe',
      diagnosticoTxt: 'Gripe',
    });

    expect(r.status).toBe(400);
    expect(r.body.error.detalles[0].campo).toBe('diagnosticoCie');
  });

  it('no deja cerrar una atencion que no esta en curso', async () => {
    const { atencion } = await nuevaAtencion();

    const r = await med(request(app).patch(`/api/v1/atenciones/${atencion.id}/consulta`)).send({
      diagnosticoCie: 'J06.9',
      diagnosticoTxt: 'Resfriado',
    });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('estado_invalido');
  });

  it('niega el cierre de consulta a preconsulta', async () => {
    const { atencion } = await pacienteEnAtencion();

    const r = await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/consulta`)).send({
      diagnosticoCie: 'J06.9',
      diagnosticoTxt: 'Resfriado',
    });

    expect(r.status).toBe(403);
  });
});

describe('alertas clinicas derivadas', () => {
  it('avisa de tres consultas por el mismo diagnostico en 60 dias', async () => {
    const paciente = await nuevoPaciente({ nombres: 'Repetido' });

    // Tres consultas cerradas con el mismo CIE-10 dentro de la ventana.
    for (let i = 0; i < 3; i += 1) {
      await prisma.atencion.create({
        data: {
          establecimientoId,
          pacienteId: paciente.id,
          estado: 'atendido',
          gravedad: 'leve',
          motivoConsulta: 'Tos',
          diagnosticoCie: 'J06.9',
          diagnosticoTxt: 'Infeccion respiratoria',
          registradaEn: new Date(Date.now() - (i + 1) * 5 * 86400000),
        },
      });
    }

    const r = await med(request(app).get(`/api/v1/pacientes/${paciente.id}/alertas`));

    expect(r.status).toBe(200);
    const patron = r.body.alertas.find((a) => a.tipo === 'patron_clinico');
    expect(patron).toBeTruthy();
    expect(patron.mensaje).toMatch(/3 consultas/);
  });

  it('no avisa si las consultas quedan fuera de la ventana de 60 dias', async () => {
    const paciente = await nuevoPaciente({ nombres: 'Antiguo' });

    for (let i = 0; i < 3; i += 1) {
      await prisma.atencion.create({
        data: {
          establecimientoId,
          pacienteId: paciente.id,
          estado: 'atendido',
          gravedad: 'leve',
          motivoConsulta: 'Tos',
          diagnosticoCie: 'J06.9',
          diagnosticoTxt: 'Infeccion respiratoria',
          registradaEn: new Date(Date.now() - (90 + i) * 86400000),
        },
      });
    }

    const r = await med(request(app).get(`/api/v1/pacientes/${paciente.id}/alertas`));
    expect(r.body.alertas.some((a) => a.tipo === 'patron_clinico')).toBe(false);
  });

  it('avisa de la desnutricion detectada en la ultima medicion', async () => {
    const { atencion } = await nuevaAtencion({ meses: 24, nombres: 'Desnutrido' });

    await pre(request(app).post(`/api/v1/atenciones/${atencion.id}/preconsulta`)).send({ motivoConsulta: 'Control', 
      peso: 8.5,
      talla: 87,
    });

    const r = await med(request(app).get(`/api/v1/pacientes/${atencion.pacienteId}/alertas`));

    const desnutricion = r.body.alertas.find((a) => a.tipo === 'desnutricion');
    expect(desnutricion).toBeTruthy();
    expect(desnutricion.severidad).toBe('alta');
  });
});

describe('prescripcion', () => {
  it('registra una prescripcion ligada a la atencion', async () => {
    const { atencion } = await nuevaAtencion();
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_atencion' });

    const insumo = await prisma.insumo.findFirst({ where: { establecimientoId, activo: true } });

    const r = await med(request(app).post(`/api/v1/atenciones/${atencion.id}/prescripcion`)).send({
      insumoId: insumo.id,
      cantidad: 20,
      indicaciones: 'Una cada 8 horas por 5 dias',
    });

    expect(r.status).toBe(201);
    expect(r.body.prescripcion.cantidad).toBe(20);
    expect(r.body.prescripcion.insumo.nombreGenerico).toBe(insumo.nombreGenerico);
  });

  it('rechaza cantidad cero', async () => {
    const { atencion } = await nuevaAtencion();
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_atencion' });
    const insumo = await prisma.insumo.findFirst({ where: { establecimientoId } });

    const r = await med(request(app).post(`/api/v1/atenciones/${atencion.id}/prescripcion`)).send({
      insumoId: insumo.id,
      cantidad: 0,
    });

    expect(r.status).toBe(400);
  });

  it('no permite prescribir antes de que inicie la consulta', async () => {
    const { atencion } = await nuevaAtencion();
    const insumo = await prisma.insumo.findFirst({ where: { establecimientoId } });

    const r = await med(request(app).post(`/api/v1/atenciones/${atencion.id}/prescripcion`)).send({
      insumoId: insumo.id,
      cantidad: 10,
    });

    expect(r.status).toBe(409);
  });
});

describe('resumen del dia', () => {
  it('cuenta atendidos, urgentes y tiempo promedio', async () => {
    const { atencion } = await nuevaAtencion({ gravedad: 'urgente' });
    await pre(request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({ estado: 'en_atencion' });
    await med(request(app).patch(`/api/v1/atenciones/${atencion.id}/consulta`)).send({
      diagnosticoCie: 'A09',
      diagnosticoTxt: 'Diarrea',
    });

    const r = await med(request(app).get('/api/v1/atenciones/resumen-dia'));

    expect(r.status).toBe(200);
    expect(r.body.atendidos).toBeGreaterThanOrEqual(1);
    expect(r.body.urgentesAtendidos).toBeGreaterThanOrEqual(1);
  });
});
