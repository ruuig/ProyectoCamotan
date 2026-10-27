<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import servicio from '../../services/inventario';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import BresPreimpreso from '../../components/bodega/BresPreimpreso.vue';
import { nombrePeriodo } from '../../dominio/bodega';
import { useAuthStore } from '../../stores/auth';
import { miles, general } from '../../components/bodega/diseno/PiezasBodega';
import {
  establecimiento as cargarEstablecimiento, registrarImpresion, paginas, renglonesEnBlanco, textoInsumo,
} from '../../dominio/impresionBodega';

/**
 * BRES impreso con el formato del centro: columnas B a M, unos 20 insumos
 * por página, encabezado con municipio, servicio, mes y año, niveles mínimo
 * y máximo, y al pie las firmas del encargado de bodega y del coordinador
 * municipal.
 *
 * ?orden=alfabetico|categoria, ?categoria=..., ?blanco=1 para el formato vacío.
 */
const route = useRoute();
const datos = ref(null);
const est = ref(null);
const error = ref('');
const enBlanco = route.query.blanco === '1';
// BRES de la farmacia (post-consulta): sus propios movimientos y su firma.
const deFarmacia = route.query.ubicacion === 'farmacia';
const auth = useAuthStore();

// El centro imprime el BRES sobre el formulario preimpreso del MSPAS. El modo
// y el ajuste de la impresora se recuerdan en este equipo.
const CLAVE_MODO = 'camotan_bres_modo';
const CLAVE_AJUSTE = 'camotan_bres_ajuste';
function leer(clave, defecto) {
  try { return JSON.parse(localStorage.getItem(clave)) ?? defecto; } catch { return defecto; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
}
const modo = ref(leer(CLAVE_MODO, 'preimpreso'));
const ajuste = ref(leer(CLAVE_AJUSTE, { x: 0, y: 0 }));
function imprimir() { window.print(); }
function cambiarModo(m) { modo.value = m; guardar(CLAVE_MODO, m); }

// En hoja blanca la página va en carta horizontal; el preimpreso fija la suya (oficio).
let estiloPagina = null;
function fijarPagina() {
  estiloPagina?.remove();
  estiloPagina = null;
  if (modo.value !== 'blanco') return;
  estiloPagina = document.createElement('style');
  estiloPagina.textContent = '@media print { @page { size: letter landscape; margin: 0; } }';
  document.head.appendChild(estiloPagina);
}
watch(modo, fijarPagina, { immediate: true });
onBeforeUnmount(() => estiloPagina?.remove());
function mover(eje, mm) { ajuste.value = { ...ajuste.value, [eje]: Math.round((ajuste.value[eje] + mm) * 10) / 10 }; guardar(CLAVE_AJUSTE, ajuste.value); }

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const encabezadoPreimpreso = computed(() => {
  const [anio, mes] = route.params.periodo.split('-').map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return {
    municipio: est.value?.municipio ?? 'Camotán',
    servicio: datos.value?.servicio ?? 'Bodega',
    // PENDIENTE DE CONFIRMAR: en el Excel del centro estas dos casillas dicen 31.
    // Se interpretan como servicios que deben informar y servicios que informaron.
    serviciosTotal: enBlanco ? '' : datos.value?.serviciosTotal ?? '',
    serviciosInformaron: enBlanco ? '' : datos.value?.serviciosInformaron ?? '',
    minimo: datos.value?.configuracion.nivelMinimoMeses,
    maximo: datos.value?.configuracion.nivelMaximoMeses,
    mes: enBlanco ? '' : MESES[mes - 1],
    anio: enBlanco ? '' : anio,
    fecha: enBlanco ? '' : `${String(ultimo).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`,
  };
});
const hojasPreimpreso = computed(() => hojasFormulario.value.map((h) => h.map((r) => (r.vacio ? r : { ...r, nombreFormulario: textoInsumo(r) }))));

const ORDEN_CATEGORIA = ['medicamentos', 'suplementos', 'planificacion_familiar', 'medico_quirurgico', 'laboratorio', 'tuberculosis'];

async function cargar() {
  try {
    const [bres, e] = await Promise.all([
      deFarmacia ? servicio.bresFarmacia(route.params.periodo) : servicio.vistaPreviaBres(route.params.periodo),
      cargarEstablecimiento(),
    ]);
    // En el de farmacia firma quien lo imprime (el encargado de farmacia).
    if (deFarmacia) bres.firmas = { ...bres.firmas, encargadoBodega: auth.usuario?.nombre ?? '' };
    datos.value = bres;
    est.value = e;
    registrarImpresion('bres', `${deFarmacia ? 'Farmacia, p' : 'P'}eríodo ${route.params.periodo}`, enBlanco);
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const renglones = computed(() => {
  if (!datos.value) return [];
  if (enBlanco) return renglonesEnBlanco(20);
  let lista = datos.value.renglones.filter((r) => !route.query.categoria || r.categoria === route.query.categoria);
  lista = [...lista].sort((a, b) => (route.query.orden === 'categoria'
    ? ORDEN_CATEGORIA.indexOf(a.categoria) - ORDEN_CATEGORIA.indexOf(b.categoria) || a.nombre.localeCompare(b.nombre, 'es')
    : a.nombre.localeCompare(b.nombre, 'es')));
  return lista;
});

// Pantalla y hoja blanca: una sola tabla que llena cada página. El preimpreso
// sí va de 20 en 20, como el formulario.
const hojas = computed(() => [renglones.value]);
const hojasFormulario = computed(() => paginas(renglones.value, 20));
// El código interno del sistema no está en el formulario.
const columnas = computed(() => (datos.value?.columnas ?? []).filter((c) => c.clave !== 'codigoInterno'));
const TEXTO = ['codigoInterno', 'nombre', 'unidadEntrega'];

function valor(r, clave) {
  if (r.vacio) return '';
  if (clave === 'nombre') return textoInsumo(r);
  if (clave === 'med' && r.med === null) return 'sin consumo';
  const v = r[clave];
  if (v === null || v === undefined) return '';
  if (typeof v !== 'number') return v;
  // Como el balance: K con un decimal, el maximo tal cual y lo demas entero.
  if (clave === 'med') return v.toFixed(1);
  if (clave === 'cantidadMaxima') return general(v);
  return miles(v);
}

const firmas = computed(() => [
  { etiqueta: `Encargado de ${deFarmacia ? 'farmacia' : 'bodega'}${datos.value?.firmas?.encargadoBodega ? `: ${datos.value.firmas.encargadoBodega}` : ''}` },
  { etiqueta: `Coordinador municipal${datos.value?.firmas?.coordinadorMunicipal ? `: ${datos.value.firmas.coordinadorMunicipal}` : ''}` },
]);

onMounted(cargar);
</script>

<template>
  <div v-if="datos" class="no-imprimir mx-auto flex max-w-[13in] flex-wrap items-center gap-3 p-4 text-sm">
    <span class="font-bold">Imprimir:</span>
    <button type="button" class="rounded border px-3 py-1.5" :class="modo === 'preimpreso' ? 'border-black bg-black text-white' : ''" @click="cambiarModo('preimpreso')">
      Sobre el formulario preimpreso (oficio horizontal)
    </button>
    <button type="button" class="rounded border px-3 py-1.5" :class="modo === 'tabla' ? 'border-black bg-black text-white' : ''" @click="cambiarModo('tabla')">
      En hoja blanca, con tabla
    </button>
    <template v-if="modo === 'preimpreso'">
      <span class="ml-4">Ajuste de la impresora:</span>
      <button type="button" class="rounded border px-2 py-1" @click="mover('x', -1)">← 1 mm</button>
      <button type="button" class="rounded border px-2 py-1" @click="mover('x', 1)">1 mm →</button>
      <button type="button" class="rounded border px-2 py-1" @click="mover('y', -1)">↑ 1 mm</button>
      <button type="button" class="rounded border px-2 py-1" @click="mover('y', 1)">1 mm ↓</button>
      <span class="tabular-nums">({{ ajuste.x }}, {{ ajuste.y }}) mm</span>
      <button type="button" class="rounded bg-black px-3 py-1.5 font-bold text-white" @click="imprimir">Imprimir</button>
    </template>
  </div>

  <div v-if="datos && modo === 'preimpreso'" class="hoja-impresion !p-0">
    <BresPreimpreso
      :hojas="hojasPreimpreso"
      :encabezado="encabezadoPreimpreso"
      :firmas="datos.firmas ?? {}"
      :cargo-encargado="deFarmacia ? 'Encargado de Farmacia' : 'Encargado de Bodega'"
      :desplazamiento="ajuste"
    />
  </div>

  <HojaImpresion
    :confidencial="false"
    v-else-if="datos"
    class="hoja-apaisada"
    :titulo="`Balance, Requisición y Envío de Suministros (BRES)${deFarmacia ? ' · Farmacia (post-consulta)' : ''}`"
    :establecimiento="est"
    :firmas="firmas"
  >
    <section class="bloque-impresion mb-2 grid grid-cols-4 gap-2 text-sm">
      <p><strong>Municipio:</strong> {{ est?.municipio ?? 'Camotán' }}</p>
      <p><strong>Servicio:</strong> {{ est?.nombre ?? 'Centro de Salud' }}</p>
      <p><strong>Mes y año:</strong> {{ enBlanco ? '' : nombrePeriodo(route.params.periodo) }}</p>
      <p>
        <strong>Niveles:</strong> mínimo {{ datos.configuracion.nivelMinimoMeses }}, máximo {{ datos.configuracion.nivelMaximoMeses }} meses
      </p>
    </section>

    <section v-for="(hoja, h) in hojas" :key="h">
      <table class="tabla-compacta w-full border-collapse text-[9px]">
        <thead>
          <tr class="bg-slate-100">
            <th
              v-for="c in columnas"
              :key="c.clave"
              class="border border-slate-500 px-1 py-1 align-bottom"
              :class="TEXTO.includes(c.clave) ? 'text-left' : 'text-right'"
            >
              <span v-if="c.letra" class="block">{{ c.letra }}</span>{{ c.etiqueta }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in hoja" :key="r.insumoId" >
            <td
              v-for="c in columnas"
              :key="c.clave"
              class="border border-slate-500 px-1 py-0.5"
              :class="[TEXTO.includes(c.clave) ? 'text-left' : 'text-right tabular-nums', c.clave === 'cantidadSolicitar' ? 'font-bold' : '', c.clave === 'codigoInterno' ? 'whitespace-nowrap' : '']"
            >
              {{ valor(r, c.clave) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="!enBlanco && datos.observacionesRecepcion.length" class="bloque-impresion mt-3">
      <h2 class="mb-1 text-sm font-bold">Observaciones de recepción</h2>
      <ul class="list-disc pl-5 text-xs">
        <li v-for="(o, i) in datos.observacionesRecepcion" :key="i">
          {{ o.insumo }}, lote {{ o.numeroLote }}: el documento indica {{ o.segunDocumento }} y se recibieron
          {{ o.recibido }} ({{ o.diferencia > 0 ? '+' : '' }}{{ o.diferencia }})<span v-if="o.observacion">. {{ o.observacion }}</span>
        </li>
      </ul>
    </section>

    <p class="bloque-impresion mt-3 text-[9px]">
      B saldo anterior del municipio (bodega + servicios) · C entradas a bodega · D entregado a usuarios (centro + servicios) ·
      E no entregado · F = D + E · G reajustes y bajas · H = B + C − D ± G · I existencia física en bodega ·
      J promedio de la demanda de {{ datos.configuracion.mesesPromedio }} meses · K = H ÷ J · L = J × {{ datos.configuracion.nivelMaximoMeses }} ·
      M = L − {{ datos.configuracion.formulaPedido === 'mspas' ? 'H' : 'I' }}, nunca negativo.
    </p>
  </HojaImpresion>

  <p v-else-if="error" class="p-8 text-red-700">{{ error }}</p>
  <p v-else class="p-8">Preparando el BRES…</p>
</template>
