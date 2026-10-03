/**
 * FOR-SIGSA-3CS: Registro diario de consulta en centro de salud.
 *
 * Un renglon por consulta cerrada, con las columnas del formulario en su
 * orden. Los datos del paciente salen de su ficha (con los codigos oficiales
 * que ya guarda) y los de la consulta, de la hoja de evolucion del medico.
 * Funciones puras: reciben la atencion ya leida y devuelven el renglon.
 */

/** Dia, mes y anio en hora de Guatemala (UTC-6). */
function partesFecha(fecha) {
  if (!fecha) return { dia: '', mes: '', anio: '' };
  const d = new Date(new Date(fecha).getTime() - 6 * 3600000);
  return { dia: d.getUTCDate(), mes: d.getUTCMonth() + 1, anio: d.getUTCFullYear() };
}

/** Fecha de nacimiento del formulario. Si es estimada, se anota la edad. */
function nacimiento(paciente, consultaEn) {
  if (!paciente.fechaNacimiento) return { dia: '', mes: '', anio: '', edad: '' };
  if (paciente.fechaNacimientoEstimada) {
    const n = new Date(paciente.fechaNacimiento);
    const c = new Date(consultaEn);
    let anios = c.getUTCFullYear() - n.getUTCFullYear();
    if (c.getUTCMonth() < n.getUTCMonth() || (c.getUTCMonth() === n.getUTCMonth() && c.getUTCDate() < n.getUTCDate())) anios -= 1;
    if (anios >= 1) return { dia: '', mes: '', anio: '', edad: `${anios} ${anios === 1 ? 'año' : 'años'}` };
    const meses = Math.max(0, (c.getUTCFullYear() - n.getUTCFullYear()) * 12 + c.getUTCMonth() - n.getUTCMonth() - (c.getUTCDate() < n.getUTCDate() ? 1 : 0));
    return { dia: '', mes: '', anio: '', edad: `${meses} ${meses === 1 ? 'mes' : 'meses'}` };
  }
  const n = new Date(paciente.fechaNacimiento);
  return { dia: n.getUTCDate(), mes: n.getUTCMonth() + 1, anio: n.getUTCFullYear(), edad: '' };
}

const codigo = (v) => (v === null || v === undefined ? '' : String(v));
const siAplica = (v) => (v ? String(v) : '');

/**
 * atencion: con paciente (y su lugarPoblado), diagnosticos y prescripciones
 * (con insumo). sensibles: si se imprime la orientacion sexual.
 */
function renglonSigsa3cs(atencion, { sensibles = true } = {}) {
  const p = atencion.paciente;
  const cuando = atencion.cerradaEn ?? atencion.registradaEn;
  const diagnosticos = (atencion.diagnosticos?.length
    ? [...atencion.diagnosticos].sort((a, b) => a.orden - b.orden)
    : [{ descripcion: atencion.diagnosticoTxt, cie: atencion.diagnosticoCie }])
    .filter((d) => d.descripcion || d.cie);
  return {
    atencionId: atencion.id,
    dia: partesFecha(cuando).dia,
    historiaClinica: p.expedientePapel || p.expediente,
    nombre: `${p.nombres} ${p.apellidos}`,
    cui: p.cui ?? '',
    sexo: p.sexo ?? '',
    pueblo: codigo(p.pueblo),
    comunidadLinguistica: codigo(p.comunidadLinguistica),
    nacimiento: nacimiento(p, cuando),
    discapacidad: codigo(p.discapacidad),
    orientacionSexual: sensibles ? codigo(p.orientacionSexual) : '',
    escolaridad: codigo(p.escolaridad ?? p.nivelEscolar),
    profesion: p.profesionOficio ?? '',
    comunidad: p.lugarPoblado?.nombre ?? p.comunidad ?? '',
    municipio: p.municipioResidencia ?? '',
    migrante: p.migrante ? 'X' : '',
    consulta: codigo(atencion.tipoConsulta),
    control: siAplica(atencion.controlSigsa),
    semanasGestacion: atencion.semanasGestacion ?? '',
    viene: siAplica(atencion.referenciaViene),
    fue: siAplica(atencion.referenciaFue),
    referidoA: atencion.referidoA ?? '',
    diagnosticos: diagnosticos.map((d) => ({ descripcion: d.descripcion ?? '', cie: d.cie ?? '' })),
    tratamiento: (atencion.prescripciones ?? []).map((r) => ({
      descripcion: r.insumo?.nombreGenerico ?? '',
      presentacion: r.insumo?.presentacion ?? '',
      cantidad: r.cantidad,
    })),
    notificacionLugar: siAplica(atencion.lugarNotificacion),
    notificacionNumero: atencion.numeroNotificacion ?? '',
    acompanante: atencion.acompanante ?? '',
  };
}

/** Renglones ordenados por fecha de la consulta. */
function renglonesSigsa3cs(atenciones, opciones) {
  return [...atenciones]
    .sort((a, b) => new Date(a.cerradaEn ?? a.registradaEn) - new Date(b.cerradaEn ?? b.registradaEn))
    .map((a) => renglonSigsa3cs(a, opciones));
}

module.exports = { renglonSigsa3cs, renglonesSigsa3cs, partesFecha, nacimiento };
