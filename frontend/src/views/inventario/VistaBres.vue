<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import PasosCierre from '../../components/bodega/PasosCierre.vue';
import DetallePorServicio from '../../components/bodega/DetallePorServicio.vue';
import DialogoCerrarMes from '../../components/bodega/DialogoCerrarMes.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import { CATEGORIA, estiloCategoria, miles, decimal, general } from '../../components/bodega/diseno/PiezasBodega';
import { cierre, nombrePeriodo } from '../../dominio/bodega';

/**
 * Paso 3 del cierre: BRES, Balance, Requisición y Envío de Suministros.
 * Se genera, se revisa y se cierra. "Detalle por servicio" muestra de dónde
 * sale cada total: la bodega, post-consulta y cada servicio (lo que el
 * centro llevaba como balance en Excel).
 */
const datos = ref(null);
const guardado = ref(null);
const error = ref('');
const aviso = ref('');
const cargando = ref(true);
const enviando = ref(false);
const observaciones = ref('');
const buscar = ref('');
const categoriaFiltro = ref('');
const soloPedir = ref(false);
const verDescuadres = ref(false);
const vista = ref('bres');
const balance = ref(null);

async function cargarBalance() {
  try {
    balance.value = await bodega.balance({ periodo: cierre.periodo });
  } catch (fallo) {
    error.value = fallo.message;
  }
}
watch(vista, (v) => { if (v === 'servicio' && !balance.value) cargarBalance(); });

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    datos.value = await servicio.vistaPreviaBres(cierre.periodo);
    const { bres } = await servicio.bresDe(cierre.periodo);
    guardado.value = bres;
    observaciones.value = bres?.observaciones ?? '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}
watch(() => cierre.periodo, () => {
  aviso.value = '';
  balance.value = null;
  cargar();
  if (vista.value === 'servicio') cargarBalance();
});
onMounted(cargar);

