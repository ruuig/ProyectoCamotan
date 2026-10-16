<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { RouterLink } from 'vue-router';
import indicadores from '../../services/indicadores';
import atenciones from '../../services/atenciones';
import inventario from '../../services/inventario';
import bodega from '../../services/bodega';
import { useAuthStore } from '../../stores/auth';
import { cierre, nombrePeriodo } from '../../dominio/bodega';
import { ETAPAS } from '../../dominio/etapas';
import { textoEspera } from '../../dominio/espera';
import { estiloTono, miles } from '../../components/bodega/diseno/PiezasBodega';
import Icono from '../../components/comunes/Icono.vue';
import CodificarCie from '../../components/consulta/CodificarCie.vue';
import TarjetaCifra from '../../components/paneles/TarjetaCifra.vue';
import Dona from '../../components/paneles/Dona.vue';
import Anillo from '../../components/paneles/Anillo.vue';

/**
 * Panel de dirección. Quien dirige el centro responde por cuatro cosas, y el
 * panel está ordenado por ellas:
 *  1. Que la gente sea atendida a tiempo (atenciones, espera, urgentes ahora).
 *  2. Que haya medicamento (agotados con la regla del BRES, lotes por vencer).
 *  3. Que los documentos del mes salgan completos (cierre y CIE-10 para el SIGSA).
 *  4. A quién se atiende y de qué se enferma (etapas, diagnósticos, comunidades).
 * Cada bloque lleva a la pantalla donde se actúa.
 */
const auth = useAuthStore();
const periodoCierre = cierre.periodo;
const periodo = ref('semana');
const panel = ref(null);
const cola = ref(null);
const cierreMes = ref({});
const semaforo = ref(null);
const error = ref('');
const cargando = ref(true);
const verCodificar = ref(false);

const hora = Number(new Intl.DateTimeFormat('es-GT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Guatemala' }).format(new Date()));
const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
const primerNombre = computed(() => (auth.usuario?.nombre ?? '').replace(/^(Dr|Dra|Lic|Licda|Ing|P\.C)\.?\s+/i, '').split(' ')[0]);

const intentar = async (p) => { try { return await p; } catch { return null; } };

async function cargarPanel() {
  const p = await intentar(indicadores.panel('admin', periodo.value));
  if (p) panel.value = p;
  else error.value = 'No se pudo cargar el panel.';
}

async function cargar() {
  const [, c, rep, bres, tres, sem] = await Promise.all([
    cargarPanel(),
    intentar(atenciones.cola()),
    intentar(bodega.estadoReportes(periodoCierre)),
    intentar(inventario.bresDe(periodoCierre)),
    intentar(inventario.sigsa4(periodoCierre)),
    intentar(bodega.semaforo({})),
  ]);
  cola.value = c;
  semaforo.value = sem?.resumen ?? null;
  cierreMes.value = { reportes: rep?.servicios ?? null, bres: bres?.bres, sigsa4: tres?.renglones ?? null };
  cargando.value = false;
}
watch(periodo, cargarPanel);

const indicador = (clave) => panel.value?.indicadores?.find((i) => i.clave === clave) ?? null;
const enPeriodo = computed(() => (periodo.value === 'semana' ? 'esta semana' : 'este mes'));

