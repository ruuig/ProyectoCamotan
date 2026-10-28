<script setup>
import { ref, computed, watch } from 'vue';
import servicio from '../../services/pacientes';

/**
 * Número de la ficha de papel: la inicial del primer apellido y el número que
 * sigue al último de esa letra (Juan Pérez P-569 → Joaquín Pérez P-570).
 *
 * Se llena solo al escribir los apellidos. Se corrige con − / + o tocando
 * «Escribir otro». Si el número ya lo tiene alguien se dice quién: una
 * familia puede compartir la ficha y está bien, pero que se vea.
 */
const modelo = defineModel({ type: String, default: '' });
const props = defineProps({
  apellidos: { type: String, default: '' },
  // Al editar un paciente, él mismo no cuenta como dueño de su ficha.
  excluir: { type: Number, default: null },
  // Al editar no se propone otra: ya tiene la suya.
  proponer: { type: Boolean, default: true },
});

const siguiente = ref(null);
const duenos = ref([]);
const escribiendo = ref(false);
// La persona la cambió a mano: ya no se reemplaza al cambiar los apellidos.
const aMano = ref(Boolean(modelo.value));

const partes = computed(() => /^([A-Za-z]+)-(\d+)$/.exec(modelo.value ?? ''));

let relojSiguiente;
watch(() => props.apellidos, (texto) => {
  if (!props.proponer) return;
  clearTimeout(relojSiguiente);
  if (String(texto ?? '').trim().length < 2) { siguiente.value = null; return; }
  relojSiguiente = setTimeout(async () => {
    try {
      siguiente.value = (await servicio.fichaPapel({ apellidos: texto })).siguiente;
      if (!aMano.value && siguiente.value) modelo.value = siguiente.value.ficha;
    } catch { /* se puede escribir a mano */ }
  }, 350);
}, { immediate: true });

let relojDuenos;
watch(modelo, (ficha) => {
  clearTimeout(relojDuenos);
  if (!ficha) { duenos.value = []; return; }
  relojDuenos = setTimeout(async () => {
    try {
      duenos.value = (await servicio.fichaPapel({ ficha, excluir: props.excluir })).duenos;
    } catch { duenos.value = []; }
  }, 350);
}, { immediate: true });

function mover(paso) {
  if (!partes.value) return;
  const n = Math.max(1, Number(partes.value[2]) + paso);
  modelo.value = `${partes.value[1].toUpperCase()}-${n}`;
  aMano.value = true;
}
function escrito(e) {
  modelo.value = e.target.value.toUpperCase().replace(/\s+/g, '');
  aMano.value = true;
}
function volverASiguiente() {
  if (!siguiente.value) return;
  modelo.value = siguiente.value.ficha;
  aMano.value = false;
  escribiendo.value = false;
}
/** Desde fuera (por ejemplo, usar la ficha de la madre). */
function usar(ficha) {
  modelo.value = ficha;
  aMano.value = true;
  escribiendo.value = false;
}
defineExpose({ usar });

const edadTexto = (e) => (e?.anios >= 1 ? `${e.anios} años` : e?.meses >= 1 ? `${e.meses} meses` : 'recién nacido');
</script>

<template>
  <div class="campo-ficha">
    <div class="fila">
      <template v-if="!escribiendo && partes">
        <button type="button" class="paso" aria-label="Número anterior" @click="mover(-1)">−</button>
        <output class="numero" aria-live="polite">{{ modelo }}</output>
        <button type="button" class="paso" aria-label="Número siguiente" @click="mover(1)">+</button>
      </template>
      <input
        v-else :value="modelo" class="escrito" placeholder="P-570" maxlength="30" autocomplete="off"
        aria-label="Número de ficha" @input="escrito"
      />
      <button type="button" class="otro" @click="escribiendo = !escribiendo">{{ escribiendo ? 'Listo' : 'Escribir otro' }}</button>
    </div>

    <p v-if="siguiente && modelo === siguiente.ficha && siguiente.ultima" class="nota">
      Sigue de la {{ siguiente.ultima.ficha }} ({{ siguiente.ultima.nombre }})
    </p>
    <p v-else-if="!modelo && !siguiente" class="nota">Escriba los apellidos y aparece el número que sigue</p>
    <p v-else-if="siguiente && modelo !== siguiente.ficha" class="nota">
      La que sigue es {{ siguiente.ficha }}
      <button type="button" class="enlace" @click="volverASiguiente">Usar {{ siguiente.ficha }}</button>
    </p>

    <div v-if="duenos.length" class="ya-tiene" role="status">
      <b>Esta ficha ya es de:</b>
      <span v-for="d in duenos" :key="d.id">{{ d.nombre }} ({{ edadTexto(d.edad) }})</span>
      <small>Si es de la misma familia, está bien. Si no, use otro número.</small>
    </div>
  </div>
</template>

<style scoped>
.campo-ficha { display: grid; gap: 6px; }
.fila { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.paso { width: 52px; height: 56px; border: 2px solid #CBD5E1; border-bottom-width: 4px; border-radius: 14px; background: #F1F5F9; font-size: 28px; font-weight: 800; color: #172A5A; }
.numero { display: grid; place-items: center; min-width: 150px; height: 56px; padding: 0 16px; border: 2px solid #172A5A; border-bottom-width: 4px; border-radius: 14px; background: #fff; font-size: 28px; font-weight: 900; letter-spacing: .02em; color: #172A5A; font-variant-numeric: tabular-nums; }
.escrito { width: 190px; height: 56px; padding: 0 14px; border: 2px solid #172A5A; border-radius: 14px; font-size: 26px; font-weight: 900; text-transform: uppercase; color: #172A5A; }
.escrito:focus { outline: none; box-shadow: 0 0 0 3px #DCE4F5; }
.otro { height: 44px; padding: 0 14px; border: 2px solid #CBD5E1; border-radius: 12px; background: #fff; font-size: 15px; font-weight: 800; color: #174E80; }
.nota { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: #64748B; }
.enlace { padding: 2px 10px; border-radius: 8px; background: #EAF3FB; color: #174E80; font-weight: 800; }
.ya-tiene { display: grid; gap: 2px; padding: 10px 12px; border: 2px solid #F5D58A; border-radius: 12px; background: #FFF7E6; font-size: 15px; color: #7A4F05; }
.ya-tiene small { font-size: 13.5px; font-weight: 600; }
@media (pointer: coarse) and (min-width: 600px) {
  .paso { width: 64px; height: 66px; font-size: 32px; }
  .numero { min-width: 180px; height: 66px; font-size: 34px; }
  .escrito { height: 66px; font-size: 30px; }
  .otro { height: 54px; font-size: 17px; }
  .nota, .ya-tiene { font-size: 17px; }
}
</style>
