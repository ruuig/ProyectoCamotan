import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import { ejecutar as evaluarAlertas } from '../src/jobs/evaluarAlertas.js';
import { ejecutar as refrescarVistas } from '../src/jobs/refrescarVistas.js';

const MARCA = `PAN${Date.now()}`;
const tokens = {};
let establecimientoId;

async function login(usuario) {
  const r = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'Camotan2026!' });
  return r.body.token;
}

const como = (rol, p) => p.set('Authorization', `Bearer ${tokens[rol]}`);
const enDias = (n) => new Date(Date.now() + n * 86400000);

async function nuevoPaciente({ nombres = 'Panel', meses = 300, comunidad = 'Tisipe' } = {}) {
  const f = new Date();
  f.setMonth(f.getMonth() - meses);
  const r = await como(
    'preconsulta',
    request(app).post('/api/v1/pacientes'),
  ).send({
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres,
    apellidos: `Panel ${Math.random().toString(36).slice(2, 6)}`,
    fechaNacimiento: f.toISOString().slice(0, 10),
    sexo: 'M',
    comunidad,
    responsableNombre: 'Maria Lopez',
    responsableParentesco: 'madre',
    confirmarDuplicado: true,
  });
  return r.body.paciente;
}

async function nuevaAtencion(pacienteId, gravedad = 'leve') {
  const r = await como('preconsulta', request(app).post('/api/v1/atenciones')).send({
    pacienteId,
    motivoConsulta: 'Control',
    gravedad,
  });
  return r.body.atencion;
}

async function nuevoInsumo(extra = {}) {
  const r = await como('bodega', request(app).post('/api/v1/insumos')).send({
    nombreGenerico: `${MARCA} ${Math.random().toString(36).slice(2, 7)}`,
    categoria: 'medicamentos',
    presentacion: 'tableta',
    unidadMedida: 'unidad',
    stockMinimo: 10,
    ...extra,
  });
  return r.body.insumo;
}

async function recibirLote(insumoId, { cantidad, dias }) {
  const r = await como('bodega', request(app).post(`/api/v1/insumos/${insumoId}/lotes`)).send({
    numeroLote: `L${Math.random().toString(36).slice(2, 8)}`,
    fechaVence: enDias(dias).toISOString().slice(0, 10),
    cantidad,
  });
  return r.body.lote;
}

async function limpiar() {
  const insumos = await prisma.insumo.findMany({
    where: { nombreGenerico: { startsWith: MARCA } },
    select: { id: true },
  });
  const insumoIds = insumos.map((i) => i.id);
  const pacientes = await prisma.paciente.findMany({
    where: { expedientePapel: { startsWith: MARCA } },
    select: { id: true },
  });
  const pacienteIds = pacientes.map((p) => p.id);
  const atenciones = await prisma.atencion.findMany({
    where: { pacienteId: { in: pacienteIds } },
    select: { id: true },
  });
  const atencionIds = atenciones.map((a) => a.id);
  const lotes = await prisma.lote.findMany({
    where: { insumoId: { in: insumoIds } },
    select: { id: true },
  });
  const loteIds = lotes.map((l) => l.id);

  await prisma.alerta.deleteMany({
    where: {
      OR: [
        { entidadTipo: 'insumo', entidadId: { in: insumoIds } },
        { entidadTipo: 'lote', entidadId: { in: loteIds } },
        { entidadTipo: 'paciente', entidadId: { in: pacienteIds } },
      ],
    },
  });
  await prisma.movimientoInsumo.deleteMany({ where: { loteId: { in: loteIds } } });
  await prisma.dispensacion.deleteMany({
    where: { prescripcion: { atencionId: { in: atencionIds } } },
  });
  await prisma.prescripcion.deleteMany({ where: { atencionId: { in: atencionIds } } });
  await prisma.lote.deleteMany({ where: { id: { in: loteIds } } });
  await prisma.insumo.deleteMany({ where: { id: { in: insumoIds } } });
  await prisma.antropometria.deleteMany({ where: { pacienteId: { in: pacienteIds } } });
  await prisma.preconsulta.deleteMany({ where: { atencionId: { in: atencionIds } } });
  await prisma.atencion.deleteMany({ where: { id: { in: atencionIds } } });
  await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: pacienteIds } } });
  await prisma.paciente.deleteMany({ where: { id: { in: pacienteIds } } });
}

