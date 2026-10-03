<script setup>
import { onMounted } from 'vue';
import { useSincronizacionStore } from '../../stores/sincronizacion';
import Icono from './Icono.vue';

const sync = useSincronizacionStore();

onMounted(() => sync.iniciarEscucha());
</script>

<template>
  <!-- Solo aparece cuando hay algo que decir: sin red, o con cosas por enviar -->
  <div
    v-if="!sync.enLinea || sync.hayPendientes"
    class="text-sm"
    :class="sync.enLinea ? 'bg-atencion-500 text-atencion-950' : 'bg-slate-800 text-white'"
    role="status"
  >
    <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2">
      <p class="flex items-center gap-2 font-medium">
        <Icono :nombre="sync.enLinea ? 'actualizar' : 'sinConexion'" :tamano="17" />
        <span v-if="!sync.enLinea">
          Sin conexión. Los registros se guardan en este equipo y se envian al volver la red.
        </span>
        <span v-else>
          {{ sync.pendientes.length }} operación(es) pendiente(s) de envio.
        </span>
      </p>

      <button
        v-if="sync.enLinea && sync.hayPendientes"
        type="button"
        class="rounded-lg border border-atencion-700/30 bg-white/70 px-3 py-1 text-sm font-semibold
               transition hover:bg-white disabled:opacity-60"
        :disabled="sync.sincronizando"
        @click="sync.sincronizar()"
      >
        {{ sync.sincronizando ? 'Enviando...' : 'Enviar ahora' }}
      </button>
    </div>
  </div>
</template>
