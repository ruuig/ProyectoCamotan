<script setup>
import { ref } from 'vue';
import catalogos from '../../services/catalogos';
import Icono from '../comunes/Icono.vue';

/**
 * Carga del catálogo CIE-10 desde un CSV.
 *
 * El sistema no trae el catálogo: se carga el oficial cuando el centro lo
 * tenga. Mientras tanto, el buscador de la consulta usa los diagnósticos que
 * ya se escribieron en el centro.
 */
const texto = ref('');
const nombre = ref('');
const cargando = ref(false);
const resultado = ref(null);
const error = ref('');

function leer(evento) {
  const archivo = evento.target.files?.[0];
  if (!archivo) return;
  nombre.value = archivo.name;
  const lector = new FileReader();
  lector.onload = () => { texto.value = String(lector.result ?? ''); };
  lector.readAsText(archivo, 'UTF-8');
}

async function cargar() {
  error.value = '';
  resultado.value = null;
  cargando.value = true;
  try {
    resultado.value = await catalogos.importarCie10(texto.value);
    texto.value = '';
  } catch (fallo) {
    error.value = fallo.message;
    resultado.value = { errores: fallo.detalles ?? [] };
  } finally {
    cargando.value = false;
  }
}
</script>

<template>
  <div class="panel max-w-3xl space-y-5 p-relleno">
    <div>
      <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">Catálogo CIE-10</h2>
      <p class="mt-1 text-tinta-2">
        Archivo CSV con las columnas <code class="font-mono">codigo,descripcion,sinonimos</code>.
        Los sinónimos son opcionales y van separados por <code class="font-mono">|</code>
        (por ejemplo <code class="font-mono">J00,Rinofaringitis aguda,catarro|resfriado</code>).
        Lo que ya existe se actualiza; nada se borra.
      </p>
      <p class="mt-2 text-sm text-apagado">
        Mientras no se cargue, el buscador de diagnósticos de la consulta usa los que ya se registraron en el centro.
      </p>
    </div>

    <label class="boton-secundario cursor-pointer">
      <Icono nombre="agregar" :tamano="18" />
      {{ nombre || 'Elegir archivo CSV' }}
      <input type="file" accept=".csv,text/csv" class="sr-only" @change="leer" />
    </label>

    <div>
      <button type="button" class="boton-primario" :disabled="!texto || cargando" @click="cargar">
        {{ cargando ? 'Cargando…' : 'Cargar catálogo' }}
      </button>
    </div>

    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-empeora" />
      <span class="text-tinta-2">{{ error }}</span>
    </p>

    <p v-if="resultado?.creados !== undefined" class="font-bold text-mejora">
      {{ resultado.creados }} códigos nuevos y {{ resultado.actualizados }} actualizados.
    </p>
    <div v-if="resultado?.errores?.length" class="aviso aviso-atencion">
      <div>
        <p class="font-bold text-tinta">{{ resultado.errores.length }} línea(s) con problemas</p>
        <ul class="mt-1 list-inside list-disc text-sm text-tinta-2">
          <li v-for="e in resultado.errores.slice(0, 50)" :key="e.linea">Línea {{ e.linea }}: {{ e.mensaje }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>
