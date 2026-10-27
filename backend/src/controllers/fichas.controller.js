const prisma = require('../config/db');
const {
  SECCIONES_COMUNES,
  FICHAS,
  sitiosExamen,
  fichasParaAtencion,
} = require('../services/fichaClinica.service');
const { etapaDeVida } = require('../services/etapaVida.service');
const { calcularEdad } = require('../services/pacientes.service');
const { estructuraIdentificacion } = require('../services/fichaIdentificacion.service');
const { seccionesDe, clavesSensibles } = require('../services/fichaSecciones.service');
const { componerFichaImpresa, enBlanco } = require('../services/fichaImpresa.service');
const { CATALOGOS_3CS } = require('../services/hojaEvolucion.service');
const { puedeVerSensibles } = require('../services/fichaPaciente.service');
const { CAMPOS_SENSIBLES } = require('../schemas/pacientes.schema');

const CLASIFICACION_TEXTO = {
  desnutricion_aguda_severa: 'Desnutrición aguda severa',
  desnutricion_aguda_moderada: 'Desnutrición aguda moderada',
  desnutricion_cronica: 'Desnutrición crónica',
  riesgo: 'En riesgo',
  sobrepeso: 'Sobrepeso',
  normal: 'Normal',
};

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function edadSegunFicha(claveFicha, edad, dias) {
  if (claveFicha === 'recien_nacido') return plural(dias, 'día', 'días');
  if (claveFicha === 'lactante_ninez') {
    return `${plural(edad.anios, 'año', 'años')}, ${plural(edad.meses, 'mes', 'meses')} y ${plural(edad.dias, 'día', 'días')}`;
  }
  return plural(edad.anios, 'año', 'años');
}

/**
 * Ficha impresa de una atencion: identificacion y antecedentes del paciente,
 * atencion del dia y hoja del medico, en el orden del papel de su edad.
 */
async function impresa(req, res, next) {
  const establecimientoId = req.usuario.establecimientoId;
  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId },
    include: {
      paciente: true,
      preconsulta: true,
      diagnosticos: { orderBy: { orden: 'asc' } },
      prescripciones: { include: { insumo: true } },
      recetasExternas: { orderBy: { creadaEn: 'asc' } },
    },
  });
  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  const { paciente } = atencion;
  // La ficha se elige por la edad a la fecha de la atencion.
  const estructura = estructuraIdentificacion(paciente.fechaNacimiento, atencion.registradaEn);
  const edad = calcularEdad(paciente.fechaNacimiento, atencion.registradaEn);
  const dias = Math.floor((new Date(atencion.registradaEn) - new Date(paciente.fechaNacimiento)) / 86400000);
  const perfil = { sexo: paciente.sexo, edadMeses: edad.edadMeses };
  const secciones = seccionesDe(estructura.ficha.clave, perfil);

  const etapa = estructura.ficha.clave;
  const [filas, catalogo, antropometria, signos, cierre] = await Promise.all([
    prisma.seccionPaciente.findMany({ where: { pacienteId: paciente.id } }),
    prisma.catalogoSigsa.findMany(),
    prisma.antropometria.findFirst({ where: { atencionId: atencion.id }, orderBy: { fecha: 'desc' } }),
    prisma.signoPeligro.findMany({ where: { establecimientoId, activo: true, etapa }, orderBy: { orden: 'asc' } }),
    prisma.bitacora.findFirst({
      where: { entidad: 'atencion', entidadId: atencion.id, detalle: { startsWith: 'Consulta cerrada' } },
      orderBy: { id: 'desc' },
      include: { usuario: { select: { nombre: true } } },
    }),
  ]);

  // La ficha de adolescente no tiene lista propia de signos transcrita: se
  // usa la de adulto, como en la preconsulta.
  const signosPeligro = signos.length > 0
    ? signos
    : await prisma.signoPeligro.findMany({ where: { establecimientoId, activo: true, etapa: 'adulto' }, orderBy: { orden: 'asc' } });

  const catalogos = {};
  for (const c of catalogo) {
    catalogos[c.catalogo] = catalogos[c.catalogo] ?? {};
    catalogos[c.catalogo][c.codigo] = c.etiqueta;
  }

  const peso = Number(atencion.preconsulta?.peso);
  const talla = Number(atencion.preconsulta?.talla);
  const imc = peso > 0 && talla > 0 ? (peso / (talla / 100) ** 2).toFixed(1) : null;

  const verSensibles = puedeVerSensibles(req.usuario);
  const filasSecciones = new Map(filas.map((f) => [f.seccion, f.datos ?? {}]));

  let compuesta = componerFichaImpresa({
    ficha: estructura.ficha,
    identificacion: estructura,
    secciones,
    filasSecciones,
    paciente,
    perfil,
    edadTexto: edadSegunFicha(etapa, edad, dias),
    horaTexto: new Date(atencion.registradaEn).toLocaleTimeString('es-GT', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Guatemala',
    }),
    catalogos,
    atencion,
    antropometria: antropometria ? { ...antropometria, imc } : { imc },
    clasificacionTexto: antropometria?.clasificacion ? CLASIFICACION_TEXTO[antropometria.clasificacion] ?? antropometria.clasificacion : null,
    sitios: sitiosExamen(etapa),
    signosPeligro,
    proveedor: cierre?.usuario?.nombre ?? null,
    puedeVerSensibles: verSensibles,
    sensiblesIdentificacion: CAMPOS_SENSIBLES,
    catalogos3cs: CATALOGOS_3CS,
    lugaresNotificacion: CATALOGOS_3CS.lugarNotificacion,
  });

  const blanco = req.query.blanco === '1';
  if (blanco) compuesta = enBlanco(compuesta);

  // Imprimir datos sensibles queda en bitacora, con cuales.
  if (verSensibles && !blanco) {
    const leidos = [
      ...CAMPOS_SENSIBLES.filter((k) => paciente[k] !== null && paciente[k] !== undefined),
      ...secciones.flatMap((s) => [...clavesSensibles(s)]
        .filter((k) => { const v = filasSecciones.get(s.clave)?.[k]; return v !== null && v !== undefined && v !== ''; })
        .map((k) => `${s.clave}.${k}`)),
      ...(atencion.numeroNotificacion ? ['numeroNotificacion'] : []),
    ];
    if (leidos.length > 0) {
      await req.bitacora({
        accion: 'leer',
        entidad: 'paciente_datos_sensibles',
        entidadId: paciente.id,
        detalle: `Ficha impresa de la atención ${atencion.id}. Campos: ${leidos.join(', ')}`,
      });
    }
  }

  res.json({ ...compuesta, pacienteId: paciente.id, atencionId: atencion.id });
}