beforeAll(async () => {
  for (const rol of ['admin', 'preconsulta', 'medico', 'farmacia', 'bodega']) {
    tokens[rol] = await login(rol);
  }
  const u = await prisma.usuario.findUnique({ where: { usuario: 'admin' } });
  establecimientoId = u.establecimientoId;
});

beforeEach(async () => {
  await limpiar();
  await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });
});

afterAll(async () => {
  await limpiar();
  await prisma.clinica.updateMany({ where: { establecimientoId }, data: { disponible: true } });
  await prisma.$disconnect();
});

describe('GET /indicadores/panel/:rol', () => {
  it('cada rol entra a su propio panel', async () => {
    for (const rol of ['preconsulta', 'medico', 'farmacia', 'admin']) {
      const r = await como(rol, request(app).get(`/api/v1/indicadores/panel/${rol}`));
      expect(r.status).toBe(200);
      expect(r.body.rol).toBe(rol);
    }
  });

  it('niega el panel de otro rol', async () => {
    const r = await como('medico', request(app).get('/api/v1/indicadores/panel/farmacia'));
    expect(r.status).toBe(403);
    expect(r.body.error.codigo).toBe('sin_permiso');
  });

  it('el admin si puede ver cualquier panel', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/panel/farmacia'));
    expect(r.status).toBe(200);
  });

  it('rechaza un rol inexistente', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/panel/inventado'));
    expect(r.status).toBe(400);
  });
});

describe('panel de preconsulta', () => {
  it('muestra la cola con su resumen', async () => {
    const paciente = await nuevoPaciente();
    await nuevaAtencion(paciente.id);

    const r = await como('preconsulta', request(app).get('/api/v1/indicadores/panel/preconsulta'));

    expect(r.body.resumen.enEspera).toBeGreaterThanOrEqual(1);
    expect(r.body.cola.length).toBeGreaterThanOrEqual(1);
  });

  it('advierte cuando alguien supera los 90 minutos', async () => {
    const paciente = await nuevoPaciente();
    const atencion = await nuevaAtencion(paciente.id);
    await prisma.atencion.update({
      where: { id: atencion.id },
      data: { registradaEn: new Date(Date.now() - 120 * 60000) },
    });

    const r = await como('preconsulta', request(app).get('/api/v1/indicadores/panel/preconsulta'));

    expect(r.body.advertencia).toMatch(/más de 90 minutos/);
  });

  it('lista las citas de hoy que aun no llegan', async () => {
    const paciente = await nuevoPaciente({ nombres: 'ConCita' });
    const hoy = new Date();
    hoy.setHours(10, 0, 0, 0);

    await prisma.atencion.create({
      data: {
        establecimientoId,
        pacienteId: paciente.id,
        estado: 'atendido',
        gravedad: 'leve',
        motivoConsulta: 'Consulta previa',
        registradaEn: new Date(Date.now() - 30 * 86400000),
        proximaCita: hoy,
      },
    });

    const r = await como('preconsulta', request(app).get('/api/v1/indicadores/panel/preconsulta'));

    expect(r.body.citasDeHoySinLlegar.some((c) => c.pacienteId === paciente.id)).toBe(true);
  });
});

