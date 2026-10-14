<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { RouterLink } from 'vue-router';
import indicadores from '../../services/indicadores';
import atenciones from '../../services/atenciones';
import inventario from '../../services/inventario';
import bodega from '../../services/bodega';
import { useAuthStore } from '../../stores/auth';
import { cierre, nombrePeriodo } from '../../dominio/bodega';
import Icono from '../../components/comunes/Icono.vue';
import CodificarCie from '../../components/consulta/CodificarCie.vue';

/**
 * Panel de dirección: cómo va el día, qué falta para cerrar el mes y qué
 * insumos están por faltar. Cada bloque lleva a la pantalla donde se actúa.
 */
const auth = useAuthStore();
const periodo = cierre.periodo;
const panel = ref(null);
const hoy = ref(null);
const cola = ref(null);
const cierreMes = ref({});
const semaforo = ref(null);
const error = ref('');
const cargando = ref(true);

const hora = Number(new Intl.DateTimeFormat('es-GT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Guatemala' }).format(new Date()));
const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
const primerNombre = computed(() => (auth.usuario?.nombre ?? '').replace(/^(Dr|Dra|Lic|Licda|Ing|P\.C)\.?\s+/i, '').split(' ')[0]);

const intentar = async (p) => { try { return await p; } catch { return null; } };

async function cargar() {
  const [p, r, c, rep, bres, firmar, tres, sem] = await Promise.all([
    intentar(indicadores.panel('admin', 'semana')),
    intentar(atenciones.resumenDia()),
    intentar(atenciones.cola()),
    intentar(bodega.estadoReportes(periodo)),
    intentar(inventario.bresDe(periodo)),
    intentar(inventario.porFirmar()),
    intentar(inventario.sigsa4(periodo)),
    intentar(bodega.semaforo({})),
  ]);
  panel.value = p;
  hoy.value = r;
  cola.value = c;
  semaforo.value = sem?.resumen ?? null;
  cierreMes.value = { reportes: rep?.servicios ?? null, bres: bres?.bres, porFirmar: firmar?.porFirmar ?? null, sigsa4: tres?.renglones ?? null };
  if (!p && !r) error.value = 'No se pudo cargar el panel.';
  cargando.value = false;
}

/* ---------- Hoy ---------- */
const cifrasHoy = computed(() => {
  const r = hoy.value ?? {};
  const s = cola.value?.resumen ?? {};
  return [
    { e: 'En espera', n: s.enEspera ?? r.enCola ?? 0, a: '/cola' },
    { e: 'En consulta', n: cola.value?.enAtencion?.length ?? 0, a: '/cola' },
    { e: 'Atendidos', n: r.atendidos ?? 0 },
    { e: 'Urgentes', n: r.urgentesAtendidos ?? 0, tono: (r.urgentesAtendidos ?? 0) > 0 ? 'rojo' : '' },
    { e: 'Espera máx.', n: s.enEspera ? `${s.esperaMaxima} min` : '—', tono: s.superan90 ? 'rojo' : '' },
  ];
});

/* ---------- Cierre del mes ---------- */
const pasosCierre = computed(() => {
  const c = cierreMes.value;
  const servicios = c.reportes ?? [];
  const recibidos = servicios.filter((s) => s.reportado).length;
  const sinCodigo = panel.value?.pendientesDeCodificar?.length ?? 0;
  const sinFirma = (c.sigsa4 ?? []).filter((r) => !r.constancia).length;
  return [
    {
      texto: 'Reportes de los servicios',
      detalle: servicios.length ? `${recibidos} de ${servicios.length} recibidos` : 'Sin servicios',
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
      texto: 'Constancias del SIGSA-4',
      detalle: sinFirma ? `${sinFirma} entregas sin firma` : 'Todas firmadas',
      listo: !sinFirma,
      a: '/dispensacion',
    },
    {
      texto: 'Diagnósticos con CIE-10',
      detalle: sinCodigo ? `${sinCodigo} sin código` : 'Todos codificados',
      listo: !sinCodigo,
      a: '#codificar',
    },
  ];
});
const listos = computed(() => pasosCierre.value.filter((p) => p.listo).length);

/* ---------- Bodega ---------- */
const faltantes = computed(() => (panel.value?.abastecimiento?.lista ?? []).slice(0, 6));
const agotados = computed(() => (panel.value?.abastecimiento?.lista ?? []).filter((i) => i.sinExistencia).length);

/* ---------- Semana ---------- */
const semana = computed(() => panel.value?.atencionesPorDia?.actual ?? []);
const maxDia = computed(() => Math.max(1, ...semana.value.map((d) => d.noUrgentes + d.urgentes)));
const totalSemana = computed(() => semana.value.reduce((t, d) => t + d.noUrgentes + d.urgentes, 0));
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const nombreDia = (f) => DIAS[new Date(new Date(f).getTime() - 6 * 3600000).getUTCDay()];
const esHoy = (f) => new Date(new Date(f).getTime() - 6 * 3600000).toISOString().slice(0, 10) === new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);

