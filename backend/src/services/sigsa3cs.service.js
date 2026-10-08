/**
 * FOR-SIGSA-3CS: Registro diario de consulta en centro de salud.
 *
 * Un renglon por consulta cerrada, con las columnas del formulario en su
 * orden. Los datos del paciente salen de su ficha (con los codigos oficiales
 * que ya guarda) y los de la consulta, de la hoja de evolucion del medico.
 * Funciones puras: reciben la atencion ya leida y devuelven el renglon.
 */

const HORAS_GUATEMALA = -6;
const MS_POR_HORA = 3600000;

/** Dia, mes y anio en hora de Guatemala (UTC-6). */
function partesFecha(fecha) {
  if (!fecha) return { dia: '', mes: '', anio: '' };
  const fechaLocal = new Date(new Date(fecha).getTime() + HORAS_GUATEMALA * MS_POR_HORA);
  return { dia: fechaLocal.getUTCDate(), mes: fechaLocal.getUTCMonth() + 1, anio: fechaLocal.getUTCFullYear() };
}

/** Meses completos entre el nacimiento y la fecha de la consulta. */
function mesesCumplidos(nacio, consulta) {
  const meses = (consulta.getUTCFullYear() - nacio.getUTCFullYear()) * 12
    + (consulta.getUTCMonth() - nacio.getUTCMonth());
  const faltaElDia = consulta.getUTCDate() < nacio.getUTCDate();
  return Math.max(0, faltaElDia ? meses - 1 : meses);
}

/**
 * Fecha de nacimiento del formulario. Si es exacta se anotan dia, mes y anio.
 * Si no se conoce, se anota la edad en una sola casilla: los dias en la del
 * dia (menores de un mes), los meses en la del mes (menores de un anio) o
 * los anios en la del anio. Las otras dos quedan en blanco.
 */
function nacimiento(paciente, consultaEn) {
  const vacio = { dia: '', mes: '', anio: '', estimada: false };
  if (!paciente.fechaNacimiento) return vacio;

  const nacio = new Date(paciente.fechaNacimiento);
  if (!paciente.fechaNacimientoEstimada) {
    return { ...vacio, dia: nacio.getUTCDate(), mes: nacio.getUTCMonth() + 1, anio: nacio.getUTCFullYear() };
  }

  const consulta = new Date(consultaEn);
  const meses = mesesCumplidos(nacio, consulta);
  const estimada = { ...vacio, estimada: true };
  if (meses >= 12) return { ...estimada, anio: Math.floor(meses / 12) };
  if (meses >= 1) return { ...estimada, mes: meses };
  return { ...estimada, dia: Math.max(0, Math.floor((consulta - nacio) / (24 * MS_POR_HORA))) };
}

/** Codigo oficial como texto; vacio si no se registro. */
const codigo = (valor) => (valor === null || valor === undefined ? '' : String(valor));
/** Valor solo cuando aplica; vacio en cualquier otro caso. */
const siAplica = (valor) => (valor ? String(valor) : '');

/**
 * atencion: con paciente (y su lugarPoblado), diagnosticos y prescripciones
 * (con insumo). sensibles: si se imprime la orientacion sexual.
 */
function renglonSigsa3cs(atencion, { sensibles = true } = {}) {
  const paciente = atencion.paciente;
  const fechaConsulta = atencion.cerradaEn ?? atencion.registradaEn;
  const registrados = atencion.diagnosticos?.length
    ? [...atencion.diagnosticos].sort((primero, segundo) => primero.orden - segundo.orden)
    : [{ descripcion: atencion.diagnosticoTxt, cie: atencion.diagnosticoCie }];
  const diagnosticos = registrados.filter((diagnostico) => diagnostico.descripcion || diagnostico.cie);

  return {
    atencionId: atencion.id,
    dia: partesFecha(fechaConsulta).dia,
    historiaClinica: paciente.expedientePapel || paciente.expediente,
    nombre: `${paciente.nombres} ${paciente.apellidos}`,
    cui: paciente.cui ?? '',
    sexo: paciente.sexo ?? '',
    pueblo: codigo(paciente.pueblo),
    comunidadLinguistica: codigo(paciente.comunidadLinguistica),
    nacimiento: nacimiento(paciente, fechaConsulta),
    discapacidad: codigo(paciente.discapacidad),
    orientacionSexual: sensibles ? codigo(paciente.orientacionSexual) : '',
    escolaridad: codigo(paciente.escolaridad ?? paciente.nivelEscolar),
    profesion: paciente.profesionOficio ?? '',
    comunidad: paciente.lugarPoblado?.nombre ?? paciente.comunidad ?? '',
    municipio: paciente.municipioResidencia ?? '',
    migrante: paciente.migrante ? 'X' : '',
    consulta: codigo(atencion.tipoConsulta),
    control: siAplica(atencion.controlSigsa),
    semanasGestacion: atencion.semanasGestacion ?? '',
    viene: siAplica(atencion.referenciaViene),
    fue: siAplica(atencion.referenciaFue),
    referidoA: atencion.referidoA ?? '',
    diagnosticos: diagnosticos.map((diagnostico) => ({ descripcion: diagnostico.descripcion ?? '', cie: diagnostico.cie ?? '' })),
    tratamiento: [
      ...(atencion.prescripciones ?? []).map((receta) => ({
        descripcion: receta.insumo?.nombreGenerico ?? '',
        presentacion: receta.insumo?.presentacion ?? '',
        cantidad: receta.cantidad,
      })),
      // El SIGSA 3CS anota el tratamiento indicado, se entregue aqui o no.
      ...(atencion.recetasExternas ?? []).map((receta) => ({
        descripcion: receta.medicamento,
        presentacion: '',
        cantidad: receta.cantidad ?? '',
      })),
    ],
    notificacionLugar: siAplica(atencion.lugarNotificacion),
    notificacionNumero: atencion.numeroNotificacion ?? '',
    acompanante: atencion.acompanante ?? '',
  };
}

/** Renglones ordenados por fecha de la consulta. */
function renglonesSigsa3cs(atenciones, opciones) {
  const fecha = (atencion) => new Date(atencion.cerradaEn ?? atencion.registradaEn);
  return [...atenciones]
    .sort((primera, segunda) => fecha(primera) - fecha(segunda))
    .map((atencion) => renglonSigsa3cs(atencion, opciones));
}

module.exports = { renglonSigsa3cs, renglonesSigsa3cs, partesFecha, nacimiento };
