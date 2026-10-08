<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import { SEMAFORO } from '../../dominio/bodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion, firmasBodega } from '../../dominio/impresionBodega';

/**
 * Semáforo impreso, por color: insumo y, por cada lote, cantidad, número y
 * vencimiento, más el saldo total. Como las hojas Rojo, Amarillo y Verde del
 * Excel, pero sin límite de lotes.
 */
const route = useRoute();
const datos = ref(null);
const est = ref(null);
const firmas = ref([]);
firmasBodega().then((f) => { firmas.value = f.slice(0, 1); });
const error = ref('');

onMounted(async () => {
  try {
    const [d, e] = await Promise.all([
      bodega.semaforo({ categoria: route.query.categoria, orden: route.query.orden ?? 'alfabetico' }),
      cargarEstablecimiento(),
    ]);
    datos.value = d;
    est.value = e;
    registrarImpresion('semaforo', route.query.color ? `Color ${route.query.color}` : 'Todos los colores');
  } catch (fallo) {
    error.value = fallo.message;
  }
});

const colores = computed(() => (route.query.color ? [route.query.color] : ['vencido', 'rojo', 'amarillo', 'verde']));
function filasDe(color) {
  return (datos.value?.filas ?? [])
    .map((f) => ({ ...f, lotes: f.lotes.filter((l) => l.semaforo === color) }))
    .filter((f) => f.lotes.length);
}

/**
 * Como la hoja del centro: tres lotes por renglón (cantidad, lote, vence) y
 * el saldo al final. Si un insumo tiene más de tres lotes, sigue en el
 * renglón de abajo con el mismo nombre, como hacen hoy a mano.
 */
function renglonesDe(color) {
  const salida = [];
  filasDe(color).forEach((f, n) => {
    for (let i = 0; i < f.lotes.length; i += 3) {
      const lotes = f.lotes.slice(i, i + 3);
      while (lotes.length < 3) lotes.push(null);
      salida.push({ clave: `${f.insumoId}-${i}`, numero: i === 0 ? n + 1 : '', nombre: f.nombre, lotes, saldo: i === 0 ? f.lotes.reduce((s, l) => s + l.cantidad, 0) : '' });
    }
  });
  return salida;
}

const mesVence = (v) => {
  const d = new Date(v);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};
</script>

<template>
  <HojaImpresion
    :confidencial="false" v-if="datos" titulo="Semáforo de medicamentos" :establecimiento="est" :firmas="firmas" imprimir-al-abrir>
    <p class="leyenda bloque-impresion">
      <span class="muestra rojo">Rojo</span> menos de {{ datos.rangos.rojo }} meses
      <span class="muestra amarillo">Amarillo</span> de {{ datos.rangos.rojo }} a {{ datos.rangos.amarillo }} meses
      <span class="muestra verde">Verde</span> más de {{ datos.rangos.amarillo }} meses
      <span class="muestra vencido">Vencido</span>
      <span class="ml-auto">Fecha: {{ new Date().toLocaleDateString('es-GT') }}</span>
    </p>
    <section v-for="(c, i) in colores" :key="c" class="color" :class="[c, i > 0 ? 'salto-pagina' : '']">
      <h2 class="banda">{{ SEMAFORO[c].etiqueta }} <span>{{ renglonesDe(c).length }} renglones</span></h2>
      <table class="tabla-compacta w-full border-collapse text-[9.5px]">
        <thead>
          <tr class="cabeza">
            <th class="w-8">N0</th>
            <th>MEDICAMENTOS</th>
            <template v-for="k in 3" :key="k">
              <th class="text-right">CANTIDAD</th><th>LOTE</th><th>VENCE</th>
            </template>
            <th class="text-right">SALDO</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in renglonesDe(c)" :key="r.clave">
            <td class="text-right">{{ r.numero }}</td>
            <td>{{ r.nombre }}</td>
            <template v-for="(l, k) in r.lotes" :key="k">
              <td class="text-right tabular-nums">{{ l?.cantidad ?? '' }}</td>
              <td class="font-mono">{{ l?.numeroLote ?? '' }}</td>
              <td class="whitespace-nowrap">{{ l ? mesVence(l.fechaVence) : '' }}</td>
            </template>
            <td class="text-right font-bold tabular-nums">{{ r.saldo }}</td>
          </tr>
          <tr v-if="!renglonesDe(c).length"><td colspan="12" class="text-center">Sin lotes en este color.</td></tr>
        </tbody>
      </table>
    </section>
  </HojaImpresion>
  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando el semáforo…</p>
</template>

<style scoped>
/* El color es la información: se imprime tal cual, sin que el navegador lo quite. */
.color, .leyenda { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.leyenda { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-bottom: 8px; font-size: 11px; }
.muestra { display: inline-block; padding: 1px 8px; border-radius: 4px; font-weight: 700; margin-left: 6px; }
.muestra.rojo { background: #DC2626; color: #fff; }
.muestra.amarillo { background: #FACC15; color: #422006; }
.muestra.verde { background: #16A34A; color: #fff; }
.muestra.vencido { background: #7F1D1D; color: #fff; }
.banda { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 4px; padding: 6px 10px; border-radius: 4px; font-size: 15px; font-weight: 700; }
.banda span { font-size: 11px; font-weight: 600; }
.rojo .banda { background: #DC2626; color: #fff; }
.amarillo .banda { background: #FACC15; color: #422006; }
.verde .banda { background: #16A34A; color: #fff; }
.vencido .banda { background: #7F1D1D; color: #fff; }
.rojo .cabeza { background: #FCA5A5; }
.amarillo .cabeza { background: #FDE68A; }
.verde .cabeza { background: #86EFAC; }
.vencido .cabeza { background: #D4A5A5; }
.rojo tbody tr { background: #FEE2E2; }
.amarillo tbody tr { background: #FEF9C3; }
.verde tbody tr { background: #DCFCE7; }
.vencido tbody tr { background: #F3E1E1; }
</style>
