<script setup>
import { ref, computed, nextTick, watch } from 'vue';
import Icono from '../comunes/Icono.vue';
import CrearInsumoRapido from './CrearInsumoRapido.vue';
import { miles } from './diseno/PiezasBodega';

/**
 * Lista de lo que se pide, igual en todas las requisiciones (encargado de
 * servicio y bodega hacia la DDRISS), como tabla: una línea por producto con
 * sus datos en columnas y la cantidad. Viene llena; la persona solo cambia la
 * cantidad, quita un renglón (y lo puede deshacer) o agrega otro.
 *
 * Un solo buscador: filtra la lista y, si el producto no está en ella, lo
 * ofrece para agregarlo. Si no está ni en el catálogo, se escribe a mano o
 * (solo bodega, con `puedeCrear`) se crea.
 *
 * Cada renglón: { insumoId, nombre, unidad, cantidad (texto), sugerido,
 *   datos (valores de `columnas`), aviso (texto opcional) }.
 * Artículo libre: { insumoId: null, clave, libre: true, nombre, unidad, cantidad }.
 */
const lineas = defineModel({ type: Array, required: true });
const props = defineProps({
  catalogo: { type: Array, default: () => [] }, // [{ id, nombreGenerico, ... }]
  titulo: { type: String, default: 'Productos' },
  vacio: { type: String, default: 'Sin productos.' },
  // Las columnas de datos de cada renglón, entre el producto y la cantidad.
  columnas: { type: Array, default: () => [] },
  // Para agregar: arma el renglón nuevo a partir del producto elegido.
  nuevoRenglon: { type: Function, default: (i) => ({ insumoId: i.id, nombre: i.nombreGenerico, unidad: '', cantidad: '', sugerido: 0 }) },
  // Errores del servidor por renglón: { insumoId: mensaje }. Se marcan en rojo.
  errores: { type: Object, default: () => ({}) },
  // Bodega y administración pueden crear el producto ahí mismo.
  puedeCrear: { type: Boolean, default: false },
});
const emit = defineEmits(['creado']);

// Cada renglón se reconoce por su producto o, si es libre, por su clave.
const llave = (l) => l.insumoId ?? l.clave;
const creando = ref(false);

const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const resaltado = ref(null);
const quitado = ref(null);
let relojQuitado = null;
const buscar = ref('');

