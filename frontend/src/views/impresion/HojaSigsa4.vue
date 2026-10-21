<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import servicio from '../../services/inventario';
import http from '../../services/http';
import { useAuthStore } from '../../stores/auth';
import { establecimiento as cargarEstablecimiento, registrarImpresion } from '../../dominio/impresionBodega';
import { nombrePeriodo } from '../../dominio/bodega';

/**
 * FOR-SIGSA-4: Registro diario de post-consulta en centro de salud u
 * hospital, con las columnas del formulario oficial. Sale de las entregas de
 * farmacia; la firma o huella de quien recibe es la constancia tomada en
 * pantalla. Las entregas con "firma en papel" dejan la casilla en blanco.
 */
const route = useRoute();
const imprimir = () => window.print();
const auth = useAuthStore();
const datos = ref(null);
const est = ref(null);
const imagenes = ref({});
const error = ref('');
const POR_HOJA = 14;

let estiloPagina = null;
onMounted(async () => {
  estiloPagina = document.createElement('style');
  estiloPagina.textContent = '@page { size: 13in 8.5in; margin: 0; }';
  document.head.appendChild(estiloPagina);
  try {
    const [d, e] = await Promise.all([servicio.sigsa4(route.params.periodo), cargarEstablecimiento()]);
    datos.value = d;
    est.value = e;
    const conImagen = d.renglones.map((r) => r.constancia).filter((c) => c && c.tipo !== 'papel');
    const unicas = [...new Map(conImagen.map((c) => [c.id, c])).values()];
    const urls = await Promise.all(unicas.map((c) => http.descargarArchivo(`/dispensaciones/constancias/${c.id}/imagen`).catch(() => null)));
    imagenes.value = Object.fromEntries(unicas.map((c, i) => [c.id, urls[i]]));
    registrarImpresion('sigsa4', `Período ${route.params.periodo}`);
    setTimeout(() => window.print(), 700);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
onBeforeUnmount(() => {
  estiloPagina?.remove();
  Object.values(imagenes.value).forEach((u) => u && URL.revokeObjectURL(u));
});

const hojas = computed(() => {
  const r = datos.value?.renglones ?? [];
  const salida = [];
  for (let i = 0; i < Math.max(r.length, 1); i += POR_HOJA) {
    const pagina = r.slice(i, i + POR_HOJA);
    while (pagina.length < POR_HOJA) pagina.push(null);
    salida.push(pagina);
  }
  return salida;
});

const [anio, mes] = route.params.periodo.split('-');
const nombreMes = nombrePeriodo(route.params.periodo).split(' de ')[0];
const QUIEN = { responsable: 'Resp.', otro: 'Recibe' };
</script>

<template>
  <div v-if="datos" class="sigsa4 hoja-propia">
    <section v-for="(hoja, h) in hojas" :key="h" class="hoja" :class="h > 0 ? 'salto' : ''">
      <header class="encabezado">
        <div class="titulo">
          <p class="ministerio">Ministerio de Salud Pública y Asistencia Social · SIGSA</p>
          <h1>REGISTRO DIARIO DE POST-CONSULTA EN CENTRO DE SALUD U HOSPITAL</h1>
        </div>
        <div class="codigo">FOR SIGSA-4<br />Versión 2.1</div>
      </header>
      <div class="datos">
        <span><b>Área de Salud:</b> {{ est?.areaSalud ?? datos.encabezado.areaSalud }}</span>
        <span><b>Distrito de Salud:</b> {{ est?.distrito ?? datos.encabezado.distrito }}</span>
        <span><b>Municipio:</b> {{ datos.encabezado.municipio }}</span>
        <span><b>Servicio de Salud:</b> {{ datos.encabezado.servicio }}</span>
        <span><b>Responsable de la información:</b> {{ auth.usuario?.nombre }}</span>
        <span><b>Cargo:</b> {{ auth.usuario?.cargo || ({ farmacia: 'Farmacia', admin: 'Dirección' }[auth.rol] ?? auth.rol) }}</span>
        <span><b>Firma:</b> ________________</span>
        <span><b>Mes:</b> {{ nombreMes[0].toUpperCase() + nombreMes.slice(1) }} ({{ mes }})</span>
        <span><b>Año:</b> {{ anio }}</span>
      </div>

      <table>
        <thead>
          <tr>
            <th rowspan="2" class="angosta">No. de orden</th>
            <th rowspan="2" class="angosta">Día de la post consulta</th>
            <th rowspan="2">Nombre del paciente</th>
            <th rowspan="2">CUI</th>
            <th rowspan="2">Nombre del responsable de la consulta</th>
            <th rowspan="2">No. historia clínica</th>
            <th colspan="2">Motivo de la consulta y/o clasificación</th>
            <th colspan="4">Tratamiento y/o medicamento formulado</th>
            <th rowspan="2" class="firma">Firma o huella digital de la persona que recibe el medicamento</th>
          </tr>
          <tr>
            <th>Código CIE-10</th>
            <th>Descripción</th>
            <th>Descripción</th>
            <th>Presentación</th>
            <th class="angosta">Cantidad entregada</th>
            <th class="angosta">Cantidad no entregada</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in hoja" :key="i">
            <template v-if="r">
              <td class="centro">{{ r.orden }}</td>
              <td class="centro">{{ r.dia }}</td>
              <td>{{ r.paciente }}</td>
              <td class="mono">{{ r.cui }}</td>
              <td>{{ r.responsableConsulta }}</td>
              <td class="centro">{{ r.historiaClinica }}</td>
              <td class="centro mono">{{ r.cie }}</td>
              <td>{{ r.diagnostico }}</td>
              <td>{{ r.medicamento }}</td>
              <td>{{ r.presentacion }}</td>
              <td class="centro">{{ r.entregado }}</td>
              <td class="centro">{{ r.noEntregado || '' }}</td>
              <td class="firma">
                <img v-if="r.constancia && imagenes[r.constancia.id]" :src="imagenes[r.constancia.id]" alt="Firma de quien recibe" />
                <small v-if="r.constancia && r.constancia.quienRecibe !== 'paciente'">{{ QUIEN[r.constancia.quienRecibe] }}: {{ r.constancia.nombreRecibe }}</small>
              </td>
            </template>
            <template v-else>
              <td v-for="k in 13" :key="k">&nbsp;</td>
            </template>
          </tr>
        </tbody>
      </table>
      <p class="pagina">Hoja {{ h + 1 }} de {{ hojas.length }} · {{ datos.renglones.length }} renglones en el mes</p>
    </section>

    <div class="no-imprimir controles">
      <button type="button" class="boton-primario" @click="imprimir">Imprimir</button>
    </div>
  </div>
  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando el SIGSA-4…</p>
</template>

<style scoped>
.sigsa4 { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
.hoja { width: 12.3in; margin: 0 auto; padding: 12mm 0 8mm; }
.salto { break-before: page; }
.encabezado { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.ministerio { font-size: 9px; font-weight: 700; }
.encabezado h1 { font-size: 15px; font-weight: 700; }
.codigo { border: 1px solid #000; padding: 2px 8px; font-size: 9px; font-weight: 700; text-align: center; }
.datos { display: grid; grid-template-columns: repeat(5, auto); gap: 2px 18px; margin: 6px 0; font-size: 9.5px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
th, td { border: 1px solid #000; padding: 2px 3px; vertical-align: middle; overflow: hidden; }
th { font-size: 8px; font-weight: 700; text-align: center; background: #f2f2f2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
td { height: 40px; }
.angosta { width: 46px; }
.firma { width: 150px; text-align: center; }
.firma img { display: block; max-width: 140px; max-height: 34px; margin: 0 auto; }
.firma small { display: block; font-size: 7px; }
.centro { text-align: center; }
.mono { font-family: 'IBM Plex Mono', monospace; font-size: 8.5px; }
.pagina { margin-top: 3px; font-size: 8px; text-align: right; }
.controles { display: flex; justify-content: center; padding: 16px; }
@media print { .no-imprimir { display: none; } }
</style>
