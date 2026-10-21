<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import farmacia from '../../services/farmacia';
import Icono from '../../components/comunes/Icono.vue';
import EstanteFarmacia from '../../components/farmacia/EstanteFarmacia.vue';
import PedidoFarmacia from '../../components/farmacia/PedidoFarmacia.vue';
import CierreDiaFarmacia from '../../components/farmacia/CierreDiaFarmacia.vue';

/**
 * Estante y pedidos de la farmacia (post-consulta): pedir a bodega lo que
 * falta y ver lo que hay, lote por lote, con su vencimiento. Lo vencido se
 * devuelve a bodega. El informe del día (lo que entró y salió) se imprime.
 */
const hoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
// Tres tareas: pedir lo que falta, ver lo que hay y, al final del día,
// contar el estante (el cuaderno en línea) y copiar el resumen al SIGSA.
const PESTANAS = [
  { clave: 'pedir', texto: 'Pedir a bodega', icono: 'trasladar' },
  { clave: 'existencias', texto: 'Mi estante', icono: 'inventario' },
  { clave: 'contar', texto: 'Cerrar el día', icono: 'correcto' },
];
const route = useRoute();
const router = useRouter();
const pedida = route.query.pestana;
const pestana = ref(PESTANAS.some((p) => p.clave === pedida) ? pedida : 'existencias');
const existencias = ref([]);
const buscar = ref('');
const error = ref('');
const aviso = ref('');
async function cargarExistencias() {
  error.value = '';
  try {
    existencias.value = (await farmacia.existencias()).insumos;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

watch(pestana, (p) => {
  router.replace({ query: { pestana: p } });
  cargarExistencias();
});
const porPedir = computed(() => existencias.value.filter((x) => x.pedir > 0).length);

// Imprimir: el informe del inventario de un día (por defecto hoy), en su propia hoja.
const fechaInforme = ref(hoy);
const eligiendoFecha = ref(false);
function imprimir() {
  window.open(`/imprimir/inventario-farmacia?fecha=${fechaInforme.value}`, '_blank');
  eligiendoFecha.value = false;
}

onMounted(cargarExistencias);


</script>

<template>
  <section>
    <RouterLink to="/dispensacion" class="b-volver no-imprimir"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Dispensación</RouterLink>
    <header class="b-cabecera">
      <div>
        <p class="b-antetitulo">Farmacia</p>
        <h1 class="b-titulo">Estante y pedidos</h1>
      </div>
      <div class="relative no-imprimir">
        <button type="button" class="b-btn secundario" @click="eligiendoFecha = !eligiendoFecha"><Icono nombre="imprimir" :tamano="20" /> Imprimir</button>
        <div v-if="eligiendoFecha" class="elegir-informe">
          <b>Informe del inventario</b>
          <label for="fecha-informe" class="b-etiqueta">Día</label>
          <input id="fecha-informe" v-model="fechaInforme" type="date" :max="hoy" class="b-campo" />
          <button type="button" class="b-btn primario w-full" :disabled="!fechaInforme" @click="imprimir"><Icono nombre="imprimir" :tamano="18" /> Imprimir</button>
        </div>
      </div>
    </header>

    <nav class="pestanas-grandes mt-5 no-imprimir" aria-label="Estante y pedidos">
      <button v-for="p in PESTANAS" :key="p.clave" type="button" :class="{ on: pestana === p.clave }" :aria-current="pestana === p.clave ? 'page' : undefined" @click="pestana = p.clave">
        <span class="ic"><Icono :nombre="p.icono" :tamano="26" /></span>
        <b>{{ p.texto }}</b>
        <span v-if="p.clave === 'pedir' && porPedir" class="globo">{{ porPedir }}</span>
      </button>
    </nav>

    <p v-if="aviso" class="b-aviso ok mt-4 no-imprimir" aria-live="polite">{{ aviso }}</p>
    <p v-if="error" role="alert" class="b-aviso error mt-4 no-imprimir">{{ error }}</p>

    <div class="mt-5 flex flex-wrap items-end gap-3 no-imprimir">
      <label v-if="pestana === 'existencias'" class="buscador">
        <Icono nombre="buscar" :tamano="24" :grosor="2.4" />
        <input v-model="buscar" type="search" autocomplete="off" placeholder="Buscar medicamento" aria-label="Buscar medicamento" />
      </label>
    </div>

    <!-- ===== Cerrar el día ===== -->
    <CierreDiaFarmacia v-if="pestana === 'contar'" class="mt-4" @aviso="(t) => (aviso = t)" @error="(t) => (error = t)" />

    <!-- ===== Estante ===== -->
    <EstanteFarmacia
      v-if="pestana === 'existencias'" class="mt-4" :existencias="existencias" :buscar="buscar"
      @recargar="cargarExistencias" @aviso="(t) => (aviso = t)" @error="(t) => (error = t)" @pedir="pestana = 'pedir'"
    />

    <!-- ===== Pedir a bodega ===== -->
    <PedidoFarmacia v-if="pestana === 'pedir'" class="mt-4" :existencias="existencias" @aviso="(t) => (aviso = t)" @error="(t) => (error = t)" />
  </section>
</template>

<style scoped>
.pestanas-grandes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.globo { margin-left: auto; padding: 2px 11px; border-radius: 10px; background: #D64545; color: #fff; font-size: 15px; font-weight: 900; }
.solo-imprimir { display: none; }
.elegir-informe { position: absolute; right: 0; top: calc(100% + 8px); z-index: 30; display: grid; gap: 8px; width: 260px; padding: 16px;
  background: #fff; border: 2px solid #172A5A; border-bottom-width: 4px; border-radius: 16px; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, .35); }
.elegir-informe b { color: #14244A; font-size: 16px; }
.pestanas-grandes button { display: flex; align-items: center; gap: 14px; min-height: 84px; padding: 14px 18px; border: 2px solid #E2E8F0; border-bottom-width: 5px; border-radius: 18px; background: #fff; text-align: left; color: #475569; transition: transform .06s; }
.pestanas-grandes button:active { transform: translateY(2px); border-bottom-width: 3px; }
.pestanas-grandes .ic { display: grid; place-items: center; flex-shrink: 0; width: 52px; height: 52px; border-radius: 16px; background: #EAF3FB; color: #2F83C4; }
.pestanas-grandes button.on .ic { background: #2F83C4; color: #fff; box-shadow: inset 0 -4px 0 rgba(0, 0, 0, .2); }
.pestanas-grandes b { font-size: 20px; font-weight: 900; color: #14244A; }
.pestanas-grandes button.on { background: #EAF3FB; border-color: #4A9BD6; border-bottom-color: #2F83C4; }
@media (max-width: 800px) { .pestanas-grandes { grid-template-columns: 1fr; } }
.b-btn.grande { height: 56px; padding: 0 26px; border-radius: 16px; font-size: 17px; }
.debe { font-size: 17px; font-weight: 900; color: #14244A; }
.dif { display: inline-block; min-width: 64px; padding: 3px 10px; border-radius: 9px; font-weight: 900; text-align: center; }
.dif.ok { background: #E2F5EA; color: #145C3C; }
.dif.menos { background: #FDECEC; color: #A52A2A; }
.dif.mas { background: #FFF4D6; color: #8A5A06; }
.contador-pestana { margin-left: 4px; min-width: 22px; padding: 0 7px; border-radius: 8px; background: #172A5A; color: #fff; font-size: 12px; }
/* --- Buscador ---------------------------------------------------------------- */
.buscador { display: flex; flex: 1; min-width: 16rem; align-items: center; gap: 10px; height: 56px; padding: 0 16px; background: #fff; color: #64748B;
  border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; }
.buscador:focus-within { border-color: #4A9BD6; border-bottom-color: #2F83C4; color: #2F83C4; box-shadow: 0 0 0 4px rgba(74, 155, 214, .15); }
.buscador input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: 17px; font-weight: 700; color: #14244A; }
.buscador input::placeholder { font-weight: 600; color: #94A3B8; }

.poner-med { display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; background: #FFF7E6; }
.poner-med b { color: #14244A; }
.poner-med span { font-size: 13px; font-weight: 700; color: #8A5A06; }
.grande-campo { height: 52px; font-size: 18px; }
.tarjetas { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .tarjetas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tarjeta { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; }
.tarjeta span { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.tarjeta b { font-size: 28px; line-height: 1; color: #14244A; font-variant-numeric: tabular-nums; }
.tarjeta.alerta b { color: #8A5A06; }
.contado { width: 84px; height: 34px; margin-left: auto; }
/* El nombre del medicamento no se pierde al desplazar la tabla. */
.b-tabla :is(th, td):first-child { position: sticky; left: 0; z-index: 1; min-width: 200px; background: #fff; }
.b-tabla th:first-child { z-index: 2; background: #F1F5F9; }
.grupo span { margin-left: 4px; color: #14244A; }
.bodega li { padding: 12px 16px; }
.bodega li + li { border-top: 1px solid #EEF2F6; }
.lote { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 0; }
.punto { width: 10px; height: 10px; border-radius: 50%; background: #94A3B8; }
.punto.vencido { background: #111827; }
.punto.rojo { background: #C03535; }
.punto.amarillo { background: #D9A400; }
.punto.verde { background: #1E8E5E; }
.fondo { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
.ventana { width: min(460px, 100%); }
@media print {
  .no-imprimir { display: none !important; }
  .solo-imprimir { display: block; }
}
</style>
