/**
 * Boleta de Referencia y Contrarreferencia del MSPAS.
 *
 * El borrador se llena con lo que el sistema ya sabe del paciente: los
 * antecedentes de la ficha, los signos de la preconsulta, lo que el medico
 * escribio en la consulta. El medico lo revisa y corrige antes de guardar;
 * lo guardado es lo que se imprime.
 *
 * Funciones puras.
 */

const SI = 'Sí';
const NIEGA = 'Niega';

const lleno = (v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

/** Sí si alguna casilla esta marcada; Niega si todas dicen que no; vacio si no se pregunto. */
function siNiega(datos, claves) {
  const valores = claves.map((k) => datos?.[k]);
  if (valores.some((v) => v === true)) return SI;
  if (valores.some((v) => v === false)) return NIEGA;
  return '';
}

// Casillas de la lista de antecedentes medicos que la boleta pide aparte.
const APARTE = {
  quirurgicos: ['cirugias'],
  alergicos: ['alergias'],
  traumaticos: ['traumas', 'accidentes'],
};
const NO_MEDICOS = new Set(Object.values(APARTE).flat());

function antecedentesDe({ paciente, secciones, seccionesDef }) {
  const porClave = new Map(secciones.map((s) => [s.seccion, s.datos ?? {}]));
  const medicosClave = ['medicos_adulto', 'medicos_ninez'].find((c) => porClave.has(c));
  const medicos = medicosClave ? porClave.get(medicosClave) : {};
  const def = seccionesDef.find((s) => s.clave === medicosClave);

  const listaMedica = [];
  for (const campo of def?.campos ?? []) {
    if (campo.tipo !== 'lista') continue;
    for (const i of campo.items) {
      if (!NO_MEDICOS.has(i.clave) && medicos[i.clave] === true) listaMedica.push(i.etiqueta);
    }
  }
  if (lleno(medicos.otrosMedicos)) listaMedica.push(medicos.otrosMedicos.trim());

  const a = {
    medicos: listaMedica.join(', ') || (medicosClave ? NIEGA : ''),
    quirurgicos: siNiega(medicos, APARTE.quirurgicos) || siNiega(porClave.get('perinatales_neonato'), ['quirurgicos']),
    alergicos: siNiega(medicos, APARTE.alergicos),
    mentales: siNiega(porClave.get('psicosociales_adulto'), ['alteracionesAnimo']),
    traumaticos: siNiega(medicos, APARTE.traumaticos),
    gestas: '', partos: '', abortos: '', hijosVivos: '', hijosMuertos: '', fur: '', cstp: '', otros: '',
  };

  if (paciente.sexo === 'F') {
    const p = porClave.get('personales_adulto') ?? {};
    const texto = (v) => (lleno(v) ? String(v) : '');
    a.gestas = texto(p.embarazos);
    a.abortos = texto(p.abortos);
    a.hijosVivos = texto(p.hijosVivos);
    if (lleno(p.hijos) && lleno(p.hijosVivos)) a.hijosMuertos = String(Math.max(0, Number(p.hijos) - Number(p.hijosVivos)));
    if (lleno(p.fur)) a.fur = fechaCorta(p.fur);
  }
  return a;
}

function fechaCorta(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('es-GT', { timeZone: 'UTC' });
}

const num = (v) => (v === null || v === undefined ? '' : String(Number(v)));

function examenFisicoDe(pre) {
  if (!pre) return { peso: '', talla: '', pulso: '', pa: '', fr: '', temperatura: '', fcf: '' };
  return {
    peso: pre.peso != null ? `${num(pre.peso)} kg` : '',
    talla: pre.talla != null ? `${num(pre.talla)} cm` : '',
    pulso: num(pre.frecCardiaca),
    pa: pre.presionSis ? `${pre.presionSis}/${pre.presionDia ?? ''}` : '',
    fr: num(pre.frecRespiratoria),
    temperatura: pre.temperatura != null ? `${num(pre.temperatura)} °C` : '',
    fcf: '',
  };
}

function impresionClinicaDe(atencion) {
  const ds = [...(atencion.diagnosticos ?? [])].sort((x, y) => x.orden - y.orden);
  if (ds.length) return ds.map((d) => (d.cie ? `${d.cie} ${d.descripcion}` : d.descripcion)).join('; ');
  return [atencion.diagnosticoCie, atencion.diagnosticoTxt].filter(Boolean).join(' ');
}

function tratamientoDe(atencion) {
  const partes = [];
  if (lleno(atencion.tratamiento)) partes.push(atencion.tratamiento.trim());
  for (const p of atencion.prescripciones ?? []) {
    const ins = p.insumo;
    const nombre = [ins?.nombreGenerico, ins?.concentracion].filter(Boolean).join(' ');
    partes.push(`${nombre} #${p.cantidad}${p.indicaciones ? `, ${p.indicaciones}` : ''}`);
  }
  for (const r of atencion.recetasExternas ?? []) {
    partes.push(`${r.medicamento}${r.cantidad ? ` #${r.cantidad}` : ''} (receta externa)`);
  }
  return partes.join('\n');
}

/** La boleta como la propone el sistema, antes de que el medico la revise. */
function borradorReferencia({ atencion, paciente, secciones = [], seccionesDef = [] }) {
  return {
    tipo: atencion.gravedad === 'urgente' ? 'emergencia' : 'consulta_externa',
    servicioDestino: atencion.referidoA ?? '',
    telefono: paciente.telefono ?? '',
    horaTraslado: '',
    historia: atencion.historiaEnfermedad || atencion.motivoConsulta || '',
    antecedentes: antecedentesDe({ paciente, secciones, seccionesDef }),
    examenFisico: examenFisicoDe(atencion.preconsulta),
    examenes: atencion.laboratorios ?? '',
    impresionClinica: impresionClinicaDe(atencion),
    motivo: '',
    tratamiento: tratamientoDe(atencion),
  };
}

/** 0001-2026: correlativo de cuatro cifras y el anio. */
const numeroReferencia = (r) => (r ? `${String(r.correlativo).padStart(4, '0')}-${r.anio}` : '');

module.exports = { borradorReferencia, numeroReferencia, antecedentesDe, examenFisicoDe, SI, NIEGA };
