<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { usarBorrador } from '../../dominio/borrador';
import AvisoBorrador from '../../components/comunes/AvisoBorrador.vue';
import { RouterLink, useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';
import RecibirRequisicion from '../../components/bodega/RecibirRequisicion.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/**
 * Recibir: lo que llega a bodega con su documento (despacho de la DDRISS,
 * donación, préstamo) y todos sus productos de una vez.
 *
 * La entrada es lo que dice el documento. Si llegó menos, la diferencia queda
 * por reclamar y no se entrega hasta que llegue.
 */
const route = useRoute();

const vista = ref(route.query.ver === 'faltantes' ? 'faltantes' : 'nueva');
// Todo entra por requisición; sin ella solo en un caso especial (inventario inicial y similares).
const sinRequisicion = ref(false);
const insumos = ref([]);
const recibidas = ref([]);
const faltantes = ref([]);
const error = ref('');
const aviso = ref('');
const enviando = ref(false);

const hoy = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const VACIO = () => ({ numeroDocumento: '', procedencia: 'despacho', remitente: 'Almacén DDRISS Chiquimula', acta: '', fecha: hoy(), observaciones: '' });
const doc = reactive(VACIO());
const renglones = ref([]);
const borrador = usarBorrador('recibir-sin-requisicion', { doc, renglones }, { vacio: (d) => !d.renglones.length });

const PROCEDENCIAS = [['despacho', 'Despacho'], ['donacion', 'Donación'], ['prestamo', 'Préstamo'], ['traslado', 'Traslado']];
// Casi todo llega por despacho: los otros orígenes se abren solo cuando hace falta.
const otroOrigen = computed(() => doc.procedencia !== 'despacho');
function elegirOtroOrigen() {
  doc.procedencia = 'donacion';
  doc.remitente = '';
}
function volverADespacho() {
  doc.procedencia = 'despacho';
  doc.remitente = VACIO().remitente;
}
const entero = (v) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;

function agregar(insumo) {
  renglones.value.push({
    insumoId: insumo.id, nombre: insumo.nombreGenerico, unidad: insumo.unidadEntrega,
    numeroLote: '', vence: '', cantidadDocumento: '', cantidadRecibida: '', costoUnitario: '', conforme: true,
  });
}

const faltan = (r) => Math.max(0, entero(r.cantidadDocumento) - (r.cantidadRecibida === '' ? entero(r.cantidadDocumento) : entero(r.cantidadRecibida)));
const totalFaltan = computed(() => renglones.value.filter((r) => faltan(r) > 0).length);
const completo = computed(() => renglones.value.length > 0 && renglones.value.every((r) => r.numeroLote.trim() && r.vence && entero(r.cantidadDocumento) > 0));

async function cargar() {
  try {
    const [i, r, f] = await Promise.all([inventario.insumos(), bodega.recepciones(), bodega.faltantes()]);
    insumos.value = i.insumos;
    recibidas.value = r.recepciones;
    faltantes.value = f.faltantes;
    if (route.query.insumo && !renglones.value.length) {
      const elegido = i.insumos.find((x) => String(x.id) === String(route.query.insumo));
      if (elegido) agregar(elegido);
    }
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function registrar() {
  error.value = '';
  aviso.value = '';
  enviando.value = true;
  try {
    const r = await bodega.recibir({
      ...doc,
      numeroDocumento: doc.numeroDocumento.trim() || null,
      acta: doc.procedencia === 'donacion' ? doc.acta.trim() || null : null,
      renglones: renglones.value.map((x) => ({
        insumoId: x.insumoId,
        numeroLote: x.numeroLote.trim(),
        vence: x.vence,
        cantidadDocumento: entero(x.cantidadDocumento),
        cantidadRecibida: x.cantidadRecibida === '' ? entero(x.cantidadDocumento) : entero(x.cantidadRecibida),
        costoUnitario: x.costoUnitario === '' ? null : Number(x.costoUnitario),
        conforme: x.conforme,
      })),
    }, `recepcion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    aviso.value = `Recepción registrada: ${r.recepcion.renglones.length} producto(s)${r.faltantes ? `, ${r.faltantes} con faltante por reclamar` : ''}.`;
    Object.assign(doc, VACIO());
    renglones.value = [];
    borrador.limpiar();
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

// Lo que faltaba de una recepción y ya llegó: todo, o una parte.
const reponiendo = ref(null);
const parte = ref('');
function llego(f) {
  reponiendo.value = f;
  parte.value = '';
}
async function registrarLlegada(cantidad) {
  if (!cantidad || cantidad > reponiendo.value.porReponer) return;
  const f = reponiendo.value;
  error.value = '';
  enviando.value = true;
  try {
    await bodega.reponer(f.loteId, cantidad);
    aviso.value = `Registrado: llegaron ${cantidad} de ${f.insumo}.`;
    reponiendo.value = null;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

// Lo que trae cada recepción: se abre en su renglón, con el detalle por lote.
const abierta = ref(null);
const detalles = ref({});
async function abrir(id) {
  abierta.value = abierta.value === id ? null : id;
  if (abierta.value == null || detalles.value[id]) return;
  try {
    detalles.value = { ...detalles.value, [id]: (await bodega.recepcion(id)).recepcion };
  } catch (fallo) {
    error.value = fallo.message;
  }
}
const recibido = (x) => x.cantidadDocumento - (x.porReponer ?? 0);
const dinero = (v) => (v == null ? '' : `Q ${Number(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

onMounted(() => { if (borrador.recuperar()) sinRequisicion.value = true; cargar(); });
</script>

<template>
  <section>
    <header class="b-cabecera">
      <h1 class="b-titulo">Recibir</h1>
      <div class="b-segmentado" role="radiogroup" aria-label="Vista">
        <button v-for="m in [['nueva', 'Nueva recepción'], ['recibidas', `Recibidas (${recibidas.length})`], ['faltantes', `Faltantes por reclamar (${faltantes.length})`]]" :key="m[0]" type="button" role="radio" :aria-checked="vista === m[0]" :class="vista === m[0] ? 'on' : ''" @click="vista = m[0]">{{ m[1] }}</button>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4" aria-live="polite">{{ aviso }}</p>

    <!-- Nueva recepción: contra la requisición que llegó -->
    <div v-if="vista === 'nueva' && !sinRequisicion" class="mt-5 space-y-4">
      <RecibirRequisicion :inicial="route.query.requisicion ?? null" @aviso="(t) => { aviso = t; error = ''; }" @error="(t) => (error = t)" @listo="cargar" />
      <button type="button" class="enlace-origen" @click="sinRequisicion = true">Registrar sin requisición (inventario inicial u otro caso especial)</button>
    </div>

    <!-- Caso especial: sin requisición -->
    <form v-if="vista === 'nueva' && sinRequisicion" class="mt-5 space-y-4" @submit.prevent="registrar">
      <button type="button" class="enlace-origen" @click="sinRequisicion = false">← Volver a recibir por requisición</button>
      <div class="documento">
        <!-- Todo llega por despacho de la DDRISS; otro origen solo en un caso concreto. -->
        <fieldset v-if="otroOrigen" class="col-llega">
          <legend class="b-etiqueta">Llega por</legend>
          <div class="flex flex-wrap items-center gap-3">
            <div class="b-segmentado" role="radiogroup">
              <button v-for="p in PROCEDENCIAS.slice(1)" :key="p[0]" type="button" role="radio" :aria-checked="doc.procedencia === p[0]" :class="doc.procedencia === p[0] ? 'on' : ''" @click="doc.procedencia = p[0]">{{ p[1] }}</button>
            </div>
            <button type="button" class="enlace-origen" @click="volverADespacho">Volver a despacho</button>
          </div>
        </fieldset>
        <div class="col-rem">
          <label for="rem" class="b-etiqueta">{{ doc.procedencia === 'donacion' ? 'Donante' : 'Viene de' }}</label>
          <input id="rem" v-model="doc.remitente" required minlength="3" maxlength="160" class="b-campo" />
        </div>
        <div v-if="doc.procedencia === 'donacion'">
          <label for="acta" class="b-etiqueta">Acta</label>
          <input id="acta" v-model="doc.acta" maxlength="60" class="b-campo" placeholder="09-2023" />
        </div>
        <div v-else>
          <label for="ndoc" class="b-etiqueta">No. de documento</label>
          <input id="ndoc" v-model="doc.numeroDocumento" maxlength="40" class="b-campo font-mono" placeholder="167610" />
        </div>
        <div>
          <label for="fec" class="b-etiqueta">Fecha</label>
          <input id="fec" v-model="doc.fecha" type="date" required class="b-campo" />
        </div>
      </div>
      <button v-if="!otroOrigen" type="button" class="enlace-origen" @click="elegirOtroOrigen">¿No viene por despacho? Donación, préstamo o traslado</button>

      <div class="agregar">
        <span class="b-etiqueta">Agregar producto</span>
        <BuscadorInsumo :insumos="insumos" placeholder="Buscar producto del documento" @elegir="agregar" />
      </div>

      <div class="b-tabla-marco">
        <table class="b-tabla">
          <thead>
            <tr>
              <th>Producto</th><th>Lote</th><th>Vence</th><th class="n">Dice el documento</th><th class="n">Llegó</th><th>Buen estado</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in renglones" :key="i">
              <td class="font-semibold text-tinta">{{ r.nombre }} <small class="block font-normal text-apagado">{{ r.unidad }}</small></td>
              <td><input v-model="r.numeroLote" required maxlength="60" class="celda texto" :aria-label="`Lote de ${r.nombre}`" /></td>
              <td><input v-model="r.vence" type="date" required class="celda fecha-vence" :aria-label="`Vence ${r.nombre}`" /></td>
              <td class="n"><input v-model="r.cantidadDocumento" inputmode="numeric" required class="celda" :aria-label="`Cantidad del documento de ${r.nombre}`" /></td>
              <td class="n">
                <input v-model="r.cantidadRecibida" inputmode="numeric" :placeholder="r.cantidadDocumento || 'igual'" class="celda" :aria-label="`Cantidad que llegó de ${r.nombre}`" />
                <small v-if="faltan(r)" class="falta">faltan {{ faltan(r) }}</small>
              </td>
              <td><label class="flex items-center gap-1.5 text-sm"><input v-model="r.conforme" type="checkbox" /> {{ r.conforme ? 'Sí' : 'No: cuarentena' }}</label></td>
              <td class="n"><button type="button" class="quitar" aria-label="Quitar" @click="renglones.splice(i, 1)"><Icono nombre="cerrar" :tamano="16" /></button></td>
            </tr>
            <tr v-if="!renglones.length"><td colspan="7" class="b-vacio">Agregue los productos del documento.</td></tr>
          </tbody>
        </table>
      </div>
      <p v-if="totalFaltan" class="b-aviso atencion text-sm">
        {{ totalFaltan }} {{ totalFaltan === 1 ? 'producto llegó' : 'productos llegaron' }} incompletos: entra lo que dice el documento y lo que falta queda por reclamar.
      </p>
      <div class="flex flex-wrap gap-2">
        <input v-model="doc.observaciones" maxlength="1000" placeholder="Observaciones" aria-label="Observaciones" class="b-campo min-w-[12rem] flex-1" />
        <button type="submit" class="b-btn primario" :disabled="enviando || !completo"><Icono nombre="recibir" :tamano="20" /> {{ enviando ? 'Registrando…' : 'Registrar recepción' }}</button>
      </div>
    </form>

    <!-- Recibidas -->
    <div v-else-if="vista === 'recibidas'" class="b-tabla-marco mt-5">
      <table class="b-tabla">
        <thead><tr><th class="w-8" /><th>Fecha</th><th>Documento</th><th>Llega por</th><th>Viene de</th><th class="n">Productos</th><th class="n">Unidades</th><th class="n">Por reclamar</th><th /></tr></thead>
        <tbody>
          <template v-for="r in recibidas" :key="r.id">
            <tr class="cursor-pointer" :class="abierta === r.id ? 'fila-abierta' : ''" :aria-expanded="abierta === r.id" @click="abrir(r.id)">
              <td><Icono nombre="irA" :tamano="16" :grosor="2.6" class="flecha" :class="abierta === r.id ? 'abierta' : ''" /></td>
              <td class="whitespace-nowrap">{{ fecha(r.fecha) }}</td>
              <td class="font-mono font-semibold text-[#172A5A]">{{ r.numeroDocumento ?? '—' }}</td>
              <td>{{ r.procedenciaTexto }}</td>
              <td class="font-semibold text-tinta">{{ r.remitente }}</td>
              <td class="n">{{ r.productos }}</td>
              <td class="n">{{ miles(r.unidades) }}</td>
              <td class="n" :class="r.porReponer ? 'rojo' : ''">{{ r.porReponer ? miles(r.porReponer) : '' }}</td>
              <td class="n">
                <RouterLink :to="`/imprimir/requisicion/recepcion/${r.id}`" target="_blank" class="b-btn secundario chico" title="Imprimir en el formulario de requisición (FOR-ASB-01)" @click.stop>
                  <Icono nombre="imprimir" :tamano="16" /> Imprimir
                </RouterLink>
              </td>
            </tr>
            <tr v-if="abierta === r.id" class="detalle-fila">
              <td colspan="8">
                <div v-if="detalles[r.id]" class="detalle">
                  <dl class="datos">
                    <div><dt>{{ detalles[r.id].procedencia === 'donacion' ? 'Acta' : 'Documento' }}</dt><dd class="font-mono">{{ (detalles[r.id].procedencia === 'donacion' ? detalles[r.id].acta : detalles[r.id].numeroDocumento) ?? 'Sin número' }}</dd></div>
                    <div><dt>Registró</dt><dd>{{ detalles[r.id].registradaPor }} · {{ fecha(detalles[r.id].registradaEn) }}</dd></div>
                    <div v-if="detalles[r.id].observaciones" class="ancho"><dt>Observaciones</dt><dd>{{ detalles[r.id].observaciones }}</dd></div>
                  </dl>
                  <table class="b-tabla interna">
                    <thead>
                      <tr><th>Producto</th><th>Lote</th><th>Vence</th><th class="n">Según documento</th><th class="n">Recibido</th><th class="n">Por reclamar</th><th>Estado</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="x in detalles[r.id].renglones" :key="x.loteId">
                        <td class="font-semibold text-tinta">
                          <RouterLink :to="`/inventario/lotes/${x.loteId}`" class="hover:underline">{{ x.insumo }}</RouterLink>
                          <small class="block font-normal text-apagado">{{ x.unidad }}</small>
                        </td>
                        <td class="font-mono">{{ x.numeroLote }}</td>
                        <td class="whitespace-nowrap">{{ fecha(x.fechaVence) }}</td>
                        <td class="n">{{ miles(x.cantidadDocumento) }}</td>
                        <td class="n fuerte">{{ miles(recibido(x)) }}</td>
                        <td class="n" :class="x.porReponer ? 'rojo' : ''">{{ x.porReponer ? miles(x.porReponer) : '' }}</td>
                        <td><span class="b-estado" :class="x.estado">{{ x.estado === 'cuarentena' ? 'Cuarentena' : x.estado === 'disponible' ? 'Disponible' : x.estado }}</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-else class="b-vacio">Cargando el detalle…</p>
              </td>
            </tr>
          </template>
          <tr v-if="!recibidas.length"><td colspan="8" class="b-vacio">Todavía no hay recepciones.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Faltantes por reclamar -->
    <div v-else class="b-tabla-marco mt-5">
      <table class="b-tabla">
        <thead><tr><th>Producto</th><th>Lote</th><th>Documento</th><th>Viene de</th><th>Fecha</th><th class="n">Faltan</th><th /></tr></thead>
        <tbody>
          <tr v-for="f in faltantes" :key="f.loteId">
            <td class="font-semibold text-tinta">{{ f.insumo }}</td>
            <td class="font-mono">{{ f.numeroLote }}</td>
            <td class="font-mono">{{ f.documento ?? '—' }}</td>
            <td>{{ f.remitente ?? '' }}</td>
            <td class="whitespace-nowrap">{{ fecha(f.fecha) }}</td>
            <td class="n rojo">{{ miles(f.porReponer) }}</td>
            <td class="n"><button type="button" class="b-btn secundario chico" @click="llego(f)">Llegó</button></td>
          </tr>
          <tr v-if="!faltantes.length"><td colspan="7" class="b-vacio">No hay faltantes por reclamar.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Llegó lo que faltaba -->
    <div v-if="reponiendo" class="fondo-llego" role="dialog" aria-modal="true" aria-labelledby="titulo-llego" @click.self="reponiendo = null">
      <div class="ventana-llego">
        <p id="titulo-llego" class="llego-titulo">Llegó lo que faltaba</p>
        <p class="llego-producto">{{ reponiendo.insumo }}</p>
        <p class="llego-lote">Lote <b>{{ reponiendo.numeroLote }}</b><template v-if="reponiendo.documento"> · documento {{ reponiendo.documento }}</template></p>
        <div class="llego-falta"><span>Faltaban</span><b>{{ reponiendo.porReponer }}</b></div>
        <button type="button" class="b-btn exito llego-todo" :disabled="enviando" @click="registrarLlegada(reponiendo.porReponer)">
          <Icono nombre="correcto" :tamano="22" /> Llegó todo
        </button>
        <form class="llego-parte" @submit.prevent="registrarLlegada(entero(parte))">
          <input v-model="parte" inputmode="numeric" placeholder="Solo una parte" aria-label="Cuántos llegaron" class="b-campo num" :class="{ invalido: entero(parte) > reponiendo.porReponer }" />
          <button type="submit" class="b-btn secundario" :disabled="enviando || !entero(parte) || entero(parte) > reponiendo.porReponer">Registrar</button>
        </form>
        <button type="button" class="llego-cancelar" @click="reponiendo = null">Cancelar</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.fondo-llego { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .5); }
.ventana-llego { display: grid; gap: 10px; width: min(420px, 100%); padding: 24px; border: 2px solid #E2E8F0; border-bottom-width: 6px; border-radius: 24px; background: #fff; }
.llego-titulo { font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
.llego-producto { font-size: 20px; font-weight: 900; line-height: 1.2; color: #14244A; }
.llego-lote { font-size: 14px; font-weight: 600; color: #64748B; }
.llego-lote b { font-family: 'IBM Plex Mono', monospace; color: #14244A; }
.llego-falta { display: flex; align-items: baseline; justify-content: space-between; padding: 12px 16px; border-radius: 14px; background: #FFF4D6; color: #8A5A06; font-weight: 800; }
.llego-falta b { font-size: 32px; font-weight: 900; }
.llego-todo { height: 56px; font-size: 18px; border-radius: 16px; }
.llego-parte { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.llego-cancelar { justify-self: center; padding: 6px 12px; font-weight: 800; color: #64748B; }
.llego-cancelar:hover { color: #14244A; }
.celda.fecha-vence { width: 160px; text-align: left; }
.documento { display: grid; grid-template-columns: minmax(220px, 1.6fr) minmax(150px, .8fr) minmax(150px, .8fr); gap: 12px; align-items: end; }
.enlace-origen { font-size: 14px; font-weight: 700; color: #2F6FA8; text-decoration: underline; text-underline-offset: 3px; }
/* «Llega por» va solo en su renglón: sus cuatro opciones no caben junto a los campos. */
.documento .col-llega { grid-column: 1 / -1; }
@media (max-width: 900px) { .documento { grid-template-columns: 1fr 1fr; } }
.agregar { display: grid; gap: 6px; padding: 12px; border: 2px dashed #CBD5E1; border-radius: 14px; background: #F8FAFC; }
.celda { width: 96px; height: 38px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 8px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.celda.texto { width: 130px; text-align: left; font-family: ui-monospace, monospace; }
.celda.mes { width: 150px; text-align: left; }
.celda:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.quitar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: #64748B; }
.quitar:hover { background: #FDECEC; color: #C03535; }
.falta { display: block; color: #B42318; font-weight: 700; font-size: 13px; }
.rojo { color: #A83232; font-weight: 800; }
.flecha { color: #64748B; transition: transform .15s; }
.flecha.abierta { transform: rotate(90deg); color: #172A5A; }
.fila-abierta td { background: #EAF3FB; }
.detalle-fila > td { padding: 0 !important; background: #F8FAFC; }
.detalle { padding: 14px 16px 16px 44px; }
.datos { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-bottom: 12px; }
.datos dt { font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.datos dd { font-weight: 700; color: #14244A; }
.datos .ancho { flex-basis: 100%; }
.interna { background: #fff; border: 2px solid #E2E8F0; border-radius: 14px; overflow: hidden; }
/* --- Relieve (estilo duo) --- */
.celda { border-radius: 10px; }
</style>
