<script setup>
/**
 * Esqueleto de carga con la forma de cada bloque del panel.
 *
 * Un indicador giratorio no dice nada: la pantalla se queda en blanco y
 * luego salta. Aquí el espacio ya está repartido, así que al llegar los
 * datos nada se mueve de sitio y la lectura no se interrumpe.
 */
defineProps({
  // 'decisiones' | 'indicadores' | 'grafica' | 'lista'
  forma: { type: String, required: true },
  filas: { type: Number, default: 5 },
});
</script>

<template>
  <div class="animate-pulse" aria-hidden="true">
    <div v-if="forma === 'decisiones'" class="grid gap-tarjeta panel:grid-cols-3">
      <div v-for="n in 3" :key="n" class="tarjeta p-relleno">
        <div class="h-3 w-32 rounded bg-linea-suave" />
        <div class="mt-4 h-5 w-48 rounded bg-linea-suave" />
        <div class="mt-4 h-12 w-28 rounded bg-linea-suave" />
        <div class="mt-4 h-3 w-full rounded bg-linea-suave" />
        <div class="mt-2 h-3 w-4/5 rounded bg-linea-suave" />
        <div class="mt-5 h-11 w-full rounded-control bg-linea-suave" />
      </div>
    </div>

    <div
      v-else-if="forma === 'indicadores'"
      class="tarjeta grid grid-cols-1 divide-y divide-linea sm:grid-cols-2
             panel:grid-cols-4 panel:divide-x panel:divide-y-0"
    >
      <div v-for="n in 4" :key="n" class="p-relleno">
        <div class="h-3 w-24 rounded bg-linea-suave" />
        <div class="mt-3 flex items-center justify-between gap-3">
          <div class="h-9 w-20 rounded bg-linea-suave" />
          <div class="h-9 w-28 rounded bg-linea-suave" />
        </div>
        <div class="mt-3 h-3 w-36 rounded bg-linea-suave" />
      </div>
    </div>

    <div v-else-if="forma === 'grafica'" class="panel p-relleno">
      <div class="h-5 w-48 rounded bg-linea-suave" />
      <div class="mt-2 h-3 w-32 rounded bg-linea-suave" />
      <div class="mt-6 flex h-[260px] items-end gap-2">
        <div
          v-for="n in 14"
          :key="n"
          class="flex-1 rounded-t bg-linea-suave"
          :style="{ height: `${30 + ((n * 37) % 60)}%` }"
        />
      </div>
    </div>

    <div v-else class="panel p-relleno">
      <div class="h-5 w-44 rounded bg-linea-suave" />
      <div class="mt-2 h-3 w-56 rounded bg-linea-suave" />
      <div v-for="n in filas" :key="n" class="mt-5 flex items-center gap-4">
        <div class="flex-1">
          <div class="h-4 w-40 rounded bg-linea-suave" />
          <div class="mt-1.5 h-3 w-24 rounded bg-linea-suave" />
        </div>
        <div class="h-2 w-40 rounded-full bg-linea-suave" />
        <div class="h-4 w-14 rounded bg-linea-suave" />
      </div>
    </div>
  </div>
</template>
