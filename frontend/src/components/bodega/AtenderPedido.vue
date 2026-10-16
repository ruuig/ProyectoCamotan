<script setup>
import { ref, reactive, computed, watch } from 'vue';
import bodega from '../../services/bodega';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../comunes/Icono.vue';
import { miles, estiloTono } from './diseno/PiezasBodega';

/**
 * Atender un pedido (Requisición FOR-ASE-01), como lo pide el formato:
 * cantidad solicitada, autorizada y despachada.
 *
 *  1. Autorizar: por renglón, cuánto se da. Si es menos de lo pedido se dice
 *     por qué; lo que no se da es demanda que bodega pide al Área en su BRES.
 *  2. Despachar: con el número del formulario y quién recibe. Sale por PEPE y
 *     entra a la existencia del servicio (o al estante de farmacia).
 *  3. Rechazar: si el pedido completo no procede, se anula con su motivo y el
 *     servicio lo ve.
 */
const props = defineProps({ id: { type: Number, required: true } });
const emit = defineEmits(['listo', 'cerrar']);

const r = ref(null);
const existencias = ref({});
const error = ref('');
const enviando = ref(false);
const autorizar = reactive({});
const motivos = reactive({});
const despacho = reactive({ numero: '', recibidoPor: '' });
const rechazando = ref(false);
const motivoRechazo = ref('');

const MOTIVOS = ['No hay existencia', 'Ya se le despachó este mes', 'Se reparte entre los servicios', 'Pidió más de lo que consume'];
const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;