/**
 * Catalogo de fichas disponibles, para la ficha en blanco de contingencia.
 */
async function listar(req, res) {
  res.json({
    secciones: SECCIONES_COMUNES,
    fichas: Object.values(FICHAS).map((f) => ({
      clave: f.clave,
      etiqueta: f.etiqueta,
      documento: f.documento,
      confirmada: f.confirmada,
      complementaria: Boolean(f.complementaria),
      seccionesPropias: f.seccionesPropias,
      sitiosExamen: sitiosExamen(f.clave),
    })),
  });
}

/**
 * Ficha que corresponde a una atencion.
 *
 * La elige la edad del paciente a la fecha de la atencion, no la de hoy: una
 * consulta de hace dos anios se imprime con la ficha que le tocaba entonces.
 */
async function deAtencion(req, res, next) {
  const atencion = await prisma.atencion.findFirst({
    where: { id: req.params.id, establecimientoId: req.usuario.establecimientoId },
    include: {
      paciente: { include: { embarazos: { where: { estado: 'activo' } } } },
      preconsulta: true,
    },
  });

  if (!atencion) {
    return next({ status: 404, codigo: 'no_encontrado', mensaje: 'Atención no encontrada' });
  }

  const edad = calcularEdad(atencion.paciente.fechaNacimiento, atencion.registradaEn);
  const etapa = etapaDeVida(edad.edadMeses, edad.anios === 0 && edad.meses === 0 ? edad.dias : null);
  const embarazoActivo = atencion.paciente.embarazos.length > 0;

  const fichas = fichasParaAtencion({ etapa: etapa?.clave, embarazoActivo });

  // Cada ficha trae su propia lista. Los de la prenatal solo se ofrecen si hay
  // embarazo activo: un adolescente varon no debe ver "Sangrado vaginal".
  const etapas = [etapa?.clave, ...(embarazoActivo ? ['prenatal'] : [])].filter(Boolean);

  let signos = await prisma.signoPeligro.findMany({
    where: { establecimientoId: req.usuario.establecimientoId, activo: true, etapa: { in: etapas } },
    orderBy: { orden: 'asc' },
  });

  // La lista de la ficha de adolescente no se pudo transcribir del PDF oficial
  // (no esta en su capa de texto). Antes que dejar la pantalla vacia se usa la
  // de persona adulta, y se avisa que es provisional.
  const propios = signos.filter((s) => s.etapa === etapa?.clave);
  // La de adolescente no trae lista en el papel (es un recuadro): usa la de
  // adulto sin aviso.
  const usarSuplente = propios.length === 0 && Boolean(etapa);
  const listaProvisional = usarSuplente && etapa.clave !== 'adolescente_joven';

  if (usarSuplente) {
    const suplentes = await prisma.signoPeligro.findMany({
      where: { establecimientoId: req.usuario.establecimientoId, activo: true, etapa: 'adulto' },
      orderBy: { orden: 'asc' },
    });
    signos = [...suplentes, ...signos.filter((s) => s.etapa === 'prenatal')];
  }

  res.json({
    atencionId: atencion.id,
    edad,
    etapa: etapa ? { clave: etapa.clave, etiqueta: etapa.etiqueta } : null,
    embarazoActivo,
    fichas: fichas.map((f) => ({
      clave: f.clave,
      etiqueta: f.etiqueta,
      confirmada: f.confirmada,
      complementaria: Boolean(f.complementaria),
      seccionesPropias: f.seccionesPropias,
      sitiosExamen: sitiosExamen(f.clave),
    })),
    secciones: SECCIONES_COMUNES,
    signosPeligro: signos,
    // Cuando es provisional, la interfaz debe decirlo: son signos de otra
    // ficha usados mientras se confirma la propia.
    listaSignosProvisional: listaProvisional,
  });
}

module.exports = { listar, deAtencion, impresa };
