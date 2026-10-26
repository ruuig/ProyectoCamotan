<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import sigsa from '../../services/sigsa';
import { establecimiento as cargarEstablecimiento, registrarImpresion } from '../../dominio/impresionBodega';

/**
 * FOR-SIGSA-3CS impreso con las columnas del formulario, para sellarlo y
 * darle validez. Oficio horizontal; los diagnósticos y medicamentos de una
 * consulta van uno debajo del otro en su casilla, como se escribe a mano.
 */
const route = useRoute();
const imprimir = () => window.print();
const datos = ref(null);
const est = ref(null);
const error = ref('');
const POR_HOJA = 12;

let estiloPagina = null;
onMounted(async () => {
  estiloPagina = document.createElement('style');
  estiloPagina.textContent = '@page { size: 13in 8.5in; margin: 0; }';
  document.head.appendChild(estiloPagina);
  try {
    const q = { desde: route.query.desde, hasta: route.query.hasta, medicoId: route.query.medicoId ?? '' };
    const [d, e] = await Promise.all([sigsa.tresCs(q), cargarEstablecimiento()]);
    datos.value = d;
    est.value = e;
    registrarImpresion('sigsa3cs', `Del ${q.desde} al ${q.hasta}`);
    setTimeout(() => window.print(), 600);
  } catch (fallo) {
    error.value = fallo.message;
  }
});
onBeforeUnmount(() => estiloPagina?.remove());

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

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mes = computed(() => (route.query.desde ? MESES[Number(route.query.desde.slice(5, 7)) - 1] : ''));
const anio = computed(() => route.query.desde?.slice(0, 4) ?? '');
</script>

