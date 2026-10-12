<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';
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

const PROCEDENCIAS = [['despacho', 'Despacho'], ['donacion', 'Donación'], ['prestamo', 'Préstamo'], ['traslado', 'Traslado']];
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
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function llego(f) {
  const cantidad = entero(window.prompt(`¿Cuántas llegaron de ${f.insumo}, lote ${f.numeroLote}? (faltan ${f.porReponer})`, String(f.porReponer)));
  if (!cantidad) return;
  error.value = '';
  try {
    await bodega.reponer(f.loteId, cantidad);
    aviso.value = `Registrado: llegaron ${cantidad} de ${f.insumo}.`;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargar);
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

    <!-- Nueva recepción -->
    <form v-if="vista === 'nueva'" class="mt-5 space-y-4" @submit.prevent="registrar">
      <div class="documento">
        <fieldset class="col-llega">
          <legend class="b-etiqueta">Llega por</legend>
          <div class="b-segmentado w-full" role="radiogroup">
            <button v-for="p in PROCEDENCIAS" :key="p[0]" type="button" role="radio" class="flex-1" :aria-checked="doc.procedencia === p[0]" :class="doc.procedencia === p[0] ? 'on' : ''" @click="doc.procedencia = p[0]">{{ p[1] }}</button>
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

      <div class="agregar">
        <span class="b-etiqueta">Agregar producto</span>
        <BuscadorInsumo :insumos="insumos" placeholder="Buscar producto del documento" @elegir="agregar" />
      </div>

      <div class="b-tabla-marco">
        <table class="b-tabla">
          <thead>
            <tr>
              <th>Producto</th><th>Lote</th><th>Vence</th><th class="n">Dice el documento</th><th class="n">Llegó</th><th class="n">Precio u. Q</th><th>Buen estado</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in renglones" :key="i">
              <td class="font-semibold text-tinta">{{ r.nombre }} <small class="block font-normal text-apagado">{{ r.unidad }}</small></td>
              <td><input v-model="r.numeroLote" required maxlength="60" class="celda texto" :aria-label="`Lote de ${r.nombre}`" /></td>
              <td><input v-model="r.vence" type="month" required class="celda mes" :aria-label="`Vence ${r.nombre}`" /></td>
              <td class="n"><input v-model="r.cantidadDocumento" inputmode="numeric" required class="celda" :aria-label="`Cantidad del documento de ${r.nombre}`" /></td>
              <td class="n">
                <input v-model="r.cantidadRecibida" inputmode="numeric" :placeholder="r.cantidadDocumento || 'igual'" class="celda" :aria-label="`Cantidad que llegó de ${r.nombre}`" />
                <small v-if="faltan(r)" class="falta">faltan {{ faltan(r) }}</small>
              </td>
              <td class="n"><input v-model="r.costoUnitario" inputmode="decimal" class="celda" :aria-label="`Precio de ${r.nombre}`" /></td>
              <td><label class="flex items-center gap-1.5 text-sm"><input v-model="r.conforme" type="checkbox" /> {{ r.conforme ? 'Sí' : 'No: cuarentena' }}</label></td>
              <td class="n"><button type="button" class="quitar" aria-label="Quitar" @click="renglones.splice(i, 1)"><Icono nombre="cerrar" :tamano="16" /></button></td>
            </tr>
            <tr v-if="!renglones.length"><td colspan="8" class="b-vacio">Agregue los productos del documento.</td></tr>
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
        <thead><tr><th>Fecha</th><th>Documento</th><th>Llega por</th><th>Viene de</th><th class="n">Productos</th><th class="n">Unidades</th><th class="n">Por reclamar</th></tr></thead>
        <tbody>
          <tr v-for="r in recibidas" :key="r.id">
            <td class="whitespace-nowrap">{{ fecha(r.fecha) }}</td>
            <td class="font-mono font-semibold text-[#172A5A]">{{ r.numeroDocumento ?? '—' }}</td>
            <td>{{ r.procedenciaTexto }}</td>
            <td class="font-semibold text-tinta">{{ r.remitente }}</td>
            <td class="n">{{ r.productos }}</td>
            <td class="n">{{ miles(r.unidades) }}</td>
            <td class="n" :class="r.porReponer ? 'falta' : ''">{{ r.porReponer ? miles(r.porReponer) : '' }}</td>
          </tr>
          <tr v-if="!recibidas.length"><td colspan="7" class="b-vacio">Todavía no hay recepciones.</td></tr>
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
            <td class="n falta">{{ miles(f.porReponer) }}</td>
            <td class="n"><button type="button" class="b-btn secundario chico" @click="llego(f)">Llegó</button></td>
          </tr>
          <tr v-if="!faltantes.length"><td colspan="7" class="b-vacio">No hay faltantes por reclamar.</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.documento { display: grid; grid-template-columns: minmax(330px, 1.3fr) minmax(200px, 1.2fr) minmax(140px, .8fr) minmax(150px, .8fr); gap: 12px; align-items: end; }
@media (max-width: 1099px) { .documento { grid-template-columns: 1fr 1fr; } }
.agregar { display: grid; gap: 6px; padding: 12px; border: 2px dashed #CBD5E1; border-radius: 14px; background: #F8FAFC; }
.celda { width: 96px; height: 38px; padding: 0 10px; border: 2px solid #CBD5E1; border-radius: 8px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.celda.texto { width: 130px; text-align: left; font-family: ui-monospace, monospace; }
.celda.mes { width: 150px; text-align: left; }
.celda:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.quitar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: #64748B; }
.quitar:hover { background: #FDECEC; color: #C03535; }
.falta { display: block; color: #B42318; font-weight: 700; font-size: 13px; }
</style>
