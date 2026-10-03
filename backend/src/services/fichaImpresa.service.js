/**
 * Ficha clinica impresa de una atencion.
 *
 * Junta las tres partes (lo que preconsulta paso de la ficha del paciente, la
 * atencion del dia y la hoja del medico) en el orden exacto del papel de la
 * ficha que corresponde a la edad (MD/fichas.md). Lo que no se registro sale
 * vacio, como en el papel: la hoja impresa sirve tambien para terminarla a
 * mano.
 *
 * Funcion pura: recibe todo ya leido de la base.
 */

const { aplica, clavesSensibles, calculados } = require('./fichaSecciones.service');

const vacio = (v) => v === null || v === undefined || v === '';

function siNo(v) {
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  return '';
}

function fecha(v) {
  if (!v) return '';
  const d = new Date(v);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** Valor de un campo de identificacion, legible. */
function valorIdentificacion(campo, paciente, ctx) {
  const v = paciente[campo.clave];
  switch (campo.clave) {
    case 'sexo': return paciente.sexo === 'M' ? 'Masculino' : 'Femenino';
    case 'fechaNacimiento': return `${fecha(paciente.fechaNacimiento)}${paciente.fechaNacimientoEstimada ? ' (aproximada)' : ''}`;
    case 'edad': return ctx.edadTexto;
    case 'lugarPobladoId': return paciente.comunidad ?? '';
    default: break;
  }
  if (vacio(v)) return '';
  if (typeof v === 'boolean') {
    const detalle = campo.especifique ? paciente[campo.especifique.clave] : null;
    return v && detalle ? `Sí: ${detalle}` : siNo(v);
  }
  if (campo.opciones) return campo.opciones.find((o) => o.valor === v)?.etiqueta ?? String(v);
  if (campo.catalogo) return ctx.catalogos[campo.catalogo]?.[v] ?? String(v);
  return String(v);
}

/** Filas etiqueta/valor de una seccion de antecedentes. */
function filasSeccion(seccion, datos, perfil, ocultar) {
  const filas = [];
  const calc = calculados(seccion, datos);
  const valor = (k, v) => (ocultar.has(k) && !vacio(v) ? 'Registrado' : v);

  for (const c of seccion.campos) {
    if (!aplica(c, perfil, datos)) continue;
    switch (c.tipo) {
      case 'lista':
        filas.push({
          etiqueta: c.etiqueta,
          casillas: c.items.map((i) => ({ etiqueta: i.etiqueta, valor: valor(i.clave, siNo(datos[i.clave])) })),
        });
        break;
      case 'siNoEspecifique':
      case 'siNoNumero': {
        const detalle = datos[`${c.clave}Detalle`];
        const base = siNo(datos[c.clave]);
        const texto = datos[c.clave] === true && !vacio(detalle)
          ? `Sí: ${detalle}${c.tipo === 'siNoNumero' ? ` ${c.unidad}` : ''}`
          : base;
        filas.push({ etiqueta: c.etiqueta, valor: valor(c.clave, texto) });
        break;
      }
      case 'siNo':
        filas.push({ etiqueta: c.etiqueta, valor: valor(c.clave, siNo(datos[c.clave])) });
        break;
      case 'seleccion': {
        const v = datos[c.clave];
        const texto = v === 'otro' && datos[`${c.clave}Otro`]
          ? `Otro: ${datos[`${c.clave}Otro`]}`
          : (c.opciones.find((o) => o.valor === v)?.etiqueta ?? '');
        filas.push({ etiqueta: c.etiqueta, valor: valor(c.clave, texto), opciones: c.opciones.map((o) => o.etiqueta) });
        break;
      }
      case 'libraOnza':
        filas.push({
          etiqueta: c.etiqueta,
          valor: vacio(datos[`${c.clave}Lb`]) ? '' : `${datos[`${c.clave}Lb`]} lb ${datos[`${c.clave}Onz`] ?? 0} onz`,
        });
        break;
      case 'numero':
        filas.push({ etiqueta: c.etiqueta, valor: vacio(datos[c.clave]) ? '' : `${datos[c.clave]}${c.unidad ? ` ${c.unidad}` : ''}` });
        break;
      case 'fecha':
        filas.push({ etiqueta: c.etiqueta, valor: datos[c.clave] ? fecha(`${datos[c.clave]}T12:00:00Z`) : '' });
        break;
      case 'calculado':
        filas.push({ etiqueta: c.etiqueta, valor: calc[c.clave] ?? '' });
        break;
      case 'archivo':
        filas.push({ etiqueta: c.etiqueta, valor: datos[c.clave] ? 'Adjunto en el expediente digital' : '' });
        break;
      default:
        filas.push({ etiqueta: c.etiqueta, valor: valor(c.clave, datos[c.clave] ?? ''), largo: c.tipo === 'textoLargo' });
    }
  }
  return filas;
}

// --- Bloques de la atencion -----------------------------------------------------

const AVISO_PELIGRO = 'En caso de signos o síntomas de peligro/condición grave: tomar signos vitales, estabilizar, registrar y llenar boleta de referencia.';

function bloqueSignosPeligro(ctx) {
  const marcados = new Set(ctx.atencion.preconsulta?.signosPeligro ?? []);
  return {
    titulo: 'Signos o síntomas de peligro',
    nota: AVISO_PELIGRO,
    filas: [{
      etiqueta: 'Signos de peligro',
      casillas: ctx.signosPeligro.map((s) => ({
        etiqueta: s.descripcion,
        valor: marcados.has(s.codigo) || marcados.has(s.descripcion) ? 'Sí' : (ctx.atencion.preconsulta ? 'No' : ''),
      })),
    }],
  };
}

function bloqueMotivo(ctx, conReferido) {
  const a = ctx.atencion;
  const filas = [{ etiqueta: 'Motivo de consulta', valor: a.motivoConsulta ?? '', largo: true }];
  if (conReferido) {
    filas.push({ etiqueta: 'Referido', valor: a.referenciaViene > 0 ? 'Sí' : (a.referenciaViene === 0 ? 'No' : '') });
  }
  return { titulo: 'Motivo de consulta', filas };
}

function bloqueHistoria(ctx, titulo = 'Historia de la enfermedad actual') {
  return { titulo, filas: [{ etiqueta: titulo, valor: ctx.atencion.historiaEnfermedad ?? '', largo: true }] };
}

function bloqueSignosVitales(ctx, { conPeso }) {
  const p = ctx.atencion.preconsulta ?? {};
  const a = ctx.antropometria ?? {};
  const filas = [
    { etiqueta: 'Temperatura', valor: vacio(p.temperatura) ? '' : `${p.temperatura} °C` },
    { etiqueta: 'Frecuencia cardíaca', valor: vacio(p.frecCardiaca) ? '' : `${p.frecCardiaca} por min` },
    { etiqueta: 'P/A', valor: p.presionSis ? `${p.presionSis}/${p.presionDia} mmHg` : '' },
    { etiqueta: 'Frecuencia respiratoria', valor: vacio(p.frecRespiratoria) ? '' : `${p.frecRespiratoria} por min` },
  ];
  if (conPeso) {
    filas.push(
      { etiqueta: 'Peso', valor: vacio(p.peso) ? '' : `${p.peso} kg` },
      { etiqueta: 'Talla', valor: vacio(p.talla) ? '' : `${p.talla} cm` },
      { etiqueta: 'IMC', valor: vacio(a.imc) ? '' : String(a.imc) },
      { etiqueta: 'Estado nutricional', valor: ctx.clasificacionTexto ?? '' },
    );
  }
  return { titulo: 'Signos vitales', filas };
}

function bloqueAntropometria(ctx) {
  const p = ctx.atencion.preconsulta ?? {};
  const a = ctx.antropometria ?? {};
  return {
    titulo: 'Antropometría',
    filas: [
      { etiqueta: 'Peso', valor: vacio(p.peso) ? '' : `${p.peso} kg` },
      { etiqueta: 'Longitud/talla', valor: vacio(p.talla) ? '' : `${p.talla} cm` },
      { etiqueta: 'Perímetro cefálico', valor: vacio(a.perimetroCefalico) ? '' : `${a.perimetroCefalico} cm` },
      { etiqueta: 'Clasificación', valor: ctx.clasificacionTexto ?? '' },
    ],
  };
}

function bloqueExamen(ctx) {
  const a = ctx.atencion;
  const sitios = a.examenSitios?.sitios ?? {};
  return {
    titulo: 'Examen físico',
    filas: [
      { etiqueta: 'Examen físico', valor: a.examenFisico ?? '', largo: true },
      {
        etiqueta: 'Normal por sitio anatómico',
        casillas: ctx.sitios.map((s) => ({ etiqueta: s.etiqueta, valor: siNo(sitios[s.clave]) })),
      },
      { etiqueta: 'Otros hallazgos, especifique', valor: a.examenSitios?.otrosHallazgos ?? '', largo: true },
      { etiqueta: 'Describa hallazgos anormales', valor: a.examenSitios?.hallazgosAnormales ?? '', largo: true },
    ],
  };
}

function bloqueViolencia(ctx) {
  const a = ctx.atencion;
  const oculto = !ctx.puedeVerSensibles;
  const lugar = ctx.lugaresNotificacion.find((l) => l.valor === a.lugarNotificacion);
  return {
    titulo: 'En caso de violencia',
    filas: [
      { etiqueta: 'Fecha de notificación', valor: '' },
      { etiqueta: 'Hora de notificación', valor: '' },
      { etiqueta: 'Número de caso', valor: a.numeroNotificacion ? (oculto ? 'Registrado' : `${lugar?.etiqueta ?? ''} ${a.numeroNotificacion}`.trim()) : '' },
    ],
  };
}

function bloqueImpresionClinica(ctx, columnaTratamiento) {
  const a = ctx.atencion;
  const diagnosticos = a.diagnosticos?.length
    ? a.diagnosticos
    : (a.diagnosticoTxt ? [{ descripcion: a.diagnosticoTxt, cie: a.diagnosticoCie }] : []);
  // El papel trae 10 renglones; los que sobran quedan en blanco.
  const filas = Array.from({ length: Math.max(5, diagnosticos.length) }, (_, i) => [
    diagnosticos[i]?.descripcion ?? '',
    diagnosticos[i]?.cie ?? '',
  ]);
  const receta = (a.prescripciones ?? []).map((p) => `${p.insumo?.nombreGenerico ?? ''} ${p.insumo?.presentacion ?? ''}: ${p.cantidad}${p.indicaciones ? ` (${p.indicaciones})` : ''}`.trim());
  return {
    titulo: 'Impresión clínica (diagnóstico), codificación y tratamiento',
    tabla: { columnas: ['Impresión clínica (diagnóstico)', 'CIE-10'], filas },
    filas: [
      { etiqueta: columnaTratamiento, valor: a.tratamiento ?? '', largo: true },
      { etiqueta: 'Prescripción', valor: receta.join(' · ') },
    ],
  };
}

function bloqueCierre(ctx, extras) {
  const a = ctx.atencion;
  const filas = [
    { etiqueta: 'Otros problemas identificados', valor: a.otrosProblemas ?? '', largo: true },
    { etiqueta: 'Laboratorios a realizar según normas, resultados y otros estudios complementarios', valor: a.laboratorios ?? '', largo: true },
    { etiqueta: 'Orientación integral', valor: a.orientacionIntegral ?? '', largo: true },
    { etiqueta: 'Nombre completo, firma y sello del proveedor', valor: ctx.proveedor ?? '' },
  ];
  if (extras.includes('proximaCita')) filas.push({ etiqueta: 'Fecha próxima cita', valor: fecha(a.proximaCita) });
  if (extras.includes('firmaResponsable')) filas.push({ etiqueta: extras.etiquetaFirma, valor: '', firma: true });
  if (extras.includes('huellaPlantar')) filas.push({ etiqueta: 'Huella plantar del neonato', valor: '', firma: true });
  return { titulo: 'Cierre', filas };
}

function bloque3cs(ctx) {
  const a = ctx.atencion;
  const et = (lista, v) => lista.find((o) => o.valor === v)?.etiqueta ?? '';
  return {
    titulo: 'Datos del SIGSA 3CS',
    nota: 'No forman parte del papel de la ficha; se registran para el informe.',
    filas: [
      { etiqueta: 'Tipo de consulta', valor: et(ctx.catalogos3cs.tipoConsulta, a.tipoConsulta) },
      { etiqueta: 'Control', valor: et(ctx.catalogos3cs.controlSigsa, a.controlSigsa) },
      { etiqueta: 'Semana de gestación', valor: vacio(a.semanasGestacion) ? '' : String(a.semanasGestacion) },
      { etiqueta: 'Referencia, viene', valor: et(ctx.catalogos3cs.referenciaViene, a.referenciaViene) },
      { etiqueta: 'Referencia, fue', valor: `${et(ctx.catalogos3cs.referenciaFue, a.referenciaFue)}${a.referidoA ? `: ${a.referidoA}` : ''}` },
      { etiqueta: 'Nombre del acompañante', valor: a.acompanante ?? '' },
    ],
  };
}

// --- Composicion ----------------------------------------------------------------------

/**
 * ctx: { ficha, identificacion (estructura), secciones (definiciones de la
 * ficha), filasSecciones (Map clave -> datos), paciente, perfil, edadTexto,
 * catalogos, atencion, antropometria, clasificacionTexto, sitios,
 * signosPeligro, proveedor, puedeVerSensibles, catalogos3cs,
 * lugaresNotificacion }
 */
function componerFichaImpresa(ctx) {
  const ocultarIdentificacion = ctx.puedeVerSensibles ? new Set() : new Set(ctx.sensiblesIdentificacion ?? []);
  const identificacion = {
    titulo: ctx.identificacion.seccion,
    filas: ctx.identificacion.campos.map((c) => {
      const valor = valorIdentificacion(c, ctx.paciente, ctx);
      return {
        etiqueta: c.etiqueta,
        subseccion: c.subseccion ?? null,
        valor: ocultarIdentificacion.has(c.clave) && valor ? 'Registrado' : valor,
      };
    }),
  };

  const antecedentes = ctx.secciones.map((s) => {
    const datos = ctx.filasSecciones.get(s.clave) ?? {};
    const ocultar = ctx.puedeVerSensibles ? new Set() : clavesSensibles(s);
    return { titulo: s.titulo, subtitulo: s.subtitulo ?? null, nivel: 2, filas: filasSeccion(s, datos, ctx.perfil, ocultar) };
  });
  const grupoAntecedentes = antecedentes.length
    ? [{ titulo: 'Antecedentes', nivel: 1, filas: [] }, ...antecedentes]
    : [];

  const clave = ctx.ficha.clave;
  let bloques;
  if (clave === 'recien_nacido') {
    bloques = [
      identificacion,
      bloqueMotivo(ctx, false),
      bloqueSignosPeligro(ctx),
      bloqueHistoria(ctx, 'Historial de la enfermedad actual'),
      ...grupoAntecedentes,
      bloqueExamen(ctx),
      bloqueViolencia(ctx),
      bloqueImpresionClinica(ctx, 'Tratamiento'),
      bloqueCierre(ctx, Object.assign(['firmaResponsable', 'proximaCita', 'huellaPlantar'], { etiquetaFirma: 'Firma o huella de la madre, padre o responsable' })),
    ];
  } else if (clave === 'lactante_ninez') {
    bloques = [
      identificacion,
      bloqueSignosPeligro(ctx),
      bloqueMotivo(ctx, true),
      bloqueHistoria(ctx),
      ...grupoAntecedentes,
      bloqueSignosVitales(ctx, { conPeso: false }),
      bloqueAntropometria(ctx),
      bloqueExamen(ctx),
      bloqueViolencia(ctx),
      { titulo: 'Maltrato infantil', filas: [{ etiqueta: 'Fecha de notificación', valor: '' }, { etiqueta: 'Número de caso', valor: '' }] },
      bloqueImpresionClinica(ctx, 'Conducta/tratamiento'),
      bloqueCierre(ctx, ['proximaCita']),
    ];
  } else {
    // Persona adulta y mayor. La de adolescente sigue este orden comun
    // mientras no se fotografie la suya.
    bloques = [
      identificacion,
      { ...bloqueSignosPeligro(ctx), titulo: 'Evalúe signos y síntomas de peligro' },
      bloqueMotivo(ctx, true),
      bloqueHistoria(ctx),
      ...grupoAntecedentes,
      bloqueSignosVitales(ctx, { conPeso: true }),
      bloqueExamen(ctx),
      bloqueViolencia(ctx),
      bloqueImpresionClinica(ctx, 'Tratamiento'),
      bloqueCierre(ctx, Object.assign(['firmaResponsable', 'proximaCita'], { etiquetaFirma: 'Firma o huella del paciente o responsable' })),
    ];
  }

  return {
    ficha: ctx.ficha,
    encabezado: [
      { etiqueta: 'Fecha', valor: fecha(ctx.atencion.registradaEn) },
      { etiqueta: 'Hora', valor: ctx.horaTexto ?? '' },
      { etiqueta: 'Número de expediente', valor: ctx.paciente.expediente },
      { etiqueta: 'Ficha en papel', valor: ctx.paciente.expedientePapel ?? '' },
    ],
    bloques: [...bloques, bloque3cs(ctx)],
  };
}

/** Vacia todos los valores: la misma ficha en blanco, para contingencia. */
function enBlanco(compuesta) {
  const limpiar = (filas) => filas.map((f) => ({
    ...f,
    valor: f.valor === undefined ? undefined : '',
    casillas: f.casillas?.map((c) => ({ ...c, valor: '' })),
  }));
  return {
    ...compuesta,
    encabezado: compuesta.encabezado.map((e) => ({ ...e, valor: '' })),
    bloques: compuesta.bloques.map((b) => ({
      ...b,
      filas: limpiar(b.filas ?? []),
      tabla: b.tabla ? { ...b.tabla, filas: b.tabla.filas.map((r) => r.map(() => '')) } : undefined,
    })),
  };
}

module.exports = { componerFichaImpresa, enBlanco, filasSeccion, valorIdentificacion, siNo, fecha };
