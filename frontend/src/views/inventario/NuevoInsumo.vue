<script setup>
import { reactive, ref } from 'vue';
import { useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import { CATEGORIA, estiloCategoria } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Alta de un insumo en el catálogo único. El código interno lo da el sistema:
 * ningún insumo se identifica por su fila ni por el nombre del proveedor.
 */
const router = useRouter();
const error = ref('');
const detalles = ref([]);
const guardando = ref(false);

const form = reactive({
  nombreGenerico: '',
  formaFarmaceutica: '',
  concentracion: '',
  presentacion: '',
  unidadMedida: '',
  unidadEntrega: '',
  unidadesPorEmpaque: 1,
  categoria: '',
  codigoMspas: '',
  codigoBarras: '',
  costoReferencia: '',
  nombreComercial: '',
  perecedero: true,
  cadenaFrio: false,
});

const nulo = (v) => (v === '' ? null : v);

async function guardar() {
  error.value = '';
  detalles.value = [];
  guardando.value = true;
  try {
    const r = await servicio.crearInsumo({
      ...form,
      formaFarmaceutica: nulo(form.formaFarmaceutica),
      concentracion: nulo(form.concentracion),
      unidadEntrega: nulo(form.unidadEntrega),
      codigoMspas: nulo(form.codigoMspas),
      codigoBarras: nulo(form.codigoBarras),
      costoReferencia: form.costoReferencia === '' ? null : Number(String(form.costoReferencia).replace(',', '.')),
      nombreComercial: nulo(form.nombreComercial),
      unidadesPorEmpaque: Number(String(form.unidadesPorEmpaque).replace(/[^\d]/g, '')) || 1,
    });
    router.push(`/inventario/${r.insumo.id}`);
  } catch (fallo) {
    error.value = fallo.message;
    detalles.value = Array.isArray(fallo.detalles) ? fallo.detalles : [];
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <section>
    <RouterLink to="/inventario" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Existencias</RouterLink>
    <header class="b-cabecera">
      <h1 class="b-titulo">Nuevo insumo</h1>
    </header>

    <form class="rejilla mt-5" @submit.prevent="guardar">
      <div class="space-y-5">
        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Categoría</h2></header>
          <div class="b-panel-cuerpo mosaicos" role="radiogroup" aria-label="Categoría">
            <button
              v-for="(c, clave) in CATEGORIA"
              :key="clave"
              type="button"
              role="radio"
              class="mosaico"
              :class="form.categoria === clave ? 'on' : ''"
              :style="estiloCategoria(clave)"
              :aria-checked="form.categoria === clave"
              @click="form.categoria = clave"
            >
              <span class="lomo-m"><Pictograma :categoria="clave" /></span>
              <span class="px-3 text-left font-semibold leading-tight">{{ c.nombre }}</span>
            </button>
          </div>
        </section>

        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Identificación</h2></header>
          <div class="b-panel-cuerpo grid gap-4 sm:grid-cols-3">
            <div class="sm:col-span-3">
              <label for="nombreGenerico" class="b-etiqueta">Nombre genérico</label>
              <input id="nombreGenerico" v-model="form.nombreGenerico" required maxlength="160" class="b-campo" />
            </div>
            <div>
              <label for="forma" class="b-etiqueta">Forma farmacéutica</label>
              <input id="forma" v-model="form.formaFarmaceutica" maxlength="40" placeholder="Tableta, jarabe…" class="b-campo" />
            </div>
            <div>
              <label for="concentracion" class="b-etiqueta">Concentración</label>
              <input id="concentracion" v-model="form.concentracion" maxlength="40" placeholder="500 mg" class="b-campo" />
            </div>
            <div>
              <label for="nombreComercial" class="b-etiqueta">Nombre comercial</label>
              <input id="nombreComercial" v-model="form.nombreComercial" maxlength="160" class="b-campo" />
            </div>
          </div>
        </section>

        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Presentación y entrega</h2></header>
          <div class="b-panel-cuerpo grid gap-4 sm:grid-cols-4">
            <div>
              <label for="presentacion" class="b-etiqueta">Presentación</label>
              <input id="presentacion" v-model="form.presentacion" required maxlength="80" placeholder="Caja, frasco…" class="b-campo" />
            </div>
            <div>
              <label for="unidadMedida" class="b-etiqueta">Unidad de medida</label>
              <input id="unidadMedida" v-model="form.unidadMedida" required maxlength="40" placeholder="Tableta, ml…" class="b-campo" />
            </div>
            <div>
              <label for="unidadEntrega" class="b-etiqueta">Unidad de entrega</label>
              <input id="unidadEntrega" v-model="form.unidadEntrega" maxlength="30" class="b-campo" />
            </div>
            <div>
              <label for="empaque" class="b-etiqueta">Por empaque</label>
              <input id="empaque" v-model="form.unidadesPorEmpaque" inputmode="numeric" class="b-campo num" />
            </div>
            <div class="sm:col-span-2">
              <span class="b-etiqueta">Perecedero</span>
              <div class="b-segmentado" role="radiogroup">
                <button v-for="o in [[true, 'Sí'], [false, 'No']]" :key="String(o[0])" type="button" role="radio" :aria-checked="form.perecedero === o[0]" :class="form.perecedero === o[0] ? 'on' : ''" @click="form.perecedero = o[0]">{{ o[1] }}</button>
              </div>
            </div>
            <div class="sm:col-span-2">
              <span class="b-etiqueta">Cadena de frío</span>
              <div class="b-segmentado" role="radiogroup">
                <button v-for="o in [[true, 'Sí'], [false, 'No']]" :key="String(o[0])" type="button" role="radio" :aria-checked="form.cadenaFrio === o[0]" :class="form.cadenaFrio === o[0] ? 'on' : ''" @click="form.cadenaFrio = o[0]">{{ o[1] }}</button>
              </div>
            </div>
          </div>
        </section>

        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Códigos y costo</h2></header>
          <div class="b-panel-cuerpo grid gap-4 sm:grid-cols-3">
            <div>
              <label for="codigoMspas" class="b-etiqueta">Código MSPAS</label>
              <input id="codigoMspas" v-model="form.codigoMspas" maxlength="40" class="b-campo" />
            </div>
            <div>
              <label for="codigoBarras" class="b-etiqueta">Código de barras</label>
              <input id="codigoBarras" v-model="form.codigoBarras" maxlength="40" class="b-campo" />
            </div>
            <div>
              <label for="costo" class="b-etiqueta">Costo unitario (Q)</label>
              <input id="costo" v-model="form.costoReferencia" inputmode="decimal" class="b-campo num" />
            </div>
          </div>
        </section>
      </div>

      <!-- Vista previa -->
      <aside class="previa">
        <p class="b-subtitulo">Así se verá en Existencias</p>
        <div class="b-fila mt-2" :style="estiloCategoria(form.categoria || 'medicamentos')" :class="form.categoria ? '' : 'opacity-50'">
          <span class="b-lomo"><Pictograma :categoria="form.categoria || 'medicamentos'" /></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-bold text-tinta">{{ [form.nombreGenerico || 'Nombre del insumo', form.concentracion].filter(Boolean).join(' ') }}</span>
            <span class="mt-1 block text-[13px] text-apagado"><span class="font-mono">INS-·····</span> · 0 en bodega</span>
          </span>
        </div>

        <p v-if="error" role="alert" class="b-aviso error mt-4 flex-col">
          {{ error }}
          <span v-if="detalles.length && detalles[0].campo" class="text-sm">{{ detalles.map((d) => d.mensaje).join(' · ') }}</span>
        </p>

        <button type="submit" :disabled="guardando || !form.categoria" class="b-btn primario mt-4 w-full">
          <Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Guardando…' : 'Registrar insumo' }}
        </button>
      </aside>
    </form>
  </section>
</template>

<style scoped>
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.mosaicos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 700px) { .mosaicos { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.mosaico { display: flex; align-items: center; min-height: 56px; border: 2px solid #E2E8F0; border-radius: 12px; overflow: hidden; color: #334155; background: #fff; transition: border-color .15s, background .15s; }
.mosaico:hover { border-color: var(--cat); }
.mosaico.on { border-color: var(--cat); background: var(--cat-fondo); color: var(--cat-tinta); box-shadow: 0 0 0 3px var(--cat-fondo); }
.lomo-m { align-self: stretch; display: grid; place-items: center; width: 46px; flex-shrink: 0; background: var(--cat); color: #fff; }
.lomo-m svg { width: 24px; height: 24px; }
.previa { position: sticky; top: 16px; }
</style>
