<script setup>
/**
 * Pregunta Sí/No con tres estados: sin registrar, Sí y No.
 *
 * En papel una casilla vacía puede querer decir "no" o "no se preguntó". Aquí
 * nunca se asume No: mientras nadie marque, queda sin registrar. Volver a
 * tocar la opción marcada la deja otra vez sin registrar. El Sí marcado
 * resalta; el No marcado se ve, pero no compite con los Sí.
 */
const props = defineProps({
  modelValue: { type: Boolean, default: null },
  etiqueta: { type: String, required: true },
  id: { type: String, default: null },
  compacto: { type: Boolean, default: false },
  deshabilitado: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

function elegir(valor) {
  if (props.deshabilitado) return;
  emit('update:modelValue', props.modelValue === valor ? null : valor);
}
</script>

<template>
  <div :id="id" tabindex="-1" role="radiogroup" :aria-label="etiqueta" class="sino" :class="[compacto ? 'compacto' : '', modelValue === null || modelValue === undefined ? 'vacio' : '']">
    <button
      v-for="op in [{ v: true, t: 'Sí' }, { v: false, t: 'No' }]"
      :key="op.t"
      type="button"
      role="radio"
      :aria-checked="modelValue === op.v"
      :disabled="deshabilitado"
      :class="modelValue === op.v ? (op.v ? 'si' : 'no') : ''"
      @click="elegir(op.v)"
    >
      {{ op.t }}
    </button>
  </div>
</template>

<style scoped>
.sino { display: inline-flex; padding: 3px; border: 2px solid #CBD5E1; border-radius: 10px; background: #fff; }
.sino.vacio { border-style: dashed; }
.sino button { min-width: 56px; height: 36px; padding: 0 12px; border-radius: 7px; font-weight: 700; font-size: 14px; color: #475569; }
.sino button:hover:not(:disabled) { background: #F1F5F9; }
.sino button.si { background: #172A5A; color: #fff; }
.sino button.no { background: #E2E8F0; color: #14244A; }
.sino button:disabled { opacity: .5; }
.compacto button { min-width: 46px; height: 30px; font-size: 13px; }
/* --- Relieve (estilo duo) --- */
.sino { border-color: #E2E8F0; border-bottom-width: 4px; border-radius: 14px; }
.sino button { border-radius: 10px; font-weight: 800; }
.sino button.si { box-shadow: inset 0 -3px 0 #0B163A; }
.sino button.no { box-shadow: inset 0 -3px 0 #C5CEDB; }
</style>
