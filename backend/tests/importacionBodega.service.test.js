import { describe, it, expect } from 'vitest';

const ib = require('../src/services/importacionBodega.service');

const catalogo = [
  { clave: 1, nombre: 'Amoxicilina 250mg/5ml Susp. Fco 120ml' },
  { clave: 2, nombre: 'Amoxicilina capsulas 500mg.' },
  { clave: 3, nombre: 'Condón masculino, unidad' },
  { clave: 4, nombre: 'Acetaminofén 100mg/1mf Frasco Gotero' },
];

describe('emparejar nombres entre los Excel', () => {
  it('el mismo nombre sin tildes ni signos es exacto', () => {
    expect(ib.emparejar('CONDON MASCULINO UNIDAD', catalogo)).toMatchObject({ clave: 3, metodo: 'exacto' });
  });

  it('un nombre parecido con los mismos números empareja', () => {
    expect(ib.emparejar('Acetaminofén 100mg/1mf, gotero', catalogo)).toMatchObject({ clave: 4, metodo: 'parecido' });
  });

  it('nunca junta concentraciones distintas aunque el nombre se parezca', () => {
    expect(ib.emparejar('Amoxicilina capsulas 250mg.', catalogo)).toBeNull();
  });

  it('a un nombre sin concentración lo empareja solo si hay un único candidato', () => {
    const cat = [{ clave: 9, nombre: 'Diazepan 10mg ampolla' }, ...catalogo];
    expect(ib.emparejar('Diazepan ampolla', cat)).toMatchObject({ clave: 9, metodo: 'sin concentración' });
    // Hay amoxicilina de 250 y de 500: sin concentración no se adivina.
    expect(ib.emparejar('Amoxicilina', catalogo)).toBeNull();
  });

  it('las equivalencias escritas a mano mandan', () => {
    const filas = [{ nombreExcel: 'Bolsas Rojas', nombreCatalogo: 'Condón masculino, unidad' }];
    expect(ib.aplicarEquivalencias('BOLSAS ROJAS', filas, catalogo)).toMatchObject({ clave: 3, metodo: 'equivalencia' });
  });

  it('lo que no se parece a nada queda sin emparejar', () => {
    expect(ib.emparejar('Termómetro infrarrojo', catalogo)).toBeNull();
  });

  it('los números se leen igual con o sin separador de miles', () => {
    expect(ib.numerosDe('Penicilina 4,000,000 UI')).toBe(ib.numerosDe('Penicilina 4000000 UI'));
  });
});

describe('categoría por la sección del Excel', () => {
  it('cada sección del balance a su categoría', () => {
    expect(ib.categoriaDe(null, 'Acetaminofén')).toEqual({ categoria: 'medicamentos', revisar: false });
    expect(ib.categoriaDe('MICRONUTRIENTES', 'x').categoria).toBe('suplementos');
    expect(ib.categoriaDe('MEDICAMENTO (MICRONUTRIENTES)', 'x').categoria).toBe('suplementos');
    expect(ib.categoriaDe('PLANIFICACION FAMILIAR', 'x').categoria).toBe('planificacion_familiar');
    expect(ib.categoriaDe('MATERIALES MEDICO QUIRÚRGICOS', 'x').categoria).toBe('medico_quirurgico');
    expect(ib.categoriaDe('MEDICAMENTOS PARA TUBERCULOSIS', 'x').categoria).toBe('tuberculosis');
    expect(ib.categoriaDe('MATERIALES DE LABORATORIO', 'x').categoria).toBe('laboratorio');
  });

  it('el bloque COVID-19 se decide por el nombre y queda para revisar', () => {
    expect(ib.categoriaDe('COVID-19', 'Reactivo RPR para sífilis, KIT')).toEqual({ categoria: 'laboratorio', revisar: true });
    expect(ib.categoriaDe('COVID-19', 'Mascarillas N95, unidad')).toEqual({ categoria: 'medico_quirurgico', revisar: true });
    expect(ib.categoriaDe('COVID-19', 'Diazepan 10mg ampolla').categoria).toBe('medicamentos');
  });
});

describe('servicios del balance', () => {
  const ubicaciones = [
    { id: 1, nombre: 'Post-consulta (Centro de Salud)', tipo: 'centro_salud' },
    { id: 2, nombre: 'Centro Comunitario Tierra Blanca', tipo: 'centro_comunitario' },
    { id: 3, nombre: 'C/C Nuevo Porvenir Tesoro', tipo: 'centro_comunitario' },
    { id: 4, nombre: 'P/S Caparjá', tipo: 'puesto_salud' },
  ];

  it('empareja aunque el Excel abrevie distinto', () => {
    expect(ib.emparejarServicio('CENTRO COMUN. TIERRA BLANCA', ubicaciones).id).toBe(2);
    expect(ib.emparejarServicio('C/C NUEVO POR VENIR, TESORO', ubicaciones).id).toBe(3);
    expect(ib.emparejarServicio('P/S CAPARJÁ', ubicaciones).id).toBe(4);
    expect(ib.emparejarServicio('POST CONSULTA', ubicaciones).id).toBe(1);
  });
});

describe('conciliar lotes del semáforo con la existencia', () => {
  it('llena desde el lote que vence último, porque por PEPE el primero ya salió', () => {
    const r = ib.conciliarLotes([
      { lote: 'A', vence: '2026-08-01', cantidad: 500 },
      { lote: 'B', vence: '2027-02-01', cantidad: 300 },
    ], 400);
    expect(r.lotes).toEqual([
      { lote: 'A', vence: '2026-08-01', cantidad: 100 },
      { lote: 'B', vence: '2027-02-01', cantidad: 300 },
    ]);
    expect(r.sinLote).toBe(0);
    expect(r.sobranteSemaforo).toBe(400);
  });

  it('si los lotes no alcanzan, lo que falta queda sin lote', () => {
    expect(ib.conciliarLotes([{ lote: 'A', vence: '2027-01-01', cantidad: 10 }], 25).sinLote).toBe(15);
  });

  it('descarta fechas imposibles como 1900', () => {
    const r = ib.conciliarLotes([{ lote: 'X', vence: '1900-01-27', cantidad: 50 }], 50);
    expect(r.lotes).toEqual([]);
    expect(r.descartados).toHaveLength(1);
    expect(r.sinLote).toBe(50);
  });
});

describe('entero', () => {
  it('lee celdas vacías, guiones y decimales', () => {
    expect(ib.entero(null)).toBe(0);
    expect(ib.entero('-')).toBe(0);
    expect(ib.entero(12.6)).toBe(13);
  });
});
