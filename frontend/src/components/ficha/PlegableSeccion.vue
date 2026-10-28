<script setup>
import { computed } from 'vue';
import Icono from '../comunes/Icono.vue';

/**
 * Una sección de la ficha, plegable, con su avance a la vista:
 * "5 de 9", "Sin registrar" o "Registrado el 2 de octubre por Ana López".
 */
const props = defineProps({
  id: { type: String, required: true },
  titulo: { type: String, required: true },
  subtitulo: { type: String, default: null },
  // Texto de estado bajo el título.
  estado: { type: String, default: null },
  avance: { type: Object, default: null },
  registrada: { type: Boolean, default: false },
  sinGuardar: { type: Boolean, default: false },
  abierta: { type: Boolean, default: false },
});
const emit = defineEmits(['update:abierta']);

const completa = computed(() => props.avance && props.avance.total > 0 && props.avance.respondidas === props.avance.total);
// En palabras, para quien no lee porcentajes: «Lista», «Faltan 3», «Sin llenar».
const faltan = computed(() => (props.avance?.total ? props.avance.total - props.avance.respondidas : 0));
const sello = computed(() => {
  if (completa.value) return { texto: 'Lista ✓', clase: 'lista' };
  if (props.registrada && faltan.value) return { texto: `Faltan ${faltan.value}`, clase: 'faltan' };
  return { texto: 'Sin llenar', clase: 'vacia' };
});
const porcentaje = computed(() => (props.avance?.total ? Math.round((props.avance.respondidas / props.avance.total) * 100) : 0));
</script>

<template>
  <section :id="id" class="plegable" :class="abierta ? 'abierta' : ''">
    <h3>
      <button type="button" class="cabeza" :aria-expanded="abierta" :aria-controls="`${id}-cuerpo`" @click="emit('update:abierta', !abierta)">
        <span class="anillo" :class="completa ? 'completo' : registrada ? 'curso' : ''" aria-hidden="true">
          <Icono v-if="completa" nombre="correcto" :tamano="18" :grosor="2.2" />
          <span v-else>{{ registrada ? `${porcentaje}%` : '—' }}</span>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[17px] font-bold text-tinta">
            {{ titulo }}<span v-if="subtitulo" class="font-semibold text-apagado"> · {{ subtitulo }}</span>
          </span>
          <span class="mt-0.5 block text-[13px] font-semibold text-apagado">
            <template v-if="estado">{{ estado }}</template>
            <span v-if="avance && avance.total" class="numeros-seccion"><template v-if="estado"> · </template>{{ avance.respondidas }} de {{ avance.total }}</span>
            <span v-if="sinGuardar" class="text-[#B7710A]"> · cambios sin guardar</span>
          </span>
        </span>
        <span class="sello" :class="sello.clase">{{ sello.texto }}</span>
        <Icono nombre="irA" :tamano="20" :grosor="2.2" class="flecha" />
        <!-- Tablet: dice con palabras que se toca para abrir o cerrar -->
        <span class="accion" aria-hidden="true">{{ abierta ? 'Cerrar' : completa ? 'Ver' : 'Llenar' }}<b>{{ abierta ? '▲' : '▼' }}</b></span>
      </button>
    </h3>
    <div v-if="abierta" :id="`${id}-cuerpo`" class="cuerpo">
      <slot />
      <button type="button" class="cerrar-abajo" @click="emit('update:abierta', false); $el.scrollIntoView({ block: 'start', behavior: 'smooth' })">
        Cerrar «{{ titulo }}» ▲
      </button>
    </div>
  </section>
</template>

<style scoped>
.plegable { scroll-margin-top: 90px; border: 2px solid #E2E8F0; border-radius: 14px; background: #fff; overflow: hidden; }
.plegable.abierta { border-color: #CBD5E1; }
.cabeza { display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 18px; text-align: left; }
.cabeza:hover { background: #F8FAFC; }
.anillo { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; border: 2px solid #CBD5E1; font-size: 11px; font-weight: 700; color: #94A3B8; font-variant-numeric: tabular-nums; }
.anillo.curso { border-color: #172A5A; color: #172A5A; }
.anillo.completo { border-color: #1E8E5E; background: #1E8E5E; color: #fff; }
.flecha { flex-shrink: 0; color: #64748B; transition: transform .15s; }
.abierta .flecha { transform: rotate(90deg); }
.cuerpo { padding: 18px 20px 20px; border-top: 2px solid #EEF2F6; }
/* --- Relieve (estilo duo) --- */
.plegable { border-bottom-width: 4px; border-radius: 18px; }
.sello { display: none; flex-shrink: 0; padding: 4px 12px; border-radius: 10px; font-size: 15px; font-weight: 800; white-space: nowrap; }
.sello.lista { background: #E3F5EC; color: #17784F; }
.sello.faltan { background: #FFF1DB; color: #8A4B00; }
.sello.vacia { background: #F1F5F9; color: #64748B; }
.accion, .cerrar-abajo { display: none; }
/* Tablet: la cabecera dice en palabras cómo está y qué pasa al tocarla. */
@media (pointer: coarse) and (min-width: 600px) {
  .anillo, .flecha { display: none; }
  .sello { display: inline-block; }
  .accion { display: inline-flex; flex-shrink: 0; align-items: center; gap: 8px; min-height: 52px; padding: 0 16px; border: 2px solid #172A5A; border-bottom-width: 4px; border-radius: 14px; background: #fff; font-size: 18px; font-weight: 800; color: #172A5A; }
  .abierta .accion { background: #172A5A; color: #fff; }
  .cerrar-abajo { display: block; width: 100%; min-height: 58px; margin-top: 22px; border: 2px dashed #CBD5E1; border-radius: 14px; background: #F8FAFC; font-size: 17px; font-weight: 800; color: #475569; }
  .cabeza { min-height: 84px; flex-wrap: wrap; }
  .cabeza .text-\[17px\] { font-size: 20px; }
  .cabeza .text-\[13px\] { font-size: 15.5px; }
}
</style>
