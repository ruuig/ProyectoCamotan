<script setup>
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AdminPersonal from '../../components/admin/AdminPersonal.vue';
import AdminFirmas from '../../components/admin/AdminFirmas.vue';
import AdminBodega from '../../components/admin/AdminBodega.vue';
import AdminCatalogos from '../../components/admin/AdminCatalogos.vue';
import AdminCentro from '../../components/admin/AdminCentro.vue';
import AdminRespaldos from '../../components/admin/AdminRespaldos.vue';
import AdminPrioridad from '../../components/admin/AdminPrioridad.vue';

/** Administración: cada pestaña es una parte del sistema que configura dirección. */
// Ordenadas como se configura un centro nuevo: quién es el centro, quién
// trabaja, quién firma; luego cómo se atiende y cómo se maneja la bodega;
// al final los catálogos y los respaldos, que se tocan poco.
const PESTANAS = [
  { clave: 'centro', texto: 'Centro y seguridad' },
  { clave: 'personal', texto: 'Personal' },
  { clave: 'firmas', texto: 'Firmas' },
  { clave: 'prioridad', texto: 'Prioridad de la cola' },
  { clave: 'bodega', texto: 'Bodega' },
  { clave: 'catalogos', texto: 'Catálogos' },
  { clave: 'respaldos', texto: 'Respaldos' },
];

// Enlaces de otras pantallas que usan los nombres anteriores.
const ANTERIORES = { logistica: 'bodega', ubicaciones: 'bodega', usuarios: 'personal', establecimiento: 'centro', seguridad: 'centro', lugares: 'catalogos', signos: 'catalogos', cie10: 'catalogos' };

const route = useRoute();
const router = useRouter();
const pedida = String(route.query.pestana ?? 'personal');
const pestana = ref(PESTANAS.some((p) => p.clave === pedida) ? pedida : ANTERIORES[pedida] ?? 'personal');
const subCatalogo = ['lugares', 'signos', 'cie10'].includes(pedida) ? pedida : 'lugares';

watch(pestana, (p) => router.replace({ query: { pestana: p } }));
</script>

<template>
  <div class="b-hoja">
    <nav class="b-carpetas" aria-label="Administración">
      <button
        v-for="p in PESTANAS"
        :key="p.clave"
        type="button"
        class="b-carpeta"
        :class="pestana === p.clave ? 'activa' : ''"
        :aria-current="pestana === p.clave ? 'page' : undefined"
        @click="pestana = p.clave"
      >
        {{ p.texto }}
      </button>
    </nav>

    <div class="b-cuerpo">
      <AdminPersonal v-if="pestana === 'personal'" />
      <AdminPrioridad v-else-if="pestana === 'prioridad'" />
      <AdminFirmas v-else-if="pestana === 'firmas'" />
      <AdminBodega v-else-if="pestana === 'bodega'" />
      <AdminCatalogos v-else-if="pestana === 'catalogos'" :inicial="subCatalogo" />
      <AdminRespaldos v-else-if="pestana === 'respaldos'" />
      <AdminCentro v-else />
    </div>
  </div>
</template>