/* ---------- 1. Atención ---------- */
const urgentesEsperando = computed(() => (cola.value?.cola ?? []).filter((e) => e.nivel === 'urgente'));
const tarjetas = computed(() => {
  const at = indicador('atenciones');
  const es = indicador('espera');
  const ab = panel.value?.abastecimiento;
  const urg = urgentesEsperando.value.length;
  const r = cola.value?.resumen;
  return [
    {
      titulo: `Atenciones ${enPeriodo.value}`,
      valor: at ? miles(at.valor) : '·',
      nota: at?.frase ?? '',
      icono: 'pacientes',
      tendencia: at?.tendencia,
    },
    {
      titulo: 'Espera promedio',
      valor: es?.valor ?? '—',
      unidad: es?.valor != null ? 'min' : '',
      nota: es?.frase ?? '',
      icono: 'reloj',
      tono: es?.sentido === 'empeora' ? 'atencion' : 'neutro',
      tendencia: es?.tendencia,
    },
    {
      titulo: 'Urgentes esperando ahora',
      valor: cola.value ? urg : '·',
      nota: !cola.value ? '' : r?.enEspera ? `${r.enEspera} en la cola · la espera más larga es de ${textoEspera(r.esperaMaxima)}` : 'Nadie en la cola',
      icono: 'alerta',
      tono: urg ? 'critico' : 'neutro',
      a: '/cola',
    },
    {
      titulo: 'Insumos agotados en bodega',
      valor: ab ? ab.conteo.agotado : '·',
      nota: ab ? `${ab.conteo.bajo} más con el municipio bajo el mínimo de ${ab.nivelMinimoMeses} meses` : '',
      icono: 'inventario',
      tono: ab?.conteo.agotado ? 'critico' : ab?.conteo.bajo ? 'atencion' : 'neutro',
      a: '/inventario/productos',
    },
  ];
});

/* ---------- Atenciones por día ---------- */
const barras = computed(() => panel.value?.atencionesPorDia?.actual ?? []);
const maxBarra = computed(() => Math.max(1, ...barras.value.map((d) => d.noUrgentes + d.urgentes)));
const totalBarras = computed(() => barras.value.reduce((t, d) => t + d.noUrgentes + d.urgentes, 0));
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const local = (f) => new Date(new Date(f).getTime() - 6 * 3600000);
const etiquetaBarra = (d) => (periodo.value === 'semana' ? DIAS[local(d.fecha).getUTCDay()] : `Sem. ${d.etiqueta}`);
const esActual = (d, i) => (periodo.value === 'semana'
  ? local(d.fecha).toISOString().slice(0, 10) === local(new Date()).toISOString().slice(0, 10)
  : i === barras.value.filter((b) => new Date(b.fecha) <= new Date()).length - 1);

/* ---------- 4. A quién se atiende ---------- */
const partesEtapas = computed(() => {
  const e = panel.value?.etapas ?? {};
  return ETAPAS.map((x) => ({ clave: x.valor, texto: x.corta, valor: e[x.valor] ?? 0, color: x.color }));
});
const totalEtapas = computed(() => partesEtapas.value.reduce((t, p) => t + p.valor, 0));

/* ---------- 2. Medicamento ---------- */
const partesSemaforo = computed(() => {
  const s = semaforo.value ?? {};
  return [
    { clave: 'vencido', texto: 'Vencidos', valor: s.vencido ?? 0, color: '#9B2C2C', a: '/inventario/semaforo' },
    { clave: 'rojo', texto: 'Menos de 12 meses', valor: s.rojo ?? 0, color: '#E8590C', a: '/inventario/semaforo' },
    { clave: 'amarillo', texto: 'De 12 a 18 meses', valor: s.amarillo ?? 0, color: '#D9A30A', a: '/inventario/semaforo' },
    { clave: 'verde', texto: 'Más de 18 meses', valor: s.verde ?? 0, color: '#22A06B', a: '/inventario/semaforo' },
  ];
});
const lotesConFecha = computed(() => partesSemaforo.value.reduce((t, p) => t + p.valor, 0));
const faltan = computed(() => panel.value?.abastecimiento?.lista ?? []);
const meses = (m) => (m == null ? '—' : m < 1 ? 'menos de 1 mes' : `${m.toLocaleString('es-GT', { maximumFractionDigits: 1 })} meses`);

