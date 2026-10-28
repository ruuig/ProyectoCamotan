<script setup>
import { ref, computed, watch, nextTick } from 'vue';

/**
 * Fecha fácil: día, mes y año por separado, en grande.
 *
 * El calendario del navegador obliga a ir mes por mes hasta 1960 y en la
 * tablet sale diminuto. Aquí se escribe el día, se toca el mes entre doce
 * botones y se escribe el año (con dos cifras basta: 90 es 1990). Abajo se
 * lee la fecha completa y la edad, para confirmar sin pensar.
 *
 * v-model: 'AAAA-MM-DD', o '' mientras no esté completa y válida.
 */
const modelo = defineModel({ type: String, default: '' });
const props = defineProps({
  id: { type: String, default: '' },
  // Muestra la edad que resulta (fecha de nacimiento).
  conEdad: { type: Boolean, default: false },
  // No acepta fechas después de hoy.
  sinFuturo: { type: Boolean, default: true },
});

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const dia = ref('');
const mes = ref(0); // 1 a 12
const anio = ref('');
const eligiendoMes = ref(false);
const campoDia = ref(null);
const campoAnio = ref(null);

function desdeModelo(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  if (!m) return;
  anio.value = m[1];
  mes.value = Number(m[2]);
  dia.value = String(Number(m[3]));
}
desdeModelo(modelo.value);
watch(modelo, (v) => { if (v && v !== fecha.value) desdeModelo(v); });

// 90 → 1990, 15 → 2015: el siglo que no deja la fecha en el futuro.
const anioCompleto = computed(() => {
  const a = String(anio.value).replace(/\D/g, '');
  if (a.length === 4) return Number(a);
  if (a.length === 2) {
    const actual = new Date().getFullYear();
    const n = 2000 + Number(a);
    return n > actual ? n - 100 : n;
  }
  return null;
});

const problema = computed(() => {
  const d = Number(dia.value);
  if (!dia.value || !mes.value || !anioCompleto.value) return '';
  if (anioCompleto.value < 1900) return 'Revise el año';
  const f = new Date(anioCompleto.value, mes.value - 1, d);
  if (f.getMonth() !== mes.value - 1 || d < 1) return `${MESES[mes.value - 1]} no tiene día ${d}`;
  if (props.sinFuturo && f > new Date()) return 'Esa fecha todavía no llega';
  return '';
});

const fecha = computed(() => {
  if (!dia.value || !mes.value || !anioCompleto.value || problema.value) return '';
  return `${anioCompleto.value}-${String(mes.value).padStart(2, '0')}-${String(dia.value).padStart(2, '0')}`;
});
watch(fecha, (v) => { if (v !== modelo.value) modelo.value = v; });

const edad = computed(() => {
  if (!fecha.value) return '';
  const n = new Date(`${fecha.value}T00:00:00`);
  const hoy = new Date();
  let meses = (hoy.getFullYear() - n.getFullYear()) * 12 + hoy.getMonth() - n.getMonth();
  if (hoy.getDate() < n.getDate()) meses -= 1;
  if (meses >= 24) return `${Math.floor(meses / 12)} años`;
  if (meses >= 1) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const dias = Math.floor((hoy - n) / 86400000);
  return `${dias} ${dias === 1 ? 'día' : 'días'}`;
});

async function alEscribirDia() {
  dia.value = dia.value.replace(/\D/g, '').slice(0, 2);
  // Con dos cifras (o un 4 a 9, que no puede llevar otra) se pasa al mes.
  if (dia.value.length === 2 || Number(dia.value) > 3) {
    eligiendoMes.value = true;
  }
}
async function elegirMes(n) {
  mes.value = n;
  eligiendoMes.value = false;
  await nextTick();
  if (!anio.value) campoAnio.value?.focus();
}
function alEscribirAnio() {
  anio.value = anio.value.replace(/\D/g, '').slice(0, 4);
}
function borrar() {
  dia.value = '';
  mes.value = 0;
  anio.value = '';
  modelo.value = '';
  campoDia.value?.focus();
}
</script>

<template>
  <div class="selector-fecha">
    <div class="partes">
      <label class="parte dia">
        <span>Día</span>
        <input
          :id="id || undefined" ref="campoDia" v-model="dia" inputmode="numeric" maxlength="2" placeholder="día"
          autocomplete="off" @input="alEscribirDia" @focus="$event.target.select()"
        />
      </label>
      <div class="parte mes">
        <span>Mes</span>
        <button type="button" :class="{ vacio: !mes }" :aria-expanded="eligiendoMes" @click="eligiendoMes = !eligiendoMes">
          {{ mes ? MESES[mes - 1] : 'Elegir' }}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      <label class="parte anio">
        <span>Año</span>
        <input ref="campoAnio" v-model="anio" inputmode="numeric" maxlength="4" placeholder="año" autocomplete="off" @input="alEscribirAnio" @focus="$event.target.select()" />
      </label>
    </div>

    <div v-if="eligiendoMes" class="meses" role="listbox" aria-label="Mes">
      <button v-for="(m, i) in MESES" :key="m" type="button" role="option" :aria-selected="mes === i + 1" :class="{ on: mes === i + 1 }" @click="elegirMes(i + 1)">
        {{ m }}
      </button>
    </div>

    <p v-if="problema" class="leyenda mal">{{ problema }}</p>
    <p v-else-if="fecha" class="leyenda bien">
      {{ Number(dia) }} de {{ MESES[mes - 1].toLowerCase() }} de {{ anioCompleto }}<template v-if="conEdad"> · <b>{{ edad }}</b></template>
      <button type="button" class="borrar" @click="borrar">Borrar</button>
    </p>
  </div>
</template>

<style scoped>
.selector-fecha { display: grid; gap: 8px; }
.partes { display: grid; grid-template-columns: 84px minmax(150px, 1fr) 110px; gap: 8px; max-width: 460px; }
.parte { display: grid; gap: 3px; }
.parte > span { font-size: 12.5px; font-weight: 800; color: #64748B; }
.parte input, .parte button { height: 52px; border: 2px solid #CBD5E1; border-radius: 12px; background: #fff; font-size: 20px; font-weight: 800; color: #14244A; }
.parte input { width: 100%; text-align: center; font-variant-numeric: tabular-nums; }
.parte input::placeholder { color: #94A3B8; font-size: 16px; font-weight: 600; font-style: italic; }
.parte input:focus, .parte button:focus-visible { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.parte button { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 12px; text-align: left; }
.parte button.vacio { color: #94A3B8; }
.meses { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; max-width: 560px; padding: 8px; border: 2px solid #E2E8F0; border-radius: 16px; background: #F8FAFC; }
.meses button { height: 50px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 12px; background: #fff; font-size: 16px; font-weight: 800; color: #334155; }
.meses button.on { border-color: #2F83C4; background: #EAF3FB; color: #174E80; }
@media (max-width: 520px) { .meses { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.leyenda { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
.leyenda.bien { color: #1E7A4C; }
.leyenda.mal { color: #B45309; }
.borrar { margin-left: 4px; padding: 2px 10px; border-radius: 8px; background: #F1F5F9; color: #475569; font-size: 13px; font-weight: 800; }
/* Tablet: más grande para tocar con el dedo. */
@media (pointer: coarse) and (min-width: 600px) {
  .partes { grid-template-columns: 100px minmax(170px, 1fr) 130px; max-width: 520px; }
  .parte > span { font-size: 15px; }
  .parte input, .parte button { height: 62px; font-size: 24px; }
  .meses button { height: 60px; font-size: 18px; }
  .leyenda { font-size: 18px; }
}
</style>
