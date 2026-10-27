<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import servicio from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import SelectorMes from '../../components/bodega/SelectorMes.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { cierre, nombrePeriodo } from '../../dominio/bodega';

/**
 * Conteo físico de la bodega, una vez al mes (el «Exis Fisic» del balance).
 *
 * El conteo es ciego: la hoja trae producto, lote y vencimiento, pero no lo
 * que el sistema cree que hay. Cada cantidad se guarda al escribirla, así se
 * puede contar en varias vueltas. Al cerrar, toda diferencia se ajusta y
 * queda en el kardex como reajuste por inventario físico.
 */
const hoja = ref([]);
const inventario = ref(null);
const contado = ref({});
const guardados = ref({});
const resultado = ref(null);
const cargando = ref(true);
const enviando = ref(false);
const confirmando = ref(false);
const error = ref('');
const buscar = ref('');

/** La cantidad escrita: acepta cajas, 3x100+27 = 327. Vacío es «sin contar». */
function entero(v) {
  const t = String(v ?? '').replace(/\s/g, '').replace(/[×*X]/g, 'x');
  if (!t) return null;
  if (!/^[0-9x+]+$/.test(t)) return Number(t.replace(/[^0-9]/g, '')) || 0;
  return t.split('+').filter(Boolean).reduce((s, termino) => s + termino.split('x').filter(Boolean).reduce((m, n) => m * Number(n), 1), 0);
}
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const vence = (f) => new Date(f).toLocaleDateString('es-GT', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });

