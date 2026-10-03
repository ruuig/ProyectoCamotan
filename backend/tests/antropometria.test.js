import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

const MARCA = `ANT${Date.now()}`;
let token;

async function login(usuario = 'preconsulta') {
  const respuesta = await request(app)
    .post('/api/v1/auth/login')
    .send({ usuario, password: 'Camotan2026!' });
  return respuesta.body.token;
}

const como = (peticion) => peticion.set('Authorization', `Bearer ${token}`);

function hacemeses(n) {
  const fecha = new Date();
  fecha.setMonth(fecha.getMonth() - n);
  return fecha.toISOString().slice(0, 10);
}

async function crearPaciente({ meses = 24, sexo = 'M', nombres = 'Nino' } = {}) {
  const respuesta = await como(request(app).post('/api/v1/pacientes')).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres,
    apellidos: `Antropometria ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento: hacemeses(meses),
    sexo,
    comunidad: 'Tisipe',
    responsableNombre: 'Maria Lopez',
    responsableParentesco: 'madre',
    confirmarDuplicado: true,
  });
  return respuesta.body.paciente;
}

beforeAll(async () => {
  token = await login();
});

afterAll(async () => {
  const pacientes = await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = pacientes.map((p) => p.id);

  if (ids.length > 0) {
    const atenciones = await prisma.atencion.findMany({
      where: { pacienteId: { in: ids } },
      select: { id: true },
    });
    const atencionIds = atenciones.map((a) => a.id);

    await prisma.antropometria.deleteMany({ where: { pacienteId: { in: ids } } });
    await prisma.preconsulta.deleteMany({ where: { atencionId: { in: atencionIds } } });
    await prisma.atencion.deleteMany({ where: { id: { in: atencionIds } } });
    await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
    await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.$disconnect();
});

describe('tablas de referencia OMS', () => {
  it('estan cargadas con los cinco indicadores', async () => {
    const porIndicador = await prisma.referenciaOms.groupBy({
      by: ['indicador'],
      _count: true,
    });
    const nombres = porIndicador.map((g) => g.indicador).sort();

    expect(nombres).toEqual(['imc_edad', 'peso_edad', 'peso_longitud', 'peso_talla', 'talla_edad']);
  });

  it('conserva los valores publicados por la OMS', async () => {
    const fila = await prisma.referenciaOms.findFirst({
      where: { indicador: 'peso_edad', sexo: 'M', x: 0 },
    });

    expect(Number(fila.l)).toBeCloseTo(0.3487, 4);
    expect(Number(fila.m)).toBeCloseTo(3.3464, 4);
    expect(Number(fila.s)).toBeCloseTo(0.14602, 5);
  });
});

describe('POST /pacientes/:id/antropometria', () => {
  it('calcula los cuatro puntajes Z y clasifica', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    // Un nino de 24 meses con peso y talla cercanos a la mediana de la OMS.
    const respuesta = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 12.2, talla: 87.1 });

    expect(respuesta.status).toBe(201);
    const a = respuesta.body.antropometria;
    expect(Number(a.zPesoEdad)).toBeCloseTo(0, 0);
    expect(Number(a.zTallaEdad)).toBeCloseTo(0, 0);
    expect(Number(a.zPesoTalla)).toBeCloseTo(0, 0);
    expect(respuesta.body.clasificacion).toBe('normal');
  });

  it('detecta desnutricion aguda severa por peso para la talla', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    // Talla normal con peso muy por debajo del esperado para esa talla.
    const respuesta = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 8.5, talla: 87 });

    expect(Number(respuesta.body.antropometria.zPesoTalla)).toBeLessThan(-3);
    expect(respuesta.body.clasificacion).toBe('desnutricion_aguda_severa');
    expect(respuesta.body.alertaClinica).toMatch(/Peso para la talla/);
  });

  it('detecta desnutricion cronica por talla baja para la edad', async () => {
    const paciente = await crearPaciente({ meses: 36, sexo: 'F' });

    // Talla muy por debajo de lo esperado, con peso proporcional a esa talla.
    const respuesta = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 11, talla: 82 });

    expect(Number(respuesta.body.antropometria.zTallaEdad)).toBeLessThan(-2);
    expect(respuesta.body.clasificacion).toBe('desnutricion_cronica');
  });

  it('usa el MUAC como criterio independiente', async () => {
    const paciente = await crearPaciente({ meses: 30, sexo: 'M' });

    // Peso y talla normales, pero perimetro braquial bajo 115 mm.
    const respuesta = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 13.3, talla: 91.9, perimetroBraquial: 110 });

    expect(respuesta.body.clasificacion).toBe('desnutricion_aguda_severa');
  });

  it('avisa del descenso respecto a la medicion anterior', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    await como(request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`)).send({
      peso: 12.2,
      talla: 87,
    });

    const segunda = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 10.2, talla: 87 });

    expect(segunda.body.comparacion.descensoRelevante).toBe(true);
    expect(segunda.body.alertaClinica).toMatch(/descenso de/);
  });

  it('no calcula puntajes Z sobre los 60 meses, y lo avisa', async () => {
    const paciente = await crearPaciente({ meses: 72, sexo: 'M' });

    const respuesta = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 20, talla: 115 });

    expect(respuesta.body.antropometria.zPesoEdad).toBeNull();
    expect(respuesta.body.avisos.join(' ')).toMatch(/0 a 60 meses/);
  });

  it('rechaza un peso imposible', async () => {
    const paciente = await crearPaciente();

    const respuesta = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 900, talla: 87 });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('validacion');
  });
});

