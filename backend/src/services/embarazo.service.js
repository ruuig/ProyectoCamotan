// Episodio de embarazo.
//
// El embarazo no es un atributo de la persona, es un episodio con principio y
// fin. Como casilla fija se quedaba marcada para siempre y seguia dando
// prioridad en la cola anios despues del parto.
//
// Funciones puras: el calculo de semanas y fecha probable de parto no toca la
// base y se puede probar solo.

const MS_POR_DIA = 86400000;
const DIAS_POR_SEMANA = 7;

// Regla de Naegele: 280 dias desde la fecha de ultima regla.
const DIAS_GESTACION = 280;

// A las 42 semanas el episodio se vence solo: o ya hubo parto y no se
// registro, o la paciente dejo de asistir. En ninguno de los dos casos
// corresponde seguir dando prioridad por embarazo.
const SEMANAS_MAXIMAS = 42;

/**
 * Fecha probable de parto a partir de la fecha de ultima regla.
 */
function fechaProbableParto(fechaUltimaRegla) {
  if (!fechaUltimaRegla) return null;
  const fur = new Date(fechaUltimaRegla);
  if (Number.isNaN(fur.getTime())) return null;
  return new Date(fur.getTime() + DIAS_GESTACION * MS_POR_DIA);
}

/**
 * Semanas de gestacion a una fecha dada.
 *
 * Si no hay fecha de ultima regla se parte de las semanas declaradas al abrir
 * el episodio. Devuelve null cuando no hay ninguna de las dos: es preferible
 * no saberlo a mostrar un numero inventado.
 */
function semanasDeGestacion(episodio, ahora = new Date()) {
  if (!episodio) return null;

  const { fechaUltimaRegla, semanasAlRegistrar, abiertoEn } = episodio;

  if (fechaUltimaRegla) {
    const dias = (new Date(ahora) - new Date(fechaUltimaRegla)) / MS_POR_DIA;
    if (dias < 0) return null;
    return Math.floor(dias / DIAS_POR_SEMANA);
  }

  if (semanasAlRegistrar != null && abiertoEn) {
    const dias = (new Date(ahora) - new Date(abiertoEn)) / MS_POR_DIA;
    if (dias < 0) return semanasAlRegistrar;
    return semanasAlRegistrar + Math.floor(dias / DIAS_POR_SEMANA);
  }

  return null;
}

/**
 * Indica si el episodio ya paso el limite y debe cerrarse solo.
 *
 * Sin semanas conocidas no se vence: no se cierra un episodio por no saber
 * cuanto lleva.
 */
function debeVencerse(episodio, ahora = new Date()) {
  if (!episodio || episodio.estado !== 'activo') return false;
  const semanas = semanasDeGestacion(episodio, ahora);
  return semanas !== null && semanas >= SEMANAS_MAXIMAS;
}

/**
 * Resumen del episodio para mostrarlo en la ficha y en la cola.
 */
function describirEpisodio(episodio, ahora = new Date()) {
  if (!episodio) return null;

  const semanas = semanasDeGestacion(episodio, ahora);

  return {
    id: episodio.id,
    estado: episodio.estado,
    semanas,
    // Sin semanas el texto lo dice, en vez de dejar un hueco.
    texto: semanas === null
      ? 'Embarazo activo, semanas desconocidas'
      : `Embarazo de ${semanas} semanas`,
    fechaProbableParto: episodio.fechaProbableParto ?? fechaProbableParto(episodio.fechaUltimaRegla),
    vencido: debeVencerse(episodio, ahora),
  };
}

module.exports = {
  DIAS_GESTACION,
  SEMANAS_MAXIMAS,
  fechaProbableParto,
  semanasDeGestacion,
  debeVencerse,
  describirEpisodio,
};