async function cargar() {
  cargando.value = true;
  error.value = '';
  resultado.value = null;
  try {
    const [h, inv] = await Promise.all([servicio.hojaDeConteo(), servicio.inventarioFisico(cierre.periodo)]);
    hoja.value = h.lotes;
    inventario.value = inv.inventario;
    const previos = {};
    for (const c of inv.inventario?.conteos ?? []) previos[c.loteId] = c.cantidadContada;
    contado.value = Object.fromEntries(Object.entries(previos).map(([k, v]) => [k, String(v)]));
    guardados.value = { ...previos };
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}
onMounted(cargar);
watch(() => cierre.periodo, cargar);

const abierto = computed(() => inventario.value?.estado === 'abierto');
const cerrado = computed(() => inventario.value?.estado === 'cerrado');

// Los lotes agrupados por producto, en orden alfabético como la hoja.
const productos = computed(() => {
  const clave = sinTildes(buscar.value.trim());
  const grupos = new Map();
  for (const l of hoja.value) {
    if (clave && !sinTildes(`${l.insumo.nombreGenerico} ${l.numeroLote}`).includes(clave)) continue;
    if (!grupos.has(l.insumo.id)) grupos.set(l.insumo.id, { insumo: l.insumo, lotes: [] });
    grupos.get(l.insumo.id).lotes.push(l);
  }
  return [...grupos.values()];
});
const contados = computed(() => hoja.value.filter((l) => guardados.value[l.loteId] !== undefined).length);

async function empezar() {
  enviando.value = true;
  error.value = '';
  try {
    inventario.value = (await servicio.abrirInventarioFisico(cierre.periodo)).inventario;
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

// Cada cantidad se guarda al salir de la casilla.
async function guardar(l) {
  const n = entero(contado.value[l.loteId]);
  if (n === null || n === guardados.value[l.loteId]) return;
  try {
    await servicio.registrarConteo(inventario.value.id, [{ loteId: l.loteId, cantidadContada: n }]);
    guardados.value = { ...guardados.value, [l.loteId]: n };
    contado.value[l.loteId] = String(n);
  } catch (fallo) {
    error.value = `${l.insumo.nombreGenerico}, lote ${l.numeroLote}: ${fallo.message}`;
  }
}

async function cerrarConteo() {
  enviando.value = true;
  error.value = '';
  try {
    resultado.value = await servicio.cerrarInventarioFisico(inventario.value.id);
    confirmando.value = false;
    inventario.value = (await servicio.inventarioFisico(cierre.periodo)).inventario;
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

// Ya cerrado: lo que no cuadró, con lo que había en el sistema y lo contado.
const diferencias = computed(() => (inventario.value?.conteos ?? [])
  .filter((c) => c.diferencia)
  .map((c) => ({ ...c, nombre: c.lote.insumo.nombreGenerico, numeroLote: c.lote.numeroLote, unidad: c.lote.insumo.unidadEntrega }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">Conteo físico</h1>
        <SelectorMes v-model="cierre.periodo" etiqueta="Mes del conteo" />
      </div>
      <div v-if="abierto" class="b-acciones">
        <span class="avance"><b>{{ miles(contados) }}</b> / {{ miles(hoja.length) }} lotes</span>
        <button type="button" data-accion class="b-btn primario" :disabled="!contados || enviando" @click="confirmando = true">
          <Icono nombre="correcto" :tamano="20" /> Cerrar conteo
        </button>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="cargando" class="b-vacio">Cargando…</p>

    <!-- Sin empezar -->
    <section v-else-if="!inventario" class="b-panel mt-5 empezar">
      <p class="text-lg font-bold text-tinta">{{ nombrePeriodo(cierre.periodo) }} · {{ miles(hoja.length) }} lotes por contar</p>
      <button type="button" data-accion class="b-btn primario grande" :disabled="enviando" @click="empezar">
        <Icono nombre="hojaCalculo" :tamano="22" /> Empezar el conteo
      </button>
    </section>

    <!-- Contando -->
    <template v-else-if="abierto">
      <label class="b-buscar mt-4 block">
        <Icono nombre="buscar" :tamano="20" />
        <input v-model="buscar" type="search" class="b-campo" placeholder="Buscar producto o lote" aria-label="Buscar producto o lote" />
      </label>
      <div class="tabla mt-3">
        <div class="fila cabeza"><span>Producto</span><span>Lote</span><span>Vence</span><span class="n">Contado</span></div>
        <template v-for="p in productos" :key="p.insumo.id">
          <div v-for="(l, k) in p.lotes" :key="l.loteId" class="fila" :class="{ primero: k === 0, hecho: guardados[l.loteId] !== undefined }">
            <span class="nombre">{{ k === 0 ? p.insumo.nombreGenerico : '' }}<small v-if="k === 0"> {{ p.insumo.unidadEntrega }}</small></span>
            <span class="lote">{{ l.numeroLote }}<small v-if="l.estado !== 'disponible'"> · {{ l.estado }}</small></span>
            <span class="vence">{{ l.numeroLote === 'SIN-LOTE' ? '—' : vence(l.fechaVence) }}</span>
            <input v-model="contado[l.loteId]" inputmode="numeric" class="cant" :aria-label="`Contado de ${p.insumo.nombreGenerico}, lote ${l.numeroLote}`" @blur="guardar(l)" @keydown.enter="$event.target.blur()" />
          </div>
        </template>
        <p v-if="!productos.length" class="b-vacio">Ninguno.</p>
      </div>
    </template>

    <!-- Cerrado -->
    <template v-else-if="cerrado">
      <section class="b-panel mt-5">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">{{ nombrePeriodo(cierre.periodo) }} · cerrado</h2>
          <span class="b-contador gris">{{ inventario.conteos.length }} lotes contados</span>
        </header>
        <div v-if="diferencias.length" class="tabla m-3">
          <div class="fila dif cabeza"><span>Producto</span><span>Lote</span><span class="n">Sistema</span><span class="n">Contado</span><span class="n">Diferencia</span></div>
          <div v-for="d in diferencias" :key="d.id" class="fila dif">
            <span class="nombre">{{ d.nombre }}</span>
            <span class="lote">{{ d.numeroLote }}</span>
            <span class="n">{{ miles(d.saldoSistema) }}</span>
            <span class="n">{{ miles(d.cantidadContada) }}</span>
            <b class="n" :class="d.diferencia < 0 ? 'menos' : 'mas'">{{ d.diferencia > 0 ? '+' : '' }}{{ miles(d.diferencia) }}</b>
          </div>
        </div>
        <p v-else class="b-vacio">Todo cuadró.</p>
      </section>
    </template>

    <!-- Confirmar el cierre -->
    <div v-if="confirmando" class="velo" role="dialog" aria-modal="true" aria-labelledby="titulo-cierre-conteo" @click.self="confirmando = false" @keydown.esc="confirmando = false">
      <div class="ventana">
        <h2 id="titulo-cierre-conteo">Cerrar el conteo de {{ nombrePeriodo(cierre.periodo) }}</h2>
        <ul class="efectos">
          <li>{{ miles(contados) }} lotes contados<template v-if="hoja.length - contados"> · {{ miles(hoja.length - contados) }} sin contar quedan como están</template></li>
          <li>Cada diferencia se ajusta en el kardex como reajuste por inventario físico.</li>
          <li>No se puede deshacer.</li>
        </ul>
        <footer>
          <button type="button" class="b-btn secundario" @click="confirmando = false">Seguir contando</button>
          <button type="button" class="b-btn exito" :disabled="enviando" @click="cerrarConteo">{{ enviando ? 'Cerrando…' : 'Cerrar conteo' }}</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.avance { font-size: 15px; font-weight: 700; color: #475569; }
.avance b { font-size: 20px; color: #14244A; }
.empezar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 22px; }
.tabla { border: 2px solid #E5E9F0; border-radius: 16px; overflow: hidden; background: #fff; }
.fila { display: grid; grid-template-columns: minmax(0, 1fr) 170px 90px 130px; align-items: center; gap: 12px; padding: 6px 14px; border-top: 1px solid #F1F4F8; }
.fila.primero { border-top: 2px solid #E5E9F0; }
.fila.cabeza { border-top: 0; background: #F1F5F9; font-size: 12px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.fila.dif { grid-template-columns: minmax(0, 1fr) 150px 100px 100px 100px; }
.nombre { min-width: 0; font-size: 15px; font-weight: 800; color: #14244A; overflow-wrap: anywhere; }
.nombre small { font-weight: 600; color: #64748B; }
.lote { font-family: ui-monospace, monospace; font-size: 13.5px; font-weight: 700; color: #334155; }
.lote small { font-family: inherit; color: #B7710A; }
.vence { font-size: 13.5px; font-weight: 600; color: #475569; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
.cant { width: 100%; height: 40px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 12px; text-align: right; font-size: 16px; font-weight: 900; color: #14244A; }
.cant:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.fila.hecho .cant { border-color: #8FD1AE; background: #F2FBF6; }
.menos { color: #A83232; }
.mas { color: #1E6E45; }
.velo { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .5); }
.ventana { display: grid; gap: 14px; width: min(480px, 100%); padding: 22px; border-radius: 22px; background: #fff; }
.ventana h2 { font-size: 21px; font-weight: 900; color: #14244A; }
.efectos { display: grid; gap: 8px; font-weight: 600; color: #334155; }
.ventana footer { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 760px) { .fila { grid-template-columns: minmax(0, 1fr) 110px 100px; } .fila .vence { display: none; } }
</style>
