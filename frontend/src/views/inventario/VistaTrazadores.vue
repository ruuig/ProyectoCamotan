<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import SelectorMes from '../../components/bodega/SelectorMes.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { nombrePeriodo, periodoActual } from '../../dominio/bodega';

/**
 * Trazadores: el informe que la bodega entrega cada mes a la DDRISS en sus
 * tres formatos (medicamentos, material médico quirúrgico y laboratorio). De
 * cada producto, el promedio mensual de demanda real y la existencia física,
 * del BRES del mes. Antes de imprimir se ve cómo va: para cuántos meses
 * alcanza ahora y cómo estaba en los meses anteriores.
 */
const FORMATOS = [['medicamentos', 'Medicamentos'], ['quirurgico', 'Médico quirúrgico'], ['laboratorio', 'Laboratorio']];
const formato = ref('medicamentos');
const periodo = ref(periodoActual());
const datos = ref(null);
const error = ref('');
const cargando = ref(false);
const buscar = ref('');
const filtro = ref('todos');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    datos.value = await bodega.trazador(formato.value, periodo.value);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}
watch([formato, periodo], cargar);
onMounted(cargar);

const FUENTE = { cerrado: 'BRES cerrado', borrador: 'BRES en borrador', en_curso: 'Existencia de hoy' };
const mesCorto = (p) => nombrePeriodo(p).slice(0, 3);

/* Para cuántos meses alcanza: el mismo color que el semáforo del BRES. */
function tono(m) {
  if (m === null || m === undefined) return 'nada';
  if (m < 1) return 'rojo';
  if (m < 2) return 'ambar';
  if (m > 6) return 'azul';
  return 'verde';
}
const meses = (m) => (m === null || m === undefined ? '—' : m.toFixed(1));

const FILTROS = [
  { clave: 'todos', texto: 'Todos', pasa: () => true },
  { clave: 'poco', texto: 'Menos de 2 meses', pasa: (r) => r.maneja && r.meses !== null && r.meses < 2 },
  { clave: 'cero', texto: 'Sin existencia', pasa: (r) => r.maneja && !r.existencia },
  { clave: 'no', texto: 'No se maneja', pasa: (r) => !r.maneja },
];
const todos = computed(() => (datos.value?.secciones ?? []).flatMap((s) => s.renglones));
const cuenta = computed(() => Object.fromEntries(FILTROS.map((f) => [f.clave, todos.value.filter(f.pasa).length])));
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const secciones = computed(() => {
  const q = sinTildes(buscar.value.trim());
  const pasa = FILTROS.find((f) => f.clave === filtro.value).pasa;
  return (datos.value?.secciones ?? [])
    .map((s) => ({ ...s, renglones: s.renglones.filter((r) => r.texto && r.texto !== '-' && pasa(r) && (!q || sinTildes(`${r.texto} ${r.productos.join(' ')}`).includes(q))) }))
    .filter((s) => s.renglones.length);
});

