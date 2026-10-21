<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import NavTramites from '../../components/bodega/NavTramites.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import DialogoAutorizacion from '../../components/comunes/DialogoAutorizacion.vue';

/**
 * Bajas de inventario.
 *
 * La baja pasa por tres manos separadas: quien la solicita, el director que
 * la autoriza, y quien la aplica al inventario. El procedimiento del MSPAS no
 * permite sacar producto sin oficio ni autorización, y aquí el sistema lo
 * hace cumplir en vez de confiar en que alguien se acuerde.
 */
const oficios = ref([]);
const candidatos = ref([]);
const error = ref('');
const aviso = ref('');
const cargando = ref(true);
const enviando = ref(false);

const solicitando = ref(false);
const f = reactive({ loteId: '', cantidad: '', causa: '', detalle: '', numeroTarjeta: '', precioUnitario: '' });

// Autorización del director para el oficio que se está autorizando.
const autorizando = ref(null);
const errorAutorizacion = ref('');

async function cargar() {
  cargando.value = true;
  try {
    const [lista, sugeridos] = await Promise.all([
      servicio.oficiosBaja(),
      servicio.candidatosBaja(),
    ]);
    oficios.value = lista.oficios;
    // El saldo importado sin lote se registra en el inventario físico, no se da de baja.
    candidatos.value = sugeridos.lotes.filter((l) => l.numeroLote !== 'SIN-LOTE');
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

const loteElegido = computed(() =>
  candidatos.value.find((l) => l.loteId === Number(f.loteId)) ?? null,
);

function elegirLote(lote) {
  solicitando.value = true;
  Object.assign(f, {
    loteId: lote.loteId,
    cantidad: lote.cantidadActual,
    causa: lote.causaSugerida,
    detalle: '',
    numeroTarjeta: '',
    precioUnitario: lote.costoUnitario ?? '',
  });
}

async function solicitar() {
  enviando.value = true;
  error.value = '';
  try {
    const r = await servicio.solicitarBaja({
      loteId: Number(f.loteId),
      cantidad: Number(String(f.cantidad).replace(/[^\d]/g, '')),
      causa: f.causa,
      detalle: f.detalle,
      ...(f.numeroTarjeta ? { numeroTarjeta: f.numeroTarjeta } : {}),
      ...(f.precioUnitario ? { precioUnitario: Number(f.precioUnitario) } : {}),
    });
    aviso.value = `Oficio ${r.oficio.correlativo} creado. Necesita la autorización del director.`;
    solicitando.value = false;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function autorizar(autorizacion) {
  enviando.value = true;
  errorAutorizacion.value = '';
  try {
    const correlativo = autorizando.value.correlativo;
    await servicio.autorizarBaja(autorizando.value.id, autorizacion);
    aviso.value = `Oficio ${correlativo} autorizado. Ya se puede aplicar.`;
    autorizando.value = null;
    await cargar();
  } catch (fallo) {
    // El error de autorización se muestra dentro del diálogo, no fuera.
    errorAutorizacion.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function aplicar(oficio) {
  enviando.value = true;
  error.value = '';
  try {
    await servicio.aplicarBaja(oficio.id);
    aviso.value = `Baja del oficio ${oficio.correlativo} aplicada al inventario.`;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function anular(oficio) {
  enviando.value = true;
  try {
    await servicio.anularBaja(oficio.id);
    aviso.value = `Oficio ${oficio.correlativo} anulado.`;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const PASO = { borrador: 1, autorizado: 2, aplicado: 3, anulado: 0 };
const filtroOficios = ref('tramite');
const oficiosVisibles = computed(() => oficios.value.filter((o) => (filtroOficios.value === 'tramite') === ['borrador', 'autorizado'].includes(o.estado)));
const semaforoDe = (l) => (new Date(l.fechaVence) < new Date() ? 'vencido' : 'rojo');

function fecha(v) {
  return v ? new Date(v).toLocaleDateString('es-GT') : '';
}

onMounted(cargar);
</script>

<template>
  <section>
    <header class="b-cabecera">
      <h1 class="b-titulo">Bajas y retiros</h1>
      <NavTramites />
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4">{{ aviso }}</p>

    <p v-if="cargando" class="b-vacio">Cargando…</p>

    <div v-else class="rejilla mt-5">
      <!-- Lotes por dar de baja / solicitud -->
      <div class="min-w-0">
        <form v-if="solicitando" class="b-panel formulario" @submit.prevent="solicitar">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Solicitud de baja</h2>
            <button type="button" class="cerrar" aria-label="Cerrar" @click="solicitando = false"><Icono nombre="cerrar" :tamano="20" :grosor="2.2" /></button>
          </header>
          <div class="b-panel-cuerpo space-y-4">
            <div v-if="loteElegido" class="b-boleto vacio">
              <span class="min-w-0">
                <span class="block nombre-completo font-semibold text-tinta">{{ loteElegido.insumo }}</span>
                <span class="codigo text-[13px]">{{ loteElegido.numeroLote }}</span>
              </span>
              <span class="cant">{{ miles(loteElegido.cantidadActual) }}</span>
              <SelloVence :fecha="loteElegido.fechaVence" :semaforo="semaforoDe(loteElegido)" />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label for="bCantidad" class="b-etiqueta">Cantidad</label>
                <input id="bCantidad" v-model="f.cantidad" inputmode="numeric" required class="b-campo num" />
              </div>
              <div>
                <span class="b-etiqueta">Causa</span>
                <div class="b-segmentado w-full" role="radiogroup">
                  <button v-for="c in [['producto_vencido', 'Vencido'], ['producto_danado', 'Dañado']]" :key="c[0]" type="button" role="radio" class="flex-1" :aria-checked="f.causa === c[0]" :class="f.causa === c[0] ? 'on' : ''" @click="f.causa = c[0]">{{ c[1] }}</button>
                </div>
              </div>
              <div>
                <label for="bTarjeta" class="b-etiqueta">Tarjeta de control</label>
                <input id="bTarjeta" v-model="f.numeroTarjeta" maxlength="30" class="b-campo" />
              </div>
              <div>
                <label for="bPrecio" class="b-etiqueta">Precio unitario (Q)</label>
                <input id="bPrecio" v-model="f.precioUnitario" inputmode="decimal" class="b-campo num" />
              </div>
              <div class="sm:col-span-2">
                <label for="bDetalle" class="b-etiqueta">Motivo</label>
                <input id="bDetalle" v-model="f.detalle" required minlength="5" maxlength="400" class="b-campo" />
              </div>
            </div>
          </div>
          <footer class="pie"><button type="submit" class="b-btn primario" :disabled="enviando || !f.causa">Crear oficio</button></footer>
        </form>

        <section v-else class="b-panel">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Por dar de baja</h2>
            <span class="b-contador gris">{{ candidatos.length }}</span>
          </header>
          <ul v-if="candidatos.length" class="lista space-y-2 p-3">
            <li v-for="l in candidatos" :key="l.loteId" class="flex items-center gap-2">
              <div class="b-boleto flex-1">
                <span class="min-w-0">
                  <span class="block nombre-completo font-semibold text-tinta">{{ l.insumo }}</span>
                  <span class="mt-0.5 flex items-center gap-2">
                    <span class="codigo text-[13px]">{{ l.numeroLote }}</span>
                    <span v-if="l.estado !== 'vencido'" class="b-estado" :class="l.estado">{{ l.estado }}</span>
                  </span>
                </span>
                <span class="cant">{{ miles(l.cantidadActual) }}</span>
                <SelloVence :fecha="l.fechaVence" :semaforo="semaforoDe(l)" />
              </div>
              <button type="button" class="b-btn peligro chico" @click="elegirLote(l)">Solicitar</button>
            </li>
          </ul>
          <p v-else class="b-vacio">No hay lotes vencidos, dañados ni retirados con existencia.</p>
        </section>
      </div>

      <!-- Oficios -->
      <section class="b-panel">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">Oficios</h2>
          <div class="b-segmentado" role="radiogroup">
            <button v-for="o in [['tramite', 'En trámite'], ['cerrados', 'Cerrados']]" :key="o[0]" type="button" role="radio" :aria-checked="filtroOficios === o[0]" :class="filtroOficios === o[0] ? 'on' : ''" @click="filtroOficios = o[0]">{{ o[1] }}</button>
          </div>
        </header>
        <ul v-if="oficiosVisibles.length" class="lista">
          <li v-for="o in oficiosVisibles" :key="o.id" class="oficio">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-mono text-[13px] font-semibold text-[#172A5A]">{{ o.correlativo }}</p>
                <p class="font-semibold text-tinta">{{ o.insumo }}</p>
                <p class="text-[13px] text-apagado">Lote <span class="font-mono">{{ o.numeroLote }}</span> · {{ miles(o.cantidad) }} unidades · {{ o.causaEtiqueta }}</p>
              </div>
              <RouterLink :to="`/imprimir/oficio-baja/${o.id}`" target="_blank" class="b-btn secundario chico"><Icono nombre="imprimir" :tamano="16" /> Oficio</RouterLink>
            </div>

            <!-- Recorrido del oficio -->
            <ol v-if="o.estado !== 'anulado'" class="recorrido">
              <li :class="PASO[o.estado] >= 1 ? 'hecho' : ''"><b>Solicitado</b><small>{{ o.solicitadoPor }} · {{ fecha(o.solicitadoEn) }}</small></li>
              <li :class="PASO[o.estado] >= 2 ? 'hecho' : PASO[o.estado] === 1 ? 'actual' : ''"><b>Autorizado</b><small>{{ o.autorizadoPor ?? 'Director' }}</small></li>
              <li :class="PASO[o.estado] >= 3 ? 'hecho' : PASO[o.estado] === 2 ? 'actual' : ''"><b>Aplicado</b><small>{{ o.aplicadoEn ? fecha(o.aplicadoEn) : 'Inventario' }}</small></li>
            </ol>
            <p v-else class="mt-2"><span class="b-estado agotado">Anulado</span></p>

            <div v-if="o.estado === 'borrador' || o.estado === 'autorizado'" class="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" class="b-btn secundario chico" :disabled="enviando" @click="anular(o)">Anular</button>
              <button v-if="o.estado === 'borrador'" type="button" class="b-btn primario chico" @click="autorizando = o">Autorizar</button>
              <button v-if="o.estado === 'autorizado'" type="button" class="b-btn exito chico" :disabled="enviando" @click="aplicar(o)">Aplicar al inventario</button>
            </div>
          </li>
        </ul>
        <p v-else class="b-vacio">{{ filtroOficios === 'tramite' ? 'Ningún oficio en trámite.' : 'Sin oficios cerrados.' }}</p>
      </section>
    </div>

    <DialogoAutorizacion
      :abierto="Boolean(autorizando)"
      :operacion="autorizando ? `autorizar la baja del oficio ${autorizando.correlativo}` : ''"
      :error="errorAutorizacion"
      :enviando="enviando"
      @confirmar="autorizar"
      @cancelar="autorizando = null; errorAutorizacion = ''"
    />
  </section>
</template>

<style scoped>
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.lista { max-height: max(380px, calc(100vh - 360px)); overflow-y: auto; }
.formulario { border-color: #172A5A; box-shadow: 0 8px 24px -12px rgba(23, 42, 90, .35); }
.pie { display: flex; justify-content: flex-end; padding: 0 18px 16px; }
.cerrar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; color: #475569; }
.cerrar:hover { background: #F1F5F9; }
.oficio { padding: 14px 18px; border-top: 1px solid #EEF2F6; }
.oficio:first-child { border-top: none; }
.recorrido { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 12px; }
.recorrido li { position: relative; padding: 18px 6px 0 0; line-height: 1.2; }
.recorrido li::before { content: ''; position: absolute; top: 4px; left: 0; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #CBD5E1; background: #fff; z-index: 1; }
.recorrido li::after { content: ''; position: absolute; top: 9px; left: 12px; right: 0; height: 2px; background: #E2E8F0; }
.recorrido li:last-child::after { display: none; }
.recorrido li.hecho::before { border-color: #1E8E5E; background: #1E8E5E; }
.recorrido li.hecho::after { background: #1E8E5E; }
.recorrido li.actual::before { border-color: #E8930C; background: #FFF7E6; box-shadow: 0 0 0 3px #FDF0D5; }
.recorrido b { display: block; font-size: 13px; color: #14244A; }
.recorrido small { display: block; font-size: 11px; font-weight: 600; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recorrido li:not(.hecho):not(.actual) b { color: #94A3B8; }
</style>