describe('panel del medico', () => {
  it('muestra la tarjeta del siguiente paciente con sus alertas', async () => {
    const paciente = await nuevoPaciente();
    const atencion = await nuevaAtencion(paciente.id);
    await como('preconsulta', request(app).post(`/api/v1/atenciones/${atencion.id}/preconsulta`)).send({ motivoConsulta: 'Control', 
      temperatura: 39.5,
      peso: 70,
      talla: 170,
    });

    const r = await como('medico', request(app).get('/api/v1/indicadores/panel/medico'));

    expect(r.body.siguiente).not.toBeNull();
    expect(r.body.siguiente.paciente.id).toBe(paciente.id);
    expect(r.body.siguiente.alertas.some((a) => a.tipo === 'signo_vital')).toBe(true);
  });

  it('cuenta atendidos del dia y tiempo promedio de consulta', async () => {
    const paciente = await nuevoPaciente();
    const atencion = await nuevaAtencion(paciente.id);
    await como('preconsulta', request(app).patch(`/api/v1/atenciones/${atencion.id}/estado`)).send({
      estado: 'en_atencion',
    });
    await como('medico', request(app).patch(`/api/v1/atenciones/${atencion.id}/consulta`)).send({
      diagnosticoCie: 'J06.9',
      diagnosticoTxt: 'Resfriado',
    });

    const r = await como('medico', request(app).get('/api/v1/indicadores/panel/medico'));

    expect(r.body.resumenDia.atendidos).toBeGreaterThanOrEqual(1);
    expect(r.body.resumenDia).toHaveProperty('duracionPromedioMin');
  });

  it('avisa cuando la cola quedo vacia', async () => {
    const r = await como('medico', request(app).get('/api/v1/indicadores/panel/medico'));
    expect(r.body.colaVacia).toBe(true);
    expect(r.body.siguiente).toBeNull();
  });
});

describe('panel de farmacia', () => {
  it('pone en requieren accion los insumos sin existencia', async () => {
    const insumo = await nuevoInsumo();

    const r = await como('farmacia', request(app).get('/api/v1/indicadores/panel/farmacia'));

    const encontrado = r.body.requierenAccion.insumos.find((i) => i.insumoId === insumo.id);
    expect(encontrado).toBeTruthy();
    expect(encontrado.saldoTotal).toBe(0);
  });

  it('lista los lotes dentro de la ventana de vencimiento', async () => {
    const insumo = await nuevoInsumo();
    const lote = await recibirLote(insumo.id, { cantidad: 100, dias: 40 });

    const r = await como('farmacia', request(app).get('/api/v1/indicadores/panel/farmacia'));

    const encontrado = r.body.requierenAccion.lotes.find((l) => l.loteId === lote.id);
    expect(encontrado).toBeTruthy();
    expect(encontrado.semaforo).not.toBe('verde');
  });

  it('no lista lotes con vencimiento lejano', async () => {
    const insumo = await nuevoInsumo();
    // Más de 18 meses: verde con los rangos del centro.
    const lote = await recibirLote(insumo.id, { cantidad: 100, dias: 700 });

    const r = await como('farmacia', request(app).get('/api/v1/indicadores/panel/farmacia'));
    expect(r.body.requierenAccion.lotes.find((l) => l.loteId === lote.id)).toBeUndefined();
  });

  it('acumula la diferencia de inventario del mes', async () => {
    const insumo = await nuevoInsumo();
    const lote = await recibirLote(insumo.id, { cantidad: 100, dias: 300 });

    // Un faltante detectado en el conteo fisico del mes.
    await como('bodega', request(app).post('/api/v1/inventario/reajustes')).send({
      loteId: lote.id,
      cantidad: -12,
      causa: 'faltante_inventario_fisico',
      motivo: 'Conteo fisico mensual',
    });

    const r = await como('farmacia', request(app).get('/api/v1/indicadores/panel/farmacia'));

    expect(r.body.diferenciasDelMes.mayorDiscrepancia.insumo.id).toBe(insumo.id);
    expect(r.body.diferenciasDelMes.mayorDiscrepancia.absoluta).toBe(12);
  });
});

