<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import { nombrePeriodo } from '../../dominio/bodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion, paginas, renglonesEnBlanco, textoInsumo } from '../../dominio/impresionBodega';

/** Inventario de cierre de la bodega: saldo anterior, entradas, entregado y saldo actual. */
const route = useRoute();
const datos = ref(null);
const est = ref(null);
const error = ref('');
const enBlanco = route.query.blanco === '1';

onMounted(async () => {
  try {
    const [d, e] = await Promise.all([
      bodega.inventarioCierre({ periodo: route.params.periodo, categoria: route.query.categoria, orden: route.query.orden }),
      cargarEstablecimiento(),
    ]);
    datos.value = d;
    est.value = e;
    registrarImpresion('inventario_cierre', `Período ${route.params.periodo}`, enBlanco);
  } catch (fallo) {
    error.value = fallo.message;
  }
});

// El título del Excel del centro: "Inventario de Cierre de Medicamentos y M. Q.
// del Centro de Salud, Camotán, al 25 de Septiembre de 2026".
const tituloCierre = computed(() => {
  if (enBlanco) return 'Inventario de Cierre de Medicamentos y M. Q. del Centro de Salud';
  const anio = route.params.periodo.slice(0, 4);
  const nombre = nombrePeriodo(route.params.periodo).split(' de ')[0];
  const dia = datos.value?.diaCorte ?? 25;
  return `Inventario de Cierre de Medicamentos y M. Q. del Centro de Salud, ${est.value?.municipio ?? 'Camotán'}, al ${dia} de ${nombre[0].toUpperCase()}${nombre.slice(1)} de ${anio}`;
});

const hojas = computed(() => [enBlanco ? renglonesEnBlanco(45) : datos.value?.filas ?? []]);
const conReajustes = computed(() => datos.value?.fuente !== 'excel');
const firmas = computed(() => datos.value?.firmas ?? {});
const miles = (n) => Number(n).toLocaleString('en-US');
const v = (f, c) => (f.vacio ? '' : c === 'unidadEntrega' ? f[c] : miles(f[c]));
</script>

<template>
  <HojaImpresion
    :confidencial="false"
    v-if="datos"
    :titulo="tituloCierre"
    :establecimiento="est"
    :firmas="[]"
    imprimir-al-abrir
  >
    <section v-for="(hoja, h) in hojas" :key="h">
      <table class="w-full border-collapse text-[10px]">
        <thead>
          <tr class="bg-slate-100">
            <th class="border border-slate-500 px-1 text-left">N0</th>
            <th class="border border-slate-500 px-1 text-left">Insumo</th>
            <th class="border border-slate-500 px-1 text-left">Unidad</th>
            <th class="border border-slate-500 px-1 text-right">Saldo Ant.</th>
            <th class="border border-slate-500 px-1 text-right">Entradas</th>
            <th class="border border-slate-500 px-1 text-right">Entregado</th>
            <th v-if="conReajustes" class="border border-slate-500 px-1 text-right">Reajustes</th>
            <th class="border border-slate-500 px-1 text-right">Saldo Actual</th>
            <th class="border border-slate-500 px-1 text-right">÷ {{ datos.lugaresReparto ?? 32 }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(f, j) in hoja" :key="f.insumoId" >
            <td class="border border-slate-500 px-1 text-right">{{ f.vacio ? '' : j + 1 }}</td>
            <td class="border border-slate-500 px-1">{{ f.vacio ? '' : textoInsumo(f) }}</td>
            <td class="border border-slate-500 px-1">{{ v(f, 'unidadEntrega') }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, 'saldoAnterior') }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, 'entradas') }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, 'entregado') }}</td>
            <td v-if="conReajustes" class="border border-slate-500 px-1 text-right">{{ v(f, 'reajustes') }}</td>
            <td class="border border-slate-500 px-1 text-right font-bold">{{ v(f, 'saldoActual') }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, 'porLugar') }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <!-- Firmas como en el formato del centro -->
    <section class="bloque-impresion firmas-cierre">
      <div>
        <p class="nombre">{{ firmas.encargadoBodega || ' ' }}</p>
        <p class="cargo sangria">{{ firmas.cargoEncargadoBodega }}</p>
      </div>
      <div class="derecha">
        <p class="nombre">Vo. Bo. {{ firmas.coordinadorMunicipal || '' }}</p>
        <p class="cargo">{{ firmas.cargoCoordinador }}, {{ est?.municipio ?? 'Camotán' }}</p>
      </div>
    </section>
  </HojaImpresion>
  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando el inventario de cierre…</p>
</template>

<style scoped>
.firmas-cierre { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 56px; font-size: 13px; }
.firmas-cierre .nombre { padding-top: 4px; }
.firmas-cierre .sangria { padding-left: 32px; }
.firmas-cierre .derecha { padding-top: 28px; }
</style>
