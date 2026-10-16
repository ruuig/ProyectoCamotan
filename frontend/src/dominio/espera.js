/**
 * Cómo se dice una espera: en minutos mientras es de minutos, en horas o días
 * cuando pasa de eso. "3355 min" no lo lee nadie; "2 d 7 h" sí.
 */
export function partesEspera(min) {
  const m = Math.max(0, Math.round(min ?? 0));
  if (m < 60) return { n: m, u: 'min' };
  if (m < 1440) return { n: `${Math.floor(m / 60)} h`, u: m % 60 ? `${m % 60} min` : '' };
  return { n: `${Math.floor(m / 1440)} d`, u: `${Math.floor((m % 1440) / 60)} h` };
}

export function textoEspera(min) {
  const { n, u } = partesEspera(min);
  return u ? `${n} ${u}` : `${n}`;
}

// Quien sigue en la cola desde otro día casi siempre es una atención que no
// se cerró: se marca para que no se lea como una espera real.
export const diaGt = (f) => new Date(f).toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' });
export const deOtroDia = (e) => Boolean(e?.registradaEn) && diaGt(e.registradaEn) !== diaGt(new Date());
