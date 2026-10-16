const ExcelJS = require('exceljs');

const ENCABEZADO = { bold: true, color: { argb: 'FFFFFFFF' } };
const FONDO_ENCABEZADO = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F766E' },
};

function agregarHoja(libro, nombre, columnas, filas) {
  const hoja = libro.addWorksheet(nombre);
  hoja.columns = columnas;

  hoja.getRow(1).font = ENCABEZADO;
  hoja.getRow(1).fill = FONDO_ENCABEZADO;
  hoja.getRow(1).alignment = { vertical: 'middle' };

  filas.forEach((fila) => hoja.addRow(fila));
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  return hoja;
}

/**
 * Construye el libro XLSX del consolidado mensual.
 * Una hoja por bloque del informe, mas una de portada.
 */
async function construirLibro(consolidado) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema de gestion clínica';
  libro.created = new Date();

  // Portada
  const portada = libro.addWorksheet('Consolidado');
  portada.columns = [
    { header: 'Dato', key: 'dato', width: 34 },
    { header: 'Valor', key: 'valor', width: 46 },
  ];
  portada.getRow(1).font = ENCABEZADO;
  portada.getRow(1).fill = FONDO_ENCABEZADO;

  [
    ['Establecimiento', consolidado.establecimiento?.nombre ?? ''],
    ['Codigo institucional', consolidado.establecimiento?.codigo ?? ''],
    ['Municipio', consolidado.establecimiento?.municipio ?? ''],
    ['Departamento', consolidado.establecimiento?.departamento ?? ''],
    ['Mes', consolidado.mes],
    ['Atenciones registradas', consolidado.resumen.atencionesRegistradas],
    ['Atenciones concluidas', consolidado.resumen.atendidas],
    ['Ausentes', consolidado.resumen.ausentes],
    ['Urgentes atendidos', consolidado.resumen.urgentes],
    ['Generado el', new Date().toLocaleString('es-GT')],
  ].forEach(([dato, valor]) => portada.addRow({ dato, valor }));

  agregarHoja(
    libro,
    'Por grupo de edad',
    [
      { header: 'Grupo de edad', key: 'grupo', width: 22 },
      { header: 'Masculino', key: 'M', width: 12 },
      { header: 'Femenino', key: 'F', width: 12 },
      { header: 'Total', key: 'total', width: 12 },
    ],
    consolidado.atencionesPorGrupo,
  );

  agregarHoja(
    libro,
    'Diagnosticos CIE-10',
    [
      { header: 'Codigo CIE-10', key: 'codigo', width: 16 },
      { header: 'Descripcion', key: 'descripcion', width: 52 },
      { header: 'Consultas', key: 'veces', width: 12 },
    ],
    consolidado.diagnosticos,
  );

  agregarHoja(
    libro,
    'Consumo de insumos',
    [
      { header: 'Insumo', key: 'nombreGenerico', width: 40 },
      { header: 'Unidad', key: 'unidadMedida', width: 14 },
      { header: 'Consumo del mes', key: 'consumo', width: 18 },
    ],
    consolidado.consumoInsumos,
  );

  agregarHoja(
    libro,
    'Existencias por lote',
    [
      { header: 'Insumo', key: 'nombreGenerico', width: 40 },
      { header: 'Categoria', key: 'categoria', width: 20 },
      { header: 'Lote', key: 'numeroLote', width: 18 },
      { header: 'Vence', key: 'fechaVence', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Existencia', key: 'cantidadActual', width: 14 },
      { header: 'Unidad', key: 'unidadMedida', width: 14 },
    ],
    consolidado.existencias,
  );

  agregarHoja(
    libro,
    'Tiempos de espera',
    [
      { header: 'Prioridad', key: 'gravedad', width: 16 },
      { header: 'Casos', key: 'casos', width: 12 },
      { header: 'Espera promedio (min)', key: 'promedioMin', width: 24 },
    ],
    // Sin casos no se escribe un 0 que se leeria como "no hubo espera".
    consolidado.tiemposEspera.map((t) => ({
      ...t,
      promedioMin: t.promedioMin ?? 'sin casos',
    })),
  );

  return libro;
}

async function generarXlsx(consolidado) {
  const libro = await construirLibro(consolidado);
  return libro.xlsx.writeBuffer();
}

function nombreArchivo(consolidado) {
  const codigo = (consolidado.establecimiento?.codigo ?? 'establecimiento').replace(/[^\w-]/g, '');
  return `consolidado-${codigo}-${consolidado.mes}.xlsx`;
}

module.exports = { construirLibro, generarXlsx, nombreArchivo };
