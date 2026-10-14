<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';
import servicio from '../../services/atenciones';
import Icono from '../comunes/Icono.vue';

/**
 * La hoja de evolución de una consulta anterior, tal como la dejó el médico:
 * signos, MC, HEA, EF, diagnóstico y tratamiento, con la receta y lo que
 * farmacia entregó. Solo lectura.
 */
const props = defineProps({
  atencionId: { type: Number, default: null },
  // En la consulta en curso se ofrece copiar el tratamiento.
  puedeCopiar: { type: Boolean, default: false },
});
const emit = defineEmits(['cerrar', 'copiar-tratamiento']);

const hoja = ref(null);
const error = ref('');

async function cargar(id) {
  hoja.value = null;
  error.value = '';
  if (!id) return;
  try {
    hoja.value = await servicio.hoja(id);
  } catch (fallo) {
    error.value = fallo.message;
  }
}
watch(() => props.atencionId, cargar, { immediate: true });

const tecla = (e) => { if (e.key === 'Escape') emit('cerrar'); };
onMounted(() => window.addEventListener('keydown', tecla));
onBeforeUnmount(() => window.removeEventListener('keydown', tecla));

const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '');
const hora = (v) => (v ? new Date(v).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) : '');
const corta = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: 'numeric', month: 'short' }) : '');

// Edad que tenía el día de esa consulta.
const edad = computed(() => {
  const p = hoja.value?.paciente;
  if (!p?.fechaNacimiento) return '';
  const meses = Math.floor((new Date(hoja.value.registradaEn) - new Date(p.fechaNacimiento)) / (30.4375 * 86400000));
  if (meses < 24) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  return `${Math.floor(meses / 12)} años`;
});

/** Lo que pasó en farmacia, en pocas palabras. */
function entrega(r) {
  if (r.estado === 'entregada') return { texto: `Entregado ${corta(r.entregadaEn)}`, mal: false };
  if (r.estado === 'parcial') return { texto: `Entregado ${r.entregado} de ${r.cantidad}`, mal: true };
  if (r.estado === 'no_habia') return { texto: 'No había', mal: true };
  return { texto: 'No entregado', mal: true };
}

const SIGNOS = [
  ['Peso', 'peso'], ['Talla', 'talla', 'cm'], ['Temp.', 'temperatura', '°C'], ['P/A', 'presion'],
  ['F. card.', 'frecCardiaca', 'lpm'], ['F. resp.', 'frecRespiratoria', 'rpm'], ['SatO₂', 'satOxigeno', '%'],
  ['Dolor', 'dolor', '/10'], ['Glucosa', 'glucosa', 'mg/dL'],
];
const signos = computed(() => {
  const p = hoja.value?.preconsulta;
  return SIGNOS.map(([etq, clave, unidad]) => ({
    etq,
    valor: p?.[clave] ?? null,
    unidad: clave === 'peso' ? p?.unidadPeso : unidad,
  }));
});

const sigsa = computed(() => {
  const s = hoja.value?.sigsa;
  if (!s) return [];
  return [
    ['Tipo de consulta', s.tipoConsulta],
    ['Control', s.control],
    ['Sem. gestación', s.semanasGestacion],
    ['Viene', s.referenciaViene],
    ['Se refirió', [s.referenciaFue, s.referidoA].filter(Boolean).join(' a ')],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 'No aplica');
});

const alertas = computed(() => [
  ...(hoja.value?.preconsulta?.triaje?.motivos ?? []).map((m) => ({ texto: m.texto, nivel: m.nivel })),
  ...(hoja.value?.preconsulta?.signosPeligro ?? []).map((t) => ({ texto: t, nivel: 'urgente' })),
]);
</script>

