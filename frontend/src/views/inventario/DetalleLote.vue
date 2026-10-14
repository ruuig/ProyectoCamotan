<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import EstanteCategoria from '../../components/bodega/diseno/EstanteCategoria.vue';
import { estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/**
 * Trazabilidad de un lote: qué le pasó y a quién le llegó. Son las dos
 * preguntas que hay que contestar en minutos cuando llega una alerta.
 */
const route = useRoute();
const datos = ref(null);
const error = ref('');
const pestana = ref('movimientos');

onMounted(async () => {
  try {
    datos.value = await servicio.trazabilidad(route.params.id);
  } catch (fallo) {
    error.value = fallo.message;
  }
});

const sinLote = computed(() => datos.value?.lote.numeroLote === 'SIN-LOTE');
const semaforo = computed(() => (sinLote.value ? 'sin_fecha' : datos.value?.lote.semaforo));
const verificacionHecha = computed(() => {
  const r = datos.value?.lote.recepcion;
  return Boolean(r) && (r.etiquetado !== null || r.empaque !== null || r.aspecto !== null);
});
const marca = (v) => (v === null ? ['Sin verificar', 'agotado'] : v ? ['Conforme', 'disponible'] : ['No conforme', 'retirado']);
const fechaHora = (v) => (v ? new Date(v).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : '');
const usado = computed(() => (datos.value ? 1 - datos.value.lote.cantidadActual / Math.max(1, datos.value.lote.cantidadInicial) : 0));
</script>

<template>
  <section v-if="datos" :style="estiloCategoria(datos.insumo.categoria)">
    <RouterLink :to="`/inventario/${datos.insumo.id}`" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> {{ datos.insumo.nombreGenerico }}</RouterLink>

    <div v-if="datos.retiroActivo" class="b-aviso error mb-4 items-center justify-between">
      <span>Bajo retiro sanitario · {{ datos.retiroActivo.referencia }} · {{ datos.retiroActivo.motivo }}</span>
      <RouterLink :to="`/inventario/retiros/${datos.retiroActivo.id}`" class="b-btn peligro chico">Ver a quién localizar</RouterLink>
    </div>

    <!-- El lote como boleto grande -->
    <div class="boleto-grande">
      <div class="talon">
        <span class="b-antetitulo">Lote</span>
        <span class="numero">{{ sinLote ? 'Sin lote' : datos.lote.numeroLote }}</span>
        <SelloVence :fecha="datos.lote.fechaVence" :semaforo="semaforo" />
      </div>
      <div class="cuerpo-boleto">
        <EstanteCategoria v-if="datos.insumo.categoria" :categoria="datos.insumo.categoria" />
        <h1 class="mt-2 text-[24px] font-semibold leading-tight text-tinta">{{ datos.insumo.nombreGenerico }}</h1>
        <div class="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <span class="b-subtitulo">En existencia</span>
            <p class="text-[32px] font-bold leading-none tabular-nums text-tinta">{{ miles(datos.lote.cantidadActual) }}<span class="text-base font-semibold text-apagado"> de {{ miles(datos.lote.cantidadInicial) }}</span></p>
          </div>
          <div class="min-w-[160px] flex-1">
            <span class="b-subtitulo">Usado</span>
            <div class="uso"><span :style="{ width: `${usado * 100}%` }" /></div>
          </div>
          <span class="b-estado" :class="datos.lote.estado">{{ datos.lote.estadoEtiqueta }}</span>
        </div>
        <p v-if="datos.lote.motivoEstado" class="mt-2 text-sm font-semibold text-[#7A4F05]">{{ datos.lote.motivoEstado }}<span v-if="datos.lote.cambiadoPor"> · {{ datos.lote.cambiadoPor }}</span></p>
        <RouterLink :to="`/inventario/trazabilidad?lote=${datos.lote.id}`" class="b-btn secundario chico mt-3"><Icono nombre="trazabilidad" :tamano="16" /> Ver recorrido</RouterLink>
        <p class="cuadre" :class="datos.cuadra ? 'ok' : 'mal'">
          <Icono :nombre="datos.cuadra ? 'correcto' : 'alerta'" :tamano="16" />
          {{ datos.cuadra ? 'Cuadra con sus movimientos' : `Los movimientos suman ${miles(datos.saldoCalculado)}` }}
        </p>
      </div>
    </div>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <div class="rejilla mt-5">
      <!-- Datos del lote -->
      <div class="space-y-4">
        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Datos</h2></header>
          <dl class="datos">
            <div><dt>Procedencia</dt><dd>{{ datos.lote.origenEtiqueta }}</dd></div>
            <div><dt>Recibido</dt><dd>{{ new Date(datos.lote.recibidoEn).toLocaleDateString('es-GT') }}</dd></div>
            <div><dt>Vence</dt><dd>{{ sinLote ? 'Por verificar' : fecha(datos.lote.fechaVence) }}</dd></div>
            <div v-if="datos.lote.actaDonacion"><dt>Acta de donación</dt><dd>{{ datos.lote.actaDonacion }}</dd></div>
            <div v-if="datos.lote.fabricante"><dt>Fabricante</dt><dd>{{ datos.lote.fabricante }}</dd></div>
            <div v-if="datos.lote.registroSanitario"><dt>Registro sanitario</dt><dd>{{ datos.lote.registroSanitario }}</dd></div>
            <div v-if="datos.lote.ubicacion"><dt>Ubicación</dt><dd>{{ datos.lote.ubicacion }}</dd></div>
          </dl>
        </section>

        <section v-if="verificacionHecha" class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Recepción</h2></header>
          <dl class="datos">
            <div>
              <dt>Cantidad</dt>
              <dd>
                <span v-if="datos.lote.recepcion.diferencia === null" class="b-estado agotado">Sin documento</span>
                <span v-else-if="datos.lote.recepcion.diferencia === 0" class="b-estado disponible">Coincide</span>
                <span v-else class="b-estado retirado">{{ datos.lote.recepcion.diferencia > 0 ? '+' : '' }}{{ miles(datos.lote.recepcion.diferencia) }}</span>
              </dd>
            </div>
            <div v-for="c in [['etiquetado', 'Etiquetado'], ['empaque', 'Empaque'], ['aspecto', 'Aspecto']]" :key="c[0]">
              <dt>{{ c[1] }}</dt><dd><span class="b-estado" :class="marca(datos.lote.recepcion[c[0]])[1]">{{ marca(datos.lote.recepcion[c[0]])[0] }}</span></dd>
            </div>
          </dl>
          <p v-if="datos.lote.recepcion.observacion" class="px-[18px] pb-4 text-sm text-tinta-2">{{ datos.lote.recepcion.observacion }}</p>
        </section>
      </div>

      <!-- Movimientos y destinos -->
      <section class="b-panel min-w-0">
        <header class="b-panel-cabeza">
          <div class="b-segmentado" role="radiogroup">
            <button v-for="p in [['movimientos', `Movimientos (${datos.movimientos.length})`], ['servicios', `Servicios (${datos.servicios?.length ?? 0})`], ['pacientes', `Pacientes (${datos.pacientes.length})`]]" :key="p[0]" type="button" role="radio" :aria-checked="pestana === p[0]" :class="pestana === p[0] ? 'on' : ''" @click="pestana = p[0]">{{ p[1] }}</button>
          </div>
        </header>

        <ol v-if="pestana === 'movimientos'" class="libro">
          <li v-for="m in datos.movimientos" :key="m.id">
            <span class="punto" :class="m.cantidad > 0 ? 'entra' : 'sale'" />
            <span class="min-w-0 flex-1">
              <b class="block text-tinta">{{ m.etiqueta }}</b>
              <small>{{ fechaHora(m.fecha) }} · {{ m.usuario }}<template v-if="m.motivo"> · {{ m.motivo }}</template></small>
            </span>
            <span class="text-right">
              <b class="block tabular-nums" :class="m.cantidad > 0 ? 'text-[#1E8E5E]' : 'text-tinta'">{{ m.cantidad > 0 ? '+' : '' }}{{ miles(m.cantidad) }}</b>
              <small>quedan {{ miles(m.saldoResultante) }}</small>
            </span>
          </li>
        </ol>

        <ul v-else-if="pestana === 'servicios'" class="libro">
          <li v-for="s in datos.servicios" :key="s.trasladoId">
            <span class="min-w-0 flex-1">
              <b class="block text-tinta">{{ s.ubicacion }}</b>
              <small><span class="font-mono">{{ s.numero }}</span> · recibió {{ s.recibidoPor }} · {{ fecha(s.fecha) }}</small>
            </span>
            <b class="tabular-nums text-tinta">{{ miles(s.cantidad) }}</b>
          </li>
          <li v-if="!datos.servicios?.length" class="b-vacio justify-center">No se ha trasladado a servicios.</li>
        </ul>

        <ul v-else class="libro">
          <li v-for="p in datos.pacientes" :key="`${p.pacienteId}-${p.entregadoEn}`">
            <span class="min-w-0 flex-1">
              <RouterLink :to="`/pacientes/${p.pacienteId}`" class="block font-bold text-tinta hover:underline">{{ p.nombreCompleto }}</RouterLink>
              <small>Exp. {{ p.expediente }} · {{ p.comunidad }} · {{ fecha(p.entregadoEn) }}</small>
            </span>
            <b class="tabular-nums text-tinta">{{ miles(p.cantidad) }}</b>
          </li>
          <li v-if="!datos.pacientes.length" class="b-vacio justify-center">No se ha entregado a pacientes.</li>
        </ul>
      </section>
    </div>
  </section>

  <section v-else>
    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
    <p v-else class="b-vacio">Cargando lote…</p>
  </section>
</template>

<style scoped>
.boleto-grande {
  display: grid; grid-template-columns: 220px minmax(0, 1fr); border: 2px solid #CBD5E1; border-radius: 16px; overflow: hidden; background: #fff;
}
@media (max-width: 700px) { .boleto-grande { grid-template-columns: 1fr; } }
.talon { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 18px 20px; background: var(--cat-fondo); border-right: 2px dashed #CBD5E1; }
.talon .numero { font-family: 'IBM Plex Mono', monospace; font-size: 24px; font-weight: 600; color: #14244A; word-break: break-all; }
.cuerpo-boleto { padding: 18px 22px; }
.uso { margin-top: 6px; height: 10px; border-radius: 5px; background: #E2E8F0; overflow: hidden; }
.uso span { display: block; height: 100%; background: var(--cat); }
.cuadre { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 13px; font-weight: 600; }
.cuadre.ok { color: #1E8E5E; }
.cuadre.mal { color: #C03535; }
.rejilla { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.datos { padding: 6px 18px 12px; }
.datos div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #EEF2F6; font-size: 14px; }
.datos div:last-child { border-bottom: none; }
.datos dt { color: #64748B; font-weight: 600; }
.datos dd { color: #14244A; font-weight: 600; text-align: right; }
.libro { max-height: max(360px, calc(100vh - 470px)); overflow-y: auto; }
.libro li { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-top: 1px solid #EEF2F6; }
.libro li:first-child { border-top: none; }
.libro small { display: block; font-size: 12px; font-weight: 600; color: #64748B; }
.punto { flex-shrink: 0; width: 12px; height: 12px; border-radius: 50%; }
.punto.entra { background: #22A06B; }
.punto.sale { background: #fff; border: 2.5px solid #64748B; }
/* --- Relieve (estilo duo) --- */
.boleto-grande { border-bottom-width: 5px; border-radius: 20px; }
</style>