describe('panel del administrador', () => {
  it('trae los cuatro indicadores del periodo, cada uno con su frase', async () => {
    const paciente = await nuevoPaciente();
    await nuevaAtencion(paciente.id);

    const r = await como('admin', request(app).get('/api/v1/indicadores/panel/admin'));

    expect(r.status).toBe(200);
    expect(r.body.indicadores.map((i) => i.clave)).toEqual([
      'atenciones', 'espera', 'urgentes', 'ausentismo',
    ]);
    for (const indicador of r.body.indicadores) {
      expect(typeof indicador.frase).toBe('string');
      expect(indicador.frase.length).toBeGreaterThan(0);
    }
  });

  it('nunca compara contra un periodo vacio con un porcentaje', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/panel/admin'));

    for (const indicador of r.body.indicadores) {
      expect(indicador.frase).not.toMatch(/100\s*%/);
    }
  });

  it('el periodo cambia el rango y como se llama', async () => {
    const semana = await como('admin', request(app).get('/api/v1/indicadores/panel/admin'));
    const mes = await como(
      'admin',
      request(app).get('/api/v1/indicadores/panel/admin').query({ periodo: 'mes' }),
    );

    expect(semana.body.periodo.clave).toBe('semana');
    expect(semana.body.periodo.etiqueta).toMatch(/^Semana del /);
    expect(mes.body.periodo.clave).toBe('mes');
    expect(mes.body.periodo.nombreAnterior).toBe('el mes anterior');
    expect(new Date(mes.body.periodo.desde).getTime()).toBeLessThan(
      new Date(semana.body.periodo.hasta).getTime(),
    );
  });

  it('ordena las comunidades por rezago y pone primero la nunca atendida', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/panel/admin'));

    const lista = r.body.comunidades.lista;
    expect(Array.isArray(lista)).toBe(true);
    // Solo entran comunidades con pacientes inscritos.
    expect(lista.every((c) => c.pacientes > 0)).toBe(true);
    // El orden es de mas rezago a menos, con la nunca atendida al frente.
    const rango = lista.map((c) => (c.dias === null ? Infinity : c.dias));
    expect([...rango].sort((a, b) => b - a)).toEqual(rango);
  });

  it('el abastecimiento usa la regla del BRES: solo agotados y bajo minimo, primero lo mas consumido', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/panel/admin'));

    const a = r.body.abastecimiento;
    const { agotado, bajo, bien, sin_consumo: sinConsumo } = a.conteo;
    expect(agotado + bajo + bien + sinConsumo).toBe(a.total);
    expect(a.lista.every((f) => ['agotado', 'bajo'].includes(f.situacion))).toBe(true);
    expect(a.lista.every((f) => f.situacion !== 'agotado' || f.bodega === 0)).toBe(true);
    const promedios = a.lista.map((f) => f.promedio);
    expect([...promedios].sort((x, y) => y - x)).toEqual(promedios);
  });

  it('no dibuja la grafica sin al menos una semana de registros', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/panel/admin'));

    const g = r.body.atencionesPorDia;
    expect(g.dibujable).toBe(g.periodosConDatos >= 7);
    expect(g.actual.length).toBe(7);
    expect(g.anterior.length).toBe(7);
  });

  it('trae las decisiones pendientes y el total real de alertas', async () => {
    const r = await como('admin', request(app).get('/api/v1/indicadores/panel/admin'));

    expect(Array.isArray(r.body.decisiones)).toBe(true);
    expect(r.body.decisiones.length).toBeLessThanOrEqual(3);
    expect(typeof r.body.totalAlertas).toBe('number');
    expect(r.body.totalAlertas).toBeGreaterThanOrEqual(r.body.decisiones.length);
  });
});

