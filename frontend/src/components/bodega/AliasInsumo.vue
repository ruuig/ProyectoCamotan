<script setup>
import { ref, onMounted } from 'vue';
import bodega from '../../services/bodega';
import Icono from '../comunes/Icono.vue';

/**
 * Nombres con que el insumo aparece en los Excel viejos ("Condón masculino,
 * unidad"). La importación del historial los usa para no perder meses.
 */
const props = defineProps({ insumoId: { type: [Number, String], required: true } });
const lista = ref([]);
const nuevo = ref('');
const error = ref('');

async function cargar() {
  lista.value = (await bodega.alias(props.insumoId)).alias;
}

async function agregar() {
  error.value = '';
  try {
    await bodega.agregarAlias(props.insumoId, nuevo.value.trim());
    nuevo.value = '';
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function quitar(a) {
  error.value = '';
  try {
    await bodega.quitarAlias(props.insumoId, a.id);
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(() => cargar().catch((f) => { error.value = f.message; }));
</script>

<template>
  <section class="b-panel">
    <header class="b-panel-cabeza">
      <h2 class="b-panel-titulo">Otros nombres del insumo</h2>
    </header>
    <div class="b-panel-cuerpo space-y-3">
      <ul v-if="lista.length" class="flex flex-wrap gap-2">
        <li v-for="a in lista" :key="a.id" class="inline-flex h-9 items-center gap-1 rounded-[9px] border-2 border-[#E2E8F0] pl-3 pr-1 text-sm font-semibold text-tinta">
          {{ a.alias }}
          <button type="button" class="grid h-7 w-7 place-items-center rounded-md text-apagado hover:bg-[#FDECEC] hover:text-[#C03535]" :aria-label="`Quitar ${a.alias}`" @click="quitar(a)">
            <Icono nombre="cerrar" :tamano="15" :grosor="2.2" />
          </button>
        </li>
      </ul>
      <form class="flex flex-wrap gap-2" @submit.prevent="agregar">
        <input v-model="nuevo" minlength="2" maxlength="200" placeholder="Nombre como aparece en el Excel" aria-label="Nombre alterno" class="b-campo min-w-[16rem] flex-1" />
        <button type="submit" class="b-btn secundario" :disabled="nuevo.trim().length < 2">
          <Icono nombre="agregar" :tamano="20" /> Agregar
        </button>
      </form>
      <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
    </div>
  </section>
</template>