/* ---------- 3. Documentos ---------- */
const pasosCierre = computed(() => {
  const c = cierreMes.value;
  const servicios = c.reportes ?? [];
  const recibidos = servicios.filter((s) => s.reportado).length;
  const sinFirma = (c.sigsa4 ?? []).filter((r) => !r.constancia).length;
  return [
    {
      texto: 'Reportes de los servicios',
      detalle: !c.reportes ? '·' : `${recibidos} de ${servicios.length} recibidos`,
      listo: servicios.length > 0 && recibidos === servicios.length,
      a: '/inventario/reportes',
    },
    {
      texto: 'BRES',
      detalle: !c.bres ? 'Sin generar' : c.bres.estado === 'cerrado' ? 'Cerrado' : 'Generado, falta cerrarlo',
      listo: c.bres?.estado === 'cerrado',
      a: '/inventario/bres',
    },
    {
      texto: 'Constancias del SIGSA 4',
      detalle: sinFirma ? `${sinFirma} entregas sin firma` : 'Todas firmadas',
      listo: !sinFirma,
      a: '/dispensacion',
    },
  ];
});
const listos = computed(() => pasosCierre.value.filter((p) => p.listo).length);
const cod = computed(() => panel.value?.codificacion ?? { atendidas: 0, codificadas: 0 });
const pendientes = computed(() => panel.value?.pendientesDeCodificar ?? []);
function quitarCodificada(id) {
  panel.value.pendientesDeCodificar = panel.value.pendientesDeCodificar.filter((a) => a.id !== id);
  panel.value.codificacion.codificadas += 1;
}

const diagnosticos = computed(() => panel.value?.diagnosticos?.lista ?? []);
const comunidades = computed(() => panel.value?.comunidades?.lista ?? []);

// La cola cambia durante el día: se refresca cada minuto.
let reloj = null;
onMounted(() => {
  cargar();
  reloj = setInterval(async () => {
    const c = await intentar(atenciones.cola());
    if (c) cola.value = c;
  }, 60000);
});
onBeforeUnmount(() => clearInterval(reloj));
</script>

