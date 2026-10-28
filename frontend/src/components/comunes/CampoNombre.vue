<script setup>
import { ref, watch } from 'vue';
import servicio from '../../services/pacientes';

/**
 * Nombres o apellidos con ayuda: mientras se escribe, abajo aparecen los
 * nombres ya registrados que se parecen a la última palabra («Jaun» → Juan,
 * Juana). Un toque la cambia por la bien escrita.
 */
const modelo = defineModel({ type: String, default: '' });
const props = defineProps({
  id: { type: String, required: true },
  campo: { type: String, required: true }, // 'nombres' | 'apellidos'
  placeholder: { type: String, default: '' },
  requerido: { type: Boolean, default: false },
});

const sugerencias = ref([]);
let reloj;
let ultimaElegida = '';
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

watch(modelo, (texto) => {
  clearTimeout(reloj);
  const palabra = String(texto ?? '').split(/\s+/).pop();
  if (!palabra || palabra.length < 2 || palabra === ultimaElegida) {
    sugerencias.value = [];
    return;
  }
  reloj = setTimeout(async () => {
    try {
      const { palabras } = await servicio.sugerir({ campo: props.campo, texto });
      // Si ya está bien escrita no hace falta sugerir nada.
      const igual = palabras.some((p) => p === palabra);
      sugerencias.value = igual && palabras.length === 1 ? [] : palabras.filter((p) => p !== palabra).slice(0, 5);
    } catch {
      sugerencias.value = [];
    }
  }, 280);
});

function elegir(p) {
  const partes = String(modelo.value).trimEnd().split(/\s+/);
  partes[partes.length - 1] = p;
  ultimaElegida = p;
  modelo.value = `${partes.join(' ')} `;
  sugerencias.value = [];
  document.getElementById(props.id)?.focus();
}

// Primera letra en mayúscula al salir del campo: «juan carlos» → «Juan Carlos».
function ordenar() {
  modelo.value = String(modelo.value).trim().replace(/\s+/g, ' ')
    .split(' ').map((p) => (p.length > 2 || !['de', 'del', 'la', 'y'].includes(sinTildes(p)) ? p.charAt(0).toUpperCase() + p.slice(1) : p.toLowerCase())).join(' ');
  setTimeout(() => { sugerencias.value = []; }, 200);
}
</script>

<template>
  <div class="campo-nombre">
    <input
      :id="id" v-model="modelo" :required="requerido" :placeholder="placeholder"
      autocomplete="off" autocapitalize="words" spellcheck="false" class="b-campo" @blur="ordenar"
    />
    <div v-if="sugerencias.length" class="sugerencias">
      <span>¿Es</span>
      <button v-for="p in sugerencias" :key="p" type="button" @mousedown.prevent @click="elegir(p)">{{ p }}</button>
      <span>?</span>
    </div>
  </div>
</template>

<style scoped>
.sugerencias { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; font-size: 14px; font-weight: 700; color: #64748B; }
.sugerencias button { height: 36px; padding: 0 12px; border: 2px solid #9FCDEC; border-bottom-width: 3px; border-radius: 10px; background: #F4F9FE; color: #174E80; font-size: 15px; font-weight: 800; }
@media (pointer: coarse) and (min-width: 600px) {
  .sugerencias { font-size: 16px; }
  .sugerencias button { height: 46px; padding: 0 16px; font-size: 18px; }
}
</style>