<template>
  <Teleport to="body">
    <div v-if="atencionId" class="fondo" @click.self="emit('cerrar')">
      <article class="hoja" role="dialog" aria-modal="true" aria-labelledby="titulo-hoja">
        <!-- Barra de acciones -->
        <div class="barra">
          <span class="barra-titulo"><Icono nombre="consulta" :tamano="18" /> Hoja de evolución</span>
          <div class="flex gap-2">
            <button v-if="puedeCopiar && hoja?.tratamiento" type="button" class="b-btn secundario chico" @click="emit('copiar-tratamiento', hoja.tratamiento)">
              <Icono nombre="agregar" /> Usar este tratamiento
            </button>
            <button type="button" class="b-btn primario chico" @click="emit('cerrar')"><Icono nombre="cerrar" /> Cerrar</button>
          </div>
        </div>

        <p v-if="error" class="m-6 font-bold text-urgente-700">{{ error }}</p>
        <p v-else-if="!hoja" class="m-6 text-apagado">Abriendo la hoja…</p>

        <div v-else class="papel">
          <!-- Encabezado -->
          <header class="encabezado">
            <div class="min-w-0">
              <h2 id="titulo-hoja" class="paciente">{{ hoja.paciente.apellidos }}, {{ hoja.paciente.nombres }}</h2>
              <p class="datos">
                {{ edad }} · {{ hoja.paciente.sexo === 'M' ? 'Hombre' : 'Mujer' }} · Exp. {{ hoja.paciente.expediente }}<span v-if="hoja.paciente.expedientePapel"> · Ficha {{ hoja.paciente.expedientePapel }}</span>
              </p>
            </div>
            <div class="cuando">
              <p class="dia">{{ fecha(hoja.registradaEn) }}</p>
              <p>{{ hoja.medico ?? 'Sin médico' }}<span v-if="hoja.clinica"> · {{ hoja.clinica }}</span></p>
              <p v-if="hoja.cerradaEn">Cerrada {{ hora(hoja.cerradaEn) }}</p>
            </div>
          </header>

          <!-- Signos vitales, como la franja del formulario -->
          <div class="bloque">
            <h3 class="seccion">Signos vitales de preconsulta</h3>
            <div class="signos">
              <div v-for="s in signos" :key="s.etq" class="celda">
                <span class="etq">{{ s.etq }}</span>
                <span v-if="s.valor !== null && s.valor !== ''" class="valor">{{ s.valor }}<small> {{ s.unidad }}</small></span>
                <span v-else class="valor vacio">—</span>
              </div>
            </div>
            <ul v-if="alertas.length" class="alertas">
              <li v-for="a in alertas" :key="a.texto" :class="a.nivel"><Icono nombre="alerta" :tamano="14" /> {{ a.texto }}</li>
            </ul>
          </div>

          <div class="cuerpo">
            <!-- Izquierda: lo que contó y lo que se encontró -->
            <div class="columna">
              <div class="bloque apartado">
                <h3 class="seccion">MC · Motivo de consulta</h3>
                <p :class="{ vacio: !hoja.motivoConsulta }">{{ hoja.motivoConsulta || '—' }}</p>
              </div>
              <div class="bloque apartado">
                <h3 class="seccion">HEA · Historia de la enfermedad</h3>
                <p :class="{ vacio: !hoja.historiaEnfermedad }">{{ hoja.historiaEnfermedad || '—' }}</p>
              </div>
              <div class="bloque apartado">
                <h3 class="seccion">EF · Examen físico</h3>
                <p :class="{ vacio: !hoja.examenFisico && !hoja.examenSitios?.anormales?.length }">{{ hoja.examenFisico || (hoja.examenSitios?.anormales?.length ? '' : '—') }}</p>
                <p v-if="hoja.examenSitios?.anormales?.length" class="mt-1"><b class="text-urgente-700">Con hallazgos:</b> {{ hoja.examenSitios.anormales.join(', ') }}</p>
                <p v-if="hoja.examenSitios?.hallazgosAnormales" class="mt-1">{{ hoja.examenSitios.hallazgosAnormales }}</p>
                <p v-if="hoja.examenSitios?.otrosHallazgos" class="mt-1">{{ hoja.examenSitios.otrosHallazgos }}</p>
              </div>
              <div v-if="hoja.laboratorios" class="bloque apartado">
                <h3 class="seccion">Laboratorios</h3>
                <p>{{ hoja.laboratorios }}</p>
              </div>
              <div v-if="hoja.orientacion" class="bloque apartado">
                <h3 class="seccion">Orientación</h3>
                <p>{{ hoja.orientacion }}</p>
              </div>
            </div>

            <!-- Derecha: lo que concluyó y lo que indicó -->
            <div class="columna">
              <div class="bloque apartado">
                <h3 class="seccion">IC · Diagnóstico</h3>
                <ol v-if="hoja.diagnosticos.length" class="diagnosticos">
                  <li v-for="(d, i) in hoja.diagnosticos" :key="i">
                    <span class="cie" :class="{ sin: !d.cie }">{{ d.cie ?? 'Sin CIE' }}</span>
                    <span>{{ d.descripcion }}</span>
                  </li>
                </ol>
                <p v-else class="vacio">—</p>
                <p v-if="hoja.otrosProblemas" class="mt-2"><b>Otros problemas:</b> {{ hoja.otrosProblemas }}</p>
              </div>

              <div class="bloque apartado">
                <h3 class="seccion">Tx · Tratamiento</h3>
                <p :class="{ vacio: !hoja.tratamiento }">{{ hoja.tratamiento || '—' }}</p>
              </div>

              <div class="bloque apartado">
                <h3 class="seccion">Receta</h3>
                <table v-if="hoja.recetas.length || hoja.recetasExternas.length" class="receta">
                  <thead><tr><th>Medicamento</th><th class="n">Cant.</th><th>Farmacia</th></tr></thead>
                  <tbody>
                    <tr v-for="r in hoja.recetas" :key="r.id">
                      <td><b>{{ r.medicamento }}</b><small v-if="r.indicaciones">{{ r.indicaciones }}</small></td>
                      <td class="n">{{ r.cantidad }}</td>
                      <td class="estado" :class="{ mal: entrega(r).mal }">{{ entrega(r).texto }}</td>
                    </tr>
                    <tr v-for="(r, i) in hoja.recetasExternas" :key="`e${i}`">
                      <td><b>{{ r.medicamento }}</b><small v-if="r.indicaciones">{{ r.indicaciones }}</small></td>
                      <td class="n">{{ r.cantidad ?? '' }}</td>
                      <td class="estado">Compra fuera</td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="vacio">—</p>
              </div>

              <div v-if="hoja.proximaCita" class="bloque apartado">
                <h3 class="seccion">Próxima cita</h3>
                <p>{{ fecha(hoja.proximaCita) }}</p>
              </div>
            </div>
          </div>

          <div v-if="hoja.referencia" class="bloque pie-seccion">
            <h3 class="seccion">Referencia</h3>
            <p><b>{{ hoja.referencia.servicioDestino }}</b> — {{ hoja.referencia.motivo }}</p>
            <p v-if="hoja.referencia.contrarreferencia" class="mt-1 text-sm">
              <b>Contrarreferencia {{ corta(hoja.referencia.contrarreferencia.recibidaEn) }}:</b>
              {{ [hoja.referencia.contrarreferencia.diagnostico, hoja.referencia.contrarreferencia.recomendaciones].filter(Boolean).join(' · ') }}
            </p>
          </div>

          <footer class="pie">
            <span v-for="[e, v] in sigsa" :key="e"><b>{{ e }}:</b> {{ v }}</span>
          </footer>

          <div v-if="hoja.correcciones.length" class="bloque pie-seccion">
            <h3 class="seccion">Correcciones</h3>
            <ul class="text-sm">
              <li v-for="c in hoja.correcciones" :key="c.id">
                <b>{{ c.etiqueta }}:</b> <s class="text-apagado">{{ c.valorAnterior ?? 'vacío' }}</s> → {{ c.valorNuevo }}
                <span class="text-apagado">· {{ c.usuario }}, {{ corta(c.registradaEn) }}</span>
              </li>
            </ul>
          </div>
        </div>
      </article>
    </div>
  </Teleport>
