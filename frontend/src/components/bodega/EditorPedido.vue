<script setup>
import { ref, computed, nextTick, watch } from 'vue';
import Icono from '../comunes/Icono.vue';
import BuscadorInsumo from './diseno/BuscadorInsumo.vue';
import CrearInsumoRapido from './CrearInsumoRapido.vue';
import { miles } from './diseno/PiezasBodega';

/**
 * Lista de lo que se pide, igual en todas las requisiciones (encargado de
 * servicio, farmacia y bodega hacia la DDRISS). Viene llena; la persona solo:
 *   - cambia la cantidad con − / + o escribiéndola,
 *   - regresa a lo sugerido con un toque,
 *   - quita un renglón (y lo puede deshacer),
 *   - agrega otro producto con el buscador.
 * Funciona igual con el dedo en el celular que con el ratón.
 *
 * Cada renglón: { insumoId, nombre, unidad, cantidad (texto), sugerido,
 *   detalle (texto opcional), aviso (texto opcional), tono (opcional) }.
 *
 * Si lo que se pide no está en el sistema hay dos salidas: crear el producto
 * (solo bodega, con `puedeCrear`) o pedirlo como artículo libre, escrito a
 * mano: { insumoId: null, clave, libre: true, nombre, unidad, cantidad }.
 */
const lineas = defineModel({ type: Array, required: true });
const props = defineProps({
  catalogo: { type: Array, default: () => [] }, // [{ id, nombreGenerico, ... }]
  titulo: { type: String, default: 'Qué pedir' },
  vacio: { type: String, default: 'No hay nada sugerido. Agregue lo que necesite.' },
  // Para agregar: arma el renglón nuevo a partir del producto elegido.
  nuevoRenglon: { type: Function, default: (i) => ({ insumoId: i.id, nombre: i.nombreGenerico, unidad: '', cantidad: '', sugerido: 0 }) },
  // Errores del servidor por renglón: { insumoId: mensaje }. Se marcan en rojo.
  errores: { type: Object, default: () => ({}) },
  // Bodega y administración pueden crear el producto ahí mismo.
  puedeCrear: { type: Boolean, default: false },
});
const emit = defineEmits(['volverALlenar', 'creado']);

// Cada renglón se reconoce por su producto o, si es libre, por su clave.
const llave = (l) => l.insumoId ?? l.clave;
const creando = ref(false);

const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;
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
  document.getElementById(`cant-${primero}`)?.closest('.linea')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

const aPedir = computed(() => lineas.value.filter((l) => entero(l.cantidad) > 0));
const totalUnidades = computed(() => aPedir.value.reduce((s, l) => s + entero(l.cantidad), 0));
const visibles = computed(() => {
  const q = buscar.value.trim().toLowerCase();
  return q ? lineas.value.filter((l) => l.libre || l.nombre.toLowerCase().includes(q)) : lineas.value;
});

function cambiar(l, paso) {
  l.cantidad = String(Math.max(0, entero(l.cantidad) + paso));
}
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