/* Barras de cómo va: hasta 6 meses de alto. */
const alto = (m) => `${Math.max(6, Math.min(100, ((m ?? 0) / 6) * 100))}%`;
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div>
        <p class="b-antetitulo">Bodega</p>
        <h1 class="b-titulo">Trazadores</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <SelectorMes v-model="periodo" />
        <RouterLink :to="`/imprimir/trazador/${formato}/${periodo}`" target="_blank" class="b-btn primario"><Icono nombre="imprimir" :tamano="20" /> Imprimir</RouterLink>
      </div>
    </header>

    <div class="barra mt-4">
      <div class="b-segmentado" role="radiogroup" aria-label="Formato">
        <button v-for="[clave, texto] in FORMATOS" :key="clave" type="button" role="radio" :aria-checked="formato === clave" :class="{ on: formato === clave }" @click="formato = clave">{{ texto }}</button>
      </div>
      <span v-if="datos" class="fuente">{{ FUENTE[datos.fuente] }}</span>
    </div>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="cargando && !datos" class="b-vacio">Calculando {{ nombrePeriodo(periodo) }}…</p>

    <template v-if="datos">
      <div class="barra mt-3">
        <label class="buscar">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" autocomplete="off" placeholder="Buscar producto" aria-label="Buscar producto" />
        </label>
        <div class="filtros">
          <button v-for="f in FILTROS" :key="f.clave" type="button" :class="{ on: filtro === f.clave }" :aria-pressed="filtro === f.clave" @click="filtro = f.clave">{{ f.texto }} <b>{{ cuenta[f.clave] }}</b></button>
        </div>
      </div>

      <div class="tabla mt-3" :class="{ cargando }">
        <template v-for="s in secciones" :key="s.titulo">
          <div class="seccion">{{ s.titulo }}</div>
          <div class="fila cabeza">
            <span class="n">No.</span><span>Producto</span><span class="n">Promedio mensual</span><span class="n">Existencia</span><span class="n">Meses</span>
            <span class="historia-cab">Últimos 6 meses <small>{{ datos.mesesHistoria.map(mesCorto).join(' · ') }}</small></span>
          </div>
          <div v-for="r in s.renglones" :key="r.clave" class="fila" :class="{ apagada: !r.maneja }">
            <span class="n no">{{ r.no }}</span>
            <span class="producto">
              <b>{{ r.texto }}</b>
              <small v-if="r.maneja && r.productos.length" class="catalogo">{{ r.productos.join(' + ') }}</small>
              <small v-else class="catalogo">No se maneja</small>
            </span>
            <span class="n">{{ r.maneja ? miles(Math.round(r.pmdr ?? 0)) : '' }}</span>
            <span class="n fuerte">{{ r.maneja ? miles(r.existencia ?? 0) : '' }}</span>
            <span class="n"><span v-if="r.maneja" class="alcanza" :class="tono(r.meses)">{{ meses(r.meses) }}</span></span>
            <span class="historia" :title="r.historia.map((h) => `${nombrePeriodo(h.periodo)}: ${meses(h.meses)} meses`).join('\n')">
              <span v-for="h in r.historia" :key="h.periodo" class="barra-mes" :class="tono(h.meses)" :style="{ height: alto(h.meses) }" />
              <span v-if="r.maneja" class="barra-mes actual" :class="tono(r.meses)" :style="{ height: alto(r.meses) }" />
            </span>
          </div>
        </template>
        <p v-if="!secciones.length" class="b-vacio">Ningún producto en esta lista.</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.barra { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.fuente { padding: 6px 12px; border-radius: 10px; background: #EAF3FB; color: #174E80; font-size: 14px; font-weight: 800; }
.buscar { display: flex; flex: 1; min-width: 12rem; align-items: center; gap: 8px; height: 46px; padding: 0 14px; border: 2px solid #E5E9F0; border-radius: 14px; background: #fff; color: #64748B; }
.buscar:focus-within { border-color: #4A9BD6; }
.buscar input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: 16px; font-weight: 700; color: #14244A; }
.filtros { display: flex; flex-wrap: wrap; gap: 8px; }
.filtros button { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 14px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 14px; background: #fff; font-size: 14px; font-weight: 800; color: #334155; }
.filtros button b { min-width: 24px; padding: 0 7px; border-radius: 9px; background: #F1F5F9; color: #14244A; text-align: center; }
.filtros button.on { border-color: #2F83C4; border-bottom-color: #1F6AA5; background: #EAF3FB; color: #174E80; }
.filtros button.on b { background: #2F83C4; color: #fff; }

.tabla { border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; background: #fff; overflow: hidden; }
.tabla.cargando { opacity: .6; }
.seccion { padding: 10px 16px; background: #DCE6F1; font-size: 13px; font-weight: 900; letter-spacing: .04em; color: #14244A; }
.fila { display: grid; grid-template-columns: 44px minmax(0, 1fr) 110px 100px 80px 150px; align-items: center; gap: 12px; padding: 8px 16px; border-top: 1px solid #EEF2F6; }
.fila.cabeza { background: #F8FAFC; font-size: 11.5px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; color: #64748B; }
.historia-cab small { display: block; font-size: 10.5px; letter-spacing: 0; text-transform: none; font-weight: 700; color: #94A3B8; }
.fila.apagada .producto b { color: #94A3B8; font-weight: 700; }
.n { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: #334155; }
.no { color: #94A3B8; }
.fuerte { font-weight: 900; color: #14244A; }
.producto { display: grid; min-width: 0; }
.producto b { font-size: 14.5px; font-weight: 800; color: #14244A; overflow-wrap: anywhere; }
.catalogo { font-size: 12px; font-weight: 600; color: #64748B; overflow-wrap: anywhere; }
.alcanza { display: inline-block; min-width: 46px; padding: 2px 8px; border-radius: 8px; text-align: center; font-weight: 900; }
.alcanza.rojo { background: #FDECEC; color: #A52A2A; }
.alcanza.ambar { background: #FFF1DC; color: #8A4B00; }
.alcanza.verde { background: #E2F5EA; color: #145C3C; }
.alcanza.azul { background: #EAF3FB; color: #174E80; }
.alcanza.nada { color: #94A3B8; }
.historia { display: flex; align-items: flex-end; gap: 4px; height: 34px; }
.barra-mes { width: 14px; border-radius: 3px 3px 0 0; background: #CBD5E1; }
.barra-mes.rojo { background: #E06464; }
.barra-mes.ambar { background: #E8A33C; }
.barra-mes.verde { background: #3BAA74; }
.barra-mes.azul { background: #5B9BD5; }
.barra-mes.nada { background: #E2E8F0; }
.barra-mes.actual { width: 18px; outline: 2px solid #14244A; outline-offset: 1px; }
@media (max-width: 860px) {
  .fila { grid-template-columns: 26px minmax(0, 1fr) 58px 58px 52px; gap: 8px; padding: 8px 10px; }
  .fila > :nth-child(6) { display: none; }
}
</style>
