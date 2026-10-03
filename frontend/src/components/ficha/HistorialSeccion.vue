<script setup>
import { ref, onMounted } from 'vue';
import servicio from '../../services/pacientes';
import { valorLegible } from '../../dominio/ficha';

/**
 * Quién cambió qué en una sección, cuándo, y qué decía antes.
 * Un dato sensible se muestra como "registrado" a quien no puede verlo.
 */
const props = defineProps({
  pacienteId: { type: [Number, String], required: true },
  seccion: { type: String, required: true },
  // Clave de dato → { etiqueta, opciones }
  etiquetas: { type: Object, required: true },
});

const cambios = ref(null);
const error = ref('');

const formato = new Intl.DateTimeFormat('es-GT', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

onMounted(async () => {
  try {
    cambios.value = (await servicio.historialSeccion(props.pacienteId, props.seccion)).cambios;
  } catch (fallo) {
    error.value = fallo.message;
  }
});

const etiquetaDe = (campo) => props.etiquetas[campo]?.etiqueta ?? campo;
const leer = (c, valor) => (c.oculto && valor ? 'registrado' : valorLegible(valor, props.etiquetas[c.campo]));
</script>

<template>
  <div class="rounded-control border border-linea bg-fondo p-4">
    <p class="text-etiqueta font-bold uppercase tracking-wide text-apagado">Historial de cambios</p>
    <p v-if="error" class="mt-2 text-empeora">{{ error }}</p>
    <p v-else-if="cambios === null" class="mt-2 text-apagado">Cargando…</p>
    <p v-else-if="cambios.length === 0" class="mt-2 text-apagado">Todavía no hay cambios registrados.</p>
    <ol v-else class="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
      <li v-for="c in cambios" :key="c.id" class="border-l-2 border-linea pl-3 text-sm">
        <p class="text-tinta">
          <strong>{{ etiquetaDe(c.campo) }}</strong>:
          <span class="text-apagado line-through decoration-1">{{ leer(c, c.anterior) }}</span>
          → <span class="font-bold">{{ leer(c, c.nuevo) }}</span>
          <span v-if="c.oculto" class="text-apagado"> (dato sensible)</span>
        </p>
        <p class="text-apagado">{{ c.usuario }} · {{ formato.format(new Date(c.registradoEn)) }}</p>
      </li>
    </ol>
  </div>
</template>
