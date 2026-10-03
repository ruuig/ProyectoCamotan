<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import servicio from '../../services/inventario';
import Icono from '../comunes/Icono.vue';

/**
 * "Recibí conforme": la firma o huella de quien recibe los medicamentos,
 * la última columna del SIGSA-4. La firma se hace con el dedo o un lápiz en
 * pantalla; la huella necesita el lector conectado a la computadora; "en
 * papel" deja el renglón para firmar en la hoja impresa.
 */
const props = defineProps({
  atencion: { type: Object, required: true }, // { atencionId, paciente, entregas }
});
const emit = defineEmits(['cerrar', 'guardada']);

const quien = ref('paciente');
const nombre = ref('');
const modo = ref('firma');
const enviando = ref(false);
const error = ref('');
const lienzo = ref(null);
const trazada = ref(false);
let ctx = null;
let dibujando = false;

const pideNombre = computed(() => quien.value !== 'paciente');

function prepararLienzo() {
  const c = lienzo.value;
  if (!c) return;
  const escala = window.devicePixelRatio || 1;
  const caja = c.getBoundingClientRect();
  c.width = caja.width * escala;
  c.height = caja.height * escala;
  ctx = c.getContext('2d');
  ctx.scale(escala, escala);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0F172A';
  trazada.value = false;
}

function punto(e) {
  const caja = lienzo.value.getBoundingClientRect();
  return { x: e.clientX - caja.left, y: e.clientY - caja.top };
}
function empezar(e) {
  dibujando = true;
  lienzo.value.setPointerCapture(e.pointerId);
  const p = punto(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}
function mover(e) {
  if (!dibujando) return;
  const p = punto(e);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  trazada.value = true;
}
function terminar() {
  dibujando = false;
}
function limpiar() {
  prepararLienzo();
}

function elegirQuien(q) {
  quien.value = q;
  nombre.value = q === 'responsable' ? props.atencion.paciente.responsableNombre ?? '' : '';
}

async function elegirModo(m) {
  modo.value = m;
  if (m === 'firma') {
    await nextTick();
    prepararLienzo();
  }
}

const listo = computed(() => {
  if (pideNombre.value && nombre.value.trim().length < 3) return false;
  if (modo.value === 'firma') return trazada.value;
  return modo.value === 'papel';
});

async function guardar() {
  enviando.value = true;
  error.value = '';
  try {
    await servicio.registrarConstancia({
      atencionId: props.atencion.atencionId,
      tipo: modo.value,
      quienRecibe: quien.value,
      nombreRecibe: pideNombre.value ? nombre.value.trim() : null,
      imagen: modo.value === 'firma' ? lienzo.value.toDataURL('image/png') : null,
    });
    emit('guardada');
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

onMounted(() => nextTick(prepararLienzo));
</script>

<template>
  <div class="fondo" role="dialog" aria-modal="true" aria-labelledby="titulo-firma" @click.self="emit('cerrar')">
    <div class="ventana">
      <header class="b-panel-cabeza">
        <div>
          <h2 id="titulo-firma" class="b-panel-titulo">Recibí conforme</h2>
          <p class="text-sm font-semibold text-apagado">{{ atencion.paciente.nombres }} {{ atencion.paciente.apellidos }}</p>
        </div>
        <button type="button" class="cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" :tamano="20" :grosor="2.2" /></button>
      </header>

      <div class="b-panel-cuerpo space-y-4">
        <ul class="entregas">
          <li v-for="(e, i) in atencion.entregas" :key="i"><span>{{ e.insumo }}</span><b>{{ e.cantidad }}</b></li>
        </ul>

        <div class="b-rejilla">
          <div class="c12">
            <span class="b-etiqueta">Recibe</span>
            <div class="b-segmentado" role="radiogroup" aria-label="Quién recibe">
              <button v-for="q in [['paciente', 'El paciente'], ['responsable', 'Su responsable'], ['otro', 'Otra persona']]" :key="q[0]" type="button" role="radio" :aria-checked="quien === q[0]" :class="quien === q[0] ? 'on' : ''" @click="elegirQuien(q[0])">{{ q[1] }}</button>
            </div>
          </div>
          <div v-if="pideNombre" class="c12">
            <label for="nombre-recibe" class="b-etiqueta">Nombre de quien recibe</label>
            <input id="nombre-recibe" v-model="nombre" maxlength="160" class="b-campo" />
          </div>
          <div class="c12">
            <span class="b-etiqueta">Constancia</span>
            <div class="b-segmentado" role="radiogroup" aria-label="Forma de la constancia">
              <button type="button" role="radio" :aria-checked="modo === 'firma'" :class="modo === 'firma' ? 'on' : ''" @click="elegirModo('firma')">Firma en pantalla</button>
              <button type="button" role="radio" :aria-checked="modo === 'huella'" :class="modo === 'huella' ? 'on' : ''" @click="elegirModo('huella')">Huella</button>
              <button type="button" role="radio" :aria-checked="modo === 'papel'" :class="modo === 'papel' ? 'on' : ''" @click="elegirModo('papel')">En papel</button>
            </div>
          </div>
        </div>

        <div v-if="modo === 'firma'" class="area-firma">
          <canvas
            ref="lienzo"
            class="lienzo"
            aria-label="Espacio para firmar"
            @pointerdown="empezar"
            @pointermove="mover"
            @pointerup="terminar"
            @pointercancel="terminar"
          />
          <span class="linea" aria-hidden="true" />
          <button type="button" class="b-btn secundario chico borrar" @click="limpiar">Borrar</button>
        </div>
        <div v-else-if="modo === 'huella'" class="b-aviso atencion items-center">
          <Icono nombre="alerta" :tamano="20" />
          <span>Lector de huellas no conectado. Mientras tanto, use la opción «En papel»: huella con tinta en la hoja impresa.</span>
        </div>
        <p v-else class="b-aviso ok">Firma o huella con tinta en la hoja SIGSA-4 impresa.</p>

        <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
      </div>

      <footer class="pie">
        <button type="button" class="b-btn secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="button" class="b-btn primario" :disabled="!listo || enviando" @click="guardar"><Icono nombre="correcto" :tamano="20" /> {{ enviando ? 'Guardando…' : 'Guardar constancia' }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.fondo { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
.ventana { width: min(640px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: #fff; border-radius: 16px; box-shadow: 0 24px 60px -20px rgba(15, 23, 42, .5); }
.cerrar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; color: #475569; }
.cerrar:hover { background: #F1F5F9; }
.entregas { border: 2px solid #EEF2F6; border-radius: 10px; }
.entregas li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 12px; border-top: 1px solid #EEF2F6; font-size: 14px; color: #334155; }
.entregas li:first-child { border-top: none; }
.entregas b { color: #14244A; font-variant-numeric: tabular-nums; }
.area-firma { position: relative; }
.lienzo { display: block; width: 100%; height: 200px; border: 2px dashed #94A3B8; border-radius: 12px; background: #FCFCFD; touch-action: none; cursor: crosshair; }
.linea { position: absolute; left: 24px; right: 24px; bottom: 44px; border-bottom: 1.5px solid #CBD5E1; pointer-events: none; }
.borrar { position: absolute; top: 8px; right: 8px; }
.pie { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 18px; }
</style>