describe('job de evaluacion de alertas', () => {
  it('genera alerta de existencia baja y no la duplica al repetirse', async () => {
    const insumo = await nuevoInsumo({ stockMinimo: 100 });
    await recibirLote(insumo.id, { cantidad: 5, dias: 300 });

    await evaluarAlertas();
    await evaluarAlertas(); // segunda corrida: no debe duplicar

    const alertas = await prisma.alerta.findMany({
      where: { tipo: 'existencia_baja', entidadTipo: 'insumo', entidadId: insumo.id, estado: { not: 'resuelta' } },
    });

    expect(alertas).toHaveLength(1);
    expect(alertas[0].mensaje).toMatch(/bajo el mínimo/);
  });

  it('genera alerta de vencimiento con el excedente cuando hay historial', async () => {
    const insumo = await nuevoInsumo();
    const lote = await recibirLote(insumo.id, { cantidad: 100, dias: 20 });

    await evaluarAlertas();

    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'vencimiento', entidadTipo: 'lote', entidadId: lote.id, estado: { not: 'resuelta' } },
    });

    expect(alerta).toBeTruthy();
    expect(alerta.severidad).toBe('alta'); // 20 dias cae bajo un tercio de 91
  });

  it('cierra la alerta cuando la causa desaparece', async () => {
    const insumo = await nuevoInsumo({ stockMinimo: 100 });
    await recibirLote(insumo.id, { cantidad: 5, dias: 300 });
    await evaluarAlertas();

    // Llega mas existencia: la alerta debe cerrarse sola.
    await recibirLote(insumo.id, { cantidad: 500, dias: 300 });
    await evaluarAlertas();

    const abiertas = await prisma.alerta.findMany({
      where: { tipo: 'existencia_baja', entidadTipo: 'insumo', entidadId: insumo.id, estado: { not: 'resuelta' } },
    });
    expect(abiertas).toHaveLength(0);
  });

  it('detecta desnutricion severa sin control reciente', async () => {
    const paciente = await nuevoPaciente({ meses: 24, nombres: 'Desnutrido' });

    await como('preconsulta', request(app).post(`/api/v1/pacientes/${paciente.id}/antropometria`)).send({
      peso: 8.5,
      talla: 87,
    });
    // Se antiguan la medicion para simular que no vuelve hace 45 dias.
    await prisma.antropometria.updateMany({
      where: { pacienteId: paciente.id },
      data: { fecha: new Date(Date.now() - 45 * 86400000) },
    });

    await evaluarAlertas();

    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'desnutricion', entidadTipo: 'paciente', entidadId: paciente.id, estado: { not: 'resuelta' } },
    });

    expect(alerta).toBeTruthy();
    expect(alerta.severidad).toBe('alta');
    expect(alerta.mensaje).toMatch(/sin control desde hace/);
  });

  it('detecta tres consultas por el mismo diagnostico en 60 dias', async () => {
    const paciente = await nuevoPaciente({ nombres: 'Repetido' });

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

    await evaluarAlertas();

    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'patron_clinico', entidadTipo: 'paciente', entidadId: paciente.id, estado: { not: 'resuelta' } },
    });

    expect(alerta).toBeTruthy();
    expect(alerta.mensaje).toMatch(/3 consultas por J06.9/);
  });

  it('detecta una cita vencida a la que el paciente no volvio', async () => {
    const paciente = await nuevoPaciente({ nombres: 'NoVolvio' });

    await prisma.atencion.create({
      data: {
        establecimientoId,
        pacienteId: paciente.id,
        estado: 'atendido',
        gravedad: 'leve',
        motivoConsulta: 'Control',
        registradaEn: new Date(Date.now() - 60 * 86400000),
        proximaCita: new Date(Date.now() - 40 * 86400000),
      },
    });

    await evaluarAlertas();

    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'cita_vencida', entidadTipo: 'paciente', entidadId: paciente.id, estado: { not: 'resuelta' } },
    });

    expect(alerta).toBeTruthy();
    expect(alerta.mensaje).toMatch(/cita vencida hace 40 días/);
  });
});

