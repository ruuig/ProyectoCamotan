<script setup>
import LineaTendencia from './LineaTendencia.vue';

/**
 * Los cuatro indicadores del período, en un solo panel con divisores.
 *
 * Cada frase y su color vienen calculados del servidor. El color dice si la
 * situación mejoró o empeoró, nunca si el número subió o bajó: una espera
 * que baja y un ausentismo que baja se pintan igual aunque uno se mida en
 * minutos y el otro en puntos.
 */
defineProps({
  indicadores: { type: Array, required: true },
});

const CLASE_FRASE = {
  mejora: 'text-mejora',
  empeora: 'text-empeora',
  neutro: 'text-apagado',
};
</script>

<template>
  <div
    class="tarjeta grid grid-cols-1 divide-y divide-linea sm:grid-cols-2
           panel:grid-cols-4 panel:divide-x panel:divide-y-0"
  >
    <div v-for="i in indicadores" :key="i.clave" class="p-relleno">
      <p class="text-etiqueta font-bold uppercase tracking-wide text-apagado">{{ i.etiqueta }}</p>

      <div class="mt-2 flex items-center justify-between gap-3">
        <p class="flex items-baseline gap-1.5">
          <!-- Sin dato no se muestra un cero que se leería como medido -->
          <span v-if="i.valor === null" class="font-titulo text-2xl font-medium text-apagado">
            Sin dato
          </span>
          <template v-else>
            <span class="cifra-indicador">{{ i.valor }}</span>
            <span v-if="i.unidad" class="text-lg text-apagado">{{ i.unidad }}</span>
          </template>
        </p>

        <LineaTendencia :valores="i.tendencia" :sentido="i.sentido" />
      </div>

      <p class="mt-2 text-sm" :class="CLASE_FRASE[i.sentido] ?? 'text-apagado'">
        {{ i.frase }}
      </p>
    </div>
  </div>
</template>