describe('estandar segun como se mide la estatura', () => {
  it('usa peso_longitud en menores de 24 meses', async () => {
    const paciente = await crearPaciente({ meses: 12, sexo: 'M' });
    const respuesta = await como(request(app).get(`/api/v1/pacientes/${paciente.id}/curva`)).query({
      indicador: 'peso_talla',
    });

    expect(respuesta.body.indicador).toBe('peso_longitud');
  });

  it('usa peso_talla desde los 24 meses', async () => {
    const paciente = await crearPaciente({ meses: 30, sexo: 'M' });
    const respuesta = await como(request(app).get(`/api/v1/pacientes/${paciente.id}/curva`)).query({
      indicador: 'peso_talla',
    });

    expect(respuesta.body.indicador).toBe('peso_talla');
  });
});

describe('GET /pacientes/:id/curva', () => {
  it('devuelve las siete bandas de referencia y los puntos del paciente', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });
    await como(request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`)).send({
      peso: 12.2,
      talla: 87,
    });

    const respuesta = await como(request(app).get(`/api/v1/pacientes/${paciente.id}/curva`)).query({
      indicador: 'peso_edad',
    });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.bandas.desviaciones).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(respuesta.body.bandas.puntos.length).toBe(61); // 0 a 60 meses
    expect(respuesta.body.puntos).toHaveLength(1);
    expect(respuesta.body.ejeX).toBe('edad_meses');
  });

  it('cambia el eje X a talla para el peso segun estatura', async () => {
    const paciente = await crearPaciente({ meses: 30, sexo: 'M' });
    const respuesta = await como(request(app).get(`/api/v1/pacientes/${paciente.id}/curva`)).query({
      indicador: 'peso_talla',
    });

    expect(respuesta.body.ejeX).toBe('talla_cm');
  });
});

describe('antropometria dentro de la preconsulta', () => {
  async function abrirAtencion(pacienteId) {
    const respuesta = await como(request(app).post('/api/v1/atenciones')).send({
      pacienteId,
      motivoConsulta: 'Control de crecimiento',
    });
    return respuesta.body.atencion.id;
  }

  it('genera la antropometria automaticamente en un menor de 5 anios', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });
    const atencionId = await abrirAtencion(paciente.id);

    const respuesta = await como(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 8.5, talla: 87, perimetroBraquial: 112, temperatura: 37 });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.antropometria).not.toBeNull();
    expect(respuesta.body.antropometria.clasificacion).toBe('desnutricion_aguda_severa');
    // La medicion queda ligada a la atencion que la origino.
    expect(respuesta.body.antropometria.registro.atencionId).toBe(atencionId);
  });

  it('un peso capturado en libras se guarda en kilogramos', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });
    const atencionId = await abrirAtencion(paciente.id);

    // 26 libras son 11.79 kg. Si se guardaran 26 "kg", el puntaje Z saldria
    // absurdo y la clasificacion diria sobrepeso en un nino desnutrido.
    const respuesta = await como(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 26, unidadPeso: 'lb', talla: 87, temperatura: 37 });

    expect(respuesta.status).toBe(201);
    expect(Number(respuesta.body.preconsulta.peso)).toBeCloseTo(11.79, 2);
    expect(respuesta.body.preconsulta.unidadPeso).toBe('lb');
    // La antropometria se calcula sobre los kilogramos, no sobre las libras.
    expect(Number(respuesta.body.antropometria.registro.peso)).toBeCloseTo(11.79, 2);
  });

  it('sin indicar unidad se asume kilogramos, como antes', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });
    const atencionId = await abrirAtencion(paciente.id);

    const respuesta = await como(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 11.8, talla: 87, temperatura: 37 });

    expect(respuesta.status).toBe(201);
    expect(Number(respuesta.body.preconsulta.peso)).toBeCloseTo(11.8, 2);
    expect(respuesta.body.preconsulta.unidadPeso).toBe('kg');
  });

  it('rechaza un peso que en kilogramos queda fuera de lo posible', async () => {
    const paciente = await crearPaciente({ meses: 300, sexo: 'F' });
    const atencionId = await abrirAtencion(paciente.id);

    // 890 libras son 403 kg: el esquema lo deja pasar, la conversion no.
    const respuesta = await como(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 890, unidadPeso: 'lb', talla: 155 });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('peso_fuera_de_rango');
    expect(respuesta.body.error.mensaje).toContain('kg');
  });

  it('no genera antropometria en un adulto', async () => {
    const paciente = await crearPaciente({ meses: 300, sexo: 'F' });
    const atencionId = await abrirAtencion(paciente.id);

    const respuesta = await como(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 62, talla: 155, temperatura: 36.8 });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.antropometria).toBeNull();
  });

  it('no genera antropometria si falta la talla', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });
    const atencionId = await abrirAtencion(paciente.id);

    const respuesta = await como(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 12, temperatura: 37 });

    expect(respuesta.body.antropometria).toBeNull();
  });

  it('no guarda los perimetros como columnas de preconsulta', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });
    const atencionId = await abrirAtencion(paciente.id);

    const respuesta = await como(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 12.2, talla: 87, perimetroBraquial: 130, perimetroCefalico: 48 });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.preconsulta.perimetroBraquial).toBeUndefined();
    expect(Number(respuesta.body.antropometria.registro.perimetroBraquial)).toBe(130);
    expect(Number(respuesta.body.antropometria.registro.perimetroCefalico)).toBe(48);
  });
});

describe('Plausibilidad de la medicion', () => {
  it('rechaza 60 kg en un nino de dos anos y explica por que', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    const r = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 60, talla: 87 });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('medicion_improbable');
    expect(r.body.error.mensaje).toContain('60');
    expect(r.body.error.mensaje).toContain('2 años');
  });

  it('rechaza de plano una talla fisicamente imposible', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    // 12 cm no es un caso de "confirmar igual": no existe. Lo corta el limite
    // absoluto antes de llegar a la revision de plausibilidad.
    const r = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 87, talla: 12.2 });

    expect(r.status).toBe(400);
  });

  it('sugiere revisar el cruce cuando peso y talla van al reves', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    // Ambos valores pasan el limite absoluto, pero cada uno cae en el rango
    // del otro campo: es el sintoma de haberlos escrito cruzados.
    const r = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 87, talla: 20.5 });

    expect(r.status).toBe(409);
    expect(r.body.error.detalles.some((a) => a.campo === 'intercambio')).toBe(true);
  });

  it('guarda la medicion improbable si se confirma, pero sin clasificar', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    const r = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 60, talla: 87, confirmarImprobable: true });

    expect(r.status).toBe(201);
    expect(r.body.antropometria.improbable).toBe(true);
    // Sin clasificacion: no se afirma un estado nutricional desde un dato malo.
    expect(r.body.antropometria.clasificacion).toBeNull();
    expect(r.body.antropometria.motivoImprobable).toBeTruthy();
  });

  it('no deja que una medicion improbable arrastre la comparacion siguiente', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    await como(request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`))
      .send({ peso: 60, talla: 87, confirmarImprobable: true });

    const r = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 12.2, talla: 87.1 });

    expect(r.status).toBe(201);
    expect(r.body.antropometria.improbable).toBe(false);
    expect(r.body.antropometria.clasificacion).toBe('normal');
  });

  it('acepta sin reparos una medicion normal', async () => {
    const paciente = await crearPaciente({ meses: 24, sexo: 'M' });

    const r = await como(
      request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`),
    ).send({ peso: 12.2, talla: 87.1 });

    expect(r.status).toBe(201);
    expect(r.body.antropometria.improbable).toBe(false);
  });
});
