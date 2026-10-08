<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../../components/comunes/Icono.vue';
import FirmaEntrega from '../../components/farmacia/FirmaEntrega.vue';

/**
 * Farmacia (post-consulta): entrega a cada paciente lo que recetó el médico.
 *
 * Se elige al paciente y el sistema arma la hoja de entrega con todo lo que
 * se copia al formato en papel: datos del paciente, médico, diagnóstico y,
 * por medicamento, la cantidad, el lote que vence primero y su vencimiento,
 * tomados de la existencia de la farmacia. Copiado el formato, se termina la
 * dispensación y queda registrada lote por lote para la trazabilidad.
 *
 * La firma o huella digital de quien recibe queda lista para cuando el
 * centro tenga el equipo: se enciende en la configuración (constanciaDigital).
 * Mientras tanto se firma el formato en papel.
 */
const cola = ref([]);
const elegida = ref(null);
const hoja = ref(null);
const cantidades = reactive({});
const terminada = ref(null);
const cargando = ref(false);
const enviando = ref(false);
const error = ref('');
const constanciaDigital = ref(false);
const porFirmar = ref([]);
const firmando = ref(null);
const periodo = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 7);
let clave = null;

async function cargarCola() {
  try {
    const [c, conf] = await Promise.all([servicio.porAtender(), servicio.configuracion()]);
    cola.value = c.porAtender;
    constanciaDigital.value = Boolean(conf.configuracion?.constanciaDigital);
    if (constanciaDigital.value) porFirmar.value = (await servicio.porFirmar()).porFirmar;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function abrir(a) {
  error.value = '';
  terminada.value = null;
  elegida.value = a.atencionId;
  cargando.value = true;
  try {
    hoja.value = await servicio.hojaDeEntrega(a.atencionId);
    for (const k of Object.keys(cantidades)) delete cantidades[k];
    for (const r of hoja.value.renglones) cantidades[r.prescripcionId] = String(r.aEntregar);
    // Una clave por entrega: si se reintenta, no se registra dos veces.
    clave = nuevaClaveIdempotencia();
  } catch (fallo) {
    error.value = fallo.message;
    hoja.value = null;
  } finally {
    cargando.value = false;
  }
}

const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;

/** Los lotes de la propuesta (el que vence primero) para la cantidad escrita. */
function lotesPara(r) {
  let falta = Math.min(entero(cantidades[r.prescripcionId]), r.aEntregar);
  const salida = [];
  for (const l of r.lotes) {
    if (falta <= 0) break;
    const n = Math.min(falta, l.cantidad);
    salida.push({ ...l, cantidad: n });
    falta -= n;
  }
  return salida;
}

const porEntregar = computed(() => (hoja.value?.renglones ?? []).filter((r) => r.pendiente > 0));
const algoQueEntregar = computed(() => porEntregar.value.some((r) => entero(cantidades[r.prescripcionId]) > 0));

/**
 * Lo que se pide al registrar. Si farmacia no alcanza y no se cambio la
 * cantidad, se pide lo recetado: se entrega lo que hay y lo que falta queda
 * como demanda no atendida, en vez de dejar al paciente pendiente para siempre.
 */
function aSolicitar(r) {
  const escrito = entero(cantidades[r.prescripcionId]);
  return r.noAlcanza > 0 && escrito === r.aEntregar ? r.pendiente : escrito;
}

function excede(r) {
  return entero(cantidades[r.prescripcionId]) > r.pendiente;
}

async function terminar() {
  error.value = '';
  if (porEntregar.value.some(excede)) {
    error.value = 'Hay una cantidad mayor que lo recetado.';
    return;
  }
  enviando.value = true;
  try {
    const r = await servicio.dispensarAtencion(hoja.value.atencionId, {
      renglones: porEntregar.value.map((x) => ({ prescripcionId: x.prescripcionId, cantidad: aSolicitar(x) })),
    }, clave);
    terminada.value = { paciente: hoja.value.paciente, renglones: r.renglones };
    hoja.value = null;
    elegida.value = null;
    await cargarCola();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

function edad(e) {
  if (!e) return '';
  if (e.anios > 0) return `${e.anios} ${e.anios === 1 ? 'año' : 'años'}`;
  if (e.meses > 0) return `${e.meses} ${e.meses === 1 ? 'mes' : 'meses'}`;
  return `${e.dias} ${e.dias === 1 ? 'día' : 'días'}`;
}

const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const hora = (v) => (v ? new Date(v).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) : '');

const imprimir = () => window.print();

async function constanciaGuardada() {
  firmando.value = null;
  await cargarCola();
}

onMounted(cargarCola);
</script>

<template>
  <section>
    <header class="b-cabecera no-imprimir">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">Dispensación</h1>
        <span class="b-antetitulo">Farmacia</span>
      </div>
      <div class="flex flex-wrap gap-2">
        <RouterLink to="/dispensacion/control" class="b-btn secundario"><Icono nombre="inventario" :tamano="20" /> Control de farmacia</RouterLink>
        <RouterLink :to="`/imprimir/sigsa4/${periodo}`" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> SIGSA-4 del mes</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4 no-imprimir">{{ error }}</p>

    <div class="columnas mt-5">
      <!-- Quiénes esperan -->
      <aside class="min-w-0 no-imprimir">
        <h2 class="grupo">Esperan su entrega <span>{{ cola.length }}</span></h2>
        <div v-if="!cola.length" class="b-panel b-vacio">Nadie espera medicamentos.</div>
        <ul v-else class="b-panel cola">
          <li v-for="a in cola" :key="a.atencionId">
            <button type="button" class="persona" :class="elegida === a.atencionId ? 'activa' : ''" @click="abrir(a)">
              <span class="min-w-0 flex-1">
                <b class="block truncate">{{ a.paciente.nombreCompleto }}</b>
                <small>Exp. {{ a.paciente.expedientePapel || a.paciente.expediente }}<template v-if="a.medico"> · {{ a.medico }}</template> · {{ hora(a.registradaEn) }}</small>
                <small class="truncate">{{ a.medicamentos.join(', ') }}</small>
              </span>
              <span class="b-contador gris">{{ a.medicamentos.length }}</span>
            </button>
          </li>
        </ul>

        <template v-if="constanciaDigital">
          <h2 class="grupo mt-6">Por firmar <span>{{ porFirmar.length }}</span></h2>
          <ul v-if="porFirmar.length" class="b-panel cola">
            <li v-for="a in porFirmar" :key="a.atencionId" class="firmar">
              <span class="min-w-0 flex-1"><b class="block truncate">{{ a.paciente.apellidos }}, {{ a.paciente.nombres }}</b></span>
              <button type="button" class="b-btn primario chico" @click="firmando = a"><Icono nombre="lapiz" :tamano="16" /> Recibí conforme</button>
            </li>
          </ul>
        </template>
      </aside>

      <!-- Hoja de entrega -->
      <div class="min-w-0">
        <div v-if="terminada" class="b-panel terminada no-imprimir" aria-live="polite">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo flex items-center gap-2"><Icono nombre="correcto" :tamano="22" class="text-mejora" /> Entrega registrada</h2>
            <span class="text-sm text-apagado">{{ terminada.paciente.nombreCompleto }}</span>
          </header>
          <ul class="b-panel-cuerpo space-y-1.5">
            <li v-for="r in terminada.renglones" :key="r.prescripcionId">
              <b>{{ r.medicamento }}</b>: {{ r.entregado }} entregado<template v-if="r.lotes.length"> (lote {{ r.lotes.map((l) => `${l.numeroLote} x${l.cantidad}`).join(', ') }})</template>
              <span v-if="r.noEntregado" class="text-advertencia"> · {{ r.noEntregado }} no entregado por falta de existencia</span>
            </li>
          </ul>
        </div>

        <div v-if="cargando" class="b-panel b-vacio">Preparando la hoja…</div>
        <div v-else-if="!hoja && !terminada" class="b-panel b-vacio">Elija a quién entregar.</div>

        <article v-if="hoja" class="b-panel hoja">
          <header class="b-panel-cabeza">
            <div>
              <h2 class="b-panel-titulo">Hoja de entrega</h2>
              <p class="no-imprimir text-sm text-apagado">Copie estos datos al formato y después termine la dispensación.</p>
            </div>
            <button type="button" class="b-btn secundario chico no-imprimir" @click="imprimir"><Icono nombre="imprimir" :tamano="16" /> Imprimir</button>
          </header>

          <dl class="datos">
            <div class="ancho"><dt>Paciente</dt><dd>{{ hoja.paciente.nombreCompleto }}</dd></div>
            <div><dt>Fecha de consulta</dt><dd>{{ fecha(hoja.fecha) }}</dd></div>
            <div><dt>CUI</dt><dd class="tabular-nums">{{ hoja.paciente.cui || '—' }}</dd></div>
            <div><dt>Expediente</dt><dd>{{ hoja.paciente.expedientePapel || hoja.paciente.expediente }}</dd></div>
            <div><dt>Edad y sexo</dt><dd>{{ edad(hoja.paciente.edad) }} · {{ hoja.paciente.sexo === 'F' ? 'Mujer' : 'Hombre' }}</dd></div>
            <div><dt>Médico</dt><dd>{{ hoja.medico?.nombre ?? '—' }}</dd></div>
            <div class="ancho"><dt>Diagnóstico</dt><dd>{{ hoja.diagnosticos.map((d) => `${d.descripcion}${d.cie ? ` (${d.cie})` : ''}`).join(' · ') || '—' }}</dd></div>
          </dl>

          <div class="b-tabla-marco mx-5 mb-4">
            <table class="b-tabla">
              <thead>
                <tr>
                  <th>Medicamento e indicaciones</th>
                  <th class="text-right">Recetado</th>
                  <th class="text-right">Entregar</th>
                  <th>Lote</th>
                  <th>Vence</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in hoja.renglones" :key="r.prescripcionId" :class="r.pendiente ? '' : 'hecho'">
                  <td>
                    <b>{{ r.medicamento }}</b>
                    <small v-if="r.indicaciones" class="nota">{{ r.indicaciones }}</small>
                    <small v-if="!r.pendiente" class="nota">Ya entregado</small>
                    <small v-else-if="r.noAlcanza" class="nota alerta">
                      En farmacia hay {{ r.enFarmacia }}: faltan {{ r.noAlcanza }}<template v-if="r.enBodega"> (en bodega hay {{ r.enBodega }})</template>
                    </small>
                  </td>
                  <td class="text-right">{{ r.recetado }}</td>
                  <td class="text-right">
                    <template v-if="r.pendiente">
                      <input
                        v-model="cantidades[r.prescripcionId]"
                        inputmode="numeric"
                        :aria-label="`Cantidad de ${r.medicamento}`"
                        class="b-campo num cantidad no-imprimir"
                        :aria-invalid="excede(r)"
                      />
                      <span class="solo-imprimir">{{ entero(cantidades[r.prescripcionId]) }}</span>
                    </template>
                    <template v-else>{{ r.yaEntregado }}</template>
                  </td>
                  <td>
                    <span v-for="l in lotesPara(r)" :key="l.loteId" class="block tabular-nums">{{ l.numeroLote }}<template v-if="lotesPara(r).length > 1"> ({{ l.cantidad }})</template></span>
                    <span v-if="r.pendiente && !lotesPara(r).length" class="text-apagado">—</span>
                  </td>
                  <td>
                    <span v-for="l in lotesPara(r)" :key="l.loteId" class="block tabular-nums">{{ fecha(l.fechaVence) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="hoja.recetasExternas.length" class="mx-5 mb-4 rounded-control border border-dashed border-linea p-3">
            <p class="text-sm font-bold text-tinta">Para conseguir fuera del centro</p>
            <ul class="mt-1 text-sm">
              <li v-for="(x, i) in hoja.recetasExternas" :key="i">{{ x.medicamento }}<template v-if="x.cantidad"> · {{ x.cantidad }}</template><template v-if="x.indicaciones"> · {{ x.indicaciones }}</template></li>
            </ul>
          </div>

          <footer class="pie no-imprimir">
            <button type="button" class="b-btn secundario" @click="hoja = null; elegida = null">Cancelar</button>
            <button type="button" class="b-btn primario" :disabled="enviando || !algoQueEntregar" @click="terminar">
              <Icono nombre="dispensacion" :tamano="20" /> {{ enviando ? 'Registrando…' : 'Terminar dispensación' }}
            </button>
          </footer>
        </article>
      </div>
    </div>

    <FirmaEntrega v-if="firmando" :atencion="firmando" @cerrar="firmando = null" @guardada="constanciaGuardada" />
  </section>
</template>

<style scoped>
.columnas { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1099px) { .columnas { grid-template-columns: 1fr; } }
.grupo { margin-bottom: 8px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
.grupo span { margin-left: 4px; color: #14244A; }
.cola { overflow: hidden; }
.cola li + li { border-top: 1px solid #EEF2F6; }
.persona { display: flex; width: 100%; align-items: center; gap: 10px; padding: 12px 16px; text-align: left; }
.persona:hover { background: #F8FAFC; }
.persona.activa { background: #EEF3FB; box-shadow: inset 4px 0 0 #172A5A; }
.persona b { color: #14244A; }
.persona small { display: block; font-size: 13px; color: #64748B; }
.firmar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; }
.terminada { margin-bottom: 16px; border-color: #BFE6D2; }
.datos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 20px; padding: 16px 20px; }
.datos .ancho { grid-column: span 3; }
@media (max-width: 700px) { .datos { grid-template-columns: 1fr; } .datos .ancho { grid-column: span 1; } }
.datos dt { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.datos dd { font-size: 16px; font-weight: 600; color: #14244A; }
.cantidad { width: 80px; height: 36px; margin-left: auto; }
.nota { display: block; font-size: 12px; color: #64748B; }
.nota.alerta { color: #8A5A06; }
.hecho td { color: #94A3B8; }
.pie { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 2px solid #EEF2F6; }
.solo-imprimir { display: none; }
@media print {
  .no-imprimir { display: none !important; }
  .solo-imprimir { display: inline; }
  .columnas { display: block; }
}
</style>