async function enfocar(insumoId) {
  resaltado.value = insumoId;
  await nextTick();
  const campo = document.getElementById(`cant-${insumoId}`);
  campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  campo?.focus();
  campo?.select();
  setTimeout(() => { if (resaltado.value === insumoId) resaltado.value = null; }, 1600);
}
function agregar(i) {
  buscar.value = '';
  // Si ya está, no se repite: se lleva a ese renglón.
  if (!lineas.value.some((l) => l.insumoId === i.id)) lineas.value.push(props.nuevoRenglon(i));
  enfocar(i.id);
}
async function agregarLibre() {
  buscar.value = '';
  const clave = `libre-${Date.now()}`;
  lineas.value.push({ insumoId: null, clave, libre: true, nombre: '', unidad: 'Unidad', cantidad: '', sugerido: 0 });
  await nextTick();
  const campo = document.getElementById(`nombre-${clave}`);
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
      <div>
        <h2>{{ titulo }}</h2>
        <p>{{ aPedir.length }} {{ aPedir.length === 1 ? 'producto' : 'productos' }} · {{ miles(totalUnidades) }} unidades</p>
      </div>
      <button type="button" class="b-btn chico secundario" @click="emit('volverALlenar')"><Icono nombre="actualizar" :tamano="16" /> Volver a llenar</button>
    </header>

    <!-- Agregar va arriba: se ve sin bajar hasta el final de la lista. -->
    <div class="agregar">
      <BuscadorInsumo :insumos="catalogo" placeholder="Agregar otro producto: escriba su nombre" @elegir="agregar" />
      <div class="no-esta">
        <span>¿No aparece?</span>
        <button v-if="puedeCrear" type="button" @click="creando = true"><Icono nombre="agregar" :tamano="16" :grosor="2.6" /> Crear producto nuevo</button>
        <button type="button" @click="agregarLibre"><Icono nombre="lapiz" :tamano="16" /> Escribirlo a mano</button>
      </div>
    </div>
    <CrearInsumoRapido v-if="creando" @creado="creado" @cerrar="creando = false" />

    <label v-if="lineas.length > 10" class="filtro">
      <Icono nombre="buscar" :tamano="18" />
      <input v-model="buscar" type="search" placeholder="Buscar en la lista" aria-label="Buscar en la lista" />
    </label>

    <p v-if="quitado" class="deshacer" role="status">
      Quitó <b>{{ quitado.linea.nombre }}</b>
      <button type="button" @click="deshacer">Deshacer</button>
    </p>

    <ul v-if="visibles.length" class="lineas">
      <li v-for="l in visibles" :key="llave(l)" class="linea" :class="{ cero: !entero(l.cantidad), resaltado: resaltado === llave(l), error: errores[llave(l)], libre: l.libre, [l.tono ?? '']: true }">
        <div class="info">
          <template v-if="l.libre">
            <span class="marca-libre">No está en el sistema</span>
            <input :id="`nombre-${l.clave}`" v-model="l.nombre" class="b-campo campo-libre" maxlength="200" placeholder="Qué se pide: nombre, concentración y forma" aria-label="Qué se pide" />
          </template>
          <b v-else class="nombre">{{ l.nombre }}</b>
          <p v-if="l.detalle" class="detalle">{{ l.detalle }}</p>
          <p v-if="l.aviso && entero(l.cantidad)" class="nota-linea"><Icono nombre="alerta" :tamano="15" :grosor="2.4" /> {{ l.aviso }}</p>
          <p v-if="!entero(l.cantidad)" class="no-va">En cero: no se pide</p>
          <p v-if="errores[llave(l)]" class="error-linea"><Icono nombre="alerta" :tamano="15" :grosor="2.4" /> {{ errores[llave(l)] }}</p>
        </div>

        <div class="cantidad">
          <div class="paso">
            <button type="button" :aria-label="`Uno menos de ${l.nombre}`" :disabled="!entero(l.cantidad)" @click="cambiar(l, -1)">−</button>
            <input
              :id="`cant-${llave(l)}`" v-model="l.cantidad" type="text" inputmode="numeric" placeholder="0"
              :aria-label="`Cantidad de ${l.nombre}`" @focus="$event.target.select()" @blur="limpiar(l)"
            />
            <button type="button" :aria-label="`Uno más de ${l.nombre}`" @click="cambiar(l, 1)">+</button>
          </div>
          <select v-if="l.libre" v-model="l.unidad" class="unidad-libre" :aria-label="`Unidad de ${l.nombre || 'lo que se pide'}`">
            <option v-for="u in ['Unidad', 'Tableta', 'Cápsula', 'Frasco', 'Ampolla', 'Vial', 'Sobre', 'Tubo', 'Caja', 'Rollo', 'Par']" :key="u">{{ u }}</option>
          </select>
          <span v-else class="unidad">{{ l.unidad }}</span>
          <button v-if="l.sugerido && entero(l.cantidad) !== l.sugerido" type="button" class="sugerido" @click="l.cantidad = String(l.sugerido)">
            Sugerido: {{ miles(l.sugerido) }}
          </button>
        </div>

        <button type="button" class="quitar" :aria-label="`Quitar ${l.nombre}`" title="Quitar de la lista" @click="quitar(l)">
          <Icono nombre="cerrar" :tamano="18" :grosor="2.4" />
        </button>
      </li>
    </ul>
    <p v-else class="b-vacio">{{ buscar ? 'Ningún producto de la lista con ese nombre.' : vacio }}</p>
  </section>
</template>

<style scoped>
.editor { display: grid; gap: 12px; padding: 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.cabeza { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.cabeza h2 { font-size: 19px; font-weight: 900; color: #14244A; }
.cabeza p { font-size: 14px; font-weight: 700; color: #64748B; }
.agregar { padding: 10px; border: 2px dashed #CBD5E1; border-radius: 16px; background: #F8FAFC; }
.filtro { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 12px; border: 2px solid #E2E8F0; border-radius: 12px; color: #64748B; }
.filtro input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; font-size: 16px; background: transparent; }
.deshacer { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; background: #14244A; color: #fff; font-size: 14px; }
.deshacer b { font-weight: 800; }
.deshacer button { margin-left: auto; padding: 4px 12px; border-radius: 9px; background: #fff; color: #14244A; font-weight: 900; }
.lineas { display: grid; gap: 8px; }
.linea { display: grid; grid-template-columns: minmax(0, 1fr) auto 40px; align-items: center; gap: 12px; padding: 12px 12px 12px 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px; transition: background .2s, border-color .2s; }
.linea.critico { box-shadow: inset 6px 0 0 #D64545; }
.linea.atencion { box-shadow: inset 6px 0 0 #E8930C; }
.linea.cero { background: #F8FAFC; }
.linea.cero .nombre { color: #94A3B8; }
.linea.error { border-color: #D64545; background: #FFF5F5; }
.error-linea { display: flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 13.5px; font-weight: 800; color: #A83232; }
.linea.libre { border-style: dashed; }
.marca-libre { display: inline-block; margin-bottom: 4px; padding: 1px 8px; border-radius: 7px; background: #FEF3C7; color: #8A4B00; font-size: 12px; font-weight: 800; }
.campo-libre { font-weight: 800; }
.unidad-libre { height: 28px; padding: 0 6px; border: 2px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 700; color: #334155; background: #fff; }
.no-esta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: 8px; font-size: 14px; font-weight: 700; color: #64748B; }
.no-esta button { display: inline-flex; align-items: center; gap: 5px; height: 36px; padding: 0 12px; border: 2px solid #CBD5E1; border-bottom-width: 3px; border-radius: 11px; background: #fff; color: #174E80; font-weight: 800; }
.linea.resaltado { border-color: #4A9BD6; background: #EAF3FB; }
.nombre { display: block; font-size: 17px; font-weight: 900; line-height: 1.25; color: #14244A; overflow-wrap: anywhere; }
.detalle { margin-top: 2px; font-size: 14px; font-weight: 600; color: #475569; }
.nota-linea { display: flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 13px; font-weight: 700; color: #8A4B00; }
.no-va { margin-top: 2px; font-size: 13px; font-weight: 800; color: #94A3B8; }
.cantidad { display: grid; justify-items: center; gap: 3px; }
.paso { display: flex; align-items: stretch; height: 52px; border: 2px solid #CBD5E1; border-radius: 14px; overflow: hidden; background: #fff; }
.paso:focus-within { border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.paso button { width: 46px; font-size: 26px; font-weight: 700; color: #172A5A; background: #F1F5F9; }
.paso button:active { background: #DCE4F5; }
.paso button:disabled { color: #CBD5E1; }
.paso input { width: 76px; min-width: 0; border: 0; outline: 0; text-align: center; font-size: 22px; font-weight: 900; font-variant-numeric: tabular-nums; color: #14244A; }
.unidad { font-size: 12px; font-weight: 700; color: #64748B; }
.sugerido { padding: 2px 10px; border-radius: 8px; background: #EAF3FB; color: #174E80; font-size: 12.5px; font-weight: 800; }
.quitar { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: #94A3B8; }
.quitar:hover { background: #FDECEC; color: #A83232; }
/* Celular: el nombre arriba y la cantidad abajo, al ancho de la tarjeta. */
@media (max-width: 640px) {
  .linea { grid-template-columns: minmax(0, 1fr) 40px; padding: 12px; }
  .info { grid-column: 1; }
  .quitar { grid-column: 2; grid-row: 1; align-self: start; }
  .cantidad { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
  .paso { flex: 1 1 100%; height: 56px; }
  .paso button { flex: 0 0 64px; width: 64px; }
  .paso input { flex: 1 1 auto; width: 0; }
}
</style>
