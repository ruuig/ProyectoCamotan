<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import http from '../../services/http';
import catalogos from '../../services/catalogos';
import Icono from '../comunes/Icono.vue';

/**
 * Tiempo de viaje de cada lugar poblado al centro de salud. Da peso en la
 * cola a quien viene de lejos. Se agrupa por aldea: casi siempre sus
 * caseríos quedan a un tiempo parecido y se puede aplicar a todos de una vez.
 */
const lugares = ref([]);
const editados = reactive({});
const porAldea = reactive({});
const buscar = ref('');
const soloSinDato = ref(false);
const guardando = ref(false);
const error = ref('');
const aviso = ref('');

const TRAMOS = [
  { desde: 120, puntos: 15 },
  { desde: 60, puntos: 10 },
  { desde: 30, puntos: 5 },
];
const puntos = (min) => (min === null || min === undefined || min === '' ? null : TRAMOS.find((t) => Number(min) >= t.desde)?.puntos ?? 0);

async function cargar() {
  try {
    lugares.value = (await catalogos.lugares()).lugares;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const valor = (l) => (l.id in editados ? editados[l.id] : l.tiempoViajeMinutos ?? '');
const entero = (v) => (String(v).trim() === '' ? null : Math.min(1440, Number(String(v).replace(/[^0-9]/g, '')) || 0));

function cambiar(l, v) {
  const nuevo = entero(v);
  if (nuevo === (l.tiempoViajeMinutos ?? null)) delete editados[l.id];
  else editados[l.id] = nuevo;
}

const sinTildes = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const grupos = computed(() => {
  const clave = sinTildes(buscar.value.trim());
  const mapa = new Map();
  for (const l of lugares.value) {
    if (clave && !sinTildes(`${l.nombre} ${l.sector ?? ''}`).includes(clave)) continue;
    if (soloSinDato.value && valor(l) !== '' && valor(l) !== null) continue;
    const aldea = l.sector || 'Sin aldea';
    if (!mapa.has(aldea)) mapa.set(aldea, []);
    mapa.get(aldea).push(l);
  }
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([aldea, lista]) => ({ aldea, lista }));
});

function aplicarAldea(g) {
  const v = entero(porAldea[g.aldea] ?? '');
  if (v === null) return;
  for (const l of g.lista) cambiar(l, v);
  porAldea[g.aldea] = '';
}

const conDato = computed(() => lugares.value.filter((l) => valor(l) !== '' && valor(l) !== null).length);
const pendientes = computed(() => Object.keys(editados).length);

async function guardar() {
  guardando.value = true;
  error.value = '';
  aviso.value = '';
  try {
    const tiempos = Object.entries(editados).map(([id, minutos]) => ({ id: Number(id), minutos }));
    const r = await http.put('/catalogos/lugares/tiempos', { tiempos });
    aviso.value = `${r.actualizados} ${r.actualizados === 1 ? 'lugar guardado' : 'lugares guardados'}.`;
    for (const k of Object.keys(editados)) delete editados[k];
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

onMounted(cargar);
</script>

<template>
  <section class="b-panel">
    <header class="b-panel-cabeza flex-wrap">
      <div>
        <h2 class="b-panel-titulo">Tiempo de viaje al centro de salud</h2>
        <p class="text-sm font-semibold text-apagado">{{ conDato }} de {{ lugares.length }} lugares con tiempo · menos de 30 min +0 · 30 a 59 min +5 · 1 a 2 h +10 · más de 2 h +15</p>
      </div>
      <button type="button" class="b-btn primario" :disabled="!pendientes || guardando" @click="guardar">
        <Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Guardando…' : pendientes ? `Guardar ${pendientes}` : 'Guardar' }}
      </button>
    </header>

    <div class="b-panel-cuerpo space-y-3">
      <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
      <p v-if="aviso" class="b-aviso ok">{{ aviso }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <label class="b-buscar w-full sm:w-[300px]">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" class="b-campo" placeholder="Lugar o aldea" aria-label="Buscar lugar" />
        </label>
        <button type="button" class="b-chip" :class="soloSinDato ? 'on' : ''" @click="soloSinDato = !soloSinDato">Solo sin tiempo</button>
      </div>

      <div class="grupos">
        <section v-for="g in grupos" :key="g.aldea" class="grupo" :class="g.aldea === 'Sin aldea' ? 'plano' : ''">
          <header v-if="g.aldea !== 'Sin aldea'">
            <h3>{{ g.aldea }} <span>{{ g.lista.length }}</span></h3>
            <span class="flex items-center gap-2">
              <input v-model="porAldea[g.aldea]" inputmode="numeric" placeholder="min" :aria-label="`Minutos para toda la aldea ${g.aldea}`" class="b-campo num minutos" @keydown.enter.prevent="aplicarAldea(g)" />
              <button type="button" class="b-btn secundario chico" @click="aplicarAldea(g)">Aplicar a todos</button>
            </span>
          </header>
          <ul>
            <li v-for="l in g.lista" :key="l.id" :class="l.id in editados ? 'editado' : ''">
              <span class="min-w-0 flex-1 truncate font-semibold text-tinta">{{ l.nombre }}</span>
              <input :value="valor(l)" inputmode="numeric" placeholder="—" :aria-label="`Minutos desde ${l.nombre}`" class="b-campo num minutos" @input="cambiar(l, $event.target.value)" />
              <span class="text-sm text-apagado">min</span>
              <span class="tramo" :class="puntos(valor(l)) === null ? 'nada' : ''">{{ puntos(valor(l)) === null ? 'sin dato' : `+${puntos(valor(l))}` }}</span>
            </li>
          </ul>
        </section>
        <p v-if="!grupos.length" class="b-vacio">Ningún lugar coincide.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grupos { max-height: 620px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; align-items: start; padding-right: 4px; }
.grupo.plano { grid-column: 1 / -1; border: none; }
.grupo.plano ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); column-gap: 20px; }
.grupo.plano li { border-top: none; border-bottom: 1px solid #EEF2F6; padding-left: 4px; }
.grupo { border: 2px solid #E2E8F0; border-radius: 12px; overflow: hidden; }
.grupo header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 8px 14px; background: #F8FAFC; border-bottom: 2px solid #E2E8F0; }
.grupo h3 { font-weight: 700; color: #14244A; }
.grupo h3 span { margin-left: 4px; font-size: 12px; font-weight: 600; color: #64748B; }
.grupo li { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 14px; border-top: 1px solid #EEF2F6; }
.grupo li:first-child { border-top: none; }
.grupo li.editado { background: #FFFBEB; }
.minutos { width: 72px; height: 36px; padding: 0 8px; }
.tramo { min-width: 64px; padding: 2px 8px; border-radius: 6px; background: #EEF2FA; text-align: center; font-size: 12px; font-weight: 700; color: #172A5A; }
.tramo.nada { background: #F1F5F9; color: #94A3B8; }
</style>
