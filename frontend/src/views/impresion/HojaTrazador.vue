<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import bodega from '../../services/bodega';
import { establecimiento as cargarEstablecimiento, registrarImpresion } from '../../dominio/impresionBodega';

/**
 * Informe de trazadores impreso, igual al formato de la DDRISS («INFORME
 * QUINCENAL / ...»): la misma lista, en el mismo orden, con el promedio
 * mensual de demanda real y la existencia física de cada renglón. Lo que el
 * centro no maneja queda en blanco, como en el papel.
 */
const route = useRoute();
const router = useRouter();
const datos = ref(null);
const est = ref(null);
const error = ref('');

const hoy = new Date(Date.now() - 6 * 3600000);
const fechaInforme = route.query.fecha
  ? new Date(`${route.query.fecha}T12:00:00Z`)
  : hoy;
const fecha = fechaInforme.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

onMounted(async () => {
  try {
    const [d, e] = await Promise.all([bodega.trazador(route.params.formato, route.params.periodo), cargarEstablecimiento()]);
    datos.value = d;
    est.value = e;
    registrarImpresion('trazador', `${route.params.formato} ${route.params.periodo}`);
    setTimeout(() => window.print(), 600);
  } catch (fallo) {
    error.value = fallo.message;
  }
});

const lugar = computed(() => `${(est.value?.municipio ?? 'Camotán').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} / ${(est.value?.departamento ?? 'Chiquimula').toUpperCase()}`);
const imprimir = () => window.print();
const entero = (v) => (v === null || v === undefined ? '' : Math.round(v).toLocaleString('en-US'));
function volver() {
  if (window.history.length > 1) router.back();
  else window.close();
}
</script>

<template>
  <!-- hoja-propia: lo único que se imprime (ver style-impresion.css). -->
  <div class="hoja hoja-propia">
    <div class="controles">
      <button type="button" class="boton-primario" @click="imprimir">Imprimir</button>
      <button type="button" class="boton-secundario" @click="volver">Volver</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <!--
      La página va sin márgenes para que el navegador no escriba la fecha, el
      enlace ni el número de página. El margen de arriba y de abajo lo dan estas
      filas vacías, que se repiten en cada hoja.
    -->
    <table v-if="datos" class="marco">
      <thead><tr><td><div class="margen" /></td></tr></thead>
      <tfoot><tr><td><div class="margen" /></td></tr></tfoot>
      <tbody><tr><td>
      <div class="linea" />
      <header class="cabeza">
        <div>
          <h1>INFORME QUINCENAL &nbsp;/ {{ datos.titulo }}</h1>
          <p class="lugar">{{ lugar }}</p>
        </div>
        <div class="fecha">
          <p>FECHA DE INFORME : <b>{{ fecha }}</b></p>
          <p class="nuevo"><b>NUEVO</b><b>{{ datos.periodo.slice(0, 4) }}</b></p>
        </div>
      </header>

      <table v-for="s in datos.secciones" :key="s.titulo" class="formato">
        <thead>
          <tr><th colspan="4" class="titulo-seccion">{{ s.titulo }}</th></tr>
          <tr v-if="s.columna" class="columnas">
            <th class="no">No.</th>
            <th>{{ s.columna }}</th>
            <th class="cifra">PROMEDIO MENSUAL DE DEMANDA REAL</th>
            <th class="cifra">EXISTENCIA FISICA</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in s.renglones" :key="r.clave">
            <td class="no">{{ r.no }}</td>
            <td class="texto">{{ r.texto }}</td>
            <td class="valor">{{ r.maneja ? entero(r.pmdr) : '' }}</td>
            <td class="valor">{{ r.maneja ? entero(r.existencia) : '' }}</td>
          </tr>
        </tbody>
      </table>
      </td></tr></tbody>
    </table>

  </div>
</template>

<style scoped>
.hoja { max-width: 820px; margin: 0 auto; padding: 16px; background: #fff; color: #000; font-family: Calibri, Carlito, Arial, sans-serif; }
.error { color: #A52A2A; font-weight: 700; }
.marco { width: 100%; border-collapse: collapse; }
.marco > thead td, .marco > tfoot td, .marco > tbody > tr > td { padding: 0; border: 0; }
.margen { height: 0; }
.linea { height: 5px; margin: 0 0 6px; background: repeating-linear-gradient(90deg, #9DB3CF 0 6px, #C9D6E6 6px 9px); }
.cabeza { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
.cabeza h1 { font-family: Arial, sans-serif; font-size: 15px; font-weight: 900; color: #1F3864; }
.lugar { margin-top: 2px; font-size: 11px; font-style: italic; color: #4F81BD; letter-spacing: .03em; }
.fecha { font-size: 11px; text-align: left; }
.nuevo { display: flex; gap: 28px; margin-top: 4px; padding-left: 8px; }
.formato { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10px; page-break-inside: auto; }
.formato th, .formato td { border: 1px solid #000; padding: 0 3px; height: 14px; }
.titulo-seccion { background: #DCE6F1; font-size: 10.5px; font-weight: 700; text-align: center; }
.columnas th { background: #FCE4D6; font-weight: 700; text-align: center; vertical-align: middle; }
.columnas th.cifra { width: 82px; font-size: 7.5px; line-height: 1.15; }
.no { width: 34px; text-align: center; font-weight: 700; }
.texto { font-weight: 600; }
.valor { width: 82px; text-align: center; font-weight: 700; }
tr { page-break-inside: avoid; }
.controles { display: flex; gap: 12px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #E2E8F0; }
@media print {
  .hoja { max-width: none; padding: 0 12mm; }
  .margen { height: 10mm; }
  .controles { display: none; }
  /* Los colores del formato salen en el papel. */
  .linea, .titulo-seccion, .columnas th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
