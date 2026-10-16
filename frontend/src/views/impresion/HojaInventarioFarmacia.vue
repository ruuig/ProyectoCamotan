<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import farmacia from '../../services/farmacia';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import { establecimiento as cargarEstablecimiento, registrarImpresion, paginas } from '../../dominio/impresionBodega';

/**
 * Informe diario del inventario de la farmacia: por medicamento, con cuánto
 * abrió el día (lo que quedó del día anterior), lo que entró de la bodega, lo
 * que salió (entregado a pacientes y devuelto a bodega), los ajustes del
 * conteo y con cuánto cerró. Más lo que se recetó y no se pudo entregar.
 */
const route = useRoute();
const datos = ref(null);
const est = ref(null);
const error = ref('');
const firmas = [{ etiqueta: 'Encargado(a) de farmacia' }, { etiqueta: 'Vo. Bo.' }];

onMounted(async () => {
  try {
    const [d, e] = await Promise.all([farmacia.dia(route.query.fecha), cargarEstablecimiento()]);
    datos.value = d;
    est.value = e;
    registrarImpresion('inventario_farmacia', d.fecha);
  } catch (fallo) {
    error.value = fallo.message;
  }
});

const filas = computed(() => [...(datos.value?.filas ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
const total = (campo) => filas.value.reduce((s, f) => s + (f[campo] ?? 0), 0);
const n = (v) => (v ? Number(v).toLocaleString('es-GT') : '—');
const ajuste = (v) => (v ? `${v > 0 ? '+' : ''}${Number(v).toLocaleString('es-GT')}` : '—');
const fechaLarga = computed(() => (datos.value
  ? new Date(`${datos.value.fecha}T12:00:00`).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  : ''));
</script>

<template>
  <p v-if="error" class="p-8 text-red-700">{{ error }}</p>
  <HojaImpresion
    v-else-if="datos" :confidencial="false" titulo="Informe diario del inventario de farmacia" :establecimiento="est" :firmas="firmas" imprimir-al-abrir>
    <p class="leyenda bloque-impresion">
      <span>Día: <b>{{ fechaLarga }}</b></span>
      <span>{{ filas.length }} medicamentos con existencia o movimiento</span>
      <span v-if="datos.totales.pacientes">{{ datos.totales.pacientes }} pacientes atendidos en farmacia</span>
    </p>

    <section v-for="(pag, i) in paginas(filas, 28)" :key="i" :class="i > 0 ? 'salto-pagina' : ''">
      <table class="tabla w-full border-collapse text-[9.5px]">
        <thead>
          <tr>
            <th rowspan="2" class="w-7">No.</th>
            <th rowspan="2" class="text-left">Medicamento</th>
            <th rowspan="2">Existencia del día anterior</th>
            <th>Entradas</th>
            <th colspan="2">Salidas</th>
            <th rowspan="2">Ajuste del conteo</th>
            <th rowspan="2">Existencia al cierre</th>
            <th rowspan="2">Recetado y no entregado</th>
          </tr>
          <tr>
            <th>De bodega</th>
            <th>Entregado a pacientes</th>
            <th>Devuelto a bodega</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(f, j) in pag" :key="f.insumoId">
            <td class="num">{{ i * 28 + j + 1 }}</td>
            <td class="nombre">{{ f.nombre }}</td>
            <td class="num">{{ n(f.saldoInicial) }}</td>
            <td class="num">{{ n(f.recibido) }}</td>
            <td class="num">{{ n(f.entregado) }}</td>
            <td class="num">{{ n(f.devuelto) }}</td>
            <td class="num">{{ ajuste(f.ajuste) }}</td>
            <td class="num fuerte">{{ n(f.saldoFinal) }}</td>
            <td class="num">{{ n(f.noEntregado) }}</td>
          </tr>
          <tr v-if="!filas.length"><td colspan="9" class="vacio">Sin existencia ni movimientos ese día.</td></tr>
        </tbody>
        <tfoot v-if="i === paginas(filas, 28).length - 1 && filas.length">
          <tr>
            <td colspan="2" class="text-right">Totales</td>
            <td class="num">{{ n(total('saldoInicial')) }}</td>
            <td class="num">{{ n(total('recibido')) }}</td>
            <td class="num">{{ n(total('entregado')) }}</td>
            <td class="num">{{ n(total('devuelto')) }}</td>
            <td class="num">{{ ajuste(total('ajuste')) }}</td>
            <td class="num">{{ n(total('saldoFinal')) }}</td>
            <td class="num">{{ n(total('noEntregado')) }}</td>
          </tr>
        </tfoot>
      </table>
    </section>

    <p v-if="datos.cierre" class="nota bloque-impresion">
      Día cerrado por {{ datos.cierre.cerradoPor }}; el conteo del estante {{ datos.cierre.conteos?.some((c) => c.diferencia) ? 'tuvo diferencias, ajustadas en la columna «Ajuste del conteo»' : 'coincidió con el sistema' }}.
    </p>
    <p v-else class="nota bloque-impresion">El conteo del estante de este día todavía no se ha hecho.</p>
  </HojaImpresion>
</template>

<style scoped>
.leyenda { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-bottom: 8px; font-size: 11px; }
.tabla th, .tabla td { border: 1px solid #334155; padding: 3px 5px; }
.tabla th { background: #E2E8F0; font-weight: 700; text-align: center; line-height: 1.15; }
.tabla .num { text-align: right; font-variant-numeric: tabular-nums; }
.tabla .nombre { text-align: left; }
.tabla .fuerte { font-weight: 800; }
.tabla tfoot td { font-weight: 800; background: #F1F5F9; }
.vacio { padding: 12px; text-align: center; color: #64748B; }
.nota { margin-top: 8px; font-size: 10.5px; color: #334155; }
</style>
