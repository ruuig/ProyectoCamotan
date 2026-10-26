<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import PasosCierre from '../../components/bodega/PasosCierre.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import { CATEGORIA, estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';
import { cierre } from '../../dominio/bodega';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();

/**
 * Paso 2 del cierre: inventario de cierre de la bodega, como el que el centro
 * lleva en su Excel. Saldo anterior, entradas, entregado y saldo actual; sale
 * solo de los movimientos del mes, nadie lo llena a mano.
 */
const datos = ref(null);
const error = ref('');
const buscar = ref('');
const categoriaFiltro = ref('');
const soloMovimiento = ref(true);

async function cargar() {
  error.value = '';
  try {
    datos.value = await bodega.inventarioCierre({ periodo: cierre.periodo });
  } catch (fallo) {
    error.value = fallo.message;
  }
}
watch(() => cierre.periodo, cargar);
onMounted(cargar);

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const filas = computed(() => {
  const clave = sinTildes(buscar.value.trim());
  return (datos.value?.filas ?? [])
    .filter((f) => !soloMovimiento.value || f.saldoAnterior || f.entradas || f.entregado || f.reajustes || f.saldoActual)
    .filter((f) => !categoriaFiltro.value || f.categoria === categoriaFiltro.value)
    .filter((f) => !clave || sinTildes(`${f.nombre} ${f.codigoInterno}`).includes(clave));
});

const n = (v) => (v ? miles(v) : '–');
const delExcel = computed(() => datos.value?.fuente === 'excel');
</script>

<template>
  <section>
    <PasosCierre :estado="{ inventario: datos ? `Corte día ${datos.diaCorte}` : '' }">
      <template #acciones>
        <RouterLink :to="`/imprimir/cierre/${cierre.periodo}`" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> Imprimir</RouterLink>
      </template>
    </PasosCierre>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <template v-if="datos">
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <label class="b-buscar w-full sm:w-[210px]">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" class="b-campo" placeholder="Buscar insumo" aria-label="Buscar insumo" />
        </label>
        <button
          v-for="(c, clave) in CATEGORIA"
          :key="clave"
          type="button"
          class="b-ficha-cat"
          :class="categoriaFiltro === clave ? 'on' : ''"
          :style="estiloCategoria(clave)"
          @click="categoriaFiltro = categoriaFiltro === clave ? '' : clave"
        >
          <span class="ic"><Pictograma :categoria="clave" :grosor="2" /></span>
          {{ c.corto }}
        </button>
      </div>

      <div class="mt-3 flex items-center justify-between gap-3">
        <span class="text-sm font-bold text-apagado">{{ filas.length }} insumos<template v-if="delExcel"> · del Excel</template></span>
        <div class="b-segmentado" role="radiogroup" aria-label="Insumos">
          <button v-for="o in [[true, 'Con existencia o movimiento'], [false, 'Todos']]" :key="String(o[0])" type="button" role="radio" :aria-checked="soloMovimiento === o[0]" :class="soloMovimiento === o[0] ? 'on' : ''" @click="soloMovimiento = o[0]">{{ o[1] }}</button>
        </div>
      </div>

      <div class="b-tabla-marco alta mt-2">
        <table class="b-tabla">
          <thead>
            <tr>
              <th>Insumo</th>
              <th class="n">Saldo anterior</th>
              <th class="n">Entradas</th>
              <th class="n">Entregado</th>
              <th v-if="!delExcel" class="n">Reajustes</th>
              <th class="n">Saldo actual</th>
              <th class="n" :title="`Saldo actual entre ${datos?.lugaresReparto ?? 32} lugares`">A cada lugar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in filas" :key="f.insumoId">
              <td>
                <RouterLink :to="`/inventario/${f.insumoId}`" class="flex items-center gap-2.5" :style="estiloCategoria(f.categoria)">
                  <span class="cat-mini"><Pictograma :categoria="f.categoria" :grosor="2" /></span>
                  <span class="font-semibold text-tinta hover:underline">{{ f.nombre }}</span>
                </RouterLink>
              </td>
              <td class="n" :class="!f.saldoAnterior ? 'cero' : ''">{{ n(f.saldoAnterior) }}</td>
              <td class="n" :class="!f.entradas ? 'cero' : ''">{{ n(f.entradas) }}</td>
              <td class="n" :class="!f.entregado ? 'cero' : ''">{{ n(f.entregado) }}</td>
              <td v-if="!delExcel" class="n" :class="!f.reajustes ? 'cero' : f.reajustes < 0 ? 'text-[#C03535]' : ''">{{ f.reajustes ? `${f.reajustes > 0 ? '+' : ''}${miles(f.reajustes)}` : '–' }}</td>
              <td class="n fuerte" :class="!f.saldoActual ? 'cero' : ''">{{ n(f.saldoActual) }}</td>
              <td class="n" :class="!f.porLugar ? 'cero' : ''">{{ n(f.porLugar) }}</td>
            </tr>
            <tr v-if="!filas.length"><td colspan="7" class="b-vacio">Ningún insumo coincide.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Quién firma -->
      <div class="firmas mt-4">
        <div>
          <p class="b-subtitulo">Firma</p>
          <p class="font-semibold text-tinta">{{ datos.firmas?.encargadoBodega || 'Sin nombre' }}</p>
          <p class="text-sm text-apagado">{{ datos.firmas?.cargoEncargadoBodega }}</p>
        </div>
        <div>
          <p class="b-subtitulo">Visto bueno</p>
          <p class="font-semibold text-tinta">{{ datos.firmas?.coordinadorMunicipal || 'Sin nombre' }}</p>
          <p class="text-sm text-apagado">{{ datos.firmas?.cargoCoordinador }}</p>
        </div>
        <RouterLink v-if="auth.rol === 'admin'" to="/administracion?pestana=firmas" class="b-btn secundario chico self-center"><Icono nombre="lapiz" :tamano="16" /> Editar firmas</RouterLink>
      </div>
    </template>
    <p v-else-if="!error" class="b-vacio">Calculando…</p>
  </section>
</template>

<style scoped>
.alta { max-height: max(360px, calc(100vh - 560px)); }
.firmas { display: flex; flex-wrap: wrap; gap: 16px 48px; padding: 14px 18px; border: 2px solid #E2E8F0; border-radius: 14px; }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; border-radius: 7px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 15px; height: 15px; }
</style>
