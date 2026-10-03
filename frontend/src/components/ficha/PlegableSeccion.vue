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
            <template v-if="avance && avance.total"><template v-if="estado"> · </template>{{ avance.respondidas }} de {{ avance.total }}</template>
            <span v-if="sinGuardar" class="text-[#B7710A]"> · cambios sin guardar</span>
          </span>
        </span>
        <Icono nombre="irA" :tamano="20" :grosor="2.2" class="flecha" />
      </button>
    </h3>
    <div v-if="abierta" :id="`${id}-cuerpo`" class="cuerpo">
      <slot />
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
</style>
