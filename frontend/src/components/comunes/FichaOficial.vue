<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';

/**
 * Ficha impresa sobre el formulario oficial del MSPAS: la página del PDF de
 * fondo y cada dato en su casilla. Sin datos (ficha en blanco) sale solo el
 * formulario. Página oficio, como el papel.
 */
const props = defineProps({
  plantilla: { type: Object, required: true },
  datos: { type: Object, default: null },
  establecimiento: { type: Object, default: null },
});
const router = useRouter();

const valor = (item) => {
  if (!props.datos) return item.tipo === 'm' || item.tipo === 'x' ? false : '';
  try {
    const v = item.v(props.datos, props.establecimiento);
    return v === null || v === undefined ? '' : v;
  } catch {
    return '';
  }
};
const texto = (item) => String(valor(item));
function imprimir() { window.print(); }

const estilo = document.createElement('style');
estilo.textContent = '@media print { @page { size: 8.5in 13in; margin: 0; } }';
onMounted(() => document.head.appendChild(estilo));
onBeforeUnmount(() => estilo.remove());
</script>

<template>
  <div class="barra no-imprimir">
    <button type="button" class="boton-primario" @click="imprimir">Imprimir</button>
    <button type="button" class="boton-secundario" @click="router.back()">Volver</button>
  </div>
  <div class="hojas">
    <section v-for="(p, n) in plantilla.paginas" :key="n" class="pagina">
      <img :src="p.fondo" alt="" class="fondo" />
      <template v-for="(it, i) in p.items" :key="i">
        <span
          v-if="it.tipo === 'm' && valor(it) === true"
          class="marca"
          :style="{ left: `${it.x - 3.2}pt`, top: `${it.y - 3.2}pt` }"
        />
        <span
          v-else-if="it.tipo === 'x' && valor(it) === true"
          class="equis"
          :style="{ left: `${it.x - 3.5}pt`, top: `${it.y - 4.5}pt` }"
        >✕</span>
        <span
          v-else-if="it.tipo === 't' && texto(it)"
          class="dato"
          :class="{ negrita: it.negrita }"
          :style="{ left: `${it.x}pt`, top: `${it.y}pt`, fontSize: `${it.s ?? 7.5}pt`, maxWidth: it.w ? `${it.w}pt` : null }"
        >{{ texto(it) }}</span>
        <span
          v-else-if="it.tipo === 'area' && texto(it)"
          class="area"
          :style="{ left: `${it.x}pt`, top: `${it.y}pt`, width: `${it.w}pt`, height: `${it.h}pt`, fontSize: `${it.s ?? 7.5}pt`, lineHeight: it.renglon ? `${it.renglon}pt` : '1.25' }"
        >{{ texto(it) }}</span>
      </template>
    </section>
  </div>
</template>

<style scoped>
.barra { display: flex; justify-content: center; gap: 10px; padding: 14px; }
.hojas { display: flex; flex-direction: column; align-items: center; gap: 18px; padding-bottom: 24px; overflow-x: auto; }
.pagina { position: relative; width: 612pt; height: 936pt; flex: none; overflow: hidden; background: #fff; box-shadow: 0 2px 12px rgba(15, 23, 42, .18); }
.fondo { position: absolute; inset: 0; width: 100%; height: 100%; }
.dato, .area { position: absolute; font-family: Arial, Helvetica, sans-serif; color: #000; }
.dato { line-height: 1; white-space: nowrap; overflow: hidden; }
.negrita { font-weight: 700; }
.area { overflow: hidden; white-space: pre-wrap; word-break: break-word; }
.marca { position: absolute; width: 6.4pt; height: 6.4pt; border-radius: 50%; background: #000; }
.equis { position: absolute; font: 700 8pt Arial, sans-serif; line-height: 1; color: #000; }
@media print {
  .hojas { display: block; padding: 0; gap: 0; overflow: visible; }
  .pagina { box-shadow: none; break-after: page; }
  .pagina:last-child { break-after: auto; }
  .fondo { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
</style>