<template>
  <section class="panel-dir">
    <header class="b-cabecera">
      <div>
        <span class="b-antetitulo">Panel de dirección</span>
        <h1 class="b-titulo mt-1">{{ saludo }}{{ primerNombre ? `, ${primerNombre}` : '' }}</h1>
      </div>
      <div class="b-acciones">
        <div class="b-segmentado" role="radiogroup" aria-label="Período">
          <button v-for="o in [['semana', 'Esta semana'], ['mes', 'Este mes']]" :key="o[0]" type="button" role="radio" :aria-checked="periodo === o[0]" :class="periodo === o[0] ? 'on' : ''" @click="periodo = o[0]">{{ o[1] }}</button>
        </div>
        <RouterLink to="/consolidado" class="b-btn primario"><Icono nombre="consolidado" :tamano="20" /> Documentos</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>

    <!-- Cifras principales -->
    <div class="cifras">
      <TarjetaCifra v-for="t in tarjetas" :key="t.titulo" v-bind="t" />
    </div>

    <div class="rejilla">
      <!-- Atenciones por día -->
      <section class="tarjeta ancha estirada">
        <header class="cabeza">
          <div>
            <h2>Atenciones {{ periodo === 'semana' ? 'por día' : 'por semana' }}</h2>
            <p class="porque">Cuánta gente llega y cuánta llega grave: con esto se reparte el personal.</p>
          </div>
          <span class="total">{{ totalBarras }} {{ panel?.periodo?.etiqueta ? `· ${panel.periodo.etiqueta}` : '' }}</span>
        </header>
        <div v-if="barras.length" class="barras" role="img" :aria-label="barras.map((d) => `${etiquetaBarra(d)}: ${d.noUrgentes + d.urgentes}`).join(', ')">
          <div v-for="(d, i) in barras" :key="d.fecha" class="col" :class="esActual(d, i) ? 'actual' : ''">
            <span class="valor">{{ d.noUrgentes + d.urgentes || '' }}</span>
            <div class="pista">
              <span v-if="d.urgentes" class="urg" :style="{ height: `${(d.urgentes / maxBarra) * 100}%` }" :title="`${d.urgentes} urgentes`" />
              <span v-if="d.noUrgentes" class="norm" :style="{ height: `${(d.noUrgentes / maxBarra) * 100}%` }" :title="`${d.noUrgentes} no urgentes`" />
            </div>
            <span class="dia">{{ etiquetaBarra(d) }}</span>
          </div>
        </div>
        <p v-else class="b-vacio">Sin atenciones registradas.</p>
        <div class="leyenda"><span><i class="norm" /> No urgentes</span><span><i class="urg" /> Urgentes</span></div>
      </section>

      <!-- Documentos del mes -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2 class="first-letter:uppercase">Cierre de {{ nombrePeriodo(periodoCierre) }}</h2>
            <p class="porque">Lo que el Área de Salud espera recibir del centro.</p>
          </div>
          <Anillo :valor="listos" :de="pasosCierre.length" :texto="`${listos}/${pasosCierre.length}`" :color="listos === pasosCierre.length ? '#22A06B' : '#E8930C'" />
        </header>
        <ul class="pasos">
          <li v-for="p in pasosCierre" :key="p.texto">
            <RouterLink :to="p.a" class="paso" :style="estiloTono(p.listo ? 'bien' : 'atencion')">
              <span class="marca"><Icono :nombre="p.listo ? 'correcto' : 'reloj'" :tamano="20" :grosor="2.2" /></span>
              <span class="min-w-0 flex-1"><b>{{ p.texto }}</b><small>{{ p.detalle }}</small></span>
              <Icono nombre="irA" :tamano="18" :grosor="2.2" class="text-slate-400" />
            </RouterLink>
          </li>
        </ul>
        <div class="codif" :style="estiloTono(pendientes.length ? 'atencion' : 'bien')">
          <div class="flex items-center gap-3">
            <Anillo :valor="cod.codificadas" :de="cod.atendidas || 1" :color="cod.codificadas < cod.atendidas ? '#E8930C' : '#22A06B'" :tamano="56" :texto="cod.atendidas ? undefined : '—'" />
            <div class="min-w-0 flex-1">
              <b>Diagnósticos con CIE-10</b>
              <small>{{ cod.codificadas }} de {{ cod.atendidas }} consultas {{ enPeriodo }}. El SIGSA rechaza lo que no lleva código.</small>
            </div>
          </div>
          <button v-if="pendientes.length" type="button" class="b-btn chico secundario w-full" :aria-expanded="verCodificar" @click="verCodificar = !verCodificar">
            {{ verCodificar ? 'Cerrar' : `Codificar ${pendientes.length} pendientes` }}
          </button>
        </div>
        <ul v-if="verCodificar" class="codificar">
          <CodificarCie v-for="a in pendientes" :key="a.id" :atencion="a" @codificada="quitarCodificada" />
        </ul>
      </section>

      <!-- Etapas de vida -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>Quiénes consultaron</h2>
            <p class="porque">Por etapa de vida: así se organizan los programas del MSPAS.</p>
          </div>
        </header>
        <Dona v-if="totalEtapas" :partes="partesEtapas" :centro="totalEtapas" bajo-centro="pacientes" />
        <p v-else class="b-vacio">Sin atenciones {{ enPeriodo }}.</p>
      </section>

      <!-- Semáforo -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>Lotes en bodega por vencimiento</h2>
            <p class="porque">Lo vencido se da de baja con oficio; lo de menos de 12 meses se entrega primero.</p>
          </div>
        </header>
        <Dona v-if="semaforo" :partes="partesSemaforo" :centro="lotesConFecha" bajo-centro="lotes" />
        <p v-if="semaforo?.sinFecha" class="pie">{{ semaforo.sinFecha }} lotes sin fecha de vencimiento no entran en la cuenta.</p>
      </section>

      <!-- Diagnósticos -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>De qué se enferman</h2>
            <p class="porque">Diagnósticos más frecuentes del mes. Un repunte puede ser un brote: se avisa al distrito.</p>
          </div>
        </header>
        <ul v-if="diagnosticos.length" class="diag">
          <li v-for="d in diagnosticos" :key="d.codigo">
            <span class="cod">{{ d.codigo }}</span>
            <div class="min-w-0 flex-1">
              <div class="linea">
                <span class="truncate">{{ d.nombre ?? d.codigo }}</span>
                <span v-if="d.repunte" class="repunte" :style="estiloTono('critico')">Subió {{ d.subida }}%</span>
                <b>{{ d.casos }}</b>
              </div>
              <span class="pista-h"><span :style="{ width: `${d.proporcion * 100}%` }" /></span>
            </div>
          </li>
        </ul>
        <p v-else class="b-vacio">Sin diagnósticos codificados este mes.</p>
      </section>

      <!-- Insumos que más faltan -->
      <section class="tarjeta ancha">
        <header class="cabeza">
          <div>
            <h2>Insumos que más faltan</h2>
            <p class="porque">Agotados en bodega o bajo el mínimo, primero los que más se consumen: son los que dejan más pacientes sin tratamiento.</p>
          </div>
          <RouterLink to="/inventario/productos" class="ver">Ver existencias</RouterLink>
        </header>
        <ul v-if="faltan.length" class="faltan">
          <li v-for="f in faltan" :key="f.insumoId">
            <RouterLink :to="`/inventario/${f.insumoId}`" class="falta" :style="estiloTono(f.situacion === 'agotado' ? 'critico' : 'atencion')">
              <span class="min-w-0">
                <span class="nombre">{{ f.nombre }}</span>
                <span class="datos">
                  <span>En bodega <b>{{ miles(f.bodega) }}</b></span>
                  <span>Se consumen <b>{{ miles(f.promedio) }}</b> al mes</span>
                  <span>Al municipio le alcanza <b>{{ meses(f.meses) }}</b></span>
                </span>
              </span>
              <span class="estado">{{ f.situacion === 'agotado' ? 'Agotado' : 'Bajo el mínimo' }}</span>
            </RouterLink>
          </li>
        </ul>
        <p v-else-if="panel" class="b-vacio">Ningún insumo agotado ni bajo el mínimo.</p>
      </section>

      <!-- Comunidades -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>Comunidades sin atención</h2>
            <p class="porque">Con pacientes inscritos y sin consultas recientes: candidatas a una jornada o visita.</p>
          </div>
        </header>
        <ul class="comunidades">
          <li v-for="c in comunidades" :key="c.lugarId">
            <span class="min-w-0 flex-1 truncate"><b>{{ c.nombre }}</b> <small>{{ c.pacientes }} pacientes</small></span>
            <span class="hace" :style="estiloTono(c.dias === null || c.dias > 60 ? 'atencion' : 'neutro')">{{ c.dias === null ? 'Sin consultas en el sistema' : `Hace ${c.dias} días` }}</span>
          </li>
          <li v-if="panel && !comunidades.length" class="b-vacio">Todas las comunidades tienen atenciones recientes.</li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.panel-dir { display: grid; gap: 20px; }
