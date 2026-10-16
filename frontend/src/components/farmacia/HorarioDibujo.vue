<script setup>
import { computed } from 'vue';
import { horarioDe } from '../../dominio/orientacion';

/**
 * El horario de un medicamento en dibujos: un sol por la mañana, un sol alto
 * al mediodía, el sol bajando por la tarde y una luna por la noche. Para quien
 * no lee, o lee poco, es lo que queda claro al llegar a la casa.
 */
const props = defineProps({
  indicaciones: { type: String, default: '' },
  impreso: { type: Boolean, default: false },
});
const h = computed(() => horarioDe(props.indicaciones));
const TEXTO = { mañana: 'Mañana', mediodía: 'Mediodía', tarde: 'Tarde', noche: 'Noche' };
</script>

<template>
  <div v-if="h?.momentos" class="horario" :class="{ impreso }" :aria-label="`${h.veces} ${h.veces === 1 ? 'vez' : 'veces'} al día${h.dias ? `, por ${h.dias} días` : ''}`">
    <span v-for="m in h.momentos" :key="m" class="momento" :class="m">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <template v-if="m === 'noche'">
          <path d="M21 4a12 12 0 1 0 7 21A10 10 0 0 1 21 4Z" />
        </template>
        <template v-else-if="m === 'tarde'">
          <path d="M4 22h24" class="linea" /><path d="M9 22a7 7 0 0 1 14 0Z" />
        </template>
        <template v-else>
          <circle cx="16" :cy="m === 'mediodía' ? 14 : 17" r="6" />
          <path :d="m === 'mediodía' ? 'M16 2v4M16 22v4M4 14h4M24 14h4M7.5 5.5l2.8 2.8M21.7 19.7l2.8 2.8M7.5 22.5l2.8-2.8M21.7 8.3l2.8-2.8' : 'M16 5v4M5 17h4M23 17h4M8 9l2.8 2.8M21.2 11.8 24 9M4 27h24'" class="linea" />
        </template>
      </svg>
      <small>{{ TEXTO[m] }}</small>
    </span>
    <span v-if="h.dias" class="dias"><b>{{ h.dias }}</b> días</span>
  </div>
</template>

<style scoped>
.horario { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.momento { display: grid; justify-items: center; gap: 1px; min-width: 52px; padding: 4px 6px; border-radius: 10px; background: #FFF7E0; }
.momento svg { width: 26px; height: 26px; fill: #E8A30C; }
.momento .linea { fill: none; stroke: #E8A30C; stroke-width: 2.4; stroke-linecap: round; }
.momento.tarde { background: #FDEEE3; }
.momento.tarde svg { fill: #E8590C; } .momento.tarde .linea { stroke: #E8590C; }
.momento.noche { background: #E8ECF8; }
.momento.noche svg { fill: #3B4A8C; }
.momento small { font-size: 11px; font-weight: 800; color: #475569; }
.dias { margin-left: 4px; padding: 4px 10px; border-radius: 10px; background: #F1F5F9; font-size: 13px; font-weight: 700; color: #334155; }
.dias b { font-size: 16px; font-weight: 900; color: #14244A; }
.impreso .momento { min-width: 70px; padding: 6px 8px; border: 1.5px solid #111827; background: #fff; }
.impreso .momento svg { width: 36px; height: 36px; fill: #111827; }
.impreso .momento .linea { stroke: #111827; }
.impreso .momento small { font-size: 13px; color: #111827; }
.impreso .dias { border: 1.5px solid #111827; background: #fff; font-size: 14px; }
</style>
