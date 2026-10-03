/**
 * FOR-SIGSA-4: Registro diario de post-consulta en centro de salud u hospital.
 *
 * Un renglon por medicamento recetado y entregado en el mes: dia, paciente,
 * CUI, responsable de la consulta, historia clinica, motivo (CIE-10 y
 * descripcion), medicamento, presentacion, cantidad entregada, cantidad no
 * entregada y la firma o huella de quien recibe. Funciones puras: reciben los
 * datos ya leidos y devuelven los renglones.
 */

/** La constancia que ampara una entrega: la primera tomada despues de ella. */
function constanciaDe(entregadaEn, constancias) {
  const t = new Date(entregadaEn).getTime();
  return constancias
    .filter((c) => new Date(c.registradaEn).getTime() >= t)
    .sort((a, b) => new Date(a.registradaEn) - new Date(b.registradaEn))[0] ?? null;
}

/** Dia del mes en hora de Guatemala (UTC-6). */
function diaLocal(fecha) {
  return new Date(new Date(fecha).getTime() - 6 * 3600000).getUTCDate();
}

/**
 * prescripciones: con atencion (paciente, medico, constancias), insumo,
 * dispensaciones no anuladas del mes y demanda no atendida.
 */
function renglonesSigsa4(prescripciones) {
  const renglones = [];
  for (const p of prescripciones) {
    const entregas = p.dispensaciones.filter((d) => !d.anulada);
    const noEntregado = p.demandaNoAtendida.reduce((s, d) => s + d.cantidad, 0);
    if (!entregas.length && !noEntregado) continue;
    const primera = entregas.length
      ? entregas.reduce((a, b) => (new Date(a.registradaEn) < new Date(b.registradaEn) ? a : b))
      : p.demandaNoAtendida[0];
    const ultima = entregas.length
      ? entregas.reduce((a, b) => (new Date(a.registradaEn) > new Date(b.registradaEn) ? a : b))
      : null;
    const a = p.atencion;
    const pac = a.paciente;
    renglones.push({
      prescripcionId: p.id,
      atencionId: a.id,
      fecha: primera.registradaEn,
      dia: diaLocal(primera.registradaEn),
      paciente: `${pac.nombres} ${pac.apellidos}`,
      cui: pac.cui ?? '',
      responsableConsulta: a.medico?.nombre ?? '',
      historiaClinica: pac.expedientePapel || pac.expediente,
      cie: a.diagnosticoCie ?? '',
      diagnostico: a.diagnosticoTxt ?? '',
      medicamento: p.insumo.nombreGenerico,
      presentacion: p.insumo.presentacion ?? '',
      entregado: entregas.reduce((s, d) => s + d.cantidad, 0),
      noEntregado,
      constancia: ultima ? constanciaDe(ultima.registradaEn, a.constancias ?? []) : null,
    });
  }
  renglones.sort((x, y) => new Date(x.fecha) - new Date(y.fecha) || x.paciente.localeCompare(y.paciente, 'es'));
  return renglones.map((r, i) => ({ ...r, orden: i + 1 }));
}

module.exports = { renglonesSigsa4, constanciaDe, diaLocal };