async function accion(fn, mensaje) {
  enviando.value = true;
  error.value = '';
  try {
    await fn();
    aviso.value = mensaje;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}
const generar = () => accion(() => servicio.generarBres({ periodo: cierre.periodo, observaciones: observaciones.value || null }), 'BRES generado.');
// Cerrar pide doble confirmación y la contraseña de quien cierra.
const cerrando = ref(false);
const errorCierre = ref('');
// Los lugares que no han mandado su informe de consumo del mes.
const sinInforme = ref([]);
async function abrirCierre() {
  errorCierre.value = '';
  try {
    sinInforme.value = (await bodega.estadoInformes(cierre.periodo)).servicios.filter((s) => !s.informado).map((s) => s.nombre);
  } catch {
    sinInforme.value = [];
  }
  cerrando.value = true;
}
async function confirmarCierre(password) {
  errorCierre.value = '';
  enviando.value = true;
  try {
    await servicio.cerrarBres(cierre.periodo, password, sinInforme.value.length > 0);
    cerrando.value = false;
    aviso.value = 'Mes cerrado. Sus cifras ya no cambian.';
    await cargar();
  } catch (fallo) {
    errorCierre.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function excel() {
  try {
    const delBalance = vista.value === 'servicio';
    const url = delBalance ? await bodega.excelBalance(cierre.periodo, 'alfabetico') : await bodega.excelBres(cierre.periodo, 'alfabetico');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${delBalance ? 'balance' : 'bres'}-${cierre.periodo}.xlsx`;
    a.click();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const cerrado = computed(() => guardado.value?.estado === 'cerrado');
const estado = computed(() => (cerrado.value ? 'cerrado' : guardado.value ? 'borrador' : 'sin_generar'));
const CORTO = { B: 'Saldo anterior', C: 'Entradas', D: 'Entregado', E: 'No entregado', F: 'Demanda', G: 'Reajustes', H: 'Saldo', I: 'En bodega', J: 'Promedio', K: 'Meses', L: 'Máximo', M: 'Pedir' };
const ESTADO = { cerrado: 'Cerrado', borrador: 'Borrador', sin_generar: 'Sin generar' };

const columnas = computed(() => (datos.value?.columnas ?? []).filter((c) => c.letra));
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pasa = (r) => {
  const clave = sinTildes(buscar.value.trim());
  return (!categoriaFiltro.value || r.categoria === categoriaFiltro.value)
    && (!clave || sinTildes(`${r.nombre} ${r.codigoInterno}`).includes(clave));
};
const renglones = computed(() => (datos.value?.renglones ?? [])
  .filter(pasa)
  .filter((r) => !soloPedir.value || r.cantidadSolicitar > 0));
// La vista por servicio usa el mismo buscador y las mismas categorias.
const filtroServicio = computed(() => {
  const ids = soloPedir.value ? new Set(renglones.value.map((r) => r.insumoId)) : null;
  return (f) => pasa(f) && (!ids || ids.has(f.insumoId));
});

const totales = computed(() => {
  const r = datos.value?.renglones ?? [];
  const suma = (c) => r.reduce((s, x) => s + (x[c] ?? 0), 0);
  return { entradas: suma('entradas'), entregado: suma('entregado'), noEntregado: suma('noEntregado'), pedir: r.filter((x) => x.cantidadSolicitar > 0).length };
});

function celda(r, c) {
  const v = r[c.clave];
  if (c.letra === 'K') return v === null || v === undefined ? '—' : decimal(v);
  // El maximo va sin formato en el balance: con sus decimales.
  if (c.letra === 'L') return v ? general(v) : '–';
  return v ? miles(v) : '–';
}
</script>

<template>
  <section>
    <PasosCierre :estado="{ bres: ESTADO[estado] }">
      <template #acciones>
        <RouterLink :to="`/inventario/pedir-ddriss?periodo=${cierre.periodo}`" class="b-btn primario"><Icono nombre="trasladar" :tamano="20" /> Requisición</RouterLink>
        <RouterLink :to="vista === 'servicio' ? `/imprimir/balance/${cierre.periodo}` : `/imprimir/bres/${cierre.periodo}`" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> {{ vista === 'servicio' ? 'Imprimir balance' : 'Imprimir' }}</RouterLink>
        <button type="button" class="b-btn secundario" @click="excel"><Icono nombre="hojaCalculo" :tamano="20" /> Excel</button>
        <button v-if="!cerrado" type="button" class="b-btn primario" :disabled="enviando" @click="generar">{{ guardado ? 'Volver a generar' : 'Generar BRES' }}</button>
      </template>
    </PasosCierre>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4">{{ aviso }}</p>

    <!-- El saldo inicial tiene que empalmar con el BRES anterior -->
    <div v-if="datos?.descuadres.length" class="b-aviso error mt-4 flex-col">
      <div class="flex w-full items-center justify-between gap-3">
        <span>{{ datos.descuadres.length }} {{ datos.descuadres.length === 1 ? 'insumo no empalma' : 'insumos no empalman' }} con el BRES de {{ nombrePeriodo(datos.periodoAnterior) }}.</span>
        <button type="button" class="b-btn peligro chico" @click="verDescuadres = !verDescuadres">{{ verDescuadres ? 'Ocultar' : 'Ver cuáles' }}</button>
      </div>
      <ul v-if="verDescuadres" class="mt-2 w-full space-y-1 text-sm font-semibold">
        <li v-for="d in datos.descuadres" :key="d.insumoId">
          {{ d.nombre }}: cerró con {{ miles(d.saldoSegunBresAnterior) }}, ahora inicia con {{ miles(d.saldoSegunMovimientos) }} ({{ d.diferencia > 0 ? '+' : '' }}{{ miles(d.diferencia) }})
        </li>
      </ul>
    </div>

    <div v-if="datos?.serviciosSinInforme" class="b-aviso atencion mt-4 items-center justify-between">
      <span>Sin consumo capturado: {{ datos.serviciosSinInforme }} {{ datos.serviciosSinInforme === 1 ? 'puesto' : 'puestos' }} (cuentan como cero)</span>
      <RouterLink to="/inventario/informes" class="b-btn secundario chico">Capturar</RouterLink>
    </div>

    <p v-if="cargando" class="b-vacio">Calculando el BRES…</p>

    <template v-else-if="datos">
      <!-- Una barra: buscar, categoría, solo lo que hay que pedir y la vista -->
      <div class="barra-bres mt-3">
        <label class="b-buscar buscar">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" class="b-campo" placeholder="Buscar insumo" aria-label="Buscar insumo" />
        </label>
        <select v-model="categoriaFiltro" class="b-campo categoria" aria-label="Categoría">
          <option value="">Todas las categorías</option>
          <option v-for="(c, clave) in CATEGORIA" :key="clave" :value="clave">{{ c.nombre }}</option>
        </select>
        <button type="button" class="chip-pedir-filtro" :class="{ on: soloPedir }" :aria-pressed="soloPedir" @click="soloPedir = !soloPedir">
          Por pedir <b>{{ totales.pedir }}</b>
        </button>
        <div class="b-segmentado" role="radiogroup" aria-label="Vista">
          <button v-for="v in [['bres', 'BRES'], ['servicio', 'Por servicio']]" :key="v[0]" type="button" role="radio" :aria-checked="vista === v[0]" :class="vista === v[0] ? 'on' : ''" @click="vista = v[0]">{{ v[1] }}</button>
        </div>
      </div>
      <p class="mt-1.5 text-sm font-bold text-apagado">{{ renglones.length }} insumos · {{ datos.serviciosInformaron }} de {{ datos.serviciosTotal }} servicios informaron</p>

      <template v-if="vista === 'servicio'">
        <DetallePorServicio v-if="balance" class="mt-2" :balance="balance" :filtro="filtroServicio" />
        <p v-else class="b-vacio">Cargando el detalle…</p>
      </template>

      <div v-else class="b-tabla-marco alta mt-2">
        <table class="b-tabla">
          <thead>
            <tr>
              <th class="fija">Insumo</th>
              <th v-for="c in columnas" :key="c.clave" class="n" :class="c.letra === 'M' ? 'col-pedir' : ''"><span class="letra">{{ c.letra }}</span>{{ CORTO[c.letra] }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in renglones" :key="r.insumoId">
              <td class="fija">
                <span class="flex items-center gap-2.5" :style="estiloCategoria(r.categoria)">
                  <span class="cat-mini"><Pictograma :categoria="r.categoria" :grosor="2" /></span>
                  <span class="nombre">{{ r.nombre }}</span>
                </span>
              </td>
              <td v-for="c in columnas" :key="c.clave" class="n" :class="{
                cero: !r[c.clave] && c.letra !== 'K',
                fuerte: c.letra === 'H' || c.letra === 'I',
                'k-bajo': c.letra === 'K' && r.bajoMinimo,
                'col-pedir': c.letra === 'M',
              }">
                <span v-if="c.letra === 'M' && r.cantidadSolicitar > 0" class="chip-pedir">{{ miles(r.cantidadSolicitar) }}</span>
                <template v-else>{{ celda(r, c) }}</template>
              </td>
            </tr>
            <tr v-if="!renglones.length"><td :colspan="columnas.length + 1" class="b-vacio">Ningún insumo coincide.</td></tr>
          </tbody>
        </table>
      </div>

      <section v-if="datos.observacionesRecepcion.length" class="b-panel mt-4">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Diferencias al recibir</h2></header>
        <ul class="b-panel-cuerpo space-y-1.5 text-sm">
          <li v-for="(o, i) in datos.observacionesRecepcion" :key="i" class="text-tinta-2">
            <b class="text-tinta">{{ o.insumo }}</b> · lote <span class="font-mono">{{ o.numeroLote }}</span>: documento {{ miles(o.segunDocumento) }}, recibido {{ miles(o.recibido) }}
            <b :class="o.diferencia < 0 ? 'text-[#C03535]' : 'text-[#B7710A]'">({{ o.diferencia > 0 ? '+' : '' }}{{ miles(o.diferencia) }})</b><span v-if="o.observacion"> · {{ o.observacion }}</span>
          </li>
        </ul>
      </section>

      <div v-if="!cerrado" data-accion class="pie">
        <input v-model="observaciones" maxlength="400" placeholder="Observaciones del informe" aria-label="Observaciones del informe" class="b-campo min-w-[14rem] flex-1" />
        <button type="button" class="b-btn exito" :disabled="enviando || !guardado" :title="guardado ? '' : 'Genere el BRES primero'" @click="abrirCierre">
          <Icono nombre="bloqueo" :tamano="20" /> Cerrar BRES de {{ nombrePeriodo(cierre.periodo) }}
        </button>
      </div>
    </template>
    <DialogoCerrarMes v-if="cerrando" :mes="nombrePeriodo(cierre.periodo)" :sin-informe="sinInforme" :enviando="enviando" :error="errorCierre" @confirmar="confirmarCierre" @cancelar="cerrando = false" />
  </section>
</template>

<style scoped>
/* La tabla llena lo que queda de la pantalla; su encabezado queda fijo al bajar. */
.alta { max-height: max(320px, calc(100vh - 300px)); }
.barra-bres { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.barra-bres .buscar { flex: 1 1 220px; }
.barra-bres .categoria { flex: 0 1 220px; height: 44px; }
.chip-pedir-filtro { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 14px; border: 2px solid #F3C677; border-bottom-width: 4px; border-radius: 14px; background: #FFF8EB; font-size: 14.5px; font-weight: 800; color: #8A4B00; }
.chip-pedir-filtro b { min-width: 24px; padding: 0 7px; border-radius: 9px; background: #E8930C; color: #fff; text-align: center; }
.chip-pedir-filtro.on { background: #E8930C; border-color: #B4610A; color: #fff; }
.chip-pedir-filtro.on b { background: #fff; color: #B4610A; }
.b-tabla th { vertical-align: bottom; }
.b-tabla th .letra { display: block; font-size: 11px; color: #94A3B8; letter-spacing: .1em; }
.fija { position: sticky; left: 0; z-index: 2; background: #fff; min-width: 230px; max-width: 260px; border-right: 2px solid #E2E8F0; }
.alta :deep(th), .alta :deep(td) { padding-left: 8px; padding-right: 8px; }
.alta :deep(th.n) { white-space: normal; max-width: 86px; line-height: 1.2; }
th.fija { z-index: 3; background: #F1F5F9; }
.nombre { font-weight: 600; color: #14244A; white-space: normal; overflow-wrap: anywhere; }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; border-radius: 7px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 15px; height: 15px; }
.k-bajo { color: #B7710A !important; font-weight: 700; }
.col-pedir { background: #FFFAF3; }
th.col-pedir { background: #FDEFE0 !important; color: #9A3412 !important; }
.chip-pedir { display: inline-block; padding: 2px 8px; border: 2px dashed #EA580C; border-radius: 7px; font-weight: 700; color: #7C2D12; background: #FFF7ED; }
.estado-bres { flex: 0 0 auto; align-items: center; }
.sello-estado { display: inline-block; padding: 4px 12px; border: 3px double currentColor; border-radius: 6px; font-weight: 700; font-size: 14px; letter-spacing: .1em; text-transform: uppercase; }
.estado-bres.cerrado { color: #16794F; }
.estado-bres.borrador { color: #B7710A; }
.estado-bres.sin_generar { color: #94A3B8; }
.pie { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding: 12px 0; background: #fff; border-top: 2px solid #E2E8F0; }
</style>
