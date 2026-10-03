<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import bodega from '../../services/bodega';
import EstanteCategoria from '../../components/bodega/diseno/EstanteCategoria.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import { estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Recepción de un lote.
 *
 * El procedimiento AL-MFA del MSPAS pide verificar cuatro cosas antes de
 * ingresar nada: cantidad contra el documento, etiquetado, empaque y aspecto
 * físico. Esta pantalla las pregunta en ese orden y no deja avanzar sin
 * responderlas.
 *
 * Lo que se ingresa es lo que de verdad llegó, no lo que dice el documento.
 * Si no coinciden, la diferencia queda anotada para el BRES.
 */
const route = useRoute();
const router = useRouter();

const insumo = ref(null);
const error = ref('');
const guardando = ref(false);
const resultado = ref(null);

const f = reactive({
  numeroLote: '',
  fechaVence: '',
  fechaFabricacion: '',
  cantidad: '',
  cantidadDocumento: '',
  origen: 'despacho',
  actaDonacion: '',
  fabricante: '',
  registroSanitario: '',
  costoUnitario: '',
  ubicacion: '',
  observacionRecepcion: '',
});

// Las tres verificaciones cualitativas. Empiezan sin responder a propósito:
// marcarlas es un acto, no un valor por omisión.
const verificacion = reactive({ etiquetado: null, empaque: null, aspecto: null });

const ORIGENES = [
  { valor: 'despacho', etiqueta: 'Despacho' },
  { valor: 'donacion', etiqueta: 'Donación' },
  { valor: 'traslado', etiqueta: 'Traslado' },
  { valor: 'prestamo', etiqueta: 'Préstamo' },
];

/**
 * Qué revisar en el aspecto físico, según la forma farmacéutica. La
 * normativa las distingue y no es lo mismo mirar una tableta que un jarabe.
 */
const ASPECTO_POR_FORMA = {
  tableta: 'lisas, sin fisuras, manchas ni cambios de color',
  comprimido: 'lisos, sin fisuras, manchas ni cambios de color',
  capsula: 'sin ablandamiento, pegajosidad ni contenido derramado',
  cápsula: 'sin ablandamiento, pegajosidad ni contenido derramado',
  jarabe: 'límpido, sin partículas en suspensión ni sedimento',
  suspension: 'homogénea al agitar, sin grumos',
  suspensión: 'homogénea al agitar, sin grumos',
  solucion: 'cristalina, sin turbidez ni partículas',
  solución: 'cristalina, sin turbidez ni partículas',
  inyectable: 'sin partículas, ampolla íntegra y sellada',
};

const guiaAspecto = computed(() => {
  const forma = (insumo.value?.formaFarmaceutica ?? '').toLowerCase().trim();
  return ASPECTO_POR_FORMA[forma] ?? 'sin alteraciones visibles de color, olor o consistencia';
});

const entero = (v) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
const diferencia = computed(() => {
  const recibido = entero(f.cantidad);
  const documento = entero(f.cantidadDocumento);
  if (!f.cantidad || !f.cantidadDocumento) return null;
  return recibido - documento;
});

const noConforme = computed(() =>
  verificacion.etiquetado === false
  || verificacion.empaque === false
  || verificacion.aspecto === false,
);

const sinVerificar = computed(() =>
  verificacion.etiquetado === null
  || verificacion.empaque === null
  || verificacion.aspecto === null,
);

const esDonacion = computed(() => f.origen === 'donacion');

