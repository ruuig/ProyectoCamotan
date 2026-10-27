<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import servicio from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import NavTramites from '../../components/bodega/NavTramites.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Bajas de inventario: lo vencido o dañado sale de la bodega en un solo paso,
 * y queda en la lista de bajas hechas.
 */
const bajas = ref([]);
const candidatos = ref([]);
const error = ref('');
const aviso = ref('');
const cargando = ref(true);
const enviando = ref(false);

const elegido = ref(null);
const f = reactive({ cantidad: '', causa: '' });

async function cargar() {
  cargando.value = true;
  try {
    const [hechas, sugeridos] = await Promise.all([servicio.bajas(), servicio.candidatosBaja()]);
    bajas.value = hechas.bajas;
    candidatos.value = sugeridos.lotes;
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

function elegir(lote) {
  elegido.value = lote;
  Object.assign(f, { cantidad: lote.cantidadActual, causa: lote.causaSugerida });
}

const cantidad = computed(() => Number(String(f.cantidad).replace(/[^\d]/g, '')));

async function darDeBaja() {
  enviando.value = true;
  error.value = '';
  aviso.value = '';
  try {
    await servicio.darDeBaja({ loteId: elegido.value.loteId, cantidad: cantidad.value, causa: f.causa });
    aviso.value = `Baja: ${miles(cantidad.value)} de ${elegido.value.insumo}, lote ${elegido.value.numeroLote}.`;
    elegido.value = null;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const CAUSAS = [['producto_vencido', 'Vencido'], ['producto_danado', 'Dañado']];
const semaforoDe = (l) => (new Date(l.fechaVence) < new Date() ? 'vencido' : 'rojo');
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT') : '');

onMounted(cargar);
</script>

<template>
  <section>
    <header class="b-cabecera">
      <h1 class="b-titulo">Bajas y retiros</h1>
      <NavTramites />
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4">{{ aviso }}</p>

    <p v-if="cargando" class="b-vacio">Cargando…</p>

    <div v-else class="rejilla mt-5">
      <!-- Lotes vencidos o en cuarentena -->
      <section class="b-panel">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">Por dar de baja</h2>
          <span class="b-contador gris">{{ candidatos.length }}</span>
        </header>
        <ul v-if="candidatos.length" class="lista space-y-2 p-3">
          <li v-for="l in candidatos" :key="l.loteId">
            <div class="flex items-center gap-2">
              <div class="b-boleto flex-1" :class="{ vacio: elegido?.loteId === l.loteId }">
                <span class="min-w-0">
                  <span class="block nombre-completo font-semibold text-tinta">{{ l.insumo }}</span>
                  <span class="mt-0.5 flex items-center gap-2">
                    <span class="codigo text-[13px]">{{ l.numeroLote }}</span>
                    <span v-if="l.estado !== 'vencido'" class="b-estado" :class="l.estado">{{ l.estado }}</span>
                  </span>
                </span>
                <span class="cant">{{ miles(l.cantidadActual) }}</span>
                <SelloVence :fecha="l.fechaVence" :semaforo="semaforoDe(l)" />
              </div>
              <button v-if="elegido?.loteId !== l.loteId" type="button" data-accion class="b-btn secundario chico" @click="elegir(l)">Dar de baja</button>
            </div>

            <form v-if="elegido?.loteId === l.loteId" data-accion class="baja" @submit.prevent="darDeBaja">
              <div class="w-32">
                <label :for="`cant-${l.loteId}`" class="b-etiqueta">Cantidad</label>
                <input :id="`cant-${l.loteId}`" v-model="f.cantidad" inputmode="numeric" required class="b-campo num" />
              </div>
              <div class="min-w-[12rem] flex-1">
                <span class="b-etiqueta">Causa</span>
                <div class="b-segmentado w-full" role="radiogroup" aria-label="Causa">
                  <button v-for="c in CAUSAS" :key="c[0]" type="button" role="radio" class="flex-1" :aria-checked="f.causa === c[0]" :class="f.causa === c[0] ? 'on' : ''" @click="f.causa = c[0]">{{ c[1] }}</button>
                </div>
              </div>
              <div class="flex gap-2 self-end">
                <button type="button" class="b-btn secundario" @click="elegido = null">Cancelar</button>
                <button type="submit" class="b-btn peligro" :disabled="enviando || !f.causa || !cantidad || cantidad > l.cantidadActual">
                  <Icono nombre="quitar" :tamano="18" /> {{ enviando ? 'Guardando…' : 'Dar de baja' }}
                </button>
              </div>
            </form>
          </li>
        </ul>
        <p v-else class="b-vacio">Nada por dar de baja.</p>
      </section>

      <!-- Bajas hechas -->
      <section class="b-panel">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">Bajas hechas</h2>
          <span class="b-contador gris">{{ bajas.length }}</span>
        </header>
        <ul v-if="bajas.length" class="lista">
          <li v-for="b in bajas" :key="b.id" class="hecha">
            <span class="min-w-0 flex-1">
              <span class="block nombre-completo font-semibold text-tinta">{{ b.insumo }}</span>
              <span class="text-[13px] text-apagado">Lote <span class="font-mono">{{ b.numeroLote }}</span> · {{ b.causaEtiqueta }} · {{ fecha(b.hechaEn) }} · {{ b.hechaPor }}</span>
            </span>
            <b class="tabular-nums text-tinta">{{ miles(b.cantidad) }}</b>
          </li>
        </ul>
        <p v-else class="b-vacio">Ninguna.</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.lista { max-height: max(380px, calc(100vh - 300px)); overflow-y: auto; }
.baja { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; padding: 12px 14px; border: 2px solid #F3C5C5; border-radius: 14px; background: #FFF8F8; }
.hecha { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-top: 1px solid #EEF2F6; }
.hecha:first-child { border-top: none; }
</style>
