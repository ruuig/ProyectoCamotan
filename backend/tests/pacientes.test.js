import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

// Marca que permite limpiar solo lo que crean estas pruebas.
const MARCA = `QA${Date.now()}`;
let tokenPreconsulta;
let tokenMedico;
let tokenFarmacia;

async function login(usuario, password = 'Camotan2026!') {
  const respuesta = await request(app).post('/api/v1/auth/login').send({ usuario, password });
  return respuesta.body.token;
}

const comoPreconsulta = (peticion) => peticion.set('Authorization', `Bearer ${tokenPreconsulta}`);

function pacienteBase(extra = {}) {
  return {
    expedientePapel: `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
    nombres: 'Jose Antonio',
    apellidos: 'Ramirez Perez',
    fechaNacimiento: '1990-03-15',
    sexo: 'M',
    comunidad: 'Tisipe',
    responsableNombre: 'Maria Lopez',
    responsableParentesco: 'madre',
    ...extra,
  };
}

beforeAll(async () => {
  [tokenPreconsulta, tokenMedico, tokenFarmacia] = await Promise.all([
    login('preconsulta'),
    login('medico'),
    login('farmacia'),
  ]);
});

afterAll(async () => {
  // Borra en orden inverso a las dependencias.
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

    await prisma.preconsulta.deleteMany({ where: { atencionId: { in: atencionIds } } });
    await prisma.atencion.deleteMany({ where: { id: { in: atencionIds } } });
    await prisma.condicionPaciente.deleteMany({ where: { pacienteId: { in: ids } } });
    await prisma.paciente.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.$disconnect();
});

// Un CUI que pasa el dígito verificador de RENAP, inscrito en Camotán (2005).
function cuiValido(semilla) {
  for (let n = Number(semilla) % 90000000 + 10000000; ; n += 1) {
    const base = String(n).padStart(8, '0');
    const v = [...base].reduce((t, d, i) => t + Number(d) * (i + 2), 0) % 11;
    if (v < 10) return `${base}${v}2005`;
  }
}

describe('POST /api/v1/pacientes', () => {
  it('registra un paciente con sus condiciones', async () => {
    const respuesta = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({
        nombres: 'Ana Lucia',
        apellidos: 'Interiano Solis',
        sexo: 'F',
        condiciones: ['discapacidad'],
      }),
    );

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.paciente.condiciones).toHaveLength(1);
    expect(respuesta.body.paciente.condiciones[0].tipo).toBe('discapacidad');
    // La edad se devuelve calculada, no solo la fecha de nacimiento.
    expect(respuesta.body.paciente.edad.anios).toBeGreaterThan(30);
  });

  it('no acepta el embarazo como condicion del paciente', async () => {
    // El embarazo es un episodio con principio y fin, no un atributo
    // permanente: como casilla se quedaba marcada para siempre.
    const respuesta = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ sexo: 'F', condiciones: ['embarazo'] }),
    );

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.paciente.condiciones).toHaveLength(0);
    expect(respuesta.body.paciente.embarazo).toBeNull();
  });

  it('rechaza sexo invalido con mensaje de validacion', async () => {
    const respuesta = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ sexo: 'X' }),
    );

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('validacion');
  });

  it('rechaza una fecha de nacimiento futura', async () => {
    const respuesta = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ fechaNacimiento: '2090-01-01' }),
    );

    expect(respuesta.status).toBe(400);
  });

  it('niega el registro al rol farmacia', async () => {
    const respuesta = await request(app)
      .post('/api/v1/pacientes')
      .set('Authorization', `Bearer ${tokenFarmacia}`)
      .send(pacienteBase());

    expect(respuesta.status).toBe(403);
  });
});

describe('deteccion de duplicados', () => {
  it('advierte ante un nombre parecido y deja registrar al confirmar', async () => {
    const original = pacienteBase({ nombres: 'Marta Elena', apellidos: 'Sagastume Chacon' });
    const creado = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(original);
    expect(creado.status).toBe(201);

    // Mismo nombre con un error de digitacion.
    const parecido = pacienteBase({
      nombres: 'Marta Elena',
      apellidos: 'Sagastume Chacon',
      fechaNacimiento: original.fechaNacimiento,
      comunidad: original.comunidad,
    });

    const advertencia = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(parecido);
    expect(advertencia.status).toBe(409);
    expect(advertencia.body.error.codigo).toBe('posible_duplicado');
    expect(advertencia.body.error.detalles[0].razones).toContain('nombre similar');

    // Con la confirmacion explicita si se registra.
    const confirmado = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send({
      ...parecido,
      confirmarDuplicado: true,
    });
    expect(confirmado.status).toBe(201);
  });

  it('revisa duplicados sin intentar guardar', async () => {
    await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ nombres: 'Rigoberto', apellidos: 'Villeda Aguirre' }),
    );

    const respuesta = await comoPreconsulta(request(app).post('/api/v1/pacientes/revisar-duplicados')).send({
      nombres: 'Rigoberto',
      apellidos: 'Villeda Aguirre',
    });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.posiblesDuplicados.length).toBeGreaterThan(0);
  });

  it('no advierte ante un paciente claramente distinto', async () => {
    const respuesta = await comoPreconsulta(request(app).post('/api/v1/pacientes/revisar-duplicados')).send({
      nombres: 'Zoraida',
      apellidos: 'Quintanilla Bracamonte',
    });

    expect(respuesta.body.posiblesDuplicados).toEqual([]);
  });
});

describe('busqueda de pacientes', () => {
  it('encuentra por partes del nombre en cualquier orden', async () => {
    await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ nombres: 'Eulalia', apellidos: 'Xocop Tzunun', comunidad: 'Shalagua' }),
    );

    const respuesta = await comoPreconsulta(
      request(app).get('/api/v1/pacientes').query({ buscar: 'tzunun eulalia' }),
    );

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.pacientes.some((p) => p.apellidos === 'Xocop Tzunun')).toBe(true);
  });

  it('encuentra por CUI', async () => {
    const cui = cuiValido(Date.now());
    await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ nombres: 'Fermin', apellidos: 'Lemus Oliva', cui }),
    );

    const respuesta = await comoPreconsulta(request(app).get('/api/v1/pacientes').query({ buscar: cui }));

    expect(respuesta.body.pacientes).toHaveLength(1);
    expect(respuesta.body.pacientes[0].cui).toBe(cui);
  });

  it('devuelve la paginacion', async () => {
    const respuesta = await comoPreconsulta(request(app).get('/api/v1/pacientes').query({ limite: 2 }));

    expect(respuesta.body.paginacion.limite).toBe(2);
    expect(respuesta.body.paginacion).toHaveProperty('total');
  });
});

describe('condiciones del paciente', () => {
  it('cierra la condicion anterior en lugar de borrarla', async () => {
    const creado = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({
        nombres: 'Petrona',
        apellidos: 'Calderon Ruano',
        sexo: 'F',
        condiciones: ['discapacidad'],
      }),
    );
    const id = creado.body.paciente.id;

    const actualizado = await comoPreconsulta(request(app).patch(`/api/v1/pacientes/${id}`)).send({
      condiciones: [],
    });

    expect(actualizado.status).toBe(200);
    expect(actualizado.body.paciente.condiciones).toHaveLength(0);

    // La condicion no se borra: sigue en la base, cerrada con fecha, para
    // conservar el historial de por que el paciente tuvo prioridad.
    const cerradas = await prisma.condicionPaciente.findMany({
      where: { pacienteId: id, tipo: 'discapacidad' },
    });
    expect(cerradas).toHaveLength(1);
    expect(cerradas[0].vigenteHasta).not.toBeNull();
  });
});

describe('condiciones derivadas de la edad', () => {
  const hace = (n) => {
    const fecha = new Date();
    fecha.setFullYear(fecha.getFullYear() - n);
    return fecha.toISOString().slice(0, 10);
  };

  it('asigna menor_5 desde el alta, sin esperar a la primera atencion', async () => {
    const respuesta = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ nombres: 'Recien', apellidos: 'Registrado Nino', fechaNacimiento: hace(3) }),
    );

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.paciente.condiciones.map((c) => c.tipo)).toContain('menor_5');
  });

  it('asigna adulto_mayor desde el alta', async () => {
    const respuesta = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ nombres: 'Don', apellidos: 'Mayor Anciano', fechaNacimiento: hace(72) }),
    );

    expect(respuesta.body.paciente.condiciones.map((c) => c.tipo)).toContain('adulto_mayor');
  });

  it('no cierra menor_5 al editar solo las condiciones manuales', async () => {
    const creado = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ nombres: 'Nino', apellidos: 'Con Discapacidad', fechaNacimiento: hace(2) }),
    );
    const id = creado.body.paciente.id;

    const actualizado = await comoPreconsulta(request(app).patch(`/api/v1/pacientes/${id}`)).send({
      condiciones: ['discapacidad'],
    });

    const tipos = actualizado.body.paciente.condiciones.map((c) => c.tipo).sort();
    expect(tipos).toEqual(['discapacidad', 'menor_5']);
  });

  it('cierra menor_5 si se corrige la fecha de nacimiento a un adulto', async () => {
    const creado = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ nombres: 'Fecha', apellidos: 'Mal Digitada', fechaNacimiento: hace(3) }),
    );
    const id = creado.body.paciente.id;

    const corregido = await comoPreconsulta(request(app).patch(`/api/v1/pacientes/${id}`)).send({
      fechaNacimiento: hace(30),
    });

    expect(corregido.body.paciente.condiciones.map((c) => c.tipo)).not.toContain('menor_5');
  });
});

describe('atenciones y preconsulta', () => {
  async function crearPacienteYAtencion(datosPaciente = {}) {
    const paciente = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ confirmarDuplicado: true, ...datosPaciente }),
    );
    const atencion = await comoPreconsulta(request(app).post('/api/v1/atenciones')).send({
      pacienteId: paciente.body.paciente.id,
      motivoConsulta: 'Tos y fiebre',
    });
    return { pacienteId: paciente.body.paciente.id, atencionId: atencion.body.atencion.id };
  }

  it('asigna automaticamente la condicion menor_5 al abrir la atencion', async () => {
    const hace2Anios = new Date();
    hace2Anios.setFullYear(hace2Anios.getFullYear() - 2);

    const { pacienteId } = await crearPacienteYAtencion({
      nombres: 'Bebe',
      apellidos: 'Perez Lopez',
      fechaNacimiento: hace2Anios.toISOString().slice(0, 10),
    });

    const condiciones = await prisma.condicionPaciente.findMany({
      where: { pacienteId, vigenteHasta: null },
    });
    expect(condiciones.map((c) => c.tipo)).toContain('menor_5');
  });

  it('impide dos atenciones abiertas para el mismo paciente', async () => {
    const { pacienteId } = await crearPacienteYAtencion();

    const segunda = await comoPreconsulta(request(app).post('/api/v1/atenciones')).send({
      pacienteId,
      motivoConsulta: 'Otra cosa',
    });

    expect(segunda.status).toBe(409);
    expect(segunda.body.error.codigo).toBe('atencion_abierta');
  });

  it('registra preconsulta y devuelve los hallazgos fuera de rango', async () => {
    const hace8Meses = new Date();
    hace8Meses.setMonth(hace8Meses.getMonth() - 8);

    const { atencionId } = await crearPacienteYAtencion({
      nombres: 'Lactante',
      apellidos: 'Morales Diaz',
      fechaNacimiento: hace8Meses.toISOString().slice(0, 10),
    });

    const respuesta = await comoPreconsulta(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 7.5, talla: 68, temperatura: 39.4, frecRespiratoria: 55, satOxigeno: 92 });

    expect(respuesta.status).toBe(201);
    const campos = respuesta.body.hallazgos.map((h) => h.campo);
    expect(campos).toContain('temperatura');
    // 55 por minuto en un lactante de 8 meses supera el limite AIEPI de 50.
    expect(campos).toContain('frecRespiratoria');
    expect(campos).toContain('satOxigeno');
  });

  it('sube la gravedad a urgente al marcar un signo de peligro urgente', async () => {
    const { atencionId } = await crearPacienteYAtencion({ nombres: 'Urgencia', apellidos: 'Cardona Peña' });

    const respuesta = await comoPreconsulta(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  temperatura: 37, signosPeligro: ['conv'] });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.gravedadSugerida).toBe('urgente');
    expect(respuesta.body.gravedad).toBe('urgente');

    const atencion = await prisma.atencion.findUnique({ where: { id: atencionId } });
    expect(atencion.gravedad).toBe('urgente');
  });

  it('exige justificacion escrita si se baja una gravedad urgente', async () => {
    const { atencionId } = await crearPacienteYAtencion({ nombres: 'Baja', apellidos: 'Guzman Mejia' });

    const sinJustificar = await comoPreconsulta(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  signosPeligro: ['conv'], gravedad: 'leve' });

    expect(sinJustificar.status).toBe(400);
    expect(sinJustificar.body.error.codigo).toBe('justificacion_requerida');

    const conJustificacion = await comoPreconsulta(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control', 
      signosPeligro: ['conv'],
      gravedad: 'leve',
      justificacionGravedad: 'Convulsion febril ya resuelta, paciente estable y consciente',
    });

    expect(conJustificacion.status).toBe(201);
    expect(conJustificacion.body.gravedad).toBe('leve');
  });

  it('rechaza un signo de peligro que no esta en el catalogo', async () => {
    const { atencionId } = await crearPacienteYAtencion({ nombres: 'Falso', apellidos: 'Signo Prueba' });

    const respuesta = await comoPreconsulta(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  signosPeligro: ['inventado'] });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('signo_desconocido');
  });

  it('no permite registrar dos veces la preconsulta', async () => {
    const { atencionId } = await crearPacienteYAtencion({ nombres: 'Doble', apellidos: 'Registro Prueba' });

    await comoPreconsulta(request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`)).send({ motivoConsulta: 'Control',  peso: 60 });
    const segunda = await comoPreconsulta(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  peso: 60 });

    expect(segunda.status).toBe(409);
    expect(segunda.body.error.codigo).toBe('preconsulta_registrada');
  });

  it('rechaza presion sistolica menor que la diastolica', async () => {
    const { atencionId } = await crearPacienteYAtencion({ nombres: 'Presion', apellidos: 'Invertida Prueba' });

    const respuesta = await comoPreconsulta(
      request(app).post(`/api/v1/atenciones/${atencionId}/preconsulta`),
    ).send({ motivoConsulta: 'Control',  presionSis: 70, presionDia: 110 });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.codigo).toBe('validacion');
  });
});