.cifras { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1200px) { .cifras { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .cifras { grid-template-columns: 1fr; } }

.rejilla { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
.ancha { grid-column: span 2; }
@media (max-width: 1200px) { .rejilla { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .rejilla { grid-template-columns: 1fr; } .ancha { grid-column: auto; } }

.tarjeta { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; min-width: 0; padding: 18px 20px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.cabeza { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cabeza h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.porque { margin-top: 2px; font-size: 13px; font-weight: 600; color: #64748B; line-height: 1.35; }
.total { flex-shrink: 0; font-size: 14px; font-weight: 800; color: #475569; }
.ver { flex-shrink: 0; font-size: 14px; font-weight: 800; color: #1F6AA5; }
.ver:hover { text-decoration: underline; }
.pie { font-size: 12px; font-weight: 600; color: #64748B; }

.estirada { align-self: stretch; grid-template-rows: auto 1fr auto; }
.barras { display: flex; align-items: flex-end; gap: 12px; min-height: 210px; height: 100%; }
.col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; min-width: 0; }
.valor { height: 20px; font-size: 14px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.pista { flex: 1; width: 100%; max-width: 30px; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; border-radius: 10px; background: #F1F5F9; overflow: hidden; }
.pista span { border-radius: 8px; }
.norm { background: #3D7BE0; }
.urg { background: #D64545; }
.dia { padding-top: 8px; font-size: 13px; font-weight: 800; color: #64748B; white-space: nowrap; }
.actual .dia { color: #14244A; }
.actual .pista { box-shadow: inset 0 0 0 2px #9FCDEC; }
.leyenda { display: flex; gap: 16px; font-size: 13px; font-weight: 700; color: #64748B; }
.leyenda i { display: inline-block; width: 12px; height: 12px; margin-right: 6px; border-radius: 4px; vertical-align: -1px; }

.pasos { display: grid; gap: 8px; }
.paso { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 2px solid #EEF2F6; border-radius: 14px; }
.paso:hover { border-color: var(--t-borde); background: var(--t-fondo); }
.paso b { display: block; font-size: 15px; font-weight: 800; color: #14244A; }
.paso small { font-size: 13px; font-weight: 700; color: var(--t-tinta); }
.marca { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--t-fondo); color: var(--t-hondo); flex-shrink: 0; }
.codif { display: grid; gap: 10px; padding: 12px; border-radius: 16px; background: var(--t-fondo); }
.codif b { display: block; font-size: 15px; font-weight: 900; color: #14244A; }
.codif small { font-size: 13px; font-weight: 600; color: var(--t-tinta); }
.codificar { max-height: 360px; overflow-y: auto; border-top: 2px solid #EEF2F6; }
.codificar :deep(li) { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid #F1F5F9; }

.diag { display: grid; gap: 10px; }
.diag li { display: flex; align-items: center; gap: 10px; min-width: 0; }
.cod { flex-shrink: 0; min-width: 52px; padding: 3px 6px; border-radius: 8px; background: #EAF3FB; color: #174E80; font-size: 12px; font-weight: 900; text-align: center; font-family: ui-monospace, monospace; }
.linea { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; font-weight: 700; color: #1E293B; }
.linea .truncate { min-width: 0; flex: 1; }
.linea b { margin-left: auto; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.repunte { flex-shrink: 0; padding: 1px 8px; border-radius: 8px; background: var(--t-fondo); color: var(--t-tinta); font-size: 12px; font-weight: 900; }
.pista-h { display: block; height: 8px; margin-top: 4px; border-radius: 4px; background: #F1F5F9; overflow: hidden; }
.pista-h span { display: block; height: 100%; border-radius: 4px; background: #3D7BE0; }

.faltan { display: grid; gap: 8px; }
.falta { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 14px; background: var(--t-fondo); border: 2px solid transparent; }
.falta:hover { border-color: var(--t-borde); }
.nombre { display: block; font-size: 15px; font-weight: 800; color: #14244A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.datos { display: flex; flex-wrap: wrap; gap: 2px 16px; margin-top: 2px; font-size: 13px; font-weight: 600; color: var(--t-tinta); }
.datos b { font-weight: 900; font-variant-numeric: tabular-nums; }
.estado { justify-self: end; padding: 3px 10px; border-radius: 10px; background: var(--t); color: #fff; font-size: 13px; font-weight: 900; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, .18); }

.comunidades { display: grid; gap: 4px; }
.comunidades li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #F1F5F9; }
.comunidades li:last-child { border-bottom: none; }
.comunidades b { font-size: 15px; font-weight: 800; color: #14244A; }
.comunidades small { font-size: 13px; font-weight: 600; color: #64748B; }
.hace { flex-shrink: 0; padding: 2px 10px; border-radius: 10px; background: var(--t-fondo); color: var(--t-tinta); font-size: 13px; font-weight: 800; }
</style>
