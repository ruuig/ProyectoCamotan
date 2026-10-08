<script setup>
import { ref } from 'vue';
import Icono from '../comunes/Icono.vue';

/**
 * Carga de un catálogo desde un archivo CSV. Lo que ya existe se actualiza;
 * nada se borra. Las líneas con error se listan con su número.
 */
const props = defineProps({
  titulo: { type: String, required: true },
  columnas: { type: String, required: true },
  ejemplo: { type: String, default: '' },
  cargar: { type: Function, required: true }, // (texto) => resultado
});
const emit = defineEmits(['cargado']);

const texto = ref('');
const nombre = ref('');
const cargando = ref(false);
const resultado = ref(null);
const error = ref('');

function leer(evento) {
  const archivo = evento.target.files?.[0];
  if (!archivo) return;
  nombre.value = archivo.name;
  resultado.value = null;
  const lector = new FileReader();
  lector.onload = () => { texto.value = String(lector.result ?? ''); };
  lector.readAsText(archivo, 'UTF-8');
}

const lineas = () => texto.value.split(/\r?\n/).filter((l) => l.trim()).length;

async function enviar() {
  error.value = '';
  resultado.value = null;
  cargando.value = true;
  try {
    resultado.value = await props.cargar(texto.value);
    texto.value = '';
    nombre.value = '';
    emit('cargado', resultado.value);
  } catch (fallo) {
    error.value = fallo.message;
    resultado.value = { errores: fallo.detalles ?? [] };
  } finally {
    cargando.value = false;
  }
}
</script>

<template>
  <section class="b-panel">
    <header class="b-panel-cabeza">
      <h2 class="b-panel-titulo">{{ titulo }}</h2>
    </header>
    <div class="b-panel-cuerpo space-y-3">
      <div>
        <span class="b-etiqueta">Columnas del archivo</span>
        <code class="columnas">{{ columnas }}</code>
        <code v-if="ejemplo" class="columnas ejemplo">{{ ejemplo }}</code>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <label class="b-btn secundario cursor-pointer">
          <Icono nombre="recibir" :tamano="20" />
          <span class="max-w-[220px] truncate">{{ nombre || 'Elegir archivo CSV' }}</span>
          <input type="file" accept=".csv,text/csv" class="sr-only" @change="leer" />
        </label>
        <button type="button" class="b-btn primario" :disabled="!texto || cargando" @click="enviar">
          {{ cargando ? 'Cargando…' : texto ? `Cargar ${lineas()} líneas` : 'Cargar' }}
        </button>
      </div>

      <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
      <p v-if="resultado?.mensaje || resultado?.creados !== undefined" class="b-aviso ok">
        {{ resultado.mensaje ?? `${resultado.creados} nuevos y ${resultado.actualizados} actualizados.` }}
      </p>
      <div v-if="resultado?.errores?.length" class="b-aviso atencion block">
        <p>{{ resultado.errores.length }} {{ resultado.errores.length === 1 ? 'línea' : 'líneas' }} con problemas</p>
        <ul class="mt-1 max-h-40 overflow-y-auto text-sm font-medium">
          <li v-for="e in resultado.errores.slice(0, 50)" :key="e.linea">Línea {{ e.linea }}: {{ e.mensaje }}</li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.columnas { display: block; padding: 8px 12px; border-radius: 8px; background: #F1F5F9; font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: #14244A; overflow-x: auto; white-space: nowrap; }
.columnas.ejemplo { margin-top: 4px; background: transparent; padding-top: 0; color: #64748B; }
</style>
