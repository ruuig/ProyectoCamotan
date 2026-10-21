<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import { nombrePeriodo } from '../../dominio/bodega';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion, firmasBodega, paginas, renglonesEnBlanco, textoInsumo } from '../../dominio/impresionBodega';

/**
 * Balance consolidado impreso: insumos en filas, la bodega, post-consulta y
 * los servicios en columnas (lo entregado por cada uno), y los totales del
 * municipio. En carta horizontal no caben 31 servicios con todas sus
 * columnas, así que de cada servicio se imprime lo entregado; el detalle
 * completo está en la exportación a Excel.
 */
const route = useRoute();
const datos = ref(null);
const est = ref(null);
const firmas = ref([]);
firmasBodega().then((f) => { firmas.value = f; });
const error = ref('');
const enBlanco = route.query.blanco === '1';

// El balance sale en carta horizontal. Chrome no respeta una página con nombre
// al imprimir, así que el tamaño se fija mientras esta vista está abierta.
let estiloPagina = null;
onMounted(() => {
  estiloPagina = document.createElement('style');
  estiloPagina.textContent = '@media print { @page { size: letter landscape; margin: 0; } }';
  document.head.appendChild(estiloPagina);
});
onBeforeUnmount(() => estiloPagina?.remove());

onMounted(async () => {
  try {
    const [b, e] = await Promise.all([
      bodega.balance({ periodo: route.params.periodo, categoria: route.query.categoria, orden: route.query.orden }),
      cargarEstablecimiento(),
    ]);
    datos.value = b;
    est.value = e;
    registrarImpresion('balance', `Período ${route.params.periodo}`, enBlanco);
  } catch (fallo) {
    error.value = fallo.message;
  }
});

const hojas = computed(() => [enBlanco ? renglonesEnBlanco(30) : datos.value?.filas ?? []]);
const v = (f, fn) => (f.vacio ? '' : fn(f));
const abreviar = (n) => n.replace('Centro Comunitario', 'C/C').replace('Post-consulta (Centro de Salud)', 'Post-consulta');
</script>

<template>
  <HojaImpresion
    :confidencial="false"
    v-if="datos"
    class="hoja-apaisada"
    :titulo="`Balance de medicamentos · ${enBlanco ? '' : nombrePeriodo(route.params.periodo)}`"
    :establecimiento="est"
    :firmas="firmas"
    imprimir-al-abrir
  >
    <section v-for="(hoja, h) in hojas" :key="h">
      <table class="tabla-compacta w-full border-collapse text-[7.5px]">
        <thead>
          <tr class="bg-slate-100">
            <th class="border border-slate-500 px-1 text-left">Insumo</th>
            <th class="border border-slate-500 px-1">Bodega</th>
            <th class="border border-slate-500 px-1">Post-consulta</th>
            <th v-for="s in datos.servicios" :key="s.id" class="border border-slate-500 px-0.5 align-bottom [writing-mode:vertical-rl] rotate-180">
              {{ abreviar(s.nombre) }}
            </th>
            <th class="border border-slate-500 px-1">B</th>
            <th class="border border-slate-500 px-1">C</th>
            <th class="border border-slate-500 px-1">D</th>
            <th class="border border-slate-500 px-1">E</th>
            <th class="border border-slate-500 px-1">H</th>
            <th class="border border-slate-500 px-1">M</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in hoja" :key="f.insumoId" >
            <td class="border border-slate-500 px-1">{{ v(f, textoInsumo) }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, (x) => x.bodega.saldoSiguiente) }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, (x) => x.postConsulta.entregado) }}</td>
            <td v-for="(s, i) in datos.servicios" :key="s.id" class="border border-slate-500 px-0.5 text-right">
              {{ v(f, (x) => x.servicios[i].entregado || '') }}
            </td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, (x) => miles(x.bres.B)) }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, (x) => miles(x.bres.C)) }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, (x) => miles(x.bres.D)) }}</td>
            <td class="border border-slate-500 px-1 text-right">{{ v(f, (x) => miles(x.bres.E)) }}</td>
            <td class="border border-slate-500 px-1 text-right font-bold">{{ v(f, (x) => miles(x.bres.H)) }}</td>
            <td class="border border-slate-500 px-1 text-right font-bold">{{ v(f, (x) => miles(x.bres.M)) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <p class="bloque-impresion mt-2 text-[8px]">
      Bodega: existencia al cierre. Post-consulta y servicios: entregado a usuarios en el mes.
      B saldo anterior del municipio · C entradas · D entregado · E no entregado · H saldo siguiente · M cantidad a pedir.
    </p>
  </HojaImpresion>
  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando el balance…</p>
</template>


