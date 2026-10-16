<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import inventario from '../../services/inventario';
import bodega from '../../services/bodega';
import sigsa from '../../services/sigsa';
import http from '../../services/http';
import Icono from '../../components/comunes/Icono.vue';
import { estiloTono } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Consolidados: lo que el centro entrega al Distrito de Salud, ordenado por
 * el calendario oficial del SIGSA (Memorándum 010-2013):
 *  - Cada semana epidemiológica (domingo a sábado): el SIGSA 3C/S, uno por
 *    responsable, porque cada uno firma lo que atendió.
 *  - Cada mes (corte el último día): el SIGSA 4 de farmacia y los formatos de
 *    bodega (BRES, balance, inventario de cierre, semáforo).
 * Quien entra aquí (dirección) no llena nada: revisa que cada documento esté
 * listo, sabe quién lo prepara y lo imprime o descarga para entregarlo.
 * Los indicadores de atención están en el panel de inicio, no aquí.
 */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA = 86400000;
const hoyGt = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const hoy = hoyGt();
const mesActual = hoy.slice(0, 7);

const error = ref('');
const descargando = ref('');
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const intentar = async (p) => { try { return await p; } catch { return null; } };
const fecha = (iso) => new Date(`${iso}T12:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const corta = (s) => { const d = fecha(s); return `${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0, 3)}`; };

async function descargar(clave, ruta, nombre) {
  descargando.value = clave;
  error.value = '';
  try {
    const url = await http.descargarArchivo(ruta);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    descargando.value = '';
  }
}
const iniciales = (n) => n.split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
const consulta = (p) => new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v != null)).toString();

/* ===================== Semana epidemiológica ===================== */
// Semana de domingo a sábado. La semana 1 es la primera que tiene al menos
// cuatro días del año (regla de la semana epidemiológica).
function domingoDe(d) { return new Date(d.getTime() - d.getUTCDay() * DIA); }
function numeroSemana(domingo) {
  const sabado = new Date(domingo.getTime() + 6 * DIA);
  const anio = new Date(domingo.getTime() + 3 * DIA).getUTCFullYear();
  const primero = new Date(Date.UTC(anio, 0, 1));
  let inicio = domingoDe(primero);
  if (primero.getUTCDay() > 3) inicio = new Date(inicio.getTime() + 7 * DIA);
  return { numero: Math.floor((domingo - inicio) / (7 * DIA)) + 1, anio, sabado };
}

// Por omisión, la última semana ya cortada: es la que toca entregar.
const domingo = ref(new Date(domingoDe(fecha(hoy)).getTime() - 7 * DIA));
const semana = computed(() => {
  const { numero, anio, sabado } = numeroSemana(domingo.value);
  return { numero, anio, desde: iso(domingo.value), hasta: iso(sabado), enCurso: iso(sabado) >= hoy };
});
const puedeAvanzar = computed(() => !semana.value.enCurso);
function moverSemana(paso) {
  const nuevo = new Date(domingo.value.getTime() + paso * 7 * DIA);
  if (iso(nuevo) <= hoy) domingo.value = nuevo;
}

const tresCs = ref(null);
const cargandoSemana = ref(false);
async function cargarSemana() {
  cargandoSemana.value = true;
  const s = semana.value;
  const r = await intentar(sigsa.tresCs({ desde: s.desde, hasta: s.hasta }));
  if (s.desde !== semana.value.desde) return;
  tresCs.value = r;
  cargandoSemana.value = false;
}

const estadoSemana = computed(() => {
  const t = tresCs.value;
  if (!t) return null;
  if (semana.value.enCurso) return { tono: 'accion', texto: `En curso: se corta el sábado ${corta(semana.value.hasta)}` };
  if (!t.renglones.length) return { tono: 'neutro', texto: 'Sin consultas en la semana' };
  if (t.sinCie) return { tono: 'atencion', texto: `${plural(t.sinCie, 'consulta', 'consultas')} sin código CIE-10: el distrito las rechaza` };
  return { tono: 'bien', texto: 'Lista para entregar' };
});
const rangoSemana = computed(() => ({ desde: semana.value.desde, hasta: semana.value.hasta }));

/* ===================== Mes ===================== */
const mes = ref(cierreAnterior());
function cierreAnterior() {
  const [a, m] = mesActual.split('-').map(Number);
  return iso(new Date(Date.UTC(a, m - 2, 1))).slice(0, 7);
}
const nombreMes = computed(() => {
  const [a, m] = mes.value.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
});
function moverMes(paso) {
  const [a, m] = mes.value.split('-').map(Number);
  const nuevo = iso(new Date(Date.UTC(a, m - 1 + paso, 1))).slice(0, 7);
  if (nuevo <= mesActual) mes.value = nuevo;
}
const delMes = ref({});
const cargandoMes = ref(false);
async function cargarMes() {
  cargandoMes.value = true;
  const periodo = mes.value;
  const [cuatro, bres, reportes, cierre, semaforo, pf] = await Promise.all([
    intentar(inventario.sigsa4(periodo)),
    intentar(inventario.bresDe(periodo)),
    intentar(bodega.estadoReportes(periodo)),
    intentar(bodega.inventarioCierre({ periodo })),
    intentar(bodega.semaforo({})),
    intentar(http.get(`/indicadores/planificacion?periodo=${periodo}`)),
  ]);
  if (periodo !== mes.value) return;
  delMes.value = { cuatro, bres: bres?.bres ?? null, reportes, cierre, semaforo, pf };
  cargandoMes.value = false;
}

const documentosMes = computed(() => {
  const d = delMes.value;
  const entregas = d.cuatro?.renglones ?? [];
  const sinConstancia = entregas.filter((e) => !e.constancia).length;
  const servicios = d.reportes?.servicios ?? [];
  const recibidos = servicios.filter((s) => s.reportado).length;
  const filasCierre = d.cierre?.filas?.length ?? 0;
  const s = d.semaforo?.resumen;
  const enCurso = mes.value === mesActual;
  return [
    {
      clave: 'sigsa4',
      codigo: 'SIGSA 4',
      nombre: 'Registro diario de post-consulta',
      porque: 'Lo entregado y lo no entregado a cada paciente, con la firma de quien recibió.',
      prepara: 'Farmacia',
      estado: !d.cuatro ? null
        : !entregas.length ? { tono: 'neutro', texto: 'Sin entregas' }
          : sinConstancia ? { tono: 'atencion', texto: `${sinConstancia} entregas sin firma` }
            : { tono: 'bien', texto: `${plural(entregas.length, 'renglón', 'renglones')}, completo` },
      imprimir: `/imprimir/sigsa4/${mes.value}`,
      abrir: '/dispensacion',
    },
    {
      clave: 'balance',
      codigo: 'Balance',
      nombre: 'Balance por servicio',
      porque: 'Saldos y consumo de cada puesto y centro comunitario. Sin él no se puede armar el BRES.',
      prepara: 'Bodega, con los reportes de los servicios',
      estado: !d.reportes ? null
        : !servicios.length ? { tono: 'neutro', texto: 'Sin servicios' }
          : recibidos < servicios.length ? { tono: 'atencion', texto: `Faltan ${servicios.length - recibidos} de ${servicios.length} reportes` }
            : { tono: 'bien', texto: `${recibidos} de ${servicios.length} reportes` },
      imprimir: `/imprimir/balance/${mes.value}`,
      excel: () => descargar('balance', `/bodega/balance/${mes.value}/excel?orden=alfabetico`, `balance-${mes.value}.xlsx`),
      abrir: '/inventario/reportes',
    },
    {
      clave: 'bres',
      codigo: 'BRES',
      nombre: 'Balance, requisición y envío de suministros',
      porque: 'Con esto el Área de Salud decide cuánto despacha el mes siguiente. Lleva el visto bueno de dirección.',
      prepara: 'Bodega · visto bueno de dirección',
      estado: !d.bres ? { tono: enCurso ? 'neutro' : 'atencion', texto: 'Sin generar' }
        : d.bres.estado === 'cerrado' ? { tono: 'bien', texto: 'Cerrado' } : { tono: 'atencion', texto: 'Generado, falta cerrarlo' },
      imprimir: d.bres ? `/imprimir/bres/${mes.value}` : null,
      excel: d.bres ? () => descargar('bres', `/bodega/bres/${mes.value}/excel?orden=alfabetico`, `bres-${mes.value}.xlsx`) : null,
      abrir: '/inventario/bres',
    },
    {
      clave: 'cierre',
      codigo: 'Cierre',
      nombre: 'Inventario de cierre de medicamentos',
      porque: 'El conteo físico del día de corte: respalda la existencia que dice el BRES.',
      prepara: 'Bodega',
      estado: !d.cierre ? null
        : filasCierre ? { tono: 'bien', texto: `${plural(filasCierre, 'insumo', 'insumos')}, corte el día ${d.cierre.diaCorte}` }
          : { tono: 'neutro', texto: 'Sin datos' },
      imprimir: `/imprimir/cierre/${mes.value}`,
      abrir: '/inventario/cierre',
    },
    {
      clave: 'semaforo',
      codigo: 'Semáforo',
      nombre: 'Semáforo de vencimientos',
      porque: 'Sale con los lotes del día en que se imprime, no del mes elegido: imprimirlo el día del corte.',
      prepara: 'Bodega',
      estado: s ? { tono: s.vencido ? 'atencion' : 'bien', texto: `${s.vencido} vencidos · ${s.rojo} de menos de 12 meses` } : null,
      imprimir: '/imprimir/semaforo',
      abrir: '/inventario/semaforo',
    },
    {
      clave: 'pf',
      codigo: 'Plan. fam.',
      nombre: 'Planificación familiar',
      porque: 'Usuarias nuevas, reconsultas y activas por método, y lo entregado. Va en el informe mensual; sale del SIGSA 4.',
      prepara: 'Farmacia (post-consulta), con lo que entrega a cada usuaria',
      estado: !d.pf ? null
        : d.pf.total.usuarias ? { tono: 'bien', texto: `${plural(d.pf.total.usuarias, 'usuaria', 'usuarias')} en el mes` }
          : { tono: 'neutro', texto: 'Sin entregas de métodos' },
      ver: Boolean(d.pf?.total.usuarias),
      abrir: '/dispensacion',
    },
  ];
});
const verPf = ref(false);
const metodosPf = computed(() => (delMes.value.pf?.metodos ?? []).filter((m) => m.usuarias || m.entregado));
const listosMes = computed(() => documentosMes.value.filter((d) => d.estado?.tono === 'bien').length);

const OTROS = [
  { texto: 'Tarjeta de control', donde: 'En la ficha de cada insumo', a: '/inventario/productos' },
  { texto: 'Requisiciones', donde: 'Al despachar a un servicio', a: '/inventario/requisiciones' },
  { texto: 'Oficios de baja', donde: 'En bajas y retiros', a: '/inventario/bajas' },
  { texto: 'Ficha, resumen y referencia', donde: 'En el expediente del paciente', a: '/pacientes' },
];

watch(() => semana.value.desde, cargarSemana);
watch(mes, cargarMes);
onMounted(() => { cargarSemana(); cargarMes(); });
</script>

<template>
  <div class="b-hoja">
    <div class="b-cuerpo space-y-6">
      <header class="b-cabecera">
        <div>
          <span class="b-antetitulo">Consolidados</span>
          <h1 class="b-titulo mt-1">Lo que se entrega al distrito</h1>
          <p class="intro">Cada documento con quién lo prepara, cuándo se corta y si ya está listo. Aquí se revisa y se imprime; se llena en su módulo.</p>
        </div>
      </header>

      <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>

      <!-- ===================== Cada semana ===================== -->
      <section class="bloque" :class="cargandoSemana ? 'opacity-60' : ''">
        <header class="bloque-cabeza">
          <div>
            <span class="cuando" :style="estiloTono('accion')"><Icono nombre="reloj" :tamano="16" :grosor="2.4" /> Cada semana</span>
            <h2>SIGSA 3C/S · Registro diario de consulta</h2>
            <p class="porque">Se corta el sábado de cada semana epidemiológica y se entrega al distrito, que lo digita. Va uno por responsable: cada quien firma lo que atendió.</p>
          </div>
          <div class="selector" role="group" aria-label="Semana">
            <button type="button" aria-label="Semana anterior" @click="moverSemana(-1)"><Icono nombre="volver" :tamano="20" :grosor="2.2" /></button>
            <span><b>Semana {{ semana.numero }}</b><small>{{ corta(semana.desde) }} al {{ corta(semana.hasta) }}</small></span>
            <button type="button" aria-label="Semana siguiente" :disabled="!puedeAvanzar" @click="moverSemana(1)"><Icono nombre="irA" :tamano="20" :grosor="2.2" /></button>
          </div>
        </header>

        <p v-if="estadoSemana" class="estado-linea" :style="estiloTono(estadoSemana.tono)">
          <Icono :nombre="estadoSemana.tono === 'bien' ? 'correcto' : estadoSemana.tono === 'atencion' ? 'alerta' : 'reloj'" :tamano="20" :grosor="2.2" />
          {{ estadoSemana.texto }}
          <RouterLink v-if="tresCs?.sinCie" to="/panel/admin" class="ml-auto underline">Codificar</RouterLink>
        </p>

        <ul v-if="tresCs?.porResponsable?.length" class="filas">
          <li v-for="r in tresCs.porResponsable" :key="r.medicoId" class="fila">
            <span class="avatar">{{ iniciales(r.nombre) }}</span>
            <div class="min-w-0 flex-1">
              <b class="nombre">{{ r.nombre }}</b>
              <small>{{ plural(r.consultas, 'consulta', 'consultas') }}<template v-if="r.sinCie"> · <span class="rojo">{{ r.sinCie }} sin CIE-10</span></template></small>
            </div>
            <div class="acciones">
              <button type="button" class="b-btn secundario chico" :disabled="descargando === `3cs${r.medicoId}`" @click="descargar(`3cs${r.medicoId}`, `/sigsa/3cs/excel?${consulta({ ...rangoSemana, medicoId: r.medicoId })}`, `sigsa3cs-sem${semana.numero}-${r.medicoId}.xlsx`)">
                <Icono nombre="hojaCalculo" :tamano="16" /> Excel
              </button>
              <RouterLink :to="`/imprimir/sigsa3cs?${consulta({ ...rangoSemana, medicoId: r.medicoId })}`" target="_blank" class="b-btn primario chico">
                <Icono nombre="imprimir" :tamano="16" /> Imprimir
              </RouterLink>
            </div>
          </li>
        </ul>
        <p v-else-if="tresCs" class="b-vacio">Nadie cerró consultas en esta semana.</p>
      </section>

      <!-- ===================== Cada mes ===================== -->
      <section class="bloque" :class="cargandoMes ? 'opacity-60' : ''">
        <header class="bloque-cabeza">
          <div>
            <span class="cuando" :style="estiloTono('atencion')"><Icono nombre="hojaCalculo" :tamano="16" :grosor="2.4" /> Cada mes</span>
            <h2 class="first-letter:uppercase">Cierre de {{ nombreMes }} · {{ listosMes }} de {{ documentosMes.length }} listos</h2>
            <p class="porque">Se cortan el último día del mes. El Área de Salud consolida los primeros días del mes siguiente.</p>
          </div>
          <div class="selector" role="group" aria-label="Mes">
            <button type="button" aria-label="Mes anterior" @click="moverMes(-1)"><Icono nombre="volver" :tamano="20" :grosor="2.2" /></button>
            <span class="first-letter:uppercase"><b>{{ nombreMes }}</b></span>
            <button type="button" aria-label="Mes siguiente" :disabled="mes >= mesActual" @click="moverMes(1)"><Icono nombre="irA" :tamano="20" :grosor="2.2" /></button>
          </div>
        </header>

        <ul class="filas">
          <li v-for="d in documentosMes" :key="d.clave" class="fila doc">
            <span class="codigo">{{ d.codigo }}</span>
            <div class="min-w-0 flex-1">
              <RouterLink :to="d.abrir" class="nombre">{{ d.nombre }}</RouterLink>
              <small>{{ d.porque }}</small>
              <small class="prepara">Lo prepara: <b>{{ d.prepara }}</b></small>
            </div>
            <span class="sello" :style="estiloTono(d.estado?.tono ?? 'neutro')">{{ d.estado?.texto ?? '·' }}</span>
            <div class="acciones">
              <button v-if="d.excel" type="button" class="b-btn secundario chico" :disabled="descargando === d.clave" @click="d.excel()">
                <Icono nombre="hojaCalculo" :tamano="16" /> Excel
              </button>
              <RouterLink v-if="d.imprimir" :to="d.imprimir" target="_blank" class="b-btn primario chico">
                <Icono nombre="imprimir" :tamano="16" /> Imprimir
              </RouterLink>
              <button v-else-if="d.clave === 'pf'" type="button" class="b-btn primario chico" :disabled="!d.ver" :aria-expanded="verPf" @click="verPf = !verPf">
                <Icono nombre="hojaCalculo" :tamano="16" /> {{ verPf ? 'Ocultar' : 'Ver cuadro' }}
              </button>
              <span v-else class="b-btn secundario chico pointer-events-none opacity-50"><Icono nombre="imprimir" :tamano="16" /> Imprimir</span>
            </div>
            <div v-if="d.clave === 'pf' && verPf" class="pf">
              <table class="b-tabla">
                <thead><tr><th>Método</th><th class="n">Nuevas</th><th class="n">Reconsultas</th><th class="n">Activas</th><th class="n">Usuarias</th><th class="n">Entregado</th><th class="n">Aplicado aquí</th></tr></thead>
                <tbody>
                  <tr v-for="m in metodosPf" :key="m.clave">
                    <td class="font-bold">{{ m.texto }}</td>
                    <td class="n">{{ m.nueva }}</td><td class="n">{{ m.reconsulta }}</td><td class="n">{{ m.activa }}</td>
                    <td class="n"><b>{{ m.usuarias }}</b></td>
                    <td class="n">{{ m.entregado }} {{ m.unidad }}</td>
                    <td class="n">{{ m.aplicado || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </li>
        </ul>
      </section>

      <!-- ===================== Otros ===================== -->
      <section class="bloque">
        <header class="bloque-cabeza">
          <div>
            <h2>Se imprimen desde cada registro</h2>
            <p class="porque">No son entregas del mes: salen cuando ocurre el hecho, desde su pantalla.</p>
          </div>
        </header>
        <div class="otros">
          <RouterLink v-for="o in OTROS" :key="o.texto" :to="o.a" class="otro">
            <span><b>{{ o.texto }}</b><small>{{ o.donde }}</small></span>
            <Icono nombre="irA" :tamano="18" :grosor="2.2" />
          </RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.intro { max-width: 640px; margin-top: 6px; font-size: 15px; font-weight: 600; color: #64748B; }
.bloque { display: grid; gap: 14px; padding: 20px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 22px; background: #fff; transition: opacity .15s; }
.bloque-cabeza { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 14px; }
.bloque-cabeza h2 { margin-top: 6px; font-size: 20px; font-weight: 900; color: #14244A; }
.porque { max-width: 640px; margin-top: 2px; font-size: 14px; font-weight: 600; color: #64748B; }
.cuando { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 10px; background: var(--t-fondo); color: var(--t-tinta); font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; }

.selector { display: inline-flex; align-items: center; height: 54px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 16px; background: #fff; }
.selector span { display: grid; min-width: 170px; padding: 0 6px; text-align: center; color: #14244A; }
.selector b { font-size: 16px; font-weight: 900; }
.selector small { font-size: 12px; font-weight: 700; color: #64748B; }
.selector button { display: grid; place-items: center; width: 44px; height: 100%; color: #475569; }
.selector button:hover:not(:disabled) { color: #172A5A; background: #F1F5F9; }
.selector button:first-child { border-radius: 14px 0 0 14px; }
.selector button:last-child { border-radius: 0 14px 14px 0; }
.selector button:disabled { opacity: .3; cursor: not-allowed; }

.estado-linea { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; background: var(--t-fondo); color: var(--t-tinta); font-size: 15px; font-weight: 800; }
.estado-linea svg { color: var(--t-hondo); flex-shrink: 0; }

.filas { display: grid; gap: 8px; }
.fila { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 2px solid #EEF2F6; border-radius: 16px; }
.avatar { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: #EAF3FB; color: #174E80; font-size: 15px; font-weight: 900; flex-shrink: 0; }
.nombre { display: block; font-size: 16px; font-weight: 900; color: #14244A; }
a.nombre:hover { text-decoration: underline; }
.fila small { display: block; font-size: 13px; font-weight: 600; color: #64748B; }
.prepara b { color: #334155; font-weight: 800; }
.rojo { color: #A83232; font-weight: 800; }
.codigo { flex-shrink: 0; width: 92px; padding: 6px 4px; border-radius: 10px; background: #F1F5F9; color: #334155; font-size: 13px; font-weight: 900; text-align: center; }
.sello { flex-shrink: 0; max-width: 220px; padding: 4px 12px; border-radius: 12px; background: var(--t-fondo); color: var(--t-tinta); font-size: 13px; font-weight: 800; text-align: center; }
.acciones { display: flex; flex-shrink: 0; gap: 6px; }
.doc { flex-wrap: wrap; }
.pf { width: 100%; overflow-x: auto; }
.pf .n { text-align: right; font-variant-numeric: tabular-nums; }

.otros { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.otro { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border: 2px solid #EEF2F6; border-bottom-width: 4px; border-radius: 16px; color: #64748B; }
.otro:hover { border-color: #9FCDEC; background: #F7FBFE; color: #172A5A; }
.otro b { display: block; font-size: 15px; font-weight: 900; color: #14244A; }
.otro small { font-size: 13px; font-weight: 600; }

@media (max-width: 1000px) {
  .otros { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .doc { flex-wrap: wrap; }
  .doc .acciones { width: 100%; justify-content: flex-end; }
}
@media (max-width: 640px) {
  .otros { grid-template-columns: 1fr; }
  .fila { flex-wrap: wrap; }
  .codigo { width: auto; padding: 4px 10px; }
}
</style>
