<script setup>
import { ref, onMounted } from 'vue';
import servicio from '../../services/atenciones';
import Icono from '../comunes/Icono.vue';

/**
 * Codificar una consulta cerrada: se parte de lo que escribió el médico
 * ("dolor de cabeza") y el sistema sugiere los códigos CIE-10 que encajan.
 * Un clic lo asigna; lo escrito se conserva tal cual.
 */
const props = defineProps({ atencion: { type: Object, required: true } });
const emit = defineEmits(['codificada']);

const texto = ref(props.atencion.diagnosticoTxt ?? '');
const sugerencias = ref([]);
const guardando = ref(false);
const error = ref('');
let temporizador;

async function buscar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    if (texto.value.trim().length < 2) { sugerencias.value = []; return; }
    try {
      const r = await servicio.buscarDiagnostico(texto.value.trim());
      sugerencias.value = r.resultados.filter((x) => x.codigo).slice(0, 3);
    } catch {
      sugerencias.value = [];
    }
  }, 250);
}

async function asignar(codigo) {
  guardando.value = true;
  error.value = '';
  try {
    await servicio.codificar(props.atencion.id, codigo);
    emit('codificada', props.atencion.id);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: 'numeric', month: 'short' }) : '');

onMounted(buscar);
</script>

<template>
  <li class="fila">
    <div class="cabeza">
      <p class="nombre">{{ props.atencion.paciente.apellidos }}, {{ props.atencion.paciente.nombres }}</p>
      <span class="fecha">{{ fecha(props.atencion.cerradaEn) }}</span>
    </div>
    <div class="buscar">
      <Icono nombre="buscar" :tamano="16" />
      <input v-model="texto" :aria-label="`Diagnóstico de ${props.atencion.paciente.nombres}`" @input="buscar" />
    </div>
    <ul v-if="sugerencias.length" class="opciones">
      <li v-for="s in sugerencias" :key="s.codigo">
        <span class="codigo">{{ s.codigo }}</span>
        <span class="desc" :title="s.descripcion">{{ s.descripcion }}</span>
        <button type="button" class="asignar" :disabled="guardando" @click="asignar(s.codigo)">Asignar</button>
      </li>
    </ul>
    <p v-else class="nada">Sin coincidencias</p>
    <p v-if="error" class="mt-1 text-xs font-bold text-urgente-700">{{ error }}</p>
  </li>
</template>

<style scoped>
.fila { display: block !important; padding: 12px 16px 14px !important; border-top: 2px solid #EEF2F6; }
.cabeza { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.nombre { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 800; color: #14244A; }
.fecha { flex-shrink: 0; padding: 1px 7px; border-radius: 6px; background: #F1F5F9; font-size: 12px; font-weight: 700; color: #475569; }
.buscar { position: relative; margin-top: 8px; }
.buscar svg { position: absolute; left: 10px; top: 50%; margin-top: -8px; color: #64748B; }
.buscar input { width: 100%; height: 36px; padding: 0 10px 0 32px; border: 2px solid #E2E8F0; border-radius: 9px; font-size: 14px; font-weight: 600; color: #1E293B; background: #F8FAFC; }
.buscar input:focus { outline: none; border-color: #172A5A; background: #fff; }
.opciones { margin-top: 8px; border: 2px solid #E2E8F0; border-radius: 10px; overflow: hidden; }
.opciones li { display: flex !important; align-items: center; gap: 10px; padding: 6px 6px 6px 8px !important; border-top: 1px solid #EEF2F6; }
.opciones li:first-child { border-top: none; }
.codigo { flex-shrink: 0; min-width: 52px; padding: 2px 6px; border-radius: 6px; background: #172A5A; color: #fff; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; font-weight: 700; text-align: center; }
.desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: #334155; }
.asignar { flex-shrink: 0; height: 28px; padding: 0 10px; border: 2px solid #172A5A; border-radius: 7px; font-size: 12px; font-weight: 800; color: #172A5A; background: #fff; }
.asignar:hover:not(:disabled) { background: #172A5A; color: #fff; }
.nada { margin-top: 8px; font-size: 13px; font-weight: 700; color: #94A3B8; }
</style>