describe('GET /indicadores/alertas', () => {
  it('devuelve solo las abiertas por omision y permite filtrar', async () => {
    const insumo = await nuevoInsumo({ stockMinimo: 100 });
    await recibirLote(insumo.id, { cantidad: 5, dias: 300 });
    await evaluarAlertas();

    const todas = await como('farmacia', request(app).get('/api/v1/indicadores/alertas'));
    expect(todas.body.alertas.every((a) => a.estado !== 'resuelta')).toBe(true);

    const filtradas = await como(
      'farmacia',
      request(app).get('/api/v1/indicadores/alertas').query({ tipo: 'existencia_baja' }),
    );
    expect(filtradas.body.alertas.every((a) => a.tipo === 'existencia_baja')).toBe(true);
  });

  it('registrar la gestion no oculta la alerta: queda en gestion con su autor', async () => {
    const insumo = await nuevoInsumo({ stockMinimo: 100 });
    await recibirLote(insumo.id, { cantidad: 5, dias: 300 });
    await evaluarAlertas();

    const alerta = await prisma.alerta.findFirst({
      where: { entidadTipo: 'insumo', entidadId: insumo.id, estado: { not: 'resuelta' } },
    });

    const r = await como(
      'farmacia',
      request(app).patch(`/api/v1/indicadores/alertas/${alerta.id}/gestion`),
    ).send({ accion: 'despacho_solicitado' });

    expect(r.status).toBe(200);
    expect(r.body.alerta.estado).toBe('en_gestion');
    expect(r.body.alerta.estadoPor).not.toBeNull();
    expect(r.body.alerta.estadoEn).not.toBeNull();

    // Sigue apareciendo: la causa no ha desaparecido.
    const abiertas = await como('farmacia', request(app).get('/api/v1/indicadores/alertas'));
    expect(abiertas.body.alertas.some((a) => a.id === alerta.id)).toBe(true);
  });

  it('una alerta resuelta ya no admite gestion', async () => {
    const insumo = await nuevoInsumo({ stockMinimo: 100 });
    await recibirLote(insumo.id, { cantidad: 5, dias: 300 });
    await evaluarAlertas();

    const alerta = await prisma.alerta.findFirst({
      where: { entidadTipo: 'insumo', entidadId: insumo.id, estado: { not: 'resuelta' } },
    });
    await prisma.alerta.update({
      where: { id: alerta.id },
      data: { estado: 'resuelta', estadoEn: new Date() },
    });

    const r = await como(
      'farmacia',
      request(app).patch(`/api/v1/indicadores/alertas/${alerta.id}/gestion`),
    ).send({ accion: 'despacho_solicitado' });

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe('alerta_resuelta');
  });

  it('la alerta de cobertura se cierra sola al registrarse una atencion', async () => {
    const lugar = await prisma.lugarPoblado.create({
      data: {
        establecimientoId,
        nombre: `Rezagada-${MARCA}`,
        categoria: 'caserio',
      },
    });
    const paciente = await nuevoPaciente();
    await prisma.paciente.update({
      where: { id: paciente.id },
      data: { lugarPobladoId: lugar.id },
    });

    await evaluarAlertas();
    const abierta = await prisma.alerta.findFirst({
      where: { tipo: 'comunidad_sin_atencion', entidadId: lugar.id, estado: { not: 'resuelta' } },
    });
    expect(abierta).toBeTruthy();

    // Se registra y se cierra una atencion en esa comunidad.
    const atencion = await nuevaAtencion(paciente.id);
    await prisma.atencion.update({
      where: { id: atencion.id },
      data: { estado: 'atendido', cerradaEn: new Date() },
    });

    await evaluarAlertas();
    const despues = await prisma.alerta.findUnique({ where: { id: abierta.id } });
    expect(despues.estado).toBe('resuelta');
    // La cerro el proceso, no una persona.
    expect(despues.estadoPor).toBeNull();
  });
});

describe('job de refresco de vistas materializadas', () => {
  it('refresca las tres vistas sin error', async () => {
    const resultados = await refrescarVistas();

    expect(resultados).toHaveLength(3);
    expect(resultados.every((r) => r.ok)).toBe(true);
  });
});