<template>
  <div v-if="datos" class="tres-cs hoja-propia">
    <div class="no-imprimir controles"><button type="button" class="boton-primario" @click="imprimir">Imprimir</button></div>
    <section v-for="(hoja, h) in hojas" :key="h" class="hoja" :class="h > 0 ? 'salto' : ''">
      <header class="encabezado">
        <div>
          <p class="ministerio">Ministerio de Salud Pública y Asistencia Social · SIGSA</p>
          <h1>REGISTRO DIARIO DE CONSULTA EN CENTRO DE SALUD</h1>
        </div>
        <div class="codigo">FOR-SIGSA-3CS</div>
      </header>
      <div class="datos">
        <span><b>Área de Salud:</b> {{ est?.areaSalud ?? datos.encabezado.areaSalud }}</span>
        <span><b>Distrito de Salud:</b> {{ est?.distrito ?? datos.encabezado.distrito }}</span>
        <span><b>Municipio:</b> {{ datos.encabezado.municipio }}</span>
        <span><b>Servicio de Salud:</b> {{ datos.encabezado.servicio }}</span>
        <span><b>Mes:</b> {{ mes }}</span>
        <span><b>Año:</b> {{ anio }}</span>
        <span class="ancho"><b>Responsable de la información:</b> {{ datos.encabezado.responsable ?? '' }}</span>
        <span><b>Cargo:</b> {{ datos.encabezado.cargo || '____________' }}</span>
        <span><b>Firma:</b> ____________</span>
      </div>

      <table>
        <colgroup>
          <col style="width: 2.2%" /><col style="width: 4.5%" /><col style="width: 9.5%" /><col style="width: 6.4%" />
          <col v-for="k in 3" :key="`a${k}`" style="width: 1.7%" />
          <col v-for="k in 3" :key="`f${k}`" style="width: 1.9%" />
          <col v-for="k in 3" :key="`b${k}`" style="width: 1.7%" /><col style="width: 4.2%" />
          <col style="width: 6.5%" /><col style="width: 4.2%" />
          <col v-for="k in 6" :key="`c${k}`" style="width: 1.7%" /><col style="width: 4.2%" />
          <col style="width: 9%" /><col style="width: 3.6%" />
          <col style="width: 8.5%" /><col style="width: 4%" /><col style="width: 2.4%" />
          <col style="width: 1.9%" /><col style="width: 2.8%" /><col style="width: 5.6%" />
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">Día de la consulta</th>
            <th rowspan="2">No. historia clínica</th>
            <th rowspan="2">Nombres y apellidos del paciente</th>
            <th rowspan="2">CUI Código Único de Identificación</th>
            <th rowspan="2" class="v">1/ Sexo</th>
            <th rowspan="2" class="v">2/ Pueblo</th>
            <th rowspan="2" class="v">3/ Comunidad lingüística</th>
            <th colspan="3">4/ Fecha de nacimiento</th>
            <th rowspan="2" class="v">5/ Discapacidad</th>
            <th rowspan="2" class="v">6/ Orientación sexual</th>
            <th rowspan="2" class="v">7/ Escolaridad</th>
            <th rowspan="2">8/ Profesión u oficio</th>
            <th colspan="2">Residencia</th>
            <th rowspan="2" class="v">9/ Agrícola migrante</th>
            <th rowspan="2" class="v">10/ Consulta</th>
            <th rowspan="2" class="v">11/ Control</th>
            <th rowspan="2" class="v">12/ Semana de gestación</th>
            <th colspan="2">Referencia</th>
            <th rowspan="2">Referido a</th>
            <th colspan="2">Motivo de consulta y/o clasificación</th>
            <th colspan="3">Tratamiento y/o medicamento formulado</th>
            <th colspan="2">Notificación</th>
            <th rowspan="2">Nombres y apellidos del acompañante</th>
          </tr>
          <tr>
            <th>Día</th><th>Mes</th><th>Año</th>
            <th>Comunidad y/o dirección exacta</th><th>Municipio</th>
            <th class="v">13/ Viene</th><th class="v">14/ Fue</th>
            <th>Descripción diagnóstico/control</th><th>Código CIE-10</th>
            <th>Descripción</th><th>Presentación</th><th>Cantidad recetada</th>
            <th class="v">15/ Lugar</th><th>Número</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in hoja" :key="i">
            <template v-if="r">
              <td class="c">{{ r.dia }}</td>
              <td class="c">{{ r.historiaClinica }}</td>
              <td>{{ r.nombre }}</td>
              <td class="c">{{ r.cui }}</td>
              <td class="c">{{ r.sexo }}</td>
              <td class="c">{{ r.pueblo }}</td>
              <td class="c">{{ r.comunidadLinguistica }}</td>
              <!-- Sin fecha conocida, la edad va solo en su casilla: días, meses o años. -->
              <td class="c">{{ r.nacimiento.dia }}</td><td class="c">{{ r.nacimiento.mes }}</td><td class="c">{{ r.nacimiento.anio }}</td>
              <td class="c">{{ r.discapacidad }}</td>
              <td class="c">{{ r.orientacionSexual }}</td>
              <td class="c">{{ r.escolaridad }}</td>
              <td>{{ r.profesion }}</td>
              <td>{{ r.comunidad }}</td>
              <td>{{ r.municipio }}</td>
              <td class="c">{{ r.migrante }}</td>
              <td class="c">{{ r.consulta }}</td>
              <td class="c">{{ r.control }}</td>
              <td class="c">{{ r.semanasGestacion }}</td>
              <td class="c">{{ r.viene }}</td>
              <td class="c">{{ r.fue }}</td>
              <td>{{ r.referidoA }}</td>
              <td><span v-for="(d, k) in r.diagnosticos" :key="k" class="linea">{{ d.descripcion }}</span></td>
              <td class="c"><span v-for="(d, k) in r.diagnosticos" :key="k" class="linea">{{ d.cie }}</span></td>
              <td><span v-for="(t, k) in r.tratamiento" :key="k" class="linea">{{ t.descripcion }}</span></td>
              <td><span v-for="(t, k) in r.tratamiento" :key="k" class="linea">{{ t.presentacion }}</span></td>
              <td class="c"><span v-for="(t, k) in r.tratamiento" :key="k" class="linea">{{ t.cantidad }}</span></td>
              <td class="c">{{ r.notificacionLugar }}</td>
              <td class="c">{{ r.notificacionNumero }}</td>
              <td>{{ r.acompanante }}</td>
            </template>
            <template v-else><td v-for="k in 33" :key="k">&nbsp;</td></template>
          </tr>
        </tbody>
      </table>
      <p class="pagina">Hoja {{ h + 1 }} de {{ hojas.length }} · {{ datos.renglones.length }} consultas · del {{ datos.desde }} al {{ datos.hasta }}</p>
    </section>
  </div>
  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando el SIGSA-3CS…</p>
</template>

<style scoped>
.tres-cs { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
.hoja { width: 12.4in; margin: 0 auto; padding: 10mm 0 7mm; }
.salto { break-before: page; }
.encabezado { display: flex; justify-content: space-between; align-items: flex-start; }
.ministerio { font-size: 8px; font-weight: 700; }
.encabezado h1 { font-size: 14px; font-weight: 700; }
.codigo { border: 1px solid #000; padding: 2px 8px; font-size: 9px; font-weight: 700; }
.datos { display: grid; grid-template-columns: repeat(6, auto); gap: 1px 14px; margin: 4px 0 5px; font-size: 8.5px; }
.datos .ancho { grid-column: span 4; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.5px; }
th, td { border: 0.8px solid #000; padding: 1px 2px; overflow: hidden; word-break: break-word; }
th { font-size: 6.5px; font-weight: 700; text-align: center; vertical-align: middle; background: #f2f2f2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
th.v { writing-mode: vertical-rl; transform: rotate(180deg); height: 70px; }
td { height: 36px; vertical-align: top; }
.c { text-align: center; }
.linea { display: block; }
.pagina { margin-top: 2px; font-size: 7.5px; text-align: right; }
.controles { display: flex; justify-content: center; padding: 16px; }
@media print { .no-imprimir { display: none; } }
</style>
