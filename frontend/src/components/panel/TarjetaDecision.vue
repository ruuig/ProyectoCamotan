<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

/**
 * Una decisión pendiente.
 *
 * No es una alerta: es una acción redactada en verbo, con la cifra que la
 * justifica y el botón que la ejecuta. La primera de la fila va en marino
 * para que se vea desde la puerta cuál es la más urgente.
 *
 * El botón no oculta la tarjeta. Registra que alguien ya actuó y la tarjeta
 * sigue ahí, porque la causa sigue ahí: el suero no llega porque se haya
 * pedido. Desaparece cuando el sistema detecta que la condición terminó.
 */
const props = defineProps({
  decision: { type: Object, required: true },
  destacada: { type: Boolean, default: false },
  registrando: { type: Boolean, default: false },
});

defineEmits(['gestionar']);

// El punto de color dice de qué tipo es sin tener que leer la categoría.
const COLOR_PUNTO = {
  existencia_baja: 'bg-empeora',
  vencimiento: 'bg-advertencia-marca',
  comunidad_sin_atencion: 'bg-advertencia-marca',
};

const puntoDestacado = computed(() =>
  props.decision.tipo === 'existencia_baja' ? 'bg-empeora-claro' : 'bg-advertencia-marca',
);

const yaGestionada = computed(() => props.decision.estado === 'en_gestion');
</script>

<template>
  <article
    class="flex flex-col rounded-tarjeta border p-relleno"
    :class="destacada
      ? 'border-marino bg-marino text-superficie'
      : 'border-linea bg-superficie'"
  >
    <p class="flex items-center gap-2 font-bold">
      <span
        class="h-2 w-2 shrink-0 rounded-full"
        :class="destacada ? puntoDestacado : COLOR_PUNTO[decision.tipo]"
      />
      <span :class="destacada ? 'text-superficie' : 'text-advertencia'">
        {{ decision.categoria }}
      </span>
    </p>

    <h3
      class="mt-3 font-titulo text-lg font-medium"
      :class="destacada ? 'text-superficie' : 'text-tinta'"
    >
      {{ decision.accion }}
    </h3>

    <!-- La cifra es lo único que se lee a distancia -->
    <p class="mt-3 flex items-baseline gap-2">
      <template v-if="decision.cifra !== null">
        <span class="cifra-decision" :class="destacada ? 'text-superficie' : 'text-tinta'">
          {{ decision.cifra }}
        </span>
        <span class="text-lg" :class="destacada ? 'text-superficie/80' : 'text-tinta-2'">
          {{ decision.unidad }}
        </span>
        <span class="text-sm" :class="destacada ? 'text-superficie/70' : 'text-apagado'">
          {{ decision.descripcionCifra }}
        </span>
      </template>
      <!-- Sin cifra no se muestra un cero que se leería como "ninguno" -->
      <span
        v-else
        class="font-titulo text-2xl font-bold"
        :class="destacada ? 'text-superficie' : 'text-empeora'"
      >
        {{ decision.textoSinCifra }}
      </span>
    </p>

    <p class="mt-3 flex-1 text-sm" :class="destacada ? 'text-superficie/80' : 'text-apagado'">
      {{ decision.contexto }}
    </p>

    <!-- Quién ya actuó y cuándo. La tarjeta no se va por eso. -->
    <p
      v-if="yaGestionada"
      class="mt-3 text-sm font-bold"
      :class="destacada ? 'text-superficie' : 'text-mejora'"
    >
      {{ decision.gestion }}
    </p>

    <div class="mt-4 flex flex-wrap gap-2">
      <button
        v-if="!yaGestionada"
        type="button"
        class="min-h-tocable flex-1 rounded-control px-4 font-bold transition"
        :class="destacada
          ? 'bg-superficie text-marino hover:bg-linea-suave'
          : 'border border-linea bg-superficie text-tinta hover:border-marino-apagado'"
        :disabled="registrando"
        @click="$emit('gestionar', decision)"
      >
        {{ registrando ? 'Registrando...' : decision.boton }}
      </button>
      <RouterLink
        v-else
        :to="decision.ruta"
        class="min-h-tocable flex flex-1 items-center justify-center rounded-control px-4 font-bold transition"
        :class="destacada
          ? 'bg-superficie text-marino hover:bg-linea-suave'
          : 'border border-linea bg-superficie text-tinta hover:border-marino-apagado'"
      >
        {{ decision.boton }}
      </RouterLink>
    </div>
  </article>
</template>