</template>

<style scoped>
.fondo { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: center; align-items: flex-start; padding: 24px 16px; overflow-y: auto; background: rgba(15, 23, 42, .55); }
.hoja { width: min(1040px, 100%); background: #fff; border-radius: 16px; box-shadow: 0 24px 60px rgba(15, 23, 42, .35); animation: entrar .16s ease-out; }
@keyframes entrar { from { transform: translateY(12px); opacity: 0; } }
.barra { position: sticky; top: -24px; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; background: #F1F5F9; border-bottom: 2px solid #E2E8F0; border-radius: 16px 16px 0 0; }
.barra-titulo { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; color: #14244A; }
.papel { padding: 24px 32px 28px; color: #1E293B; }
.encabezado { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px 24px; padding-bottom: 16px; border-bottom: 3px solid #14244A; }
.antetitulo { font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #64748B; }
.paciente { margin-top: 2px; font-size: 26px; font-weight: 700; line-height: 1.15; color: #14244A; }
.datos { margin-top: 4px; font-size: 14px; font-weight: 600; color: #475569; }
.cuando { text-align: right; font-size: 14px; color: #475569; }
.cuando .dia { font-size: 16px; font-weight: 700; color: #14244A; }
.cuando .dia::first-letter { text-transform: uppercase; }
.seccion { margin-bottom: 6px; font-size: 12px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: #64748B; }
.bloque { margin-top: 18px; }
.signos { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); border: 2px solid #E2E8F0; border-radius: 10px; overflow: hidden; }
.celda { display: grid; gap: 2px; padding: 8px 10px; border-right: 1px solid #E2E8F0; }
.celda:last-child { border-right: none; }
.celda .etq { font-size: 11px; font-weight: 700; color: #64748B; }
.celda .valor { font-size: 17px; font-weight: 700; color: #14244A; font-variant-numeric: tabular-nums; }
.celda .valor small { font-size: 11px; font-weight: 600; color: #64748B; }
@media (max-width: 800px) { .signos { grid-template-columns: repeat(3, minmax(0, 1fr)); } .celda { border-bottom: 1px solid #E2E8F0; } }
.alertas { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.alertas li { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 7px; font-size: 13px; font-weight: 700; }
.alertas li.urgente { background: #FDECEC; color: #8C1D1D; }
.alertas li.moderado { background: #FFF7E6; color: #7A4F05; }
.cuerpo { display: grid; grid-template-columns: 1fr 1fr; gap: 0 32px; }
@media (max-width: 800px) { .cuerpo { grid-template-columns: 1fr; } }
.apartado p { white-space: pre-line; font-size: 15px; line-height: 1.5; }
.apartado { padding-bottom: 14px; border-bottom: 1px dashed #CBD5E1; }
.vacio { color: #94A3B8; }
.diagnosticos { display: grid; gap: 6px; }
.diagnosticos li { display: flex; align-items: baseline; gap: 10px; font-size: 16px; font-weight: 700; color: #14244A; }
.cie { flex-shrink: 0; padding: 1px 8px; border-radius: 6px; background: #EEF2FA; font-family: ui-monospace, monospace; font-size: 13px; color: #172A5A; }
.cie.sin { background: #F1F5F9; color: #64748B; font-family: inherit; font-size: 12px; }
.receta { width: 100%; border-collapse: collapse; font-size: 14px; }
.receta th { padding: 6px 8px; border-bottom: 2px solid #E2E8F0; text-align: left; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.receta td { padding: 8px; border-bottom: 1px solid #EEF2F6; vertical-align: top; }
.receta td small { display: block; margin-top: 2px; font-size: 13px; color: #475569; }
.receta .n { text-align: right; font-variant-numeric: tabular-nums; }
.receta .estado { white-space: nowrap; font-size: 13px; color: #64748B; }
.receta .estado.mal { color: #A52A2A; font-weight: 700; }
.pie-seccion { padding-top: 12px; border-top: 1px dashed #CBD5E1; font-size: 15px; }
.pie { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-top: 18px; padding-top: 12px; border-top: 2px solid #E2E8F0; font-size: 13px; color: #475569; }
.pie b { color: #334155; }
/* --- Relieve (estilo duo) --- */
.hoja { border-radius: 22px; }
.barra { border-radius: 22px 22px 0 0; }
.signos { border-bottom-width: 4px; border-radius: 14px; }
</style>