// Si el servidor rechaza un renglón, la pantalla baja hasta él.
watch(() => props.errores, async (e) => {
  const primero = Object.keys(e ?? {})[0];
  if (!primero) return;
  buscar.value = '';
  await nextTick();
  document.getElementById(`cant-${primero}`)?.closest('.fila')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

const aPedir = computed(() => lineas.value.filter((l) => entero(l.cantidad) > 0));
const totalUnidades = computed(() => aPedir.value.reduce((s, l) => s + entero(l.cantidad), 0));
const q = computed(() => sinTildes(buscar.value.trim()));
const visibles = computed(() => (q.value ? lineas.value.filter((l) => l.libre || sinTildes(l.nombre).includes(q.value)) : lineas.value));
// Lo que se busca y no está en la lista: se ofrece para agregarlo.
const paraAgregar = computed(() => {
  if (!q.value) return [];
  const enLista = new Set(lineas.value.map((l) => l.insumoId));
  return props.catalogo.filter((c) => !enLista.has(c.id) && sinTildes(`${c.nombreGenerico} ${c.codigoInterno ?? ''}`).includes(q.value)).slice(0, 6);
});

function limpiar(l) {
  l.cantidad = l.cantidad === '' ? '' : String(entero(l.cantidad));
}

function quitar(l) {
  const i = lineas.value.indexOf(l);
  lineas.value.splice(i, 1);
  quitado.value = { linea: l, posicion: i };
  clearTimeout(relojQuitado);
  relojQuitado = setTimeout(() => { quitado.value = null; }, 7000);
}
function deshacer() {
  if (!quitado.value) return;
  lineas.value.splice(quitado.value.posicion, 0, quitado.value.linea);
  quitado.value = null;
}

async function enfocar(id) {
  resaltado.value = id;
  await nextTick();
  const campo = document.getElementById(`cant-${id}`);
  campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  campo?.focus();
  campo?.select();
  setTimeout(() => { if (resaltado.value === id) resaltado.value = null; }, 1600);
}
function agregar(i) {
  buscar.value = '';
  // Si ya está, no se repite: se lleva a ese renglón.
  if (!lineas.value.some((l) => l.insumoId === i.id)) lineas.value.push(props.nuevoRenglon(i));
  enfocar(i.id);
}
async function agregarLibre() {
  const nombre = buscar.value.trim();
  buscar.value = '';
  const clave = `libre-${Date.now()}`;
  lineas.value.push({ insumoId: null, clave, libre: true, nombre, unidad: 'Unidad', cantidad: '', sugerido: 0 });
  await nextTick();
  const campo = document.getElementById(nombre ? `cant-${clave}` : `nombre-${clave}`);
  campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  campo?.focus();
}
function creado(insumo) {
  creando.value = false;
  emit('creado', insumo);
  agregar(insumo);
}
</script>

<template>
  <section class="editor">
    <header class="cabeza">
      <h2>{{ titulo }}</h2>
      <p>{{ aPedir.length }} productos · {{ miles(totalUnidades) }} unidades</p>
    </header>

    <label class="buscar">
      <Icono nombre="buscar" :tamano="18" />
      <input v-model="buscar" type="search" autocomplete="off" placeholder="Buscar o agregar producto" aria-label="Buscar o agregar producto" />
    </label>

    <!-- Lo buscado que no está en la lista -->
    <div v-if="q" class="agregar">
      <button v-for="c in paraAgregar" :key="c.id" type="button" class="opcion" @click="agregar(c)">
        <Icono nombre="agregar" :tamano="16" :grosor="2.6" /> {{ c.nombreGenerico }}
      </button>
      <button type="button" class="opcion otra" @click="agregarLibre"><Icono nombre="lapiz" :tamano="16" /> Agregar «{{ buscar.trim() }}» sin catálogo</button>
      <button v-if="puedeCrear" type="button" class="opcion otra" @click="creando = true"><Icono nombre="agregar" :tamano="16" :grosor="2.6" /> Producto nuevo</button>
    </div>
    <CrearInsumoRapido v-if="creando" @creado="creado" @cerrar="creando = false" />

    <p v-if="quitado" class="deshacer" role="status">
      Quitado: <b>{{ quitado.linea.nombre }}</b>
      <button type="button" @click="deshacer">Deshacer</button>
    </p>

    <div v-if="visibles.length" class="tabla">
      <div class="fila cab" :style="{ '--cols': columnas.length }">
        <span>Producto</span>
        <span v-for="c in columnas" :key="c" class="n dato">{{ c }}</span>
        <span class="n">Cantidad</span>
        <span />
      </div>
      <div
        v-for="l in visibles" :key="llave(l)" class="fila" :style="{ '--cols': columnas.length }"
        :class="{ cero: !entero(l.cantidad), resaltado: resaltado === llave(l), error: errores[llave(l)], libre: l.libre }"
      >
        <span class="producto">
          <input v-if="l.libre" :id="`nombre-${l.clave}`" v-model="l.nombre" class="b-campo campo-libre" maxlength="200" placeholder="Nombre, concentración y forma" aria-label="Qué se pide" />
          <b v-else class="nombre">{{ l.nombre }}</b>
          <small v-if="l.aviso && entero(l.cantidad)" class="nota"><Icono nombre="alerta" :tamano="14" :grosor="2.4" /> {{ l.aviso }}</small>
          <small v-if="errores[llave(l)]" class="error-linea"><Icono nombre="alerta" :tamano="14" :grosor="2.4" /> {{ errores[llave(l)] }}</small>
        </span>
        <span v-for="(d, i) in columnas" :key="i" class="n dato">{{ l.datos?.[i] ?? '—' }}</span>
        <span class="cantidad">
          <input
            :id="`cant-${llave(l)}`" v-model="l.cantidad" type="text" inputmode="numeric" placeholder="0"
            class="cant" :class="{ cambiada: l.sugerido && entero(l.cantidad) !== l.sugerido }"
            :aria-label="`Cantidad de ${l.nombre}`" @focus="$event.target.select()" @blur="limpiar(l)"
          />
          <select v-if="l.libre" v-model="l.unidad" class="unidad-libre" :aria-label="`Unidad de ${l.nombre || 'lo que se pide'}`">
            <option v-for="u in ['Unidad', 'Tableta', 'Cápsula', 'Frasco', 'Ampolla', 'Vial', 'Sobre', 'Tubo', 'Caja', 'Rollo', 'Par']" :key="u">{{ u }}</option>
          </select>
          <small v-else class="unidad">{{ l.unidad }}</small>
        </span>
        <button type="button" class="quitar" :aria-label="`Quitar ${l.nombre}`" title="Quitar" @click="quitar(l)">
          <Icono nombre="cerrar" :tamano="16" :grosor="2.4" />
        </button>
      </div>
    </div>
    <p v-else class="b-vacio">{{ q ? 'No está en la lista.' : vacio }}</p>
  </section>
</template>

<style scoped>
.editor { display: grid; gap: 10px; padding: 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.cabeza { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 12px; }
.cabeza h2 { font-size: 19px; font-weight: 900; color: #14244A; }
.cabeza p { font-size: 14px; font-weight: 700; color: #64748B; }
.buscar { display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 14px; border: 2px solid #E2E8F0; border-radius: 14px; color: #64748B; background: #fff; }
.buscar:focus-within { border-color: #4A9BD6; }
.buscar input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; font-size: 16px; font-weight: 700; color: #14244A; background: transparent; }
.agregar { display: flex; flex-wrap: wrap; gap: 6px; }
.opcion { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; padding: 0 12px; border: 2px solid #CBD5E1; border-bottom-width: 3px; border-radius: 11px; background: #fff; color: #174E80; font-size: 14px; font-weight: 800; text-align: left; }
.opcion:hover { border-color: #4A9BD6; background: #F7FBFE; }
.opcion.otra { color: #475569; }
.deshacer { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 12px; background: #14244A; color: #fff; font-size: 14px; }
.deshacer b { font-weight: 800; }
.deshacer button { margin-left: auto; padding: 4px 12px; border-radius: 9px; background: #fff; color: #14244A; font-weight: 900; }

.tabla { border: 2px solid #E5E9F0; border-radius: 14px; overflow: hidden; }
.fila { display: grid; grid-template-columns: minmax(0, 1fr) repeat(var(--cols), 92px) 110px 36px; align-items: center; gap: 10px; padding: 6px 10px 6px 14px; border-top: 1px solid #EEF2F6; transition: background .2s; }
.fila.cab { border-top: 0; background: #F1F5F9; font-size: 11.5px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; color: #64748B; }
.fila.cab .n { white-space: normal; line-height: 1.2; }
.fila:not(.cab):hover { background: #F7FBFE; }
.fila.cero .nombre, .fila.cero .dato { color: #94A3B8; }
.fila.resaltado { background: #EAF3FB; }
.fila.error { background: #FFF5F5; }
.fila.libre { background: #FFFBEB; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
.fila:not(.cab) .dato { font-size: 14.5px; font-weight: 700; color: #334155; }
.producto { display: grid; gap: 2px; min-width: 0; }
.nombre { font-size: 15px; font-weight: 800; line-height: 1.25; color: #14244A; overflow-wrap: anywhere; }
.campo-libre { height: 38px; font-weight: 800; }
.nota, .error-linea { display: flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 800; }
.nota { color: #8A4B00; }
.error-linea { color: #A83232; }
.cantidad { display: grid; justify-items: end; gap: 2px; }
.cant { width: 100%; height: 38px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 10px; text-align: right; font-size: 16px; font-weight: 900; color: #14244A; background: #fff; font-variant-numeric: tabular-nums; }
.cant:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.cant.cambiada { border-color: #E8930C; background: #FFF8EB; }
.unidad { font-size: 11.5px; font-weight: 700; color: #64748B; }
.unidad-libre { height: 26px; padding: 0 6px; border: 2px solid #E2E8F0; border-radius: 8px; font-size: 12.5px; font-weight: 700; color: #334155; background: #fff; }
.quitar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #94A3B8; }
.quitar:hover { background: #FDECEC; color: #A83232; }
/* Teléfono: el nombre a lo ancho; debajo, la cantidad. Los datos se ocultan. */
@media (max-width: 640px) {
  .fila { grid-template-columns: minmax(0, 1fr) 96px 34px; padding: 8px 8px 8px 10px; }
  .fila .dato { display: none; }
}
</style>