async function cargar() {
  try {
    const datos = await bodega.ficha(route.params.id);
    insumo.value = datos.insumo;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

// Las mismas reglas que valida el servidor, para avisar antes de enviar.
const avisoVencimiento = computed(() => {
  if (!f.fechaVence) return null;
  const vence = new Date(`${f.fechaVence}T12:00:00`);
  if (f.fechaFabricacion && new Date(`${f.fechaFabricacion}T12:00:00`) > vence) {
    return { error: true, texto: 'Vence antes de su fecha de fabricación' };
  }
  const meses = (vence - Date.now()) / (30.4375 * 86400000);
  if (meses < 0) return { error: true, texto: 'El lote ya está vencido: no se puede recibir' };
  if (meses < 3) return { error: false, texto: 'Vence en menos de 3 meses' };
  return null;
});

async function guardar() {
  guardando.value = true;
  error.value = '';
  try {
    resultado.value = await servicio.recibirLote(route.params.id, {
      numeroLote: f.numeroLote.trim(),
      fechaVence: f.fechaVence,
      ...(f.fechaFabricacion ? { fechaFabricacion: f.fechaFabricacion } : {}),
      cantidad: entero(f.cantidad),
      ...(f.cantidadDocumento ? { cantidadDocumento: entero(f.cantidadDocumento) } : {}),
      origen: f.origen,
      ...(f.actaDonacion ? { actaDonacion: f.actaDonacion.trim() } : {}),
      ...(f.fabricante ? { fabricante: f.fabricante.trim() } : {}),
      ...(f.registroSanitario ? { registroSanitario: f.registroSanitario.trim() } : {}),
      ...(f.costoUnitario ? { costoUnitario: Number(String(f.costoUnitario).replace(',', '.')) } : {}),
      ...(f.ubicacion ? { ubicacion: f.ubicacion.trim() } : {}),
      verificacion: {
        etiquetado: verificacion.etiquetado,
        empaque: verificacion.empaque,
        aspecto: verificacion.aspecto,
      },
      ...(f.observacionRecepcion ? { observacionRecepcion: f.observacionRecepcion.trim() } : {}),
    });
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

const VERIFICACIONES = computed(() => [
  { clave: 'etiquetado', titulo: 'Etiquetado', detalle: 'Nombre, concentración, lote, vencimiento, registro y almacenamiento', si: 'Completo', no: 'Incompleto' },
  { clave: 'empaque', titulo: 'Empaque', detalle: 'Sellado, sin humedad, manchas ni perforaciones', si: 'Íntegro', no: 'Dañado' },
  { clave: 'aspecto', titulo: 'Aspecto físico', detalle: guiaAspecto.value[0].toUpperCase() + guiaAspecto.value.slice(1), si: 'Conforme', no: 'Alterado' },
]);

onMounted(cargar);
</script>

<template>
  <section :style="insumo ? estiloCategoria(insumo.categoria) : null">
    <RouterLink :to="`/inventario/${route.params.id}`" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> {{ insumo?.nombreGenerico ?? 'Insumo' }}</RouterLink>
    <header class="b-cabecera">
      <div class="min-w-0">
        <EstanteCategoria v-if="insumo" :categoria="insumo.categoria" />
        <h1 class="b-titulo mt-2">Recibir lote</h1>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <!-- Resultado -->
    <div v-if="resultado" class="mt-5 space-y-4">
      <div class="b-boleto recibido">
        <span class="min-w-0">
          <span class="b-subtitulo">Lote registrado</span>
          <span class="codigo block text-[22px]">{{ resultado.lote.numeroLote }}</span>
        </span>
        <span class="cant text-[22px]">{{ miles(resultado.lote.cantidadInicial) }}</span>
        <SelloVence :fecha="resultado.lote.fechaVence" :semaforo="resultado.semaforo" />
      </div>
      <p v-for="(a, i) in resultado.avisos" :key="i" class="b-aviso" :class="resultado.enCuarentena ? 'error' : 'atencion'">{{ a }}</p>
      <div class="flex flex-wrap gap-2">
        <RouterLink :to="`/inventario/${route.params.id}`" class="b-btn primario">Ver el insumo</RouterLink>
        <button type="button" class="b-btn secundario" @click="resultado = null"><Icono nombre="agregar" :tamano="20" /> Recibir otro lote</button>
      </div>
    </div>

    <form v-else class="rejilla mt-5" @submit.prevent="guardar">
      <div class="space-y-4">
        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Lote</h2></header>
          <div class="b-panel-cuerpo grid gap-4 sm:grid-cols-3">
            <div>
              <label for="numeroLote" class="b-etiqueta">Número de lote</label>
              <input id="numeroLote" v-model="f.numeroLote" required maxlength="60" class="b-campo font-mono" />
            </div>
            <div>
              <label for="fechaVence" class="b-etiqueta">Vence</label>
              <input id="fechaVence" v-model="f.fechaVence" type="date" required class="b-campo" :class="avisoVencimiento?.error ? '!border-[#C03535]' : ''" />
              <p v-if="avisoVencimiento" class="mt-1 text-[13px] font-bold" :class="avisoVencimiento.error ? 'text-[#C03535]' : 'text-[#B7710A]'">{{ avisoVencimiento.texto }}</p>
            </div>
            <div>
              <label for="fechaFabricacion" class="b-etiqueta">Fabricación</label>
              <input id="fechaFabricacion" v-model="f.fechaFabricacion" type="date" :max="f.fechaVence || undefined" class="b-campo" />
            </div>
            <div class="sm:col-span-3">
              <span class="b-etiqueta">Procedencia</span>
              <div class="b-segmentado flex-wrap" role="radiogroup">
                <button v-for="o in ORIGENES" :key="o.valor" type="button" role="radio" :aria-checked="f.origen === o.valor" :class="f.origen === o.valor ? 'on' : ''" @click="f.origen = o.valor">{{ o.etiqueta }}</button>
              </div>
            </div>
            <div v-if="esDonacion">
              <label for="actaDonacion" class="b-etiqueta">Acta de donación</label>
              <input id="actaDonacion" v-model="f.actaDonacion" required maxlength="60" class="b-campo" />
            </div>
            <div>
              <label for="fabricante" class="b-etiqueta">Fabricante</label>
              <input id="fabricante" v-model="f.fabricante" maxlength="120" class="b-campo" />
            </div>
            <div>
              <label for="registroSanitario" class="b-etiqueta">Registro sanitario</label>
              <input id="registroSanitario" v-model="f.registroSanitario" maxlength="60" class="b-campo" />
            </div>
            <div>
              <label for="ubicacion" class="b-etiqueta">Ubicación</label>
              <input id="ubicacion" v-model="f.ubicacion" maxlength="60" placeholder="Estante 2, nivel B" class="b-campo" />
            </div>
            <div>
              <label for="costoUnitario" class="b-etiqueta">Costo unitario (Q)</label>
              <input id="costoUnitario" v-model="f.costoUnitario" inputmode="decimal" class="b-campo num" />
            </div>
          </div>
        </section>

        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Cantidad</h2></header>
          <div class="b-panel-cuerpo cantidades">
            <div>
              <label for="cantidadDocumento" class="b-etiqueta">Según el documento</label>
              <input id="cantidadDocumento" v-model="f.cantidadDocumento" inputmode="numeric" class="b-campo num grande" />
            </div>
            <div>
              <label for="cantidad" class="b-etiqueta">Recibido</label>
              <input id="cantidad" v-model="f.cantidad" inputmode="numeric" required class="b-campo num grande" />
            </div>
            <div class="diferencia" :class="diferencia === null ? '' : diferencia === 0 ? 'igual' : 'distinta'">
              <span class="b-etiqueta">Diferencia</span>
              <span class="valor">{{ diferencia === null ? '—' : diferencia === 0 ? 'Coincide' : `${diferencia > 0 ? '+' : ''}${miles(diferencia)}` }}</span>
            </div>
          </div>
        </section>
      </div>

      <!-- Verificación -->
      <aside class="space-y-3">
        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Verificación del producto</h2></header>
          <div class="b-panel-cuerpo space-y-4">
            <fieldset v-for="v in VERIFICACIONES" :key="v.clave">
              <legend class="font-bold text-tinta">{{ v.titulo }}</legend>
              <p class="mb-2 text-[13px] text-apagado">{{ v.detalle }}</p>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="opcion si" :class="verificacion[v.clave] === true ? 'on' : ''" :aria-pressed="verificacion[v.clave] === true" @click="verificacion[v.clave] = true"><Icono nombre="correcto" :tamano="18" /> {{ v.si }}</button>
                <button type="button" class="opcion no" :class="verificacion[v.clave] === false ? 'on' : ''" :aria-pressed="verificacion[v.clave] === false" @click="verificacion[v.clave] = false"><Icono nombre="cerrar" :tamano="18" :grosor="2.2" /> {{ v.no }}</button>
              </div>
            </fieldset>
            <div>
              <label for="observacionRecepcion" class="b-etiqueta">Observaciones</label>
              <input id="observacionRecepcion" v-model="f.observacionRecepcion" maxlength="400" class="b-campo" />
            </div>
          </div>
        </section>

        <p v-if="noConforme" class="b-aviso error">Entrará en cuarentena.</p>
        <button type="submit" class="b-btn primario w-full" :disabled="guardando || sinVerificar || avisoVencimiento?.error">
          <Icono nombre="recibir" :tamano="20" :grosor="2" /> {{ guardando ? 'Registrando…' : 'Registrar recepción' }}
        </button>
      </aside>
    </form>
  </section>
</template>

<style scoped>
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.cantidades { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; align-items: end; }
.grande { height: 56px; font-size: 22px; font-weight: 700; }
.diferencia { display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
.diferencia .valor { display: grid; place-items: center; height: 56px; border-radius: 10px; background: #F1F5F9; font-size: 20px; font-weight: 700; color: #94A3B8; font-variant-numeric: tabular-nums; }
.diferencia.igual .valor { background: #E3F5EC; color: #145C3C; }
.diferencia.distinta .valor { background: #FDF0D5; color: #7A4F05; }
.opcion { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 44px; border: 2px solid #CBD5E1; border-radius: 10px; font-weight: 700; color: #475569; background: #fff; }
.opcion:hover { border-color: #64748B; }
.opcion.si.on { border-color: #1E8E5E; background: #1E8E5E; color: #fff; }
.opcion.no.on { border-color: #C03535; background: #C03535; color: #fff; }
.recibido { border-color: #1E8E5E; }
</style>