/* ---------- Codificación ---------- */
// Se parte de lo que escribió el médico y se elige entre los códigos sugeridos.
function quitarCodificada(id) {
  panel.value.pendientesDeCodificar = panel.value.pendientesDeCodificar.filter((a) => a.id !== id);
}

// La cola cambia durante el día: se refresca cada minuto.
let reloj = null;
onMounted(() => {
  cargar();
  reloj = setInterval(async () => {
    const [r, c] = await Promise.all([intentar(atenciones.resumenDia()), intentar(atenciones.cola())]);
    if (r) hoy.value = r;
    if (c) cola.value = c;
  }, 60000);
});
onBeforeUnmount(() => clearInterval(reloj));
</script>

<template>
  <section class="space-y-5">
    <header class="b-cabecera">
      <div>
        <span class="b-antetitulo">Panel de dirección</span>
        <h1 class="b-titulo mt-1">{{ saludo }}{{ primerNombre ? `, ${primerNombre}` : '' }}</h1>
      </div>
      <div class="b-acciones">
        <RouterLink to="/cola" class="b-btn secundario"><Icono nombre="cola" :tamano="20" /> Cola</RouterLink>
        <RouterLink to="/consolidado" class="b-btn primario"><Icono nombre="consolidado" :tamano="20" /> Documentos del mes</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>

    <!-- Hoy -->
    <div class="hoy">
      <span class="hoy-titulo">Hoy</span>
      <component :is="c.a ? RouterLink : 'div'" v-for="c in cifrasHoy" :key="c.e" :to="c.a" class="b-cifra" :class="[c.tono, c.a ? 'enlace-cifra' : '']">
        <span class="n">{{ cargando ? '·' : c.n }}</span><span class="e">{{ c.e }}</span>
      </component>
    </div>

    <div class="rejilla">
      <!-- Cierre del mes -->
      <section class="b-panel">
        <header class="b-panel-cabeza">
          <div>
            <h2 class="b-panel-titulo first-letter:uppercase">Cierre de {{ nombrePeriodo(periodo) }}</h2>
            <div class="progreso mt-2" :aria-label="`${listos} de ${pasosCierre.length} listos`">
              <span v-for="(p, i) in pasosCierre" :key="i" :class="p.listo ? 'listo' : ''" />
            </div>
          </div>
          <span class="text-sm font-bold text-apagado">{{ listos }} de {{ pasosCierre.length }}</span>
        </header>
        <ul>
          <li v-for="p in pasosCierre" :key="p.texto">
            <component :is="p.a.startsWith('#') ? 'a' : RouterLink" :to="p.a" :href="p.a" class="paso">
              <span class="marca" :class="p.listo ? 'listo' : ''"><Icono :nombre="p.listo ? 'correcto' : 'reloj'" :tamano="20" /></span>
              <span class="min-w-0 flex-1">
                <b>{{ p.texto }}</b>
                <small :class="p.listo ? '' : 'falta'">{{ p.detalle }}</small>
              </span>
              <Icono nombre="irA" :tamano="18" :grosor="2.2" class="text-slate-400" />
            </component>
          </li>
        </ul>
      </section>

      <!-- Bodega -->
      <section class="b-panel">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">Insumos por faltar</h2>
          <RouterLink to="/inventario" class="text-sm font-bold text-tinta hover:underline">Ver bodega</RouterLink>
        </header>
        <div class="mini-cifras">
          <RouterLink to="/inventario/productos" class="mini"><b class="rojo">{{ agotados }}</b><span>Agotados</span></RouterLink>
          <RouterLink to="/inventario/semaforo" class="mini"><b class="rojo">{{ semaforo ? semaforo.vencido : '·' }}</b><span>Vencidos</span></RouterLink>
          <RouterLink to="/inventario/semaforo" class="mini"><b class="ambar">{{ semaforo ? semaforo.rojo : '·' }}</b><span>Por vencer</span></RouterLink>
        </div>
        <ul class="faltantes">
          <li v-for="i in faltantes" :key="i.insumoId">
            <RouterLink :to="`/inventario/${i.insumoId}`" class="faltante">
              <span class="min-w-0 flex-1 truncate">{{ i.nombre }}</span>
              <span class="dias" :class="i.sinExistencia ? 'cero' : ''">{{ i.sinExistencia ? 'Agotado' : i.sinConsumo ? 'Sin consumo' : `${i.dias} días` }}</span>
            </RouterLink>
          </li>
          <li v-if="panel && !faltantes.length" class="b-vacio !py-6">Ningún insumo por debajo de 15 días.</li>
        </ul>
      </section>

      <!-- Semana -->
      <section class="b-panel">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">Atenciones de la semana</h2>
          <span class="text-sm font-bold text-apagado">{{ totalSemana }} en total</span>
        </header>
        <div class="grafica" role="img" :aria-label="`Atenciones por día: ${semana.map((d) => `${nombreDia(d.fecha)} ${d.noUrgentes + d.urgentes}`).join(', ')}`">
          <div v-for="d in semana" :key="d.fecha" class="columna" :class="esHoy(d.fecha) ? 'hoy-col' : ''">
            <span class="valor">{{ d.noUrgentes + d.urgentes || '' }}</span>
            <div class="barra">
              <span class="urg" :style="{ height: `${(d.urgentes / maxDia) * 100}%` }" />
              <span class="norm" :style="{ height: `${(d.noUrgentes / maxDia) * 100}%` }" />
            </div>
            <span class="dia">{{ nombreDia(d.fecha) }}</span>
          </div>
        </div>
        <div class="leyenda"><span><i class="norm" /> No urgentes</span><span><i class="urg" /> Urgentes</span></div>
      </section>

      <!-- Codificación -->
      <section id="codificar" class="b-panel">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">Diagnósticos sin CIE-10</h2>
          <span v-if="panel?.fichasIncompletas" class="text-sm font-semibold text-apagado">{{ panel.fichasIncompletas.toLocaleString('es-GT') }} fichas incompletas</span>
        </header>
        <ul class="codificar">
          <CodificarCie v-for="a in panel?.pendientesDeCodificar ?? []" :key="a.id" :atencion="a" @codificada="quitarCodificada" />
          <li v-if="panel && !panel.pendientesDeCodificar?.length" class="b-vacio !py-6">Todo codificado.</li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.hoy { display: flex; flex-wrap: wrap; border: 2px solid #E2E8F0; border-radius: 14px; overflow: hidden; background: #fff; }
.hoy-titulo { display: grid; place-items: center; padding: 0 20px; background: #172A5A; color: #fff; font-size: 13px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.hoy .b-cifra.rojo { color: #B23A3A; }
.enlace-cifra:hover { background: #F8FAFC; }

.rejilla { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
@media (max-width: 1000px) { .rejilla { grid-template-columns: 1fr; } }

.progreso { display: flex; gap: 4px; width: 220px; }
.progreso span { flex: 1; height: 6px; border-radius: 3px; background: #E2E8F0; }
.progreso span.listo { background: #2FA772; }
.paso { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-top: 1px solid #EEF2F6; }
li:first-child > .paso { border-top: none; }
.paso:hover { background: #F8FAFC; }
.paso b { display: block; font-size: 15px; color: #14244A; }
.paso small { font-size: 13px; color: #1E8E5E; font-weight: 600; }
.paso small.falta { color: #A16207; }
.marca { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: #FDF3DC; color: #A16207; flex-shrink: 0; }
.marca.listo { background: #E3F4EA; color: #1E8E5E; }

.mini-cifras { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 2px solid #EEF2F6; }
.mini { display: flex; align-items: baseline; gap: 8px; padding: 10px 18px; border-right: 2px solid #EEF2F6; }
.mini:last-child { border-right: none; }
.mini:hover { background: #F8FAFC; }
.mini b { font-size: 24px; line-height: 1; font-variant-numeric: tabular-nums; }
.mini span { font-size: 12px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: .04em; }
.rojo { color: #B23A3A; }
.ambar { color: #A16207; }
.faltantes { max-height: 200px; overflow-y: auto; }
.faltante { display: flex; align-items: center; gap: 12px; padding: 7px 18px; border-top: 1px solid #F1F5F9; font-size: 14px; color: #1E293B; }
li:first-child > .faltante { border-top: none; }
.faltante:hover { background: #F8FAFC; }
.dias { flex-shrink: 0; padding: 1px 8px; border-radius: 6px; background: #FDF3DC; color: #8A5A06; font-size: 12px; font-weight: 700; }
.dias.cero { background: #FBE3E3; color: #8C1D1D; }

.grafica { display: flex; align-items: flex-end; gap: 10px; height: 170px; padding: 14px 18px 0; }
.columna { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
.valor { height: 18px; font-size: 13px; font-weight: 700; color: #14244A; font-variant-numeric: tabular-nums; }
.barra { flex: 1; width: 100%; max-width: 38px; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 6px 6px 0 0; background: #F4F6FA; overflow: hidden; }
.barra .norm, .leyenda .norm { background: #3D7BE0; }
.barra .urg, .leyenda .urg { background: #D9534F; }
.dia { padding: 6px 0; font-size: 12px; font-weight: 700; color: #64748B; }
.hoy-col .dia { color: #172A5A; }
.hoy-col .barra { box-shadow: inset 0 0 0 2px #C9D5EC; }
.leyenda { display: flex; gap: 16px; padding: 4px 18px 14px; font-size: 12px; font-weight: 600; color: #64748B; }
.leyenda i { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 3px; }

.codificar { max-height: 420px; overflow-y: auto; }
.codificar li { display: flex; align-items: center; gap: 12px; padding: 9px 18px; border-top: 1px solid #F1F5F9; }
.codificar li:first-child { border-top: none; }
/* --- Relieve (estilo duo) --- */
.hoy { border-bottom-width: 4px; border-radius: 18px; }
.marca { border-radius: 12px; }
</style>