async function cargar() {
  error.value = '';
  try {
    const d = await bodega.requisicion(props.id);
    r.value = d.requisicion;
    existencias.value = d.existencias ?? {};
    for (const g of d.requisicion.renglones) {
      const hay = g.insumoId ? existencias.value[g.insumoId]?.enBodega ?? 0 : g.cantidadSolicitada;
      autorizar[g.id] = String(g.cantidadAutorizada ?? Math.min(g.cantidadSolicitada, hay));
      motivos[g.id] = g.motivo ?? (hay < g.cantidadSolicitada ? 'No hay existencia' : '');
    }
    despacho.numero = d.requisicion.numero ?? '';
    despacho.recibidoPor = d.requisicion.recibidoPor ?? d.requisicion.solicitante ?? '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}
watch(() => props.id, cargar, { immediate: true });

const enBodega = (g) => (g.insumoId ? existencias.value[g.insumoId]?.enBodega ?? 0 : null);
const menos = (g) => entero(autorizar[g.id]) < g.cantidadSolicitada;
const excede = (g) => g.insumoId && entero(autorizar[g.id]) > enBodega(g);
const faltaMotivo = computed(() => (r.value?.renglones ?? []).some((g) => menos(g) && !String(motivos[g.id] ?? '').trim()));
const hayExceso = computed(() => (r.value?.renglones ?? []).some(excede));
const totalAutorizado = computed(() => (r.value?.renglones ?? []).reduce((t, g) => t + entero(autorizar[g.id]), 0));
const editable = computed(() => ['solicitada', 'autorizada'].includes(r.value?.estado));

function renglonesAutorizados() {
  return r.value.renglones.map((g) => ({ id: g.id, cantidadAutorizada: entero(autorizar[g.id]), motivo: menos(g) ? motivos[g.id].trim() : null }));
}

async function soloAutorizar() {
  enviando.value = true;
  error.value = '';
  try {
    await bodega.autorizarRequisicion(r.value.id, renglonesAutorizados());
    emit('listo', `Pedido de ${r.value.unidadSeccion} autorizado. Falta despacharlo.`);
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function despachar() {
  enviando.value = true;
  error.value = '';
  try {
    await bodega.autorizarRequisicion(r.value.id, renglonesAutorizados());
    await bodega.despacharRequisicion(r.value.id, {
      numero: despacho.numero.trim(),
      recibidoPor: despacho.recibidoPor.trim(),
      renglones: r.value.renglones.map((g) => ({ id: g.id, cantidadDespachada: entero(autorizar[g.id]) })),
    }, nuevaClaveIdempotencia());
    window.open(`/imprimir/requisicion/${r.value.id}`, '_blank');
    emit('listo', `Despachado a ${r.value.unidadSeccion}: ${miles(totalAutorizado.value)} unidades. Ya está en su existencia.`);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

// Si no hay nada que dar, se responde así: el servicio lo ve y bodega lo
// incluye en lo que pide al Área.
async function avisarSinExistencia() {
  motivoRechazo.value = 'Bodega no tiene existencia de lo pedido: se incluye en lo que bodega pide al Área de Salud';
  await rechazar();
}

async function rechazar() {
  enviando.value = true;
  error.value = '';
  try {
    await bodega.anularRequisicion(r.value.id, motivoRechazo.value.trim());
    emit('listo', `Pedido de ${r.value.unidadSeccion} rechazado. Lo verá con el motivo.`);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');
const ESTADO = {
  solicitada: { texto: 'Por atender', tono: 'accion' },
  autorizada: { texto: 'Autorizado, falta despachar', tono: 'atencion' },
  despachada: { texto: 'Despachado', tono: 'bien' },
  anulada: { texto: 'Rechazado', tono: 'critico' },
};
</script>

<template>
  <article class="atender">
    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
    <template v-if="r">
      <header class="cabeza">
        <div class="min-w-0">
          <span class="estado" :style="estiloTono(ESTADO[r.estado]?.tono ?? 'neutro')">{{ ESTADO[r.estado]?.texto ?? r.estado }}</span>
          <h2>{{ r.unidadSeccion }}</h2>
          <p>Pidió <b>{{ r.solicitante }}</b> el {{ fecha(r.fechaSolicitud) }}<template v-if="r.numero"> · Formulario {{ r.numero }}</template></p>
          <p v-if="r.observaciones" class="obs">{{ r.observaciones }}</p>
        </div>
        <button type="button" class="cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" :tamano="22" :grosor="2.4" /></button>
      </header>

      <!-- Paso 1: cuánto se da de cada cosa -->
      <section class="paso">
        <h3><span class="num">1</span> Cuánto se le da</h3>
        <ul class="renglones">
          <li v-for="g in r.renglones" :key="g.id" class="renglon" :style="estiloTono(excede(g) ? 'critico' : menos(g) ? 'atencion' : 'bien')">
            <div class="min-w-0">
              <b class="nombre">{{ g.descripcion }}</b>
              <p class="datos">
                Pidió <b>{{ miles(g.cantidadSolicitada) }}</b>
                <template v-if="g.insumoId"> · en bodega hay <b :class="{ rojo: enBodega(g) < g.cantidadSolicitada }">{{ miles(enBodega(g)) }}</b></template>
              </p>
              <div v-if="editable && menos(g)" class="motivo">
                <span>¿Por qué menos?</span>
                <button v-for="m in MOTIVOS" :key="m" type="button" :class="{ on: motivos[g.id] === m }" @click="motivos[g.id] = m">{{ m }}</button>
              </div>
              <p v-else-if="g.motivo" class="motivo-texto">{{ g.motivo }}</p>
              <p v-if="excede(g)" class="aviso-rojo">No hay tanto en bodega.</p>
            </div>
            <div class="cantidad">
              <label :for="`a-${g.id}`">Se da</label>
              <input :id="`a-${g.id}`" v-model="autorizar[g.id]" :disabled="!editable" inputmode="numeric" class="b-campo num" />
            </div>
          </li>
        </ul>
        <p class="nota">Lo que no se da no se pierde: es demanda que bodega pide al Área de Salud en el BRES del mes.</p>
      </section>

      <!-- Paso 2: despachar -->
      <section v-if="editable" class="paso">
        <h3><span class="num">2</span> Despachar</h3>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label for="num-form" class="b-etiqueta">No. del formulario</label>
            <input id="num-form" v-model="despacho.numero" class="b-campo grande font-mono" placeholder="El número impreso de la requisición" />
          </div>
          <div>
            <label for="recibe" class="b-etiqueta">Quién recibe</label>
            <input id="recibe" v-model="despacho.recibidoPor" class="b-campo grande" />
          </div>
        </div>
        <div class="botones">
          <button type="button" class="b-btn peligro" :disabled="enviando" @click="rechazando = !rechazando"><Icono nombre="cerrar" :tamano="20" /> Rechazar el pedido</button>
          <button v-if="r.estado === 'solicitada'" type="button" class="b-btn secundario" :disabled="enviando || faltaMotivo || hayExceso" @click="soloAutorizar">
            Solo autorizar
          </button>
          <button v-if="!totalAutorizado" type="button" class="b-btn primario grande-btn" :disabled="enviando" @click="avisarSinExistencia">
            <Icono nombre="alerta" :tamano="22" /> Avisar que no hay existencia
          </button>
          <button v-else type="button" class="b-btn exito grande-btn" :disabled="enviando || faltaMotivo || hayExceso || !despacho.numero.trim() || despacho.recibidoPor.trim().length < 3" @click="despachar">
            <Icono nombre="trasladar" :tamano="22" /> {{ enviando ? 'Despachando…' : `Despachar ${miles(totalAutorizado)} e imprimir` }}
          </button>
        </div>
        <p v-if="faltaMotivo" class="nota rojo-nota">Diga por qué se da menos de lo pedido.</p>
        <form v-if="rechazando" class="rechazo" @submit.prevent="rechazar">
          <label for="mot-rech" class="b-etiqueta">Por qué se rechaza (lo verá quien pidió)</label>
          <input id="mot-rech" v-model="motivoRechazo" minlength="5" class="b-campo" placeholder="Ej.: pedido repetido, ya se despachó el 12 de octubre" />
          <button type="submit" class="b-btn peligro" :disabled="enviando || motivoRechazo.trim().length < 5">Rechazar</button>
        </form>
      </section>

      <section v-else class="paso">
        <p v-if="r.estado === 'anulada'" class="b-aviso error">Rechazado: {{ r.motivoAnulacion }}</p>
        <p v-else class="b-aviso ok">Despachado el {{ fecha(r.despachadaEn) }} por {{ r.despachadaPor }}. Recibió {{ r.recibidoPor }}.</p>
      </section>
    </template>
  </article>
</template>

<style scoped>
.atender { display: grid; gap: 14px; padding: 18px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 22px; background: #fff; }
.cabeza { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cabeza h2 { margin-top: 6px; font-size: 22px; font-weight: 900; color: #14244A; }
.cabeza p { font-size: 14.5px; font-weight: 600; color: #475569; }
.cabeza b { color: #14244A; }
.obs { margin-top: 4px; padding: 6px 10px; border-radius: 10px; background: #F8FAFC; font-size: 13.5px; }
.estado { display: inline-block; padding: 2px 10px; border-radius: 9px; background: var(--t-fondo); color: var(--t-tinta); font-size: 13px; font-weight: 900; }
.cerrar { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; color: #64748B; }
.cerrar:hover { background: #F1F5F9; }
.paso { display: grid; gap: 10px; }
.paso h3 { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 900; color: #14244A; }
.num { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #172A5A; color: #fff; font-size: 14px; }
.renglones { display: grid; gap: 8px; }
.renglon { display: grid; grid-template-columns: minmax(0, 1fr) 130px; align-items: center; gap: 14px; padding: 12px 14px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px; box-shadow: inset 6px 0 0 var(--t); }
.nombre { display: block; font-size: 16.5px; font-weight: 900; color: #14244A; }
.datos { margin-top: 2px; font-size: 14px; font-weight: 600; color: #475569; }
.datos b { color: #14244A; font-weight: 900; }
.datos b.rojo { color: #A83232; }
.motivo { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.motivo span { font-size: 13px; font-weight: 800; color: #8A4B00; }
.motivo button { min-height: 38px; padding: 0 12px; border: 2px solid #E2E8F0; border-bottom-width: 3px; border-radius: 11px; background: #fff; font-size: 13px; font-weight: 800; color: #334155; }
.motivo button.on { border-color: #E8930C; background: #FFF4E0; color: #8A4B00; }
.motivo-texto { margin-top: 4px; font-size: 13px; font-weight: 700; color: #8A4B00; }
.aviso-rojo { margin-top: 4px; font-size: 13px; font-weight: 800; color: #A83232; }
.cantidad { display: grid; gap: 2px; }
.cantidad label { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; color: #64748B; }
.cantidad input { width: 100%; height: 52px; font-size: 20px; font-weight: 900; text-align: right; }
.nota { font-size: 13px; font-weight: 600; color: #64748B; }
.rojo-nota { color: #A83232; font-weight: 800; }
.b-campo.grande { height: 52px; font-size: 17px; }
.botones { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.grande-btn { height: 56px; padding: 0 22px; font-size: 17px; border-radius: 16px; }
.rechazo { display: grid; gap: 8px; padding: 12px; border-radius: 14px; background: #FDECEC; }
@media (max-width: 640px) { .renglon { grid-template-columns: 1fr; } }
</style>
