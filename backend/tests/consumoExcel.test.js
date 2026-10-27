import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

/**
 * Excel del consumo de cada territorio: bodega (o el encargado) lo baja con las
 * filas del balance y un bloque por lugar, se llena y se sube; lo entregado y lo
 * no entregado quedan como el informe del mes de cada lugar.
 */
const PERIODO = '2030-01'; // un mes sin informes reales
let token;
let territorio;
const bod = (p) => p.set('Authorization', `Bearer ${token}`);

async function bajar(t = territorio.id, periodo = PERIODO) {
  const r = await bod(request(app).get(`/api/v1/bodega/consumo/excel?periodo=${periodo}&territorioId=${t}`))
    .buffer(true).parse((res, cb) => { const partes = []; res.on('data', (d) => partes.push(d)); res.on('end', () => cb(null, Buffer.concat(partes))); });
  return r;
}
const SECCIONES = new Set(['MICRONUTRIENTES', 'MEDICAMENTOS ANTIMALÁRICOS', 'OTROS MEDICAMENTOS', 'PLANIFICACION FAMILIAR', 'MATERIALES MEDICO QUIRÚRGICOS', 'MEDICAMENTOS PARA TUBERCULOSIS', 'MATERIALES DE LABORATORIO', 'COVID-19', 'AGREGADOS EN EL SISTEMA']);
/** La primera fila con un insumo. */
function primeraFila(hoja) {
  for (let f = 5; f <= hoja.rowCount; f += 1) {
    const v = hoja.getCell(f, 2).value;
    if (v && !SECCIONES.has(v)) return f;
  }
  return null;
}
async function libroDe(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  return libro;
}
const subir = async (libro, periodo = PERIODO) => bod(request(app).post(`/api/v1/bodega/consumo/excel?periodo=${periodo}`))
  .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  .send(Buffer.from(await libro.xlsx.writeBuffer()));

beforeAll(async () => {
  token = (await request(app).post('/api/v1/auth/login').send({ usuario: 'bodega', password: 'Camotan2026!' })).body.token;
  const lista = (await bod(request(app).get('/api/v1/bodega/territorios'))).body.territorios;
  territorio = lista.find((t) => t.ubicaciones.length >= 2);
});
afterAll(async () => {
  await prisma.informeServicio.deleteMany({ where: { periodo: PERIODO } });
  await prisma.$disconnect();
});

describe('Excel del consumo por territorio', () => {
  it('sale con la hoja del mes, las filas del balance y un bloque de seis columnas por lugar', async () => {
    if (!territorio) return;
    const r = await bajar();
    expect(r.status).toBe(200);
    const hoja = (await libroDe(r.body)).worksheets[0];
    expect(hoja.name).toBe('ENE30');
    expect(hoja.getCell('B4').value).toBe('MEDICAMENTOS');
    expect(primeraFila(hoja)).toBeTruthy();
    for (let k = 0; k < territorio.ubicaciones.length; k += 1) {
      expect(hoja.getCell(4, 3 + k * 6).value).toBe('Saldo anterior');
      expect(hoja.getCell(4, 5 + k * 6).value).toBe('Entregado Usu');
      expect(hoja.getCell(3, 5 + k * 6).value).toBeTruthy();
    }
    // Los títulos de sección del balance van en su lugar.
    const columnaB = [];
    hoja.getColumn(2).eachCell((c) => columnaB.push(c.value));
    expect(columnaB).toContain('MICRONUTRIENTES');
    expect(columnaB).toContain('MATERIALES DE LABORATORIO');
  });

  it('al subirlo, lo entregado y lo no entregado quedan como el informe de cada lugar', async () => {
    if (!territorio) return;
    const libro = await libroDe((await bajar()).body);
    const hoja = libro.worksheets[0];
    const f = primeraFila(hoja);
    const nombre = hoja.getCell(f, 2).value;
    hoja.getCell(f, 5).value = 12; // primer lugar: entregado
    hoja.getCell(f, 6).value = 3; // primer lugar: no entregado
    hoja.getCell(f, 11).value = 7; // segundo lugar: entregado
    const r = await subir(libro);
    expect(r.status).toBe(200);
    expect(r.body.lugares.map((l) => l.ubicacionId).sort()).toEqual(territorio.ubicaciones.map((u) => u.id).sort());

    const insumo = await prisma.insumo.findFirst({ where: { nombreGenerico: nombre } });
    const [u1, u2] = territorio.ubicaciones;
    const de = async (u) => prisma.informeServicioRenglon.findFirst({ where: { insumoId: insumo.id, informe: { ubicacionId: u.id, periodo: PERIODO } } });
    expect([(await de(u1)).entregado, (await de(u1)).noEntregado]).toEqual([12, 3]);
    expect((await de(u2)).entregado).toBe(7);

    // Al volver a bajarlo, viene con lo cargado.
    const otra = (await libroDe((await bajar()).body)).worksheets[0];
    expect([otra.getCell(f, 5).value, otra.getCell(f, 6).value]).toEqual([12, 3]);
  });

  it('subido desde un lugar, encuentra su bloque aunque le hayan cambiado el nombre', async () => {
    if (!territorio) return;
    const libro = await libroDe((await bajar()).body);
    const hoja = libro.worksheets[0];
    const f = primeraFila(hoja);
    const nombre = hoja.getCell(f, 2).value;
    hoja.getCell(3, 9).value = 'PUESTO CON OTRO NOMBRE'; // el bloque del segundo lugar
    hoja.getCell(f, 11).value = 44; // segundo lugar: entregado
    const [, u2] = territorio.ubicaciones;
    const subirA = async (ubicacionId) => bod(request(app).post(`/api/v1/bodega/consumo/excel?periodo=${PERIODO}&ubicacionId=${ubicacionId}`))
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(Buffer.from(await libro.xlsx.writeBuffer()));
    const r = await subirA(u2.id);
    expect(r.status).toBe(200);
    expect(r.body.lugares.map((l) => l.ubicacionId)).toEqual([u2.id]);
    const insumo = await prisma.insumo.findFirst({ where: { nombreGenerico: nombre } });
    const ren = await prisma.informeServicioRenglon.findFirst({ where: { insumoId: insumo.id, informe: { ubicacionId: u2.id, periodo: PERIODO } } });
    expect(ren.entregado).toBe(44);
  });

  it('un Excel de otro mes no se carga', async () => {
    if (!territorio) return;
    const libro = await libroDe((await bajar()).body);
    const r = await subir(libro, '2030-02');
    expect(r.status).toBe(409);
  });

  it('el encargado de servicio solo baja el de su territorio', async () => {
    const enc = await prisma.usuario.findFirst({ where: { rol: 'servicio', activo: true, ubicacion: { territorioId: { not: null } } } });
    if (!enc) return;
    const t = (await request(app).post('/api/v1/auth/login').send({ usuario: enc.usuario, password: 'Camotan2026!' })).body.token;
    if (!t) return;
    const lista = (await request(app).get('/api/v1/bodega/territorios').set('Authorization', `Bearer ${t}`)).body.territorios;
    expect(lista).toHaveLength(1);
  });
});