describe('catalogo de signos de peligro', () => {
  it('lo puede leer preconsulta', async () => {
    const respuesta = await comoPreconsulta(request(app).get('/api/v1/admin/signos-peligro'));

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.signos.length).toBeGreaterThanOrEqual(14);
    expect(respuesta.body.signos[0]).toHaveProperty('gravedadSugerida');
  });

  it('lo puede leer el medico', async () => {
    const respuesta = await request(app)
      .get('/api/v1/admin/signos-peligro')
      .set('Authorization', `Bearer ${tokenMedico}`);

    expect(respuesta.status).toBe(200);
  });

  it('no lo puede leer farmacia', async () => {
    const respuesta = await request(app)
      .get('/api/v1/admin/signos-peligro')
      .set('Authorization', `Bearer ${tokenFarmacia}`);

    expect(respuesta.status).toBe(403);
  });
});

describe('Numero de expediente generado por el sistema', () => {
  it('lo genera con el formato AAAA-NNNNN sin que lo escriba el usuario', async () => {
    const r = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({ nombres: 'Correlativo', apellidos: 'Uno', confirmarDuplicado: true }),
    );

    expect(r.status).toBe(201);
    expect(r.body.paciente.expediente).toMatch(/^\d{4}-\d{5}$/);
    expect(r.body.paciente.expediente.slice(0, 4)).toBe(String(new Date().getUTCFullYear()));
  });

  it('ignora un expediente enviado a mano', async () => {
    const r = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({
        nombres: 'Correlativo',
        apellidos: 'Dos',
        expediente: 'INVENTADO-999',
        confirmarDuplicado: true,
      }),
    );

    expect(r.status).toBe(201);
    expect(r.body.paciente.expediente).not.toBe('INVENTADO-999');
    expect(r.body.paciente.expediente).toMatch(/^\d{4}-\d{5}$/);
  });

  it('conserva el numero del expediente de papel', async () => {
    const papel = `${MARCA}-PAPEL`;
    const r = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
      pacienteBase({
        nombres: 'Correlativo',
        apellidos: 'Tres',
        expedientePapel: papel,
        confirmarDuplicado: true,
      }),
    );

    expect(r.status).toBe(201);
    expect(r.body.paciente.expedientePapel).toBe(papel);
  });

  it('no repite el numero con registros simultaneos', async () => {
    // Cinco altas a la vez: es el escenario que rompia un contador leido y
    // escrito por separado.
    const respuestas = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        comoPreconsulta(request(app).post('/api/v1/pacientes')).send(
          pacienteBase({
            nombres: 'Simultaneo',
            apellidos: `Numero ${i}`,
            confirmarDuplicado: true,
          }),
        ),
      ),
    );

    expect(respuestas.every((r) => r.status === 201)).toBe(true);

    const expedientes = respuestas.map((r) => r.body.paciente.expediente);
    expect(new Set(expedientes).size).toBe(5);
  });
});

describe('CUI al registrar', () => {
  it('se guarda desde el registro rápido y no se repite en otro expediente', async () => {
    const cui = cuiValido(Date.now() + 7);
    const datos = {
      nombres: 'Rosa', apellidos: `Cui ${MARCA}`, fechaNacimiento: '1985-02-03', sexo: 'F',
      comunidad: 'Tisipe', confirmarDuplicado: true,
    };
    const primero = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send({
      ...datos, cui, expedientePapel: `${MARCA}-cui1`,
    });
    expect(primero.status).toBe(201);
    expect(primero.body.paciente.cui).toBe(cui);

    const repetido = await comoPreconsulta(request(app).post('/api/v1/pacientes')).send({
      ...datos, nombres: 'Otra', cui, expedientePapel: `${MARCA}-cui2`,
    });
    expect(repetido.status).toBe(409);
    expect(repetido.body.error.codigo).toBe('cui_registrado');
    expect(repetido.body.error.detalles[0].id).toBe(primero.body.paciente.id);
  });
});

