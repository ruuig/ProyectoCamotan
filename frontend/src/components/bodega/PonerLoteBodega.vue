<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import bodega from '../../services/bodega';
import Icono from '../comunes/Icono.vue';
import { miles } from './diseno/PiezasBodega';

/**
 * Lo que la bodega tiene sin número de lote (lo cargado del Excel al empezar).
 * Así no se despacha: se mira la caja y se le pone lote y vencimiento. Un
 * producto puede tener varios lotes; lo que queda sigue en la lista.
 */
const emit = defineEmits(['cambio']);
const props = defineProps({ buscar: { type: String, default: '' } });

const filas = ref([]);
const cargando = ref(true);
const error = ref('');
const aviso = ref('');
const enviando = ref(false);
const abierto = ref(null);
const f = reactive({ numeroLote: '', fechaVence: '', cantidad: '' });

async function cargar() {
  try {
    filas.value = (await bodega.sinLote()).filas;
    emit('cambio', filas.value.length);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}
onMounted(cargar);

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const visibles = computed(() => {
  const clave = sinTildes(props.buscar.trim());
  return filas.value.filter((x) => !clave || sinTildes(x.nombre).includes(clave));
});

function abrir(x) {
  abierto.value = x.loteId;
  Object.assign(f, { numeroLote: '', fechaVence: '', cantidad: String(x.cantidad) });
  error.value = '';
}

const cantidad = computed(() => Number(String(f.cantidad).replace(/[^\d]/g, '')) || 0);

async function guardar(x) {
  enviando.value = true;
  error.value = '';
  aviso.value = '';
  try {
    const r = await bodega.ponerLote({ loteId: x.loteId, numeroLote: f.numeroLote, fechaVence: f.fechaVence, cantidad: cantidad.value });
    aviso.value = `${x.nombre}: ${miles(r.cantidad)} en el lote ${r.numeroLote}.`;
    const queda = x.cantidad - r.cantidad;
    await cargar();
    // Si queda algo sin lote, el formulario sigue abierto para el lote siguiente.
    if (queda > 0) abrir({ ...x, cantidad: queda });
    else abierto.value = null;
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="b-panel mt-4">
    <header class="b-panel-cabeza">
      <h2 class="b-panel-titulo">Sin lote</h2>
      <span class="b-contador gris">{{ filas.length }}</span>
    </header>
    <p v-if="error" role="alert" class="b-aviso error m-3">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok m-3" aria-live="polite">{{ aviso }}</p>
    <p v-if="cargando" class="b-vacio">Cargando…</p>
    <ul v-else-if="visibles.length" class="lista">
      <li v-for="x in visibles" :key="x.loteId" class="fila">
        <div class="flex items-center gap-3">
          <span class="min-w-0 flex-1 font-semibold text-tinta">{{ x.nombre }}</span>
          <b class="tabular-nums text-tinta">{{ miles(x.cantidad) }}</b>
          <small class="w-16 text-apagado">{{ x.unidad }}</small>
          <button v-if="abierto !== x.loteId" type="button" data-accion class="b-btn secundario chico" @click="abrir(x)">Poner lote</button>
        </div>
        <form v-if="abierto === x.loteId" data-accion class="poner" @submit.prevent="guardar(x)">
          <div class="flex-1">
            <label :for="`l-${x.loteId}`" class="b-etiqueta">Lote</label>
            <input :id="`l-${x.loteId}`" v-model="f.numeroLote" required minlength="2" maxlength="40" class="b-campo font-mono uppercase" autofocus />
          </div>
          <div>
            <label :for="`v-${x.loteId}`" class="b-etiqueta">Vence</label>
            <input :id="`v-${x.loteId}`" v-model="f.fechaVence" type="date" required class="b-campo" />
          </div>
          <div class="w-32">
            <label :for="`c-${x.loteId}`" class="b-etiqueta">Cantidad</label>
            <input :id="`c-${x.loteId}`" v-model="f.cantidad" inputmode="numeric" required class="b-campo num" />
          </div>
          <div class="flex gap-2 self-end">
            <button type="button" class="b-btn secundario" @click="abierto = null">Cancelar</button>
            <button type="submit" class="b-btn primario" :disabled="enviando || !cantidad || cantidad > x.cantidad">{{ enviando ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </form>
      </li>
    </ul>
    <p v-else class="b-vacio">Todo tiene lote.</p>
  </section>
</template>

<style scoped>
.lista { max-height: max(420px, calc(100vh - 320px)); overflow-y: auto; }
.fila { padding: 12px 18px; border-top: 1px solid #EEF2F6; }
.fila:first-child { border-top: 0; }
.poner { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; padding: 12px 14px; border: 2px solid #CFE3F5; border-radius: 14px; background: #F5FAFE; }
</style>
