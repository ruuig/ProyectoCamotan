<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../../components/comunes/Icono.vue';
import HorarioDibujo from '../../components/farmacia/HorarioDibujo.vue';
import { orientacionPara } from '../../dominio/orientacion';
import FirmaEntrega from '../../components/farmacia/FirmaEntrega.vue';

/**
 * Farmacia (post-consulta): entrega a cada paciente lo que recetó el médico.
 *
 * A la izquierda, quién espera y lo ya atendido (con buscador de recetas).
 * A la derecha, la hoja de entrega: un medicamento por tarjeta, con el lote
 * que vence primero. Al entregar queda registrado a quién se le dio qué y de
 * qué lote, y se imprime la receta para que el paciente sepa cómo tomarlo.
 */
const cola = ref([]);
const atendidas = ref([]);
const lista = ref('esperan');
const buscar = ref('');
const elegida = ref(null);
const hoja = ref(null);
const soloVer = ref(false);
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
// Post-consulta: lo que se puso aquí y si se le explicó al paciente.
const aplicadas = reactive({});
// No alcanza y no se quiere entregar incompleto: todo queda como no entregado.
const noEntregar = reactive({});
const orientado = ref(false);
const orientacion = computed(() => (hoja.value
  ? orientacionPara([hoja.value.diagnosticoCie, ...hoja.value.diagnosticos.map((d) => d.cie)])
  : []));
const fechaCita = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');

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

async function cargarAtendidas() {
  try {
    atendidas.value = (await servicio.entregas(buscar.value.trim() ? { buscar: buscar.value.trim() } : {})).entregas;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

let espera;
watch(buscar, () => {
  clearTimeout(espera);
  espera = setTimeout(() => { lista.value = 'atendidas'; cargarAtendidas(); }, 300);
});

async function abrir(atencionId, verSolo = false) {
  error.value = '';
  terminada.value = null;
  elegida.value = atencionId;
  soloVer.value = verSolo;
  cargando.value = true;
  try {
    hoja.value = await servicio.hojaDeEntrega(atencionId);
    for (const k of Object.keys(cantidades)) delete cantidades[k];
    for (const r of hoja.value.renglones) cantidades[r.prescripcionId] = String(r.aEntregar);
    for (const k of Object.keys(aplicadas)) delete aplicadas[k];
    for (const k of Object.keys(noEntregar)) delete noEntregar[k];
    orientado.value = false;
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
// Se puede terminar si algo sale, o si hay que dejar constancia de lo que no había.
const algoQueEntregar = computed(() => porEntregar.value.some((r) => entero(cantidades[r.prescripcionId]) > 0 || r.aEntregar === 0 || noEntregar[r.prescripcionId]));

/** No se entrega más de lo que hay: el campo no pasa de lo disponible. */
function limitar(r) {
  const n = entero(cantidades[r.prescripcionId]);
  if (n > r.aEntregar) cantidades[r.prescripcionId] = String(r.aEntregar);
}

/**
 * Lo que se pide al registrar. Si farmacia no alcanza y no se cambió la
 * cantidad, se pide lo recetado: se entrega lo que hay y lo que falta queda
 * como "no había", en vez de dejar al paciente pendiente para siempre.
 */
function aSolicitar(r) {
  const escrito = entero(cantidades[r.prescripcionId]);
  return r.noAlcanza > 0 && escrito === r.aEntregar ? r.pendiente : escrito;
}
const excede = (r) => entero(cantidades[r.prescripcionId]) > r.aEntregar;

async function terminar() {
  error.value = '';
  if (porEntregar.value.some(excede)) {
    error.value = 'Hay una cantidad mayor que lo recetado.';
    return;
  }
  enviando.value = true;
  try {
    const r = await servicio.dispensarAtencion(hoja.value.atencionId, {
      renglones: porEntregar.value.map((x) => (noEntregar[x.prescripcionId]
        ? { prescripcionId: x.prescripcionId, cantidad: 0, noEntregar: true }
        : { prescripcionId: x.prescripcionId, cantidad: aSolicitar(x), aplicada: Boolean(aplicadas[x.prescripcionId]) })),
      orientado: orientado.value,
    }, clave);
    const faltaron = r.renglones.some((x) => x.noEntregado > 0);
    terminada.value = { atencionId: hoja.value.atencionId, paciente: hoja.value.paciente, renglones: r.renglones, faltaron };
    hoja.value = null;
    elegida.value = null;
    await Promise.all([cargarCola(), cargarAtendidas()]);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

function siguiente() {
  terminada.value = null;
  if (cola.value.length) abrir(cola.value[0].atencionId);
}

function cerrarHoja() {
  hoja.value = null;
  elegida.value = null;
  soloVer.value = false;
}

const imprimirReceta = (atencionId) => window.open(`/imprimir/receta/${atencionId}`, '_blank');

function edad(e) {
  if (!e) return '';
  if (e.anios > 0) return `${e.anios} ${e.anios === 1 ? 'año' : 'años'}`;
  if (e.meses > 0) return `${e.meses} ${e.meses === 1 ? 'mes' : 'meses'}`;
  return `${e.dias} ${e.dias === 1 ? 'día' : 'días'}`;
}
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const venceCorto = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { month: '2-digit', year: '2-digit', timeZone: 'UTC' }) : '');
const hora = (v) => (v ? new Date(v).toLocaleTimeString('es-GT', { hour: 'numeric', minute: '2-digit' }).replace(/\s?a\.\s?m\./, ' am').replace(/\s?p\.\s?m\./, ' pm') : '');
const inicial = (n) => (n ?? '?').trim().charAt(0).toUpperCase();

const ESTADO = {
  entregada: { texto: 'Entregada', clase: 'verde', icono: 'correcto' },
  incompleta: { texto: 'Incompleta', clase: 'ambar', icono: 'alerta' },
  no_habia: { texto: 'No había', clase: 'rojo', icono: 'alerta' },
  no_recogida: { texto: 'No la recogió', clase: 'gris', icono: 'ausente' },
  por_entregar: { texto: 'Por entregar', clase: 'azul', icono: 'reloj' },
};

async function constanciaGuardada() {
  firmando.value = null;
  await cargarCola();
}

// La lista de quién espera se refresca sola: la receta que el médico guarda
// mientras farmacia tiene la pantalla abierta debe aparecer sin recargar.
let reloj;
function alVolver() { if (document.visibilityState === 'visible') cargarCola(); }
onMounted(() => {
  cargarCola();
  cargarAtendidas();
  reloj = setInterval(() => { if (document.visibilityState === 'visible') cargarCola(); }, 5000);
  document.addEventListener('visibilitychange', alVolver);
  // Al volver a esta ventana (aunque estuviera visible al lado de otra) se revisa en el momento.
  window.addEventListener('focus', alVolver);
});
onBeforeUnmount(() => {
  clearInterval(reloj);
  document.removeEventListener('visibilitychange', alVolver);
  window.removeEventListener('focus', alVolver);
});
</script>

<template>
  <section class="dispensa">
    <header class="b-cabecera no-imprimir">
      <div>
        <p class="b-antetitulo">Farmacia</p>
        <h1 class="b-titulo">Entregar medicamentos</h1>
      </div>
      <div class="b-acciones">
        <RouterLink :to="`/imprimir/sigsa4/${periodo}`" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> SIGSA-4 del mes</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4 no-imprimir"><Icono nombre="alerta" :tamano="20" /> {{ error }}</p>

    <div class="columnas mt-5">
      <!-- ============ Izquierda: quién espera y lo ya atendido ============ -->
      <aside class="lado no-imprimir">
        <div class="pestanas" role="tablist">
          <button type="button" role="tab" :aria-selected="lista === 'esperan'" :class="{ on: lista === 'esperan' }" @click="lista = 'esperan'">
            Esperan <span class="cuenta">{{ cola.length }}</span>
          </button>
          <button type="button" role="tab" :aria-selected="lista === 'atendidas'" :class="{ on: lista === 'atendidas' }" @click="lista = 'atendidas'; cargarAtendidas()">
            {{ buscar.trim() ? 'Recetas' : 'Atendidas hoy' }} <span class="cuenta">{{ atendidas.length }}</span>
          </button>
        </div>

        <label class="buscar">
          <Icono nombre="buscar" :tamano="18" />
          <input v-model="buscar" placeholder="Buscar receta por paciente" aria-label="Buscar receta por paciente" />
        </label>

        <!-- Esperan su entrega -->
        <template v-if="lista === 'esperan'">
          <div v-if="!cola.length" class="vacio">
            <Icono nombre="correcto" :tamano="34" />
            <b>Nadie espera</b>
          </div>
          <ul v-else class="personas">
            <li v-for="a in cola" :key="a.atencionId">
              <button type="button" class="persona" :class="{ activa: elegida === a.atencionId && !soloVer }" @click="abrir(a.atencionId)">
                <span class="avatar">{{ inicial(a.paciente.apellidos) }}</span>
                <span class="min-w-0 flex-1">
                  <b class="nombre">{{ a.paciente.nombreCompleto }}</b>
                  <small>{{ a.paciente.expedientePapel || a.paciente.expediente }} · {{ hora(a.registradaEn) }}</small>
                </span>
                <span class="meds" :title="a.medicamentos.join(', ')"><Icono nombre="dispensacion" :tamano="15" /> {{ a.medicamentos.length }}</span>
              </button>
            </li>
          </ul>
        </template>

        <!-- Atendidas: con su estado y lo que se les dio -->
        <template v-else>
          <div v-if="!atendidas.length" class="vacio">
            <Icono nombre="dispensacion" :tamano="34" />
            <b>{{ buscar.trim() ? 'Sin recetas de ese paciente' : 'Todavía nada hoy' }}</b>
          </div>
          <ul v-else class="personas">
            <li v-for="a in atendidas" :key="a.atencionId">
              <button type="button" class="persona" :class="{ activa: elegida === a.atencionId && soloVer }" @click="abrir(a.atencionId, a.estado !== 'por_entregar')">
                <span class="avatar" :class="ESTADO[a.estado].clase"><Icono :nombre="ESTADO[a.estado].icono" :tamano="18" /></span>
                <span class="min-w-0 flex-1">
                  <b class="nombre">{{ a.paciente.nombreCompleto }}</b>
                  <small>{{ fecha(a.entregadaEn ?? a.registradaEn) }}<template v-if="a.entregadaEn"> · {{ hora(a.entregadaEn) }}</template></small>
                </span>
                <span class="estado" :class="ESTADO[a.estado].clase">{{ ESTADO[a.estado].texto }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template v-if="constanciaDigital && porFirmar.length">
          <h2 class="grupo mt-6">Por firmar <span>{{ porFirmar.length }}</span></h2>
          <ul class="personas">
            <li v-for="a in porFirmar" :key="a.atencionId" class="firmar">
              <span class="min-w-0 flex-1"><b class="nombre">{{ a.paciente.apellidos }}, {{ a.paciente.nombres }}</b></span>
              <button type="button" class="b-btn primario chico" @click="firmando = a"><Icono nombre="lapiz" :tamano="16" /> Recibí conforme</button>
            </li>
          </ul>
        </template>
      </aside>

      <!-- ============ Derecha: la hoja ============ -->
      <div class="min-w-0">
        <!-- Recién entregado -->
        <div v-if="terminada" class="listo no-imprimir" :class="{ ambar: terminada.faltaron }" aria-live="polite">
          <div class="listo-cabeza">
            <span class="sello"><Icono :nombre="terminada.faltaron ? 'alerta' : 'correcto'" :tamano="34" /></span>
            <div class="min-w-0">
              <p class="listo-titulo">{{ terminada.faltaron ? 'Entregado, pero faltó algo' : '¡Entregado!' }}</p>
              <p class="listo-quien">{{ terminada.paciente.nombreCompleto }}</p>
            </div>
          </div>
          <ul class="listo-lista">
            <li v-for="r in terminada.renglones" :key="r.prescripcionId" :class="{ falta: r.noEntregado }">
              <span class="min-w-0 flex-1"><b>{{ r.medicamento }}</b></span>
              <span v-if="r.entregado" class="dato">{{ r.entregado }} · lote {{ r.lotes.map((l) => l.numeroLote).join(', ') }}</span>
              <span v-if="r.noEntregado" class="dato rojo">No había {{ r.noEntregado }}</span>
            </li>
          </ul>
          <div class="listo-botones">
            <button type="button" class="b-btn primario grande" @click="imprimirReceta(terminada.atencionId)"><Icono nombre="imprimir" :tamano="22" /> Imprimir receta</button>
            <button type="button" class="b-btn secundario grande" :disabled="!cola.length" @click="siguiente">
              <Icono nombre="irA" :tamano="22" /> {{ cola.length ? `Siguiente: ${cola[0].paciente.nombres.split(' ')[0]}` : 'Nadie más espera' }}
            </button>
          </div>
        </div>

        <div v-else-if="cargando" class="espera"><b>Abriendo la receta…</b></div>
        <div v-else-if="!hoja" class="espera">
          <span class="espera-ic"><Icono nombre="dispensacion" :tamano="40" /></span>
          <b>Elija a quién entregar</b>
          <button v-if="cola.length" type="button" class="b-btn primario grande" @click="abrir(cola[0].atencionId)">
            <Icono nombre="irA" :tamano="22" /> Empezar con {{ cola[0].paciente.nombres.split(' ')[0] }}
          </button>
        </div>

        <!-- La hoja de entrega -->
        <article v-if="hoja" class="hoja">
          <header class="hoja-cabeza">
            <span class="avatar grande">{{ inicial(hoja.paciente.nombreCompleto) }}</span>
            <div class="min-w-0 flex-1">
              <p class="paciente">{{ hoja.paciente.nombreCompleto }}</p>
              <p class="datos">
                {{ edad(hoja.paciente.edad) }} · {{ hoja.paciente.sexo === 'F' ? 'Mujer' : 'Hombre' }} · Exp. {{ hoja.paciente.expedientePapel || hoja.paciente.expediente }}
                <template v-if="hoja.paciente.cui"> · CUI {{ hoja.paciente.cui }}</template>
              </p>
              <p class="datos">{{ fecha(hoja.fecha) }} · {{ hoja.medico?.nombre ?? 'Sin médico' }}<template v-if="hoja.diagnosticos.length"> · {{ hoja.diagnosticos.map((d) => d.descripcion).join(', ') }}</template></p>
            </div>
            <span v-if="soloVer" class="sello-ver"><Icono nombre="correcto" :tamano="16" /> Atendida</span>
          </header>

          <ul class="meds-lista">
            <li v-for="r in hoja.renglones" :key="r.prescripcionId" class="med" :class="{ hecho: !r.pendiente && !soloVer, falta: !soloVer && r.pendiente && r.noAlcanza }">
              <div class="med-info">
                <p class="med-nombre">{{ r.medicamento }}</p>
                <p v-if="r.indicaciones" class="med-indic"><Icono nombre="reloj" :tamano="15" /> {{ r.indicaciones }}</p>
                <HorarioDibujo v-if="r.indicaciones" :indicaciones="r.indicaciones" class="mt-1.5" />
                <label v-if="r.aplicable && !soloVer && r.pendiente && r.aEntregar" class="aplicar">
                  <input v-model="aplicadas[r.prescripcionId]" type="checkbox" />
                  <span class="caja"><Icono nombre="correcto" :tamano="16" :grosor="3" /></span>
                  Se aplicó aquí (inyección, implante o DIU)
                </label>
                <span v-else-if="r.aplicada" class="aplicado-chip"><Icono nombre="correcto" :tamano="14" :grosor="3" /> Aplicado en el centro</span>
                <!-- Lo que sale (o salió) y de qué lote -->
                <div class="med-lotes">
                  <template v-if="soloVer || !r.pendiente">
                    <span v-for="(l, k) in r.entregas" :key="k" class="lote-chip"><b>{{ l.numeroLote }}</b> vence {{ venceCorto(l.fechaVence) }}<template v-if="r.entregas.length > 1"> · {{ l.cantidad }}</template></span>
                    <span v-if="r.noHabia" class="lote-chip rojo">No había {{ r.noHabia }}</span>
                  </template>
                  <template v-else>
                    <span v-for="l in lotesPara(r)" :key="l.loteId" class="lote-chip"><b>{{ l.numeroLote }}</b> vence {{ venceCorto(l.fechaVence) }}<template v-if="lotesPara(r).length > 1"> · se toman {{ l.cantidad }}</template><template v-if="l.hay != null"> · hay {{ l.hay.toLocaleString('es-GT') }}</template></span>
                    <span v-if="r.noAlcanza" class="lote-chip rojo">
                      No había {{ r.noAlcanza }}<template v-if="r.enBodega"> · en bodega hay {{ r.enBodega }}</template>
                    </span>
                  </template>
                </div>
              </div>
              <div class="med-cant">
                <span class="etq">Recetado</span>
                <b class="recetado">{{ r.recetado }}</b>
              </div>
              <div class="med-cant">
                <span class="etq">{{ soloVer || !r.pendiente ? 'Entregado' : 'Entregar' }}</span>
                <template v-if="!soloVer && r.pendiente">
                  <!-- Sin existencia no hay nada que escribir: queda como "no había". -->
                  <span v-if="r.aEntregar === 0" class="no-hay">No hay</span>
                  <template v-else-if="noEntregar[r.prescripcionId]">
                    <span class="no-hay">No se entrega</span>
                    <small class="hay">{{ r.pendiente }} quedan como no entregado</small>
                    <button type="button" class="incompleto" @click="noEntregar[r.prescripcionId] = false">Entregar lo que hay</button>
                  </template>
                  <template v-else>
                    <input
                      v-model="cantidades[r.prescripcionId]"
                      inputmode="numeric"
                      class="cant-campo"
                      :class="{ mal: excede(r) }"
                      :aria-label="`Cantidad de ${r.medicamento}`"
                      @input="limitar(r)"
                    />
                    <small v-if="r.noAlcanza" class="hay">hay {{ r.aEntregar }}</small>
                    <button v-if="r.noAlcanza" type="button" class="incompleto" @click="noEntregar[r.prescripcionId] = true">No entregar incompleto</button>
                  </template>
                </template>
                <b v-else class="entregado" :class="{ rojo: r.entregado < r.recetado }">{{ r.entregado }}</b>
              </div>
            </li>
          </ul>

          <div v-if="hoja.recetasExternas.length" class="fuera">
            <p class="fuera-titulo"><Icono nombre="informacion" :tamano="18" /> Para comprar fuera del centro</p>
            <ul>
              <li v-for="(x, i) in hoja.recetasExternas" :key="i"><b>{{ x.medicamento }}</b><template v-if="x.cantidad"> · {{ x.cantidad }}</template><template v-if="x.indicaciones"> · {{ x.indicaciones }}</template></li>
            </ul>
          </div>

          <!-- Antes de que se vaya: cuándo vuelve y cuándo regresar de inmediato -->
          <section class="salida">
            <h3>Antes de que se vaya</h3>
            <div class="salida-rejilla">
              <div class="cita" :class="{ sin: !hoja.proximaCita }">
                <Icono nombre="reloj" :tamano="26" :grosor="2.2" />
                <span>
                  <small>Próxima cita</small>
                  <b class="first-letter:uppercase">{{ hoja.proximaCita ? fechaCita(hoja.proximaCita) : 'Sin cita' }}</b>
                  <em v-if="!hoja.proximaCita">Solo si empeora o no mejora</em>
                </span>
              </div>
              <div class="alarma">
                <p class="alarma-titulo"><Icono nombre="alerta" :tamano="20" :grosor="2.4" /> Regrese de inmediato si…</p>
                <template v-for="g in orientacion" :key="g.clave">
                  <ul><li v-for="x in g.signos" :key="x">{{ x }}</li></ul>
                  <p v-if="g.consejo" class="consejo">{{ g.consejo }}</p>
                </template>
              </div>
            </div>
            <label v-if="!soloVer" class="explique">
              <input v-model="orientado" type="checkbox" />
              <span class="caja"><Icono nombre="correcto" :tamano="20" :grosor="3" /></span>
              Le expliqué cómo tomarlos, cuándo vuelve y cuándo regresar de inmediato
            </label>
            <p v-else-if="hoja.orientadoEn" class="explicado"><Icono nombre="correcto" :tamano="18" :grosor="2.6" /> Se le explicó al entregar</p>
          </section>

          <footer class="hoja-pie no-imprimir">
            <template v-if="soloVer">
              <button type="button" class="b-btn secundario grande" @click="cerrarHoja"><Icono nombre="cerrar" :tamano="22" /> Cerrar</button>
              <button type="button" class="b-btn primario grande" @click="imprimirReceta(hoja.atencionId)"><Icono nombre="imprimir" :tamano="22" /> Imprimir receta</button>
            </template>
            <template v-else>
              <button type="button" class="b-btn secundario grande" @click="cerrarHoja">Cancelar</button>
              <button type="button" class="b-btn exito grande" :disabled="enviando || !algoQueEntregar" @click="terminar">
                <Icono nombre="correcto" :tamano="24" /> {{ enviando ? 'Registrando…' : 'Entregar' }}
              </button>
            </template>
          </footer>
        </article>
      </div>
    </div>

    <FirmaEntrega v-if="firmando" :atencion="firmando" @cerrar="firmando = null" @guardada="constanciaGuardada" />
  </section>
</template>

<style scoped>
.incompleto { margin-top: 4px; padding: 4px 10px; border: 2px solid #E8930C; border-radius: 10px; background: #FFF7E6; color: #8A4B00; font-size: 12.5px; font-weight: 900; white-space: nowrap; }
.incompleto:hover { background: #FFEBC7; }
/* --- Post-consulta: aplicar, orientar, cita --- */
.aplicar, .explique { display: inline-flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 14px; font-weight: 800; color: #334155; cursor: pointer; }
.aplicar input, .explique input { position: absolute; opacity: 0; width: 0; height: 0; }
.aplicar .caja, .explique .caja { display: grid; place-items: center; flex-shrink: 0; width: 30px; height: 30px; border: 2px solid #CBD5E1; border-bottom-width: 4px; border-radius: 9px; background: #fff; color: transparent; }
.aplicar input:checked + .caja, .explique input:checked + .caja { background: #22A06B; border-color: #17784F; color: #fff; }
.aplicar input:focus-visible + .caja, .explique input:focus-visible + .caja { outline: 3px solid #9FCDEC; }
.aplicado-chip { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 2px 9px; border-radius: 9px; background: #E3F6EC; color: #145C3D; font-size: 12.5px; font-weight: 800; }
.salida { display: grid; gap: 12px; margin-top: 14px; padding: 16px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; background: #fff; }
.salida h3 { font-size: 17px; font-weight: 900; color: #14244A; }
.salida-rejilla { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 12px; }
@media (max-width: 900px) { .salida-rejilla { grid-template-columns: 1fr; } }
.cita { display: flex; align-items: flex-start; gap: 10px; padding: 14px; border-radius: 16px; background: #EAF3FB; color: #1F6AA5; }
.cita small { display: block; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; color: #174E80; }
.cita b { display: block; font-size: 19px; font-weight: 900; line-height: 1.2; color: #14244A; }
.cita em { display: block; font-style: normal; font-size: 13px; font-weight: 700; color: #475569; }
.cita.sin { background: #F1F5F9; color: #64748B; }
.alarma { padding: 12px 14px; border-radius: 16px; background: #FDECEC; color: #8C2323; }
.alarma-titulo { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 900; }
.alarma ul { display: grid; gap: 2px; margin-top: 6px; padding-left: 22px; list-style: disc; font-size: 14.5px; font-weight: 700; }
.consejo { margin-top: 6px; padding: 6px 10px; border-radius: 10px; background: #fff; font-size: 13.5px; font-weight: 700; color: #334155; }
.explique { position: relative; padding: 10px 12px; border-radius: 14px; background: #F8FAFC; font-size: 15px; }
.explicado { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 800; color: #145C3D; }

.columnas { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1099px) { .columnas { grid-template-columns: 1fr; } }
.lado { position: sticky; top: 88px; display: grid; gap: 10px; }

/* Pestañas grandes con relieve */
.pestanas { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 5px; background: #fff; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 18px; }
.pestanas button { display: flex; align-items: center; justify-content: center; gap: 8px; height: 46px; border-radius: 13px; font-weight: 800; font-size: 15px; color: #475569; }
.pestanas button.on { background: #EAF3FB; color: #172A5A; box-shadow: inset 0 0 0 2px #4A9BD6; }
.cuenta { min-width: 26px; padding: 1px 8px; border-radius: 9px; background: #E2E8F0; color: #14244A; font-size: 13px; }
.on .cuenta { background: #172A5A; color: #fff; }

.buscar { position: relative; display: block; }
.buscar svg { position: absolute; left: 14px; top: 50%; margin-top: -9px; color: #64748B; }
.buscar input { width: 100%; height: 48px; padding: 0 14px 0 42px; border: 2px solid #E2E8F0; border-radius: 14px; background: #F8FAFC; font-weight: 600; font-size: 15px; color: #14244A; }
.buscar input:focus { outline: none; background: #fff; border-color: #4A9BD6; box-shadow: 0 0 0 4px rgba(74, 155, 214, .15); }

.personas { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; max-height: calc(100vh - 330px); overflow-x: hidden; overflow-y: auto; padding: 2px 2px 6px; }
.personas > li { min-width: 0; }
.persona { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 16px; background: #fff; text-align: left; transition: transform .06s, border-color .12s; }
.persona:hover { border-color: #9FCDEC; }
.persona:active { transform: translateY(2px); border-bottom-width: 2px; }
.persona.activa { border-color: #4A9BD6; border-bottom-color: #2F83C4; background: #EAF3FB; }
.persona .nombre { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 800; color: #14244A; }
.persona small { display: block; font-size: 13px; font-weight: 600; color: #64748B; }
.avatar { display: grid; place-items: center; flex-shrink: 0; width: 42px; height: 42px; border-radius: 13px; background: #172A5A; color: #fff; font-weight: 900; font-size: 17px; box-shadow: inset 0 -3px 0 rgba(0, 0, 0, .25); }
.avatar.grande { width: 58px; height: 58px; border-radius: 17px; font-size: 24px; }
.avatar.verde { background: #1A8F57; } .avatar.ambar { background: #E8930C; } .avatar.rojo { background: #C03535; } .avatar.gris { background: #94A3B8; } .avatar.azul { background: #2F83C4; }
.meds { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 4px 9px; border-radius: 10px; background: #F1F5F9; font-weight: 800; font-size: 14px; color: #334155; }
.estado { flex-shrink: 0; padding: 3px 9px; border-radius: 9px; font-size: 12px; font-weight: 800; }
.estado.verde { background: #E2F5EA; color: #145C3C; } .estado.ambar { background: #FFF4D6; color: #8A5A06; } .estado.rojo { background: #FDECEC; color: #A52A2A; } .estado.gris { background: #EEF2F6; color: #475569; } .estado.azul { background: #EAF3FB; color: #1F5F99; }
.vacio { display: grid; justify-items: center; gap: 8px; padding: 34px 16px; border: 2px dashed #CBD5E1; border-radius: 18px; color: #94A3B8; }
.vacio b { color: #64748B; }
.grupo { font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
.firmar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 2px solid #E2E8F0; border-radius: 14px; background: #fff; }

/* Botones grandes */
.b-btn.grande { height: 58px; padding: 0 26px; border-radius: 16px; font-size: 17px; }

/* Espera */
.espera { display: grid; justify-items: center; gap: 14px; padding: 60px 20px; background: #fff; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 22px; color: #64748B; }
.espera b { font-size: 18px; color: #334155; }
.espera-ic { display: grid; place-items: center; width: 84px; height: 84px; border-radius: 26px; background: #EAF3FB; color: #2F83C4; box-shadow: inset 0 -5px 0 #CFE3F5; }

/* Recién entregado */
.listo { padding: 22px; background: #fff; border: 2px solid #8FD3AD; border-bottom: 6px solid #47B47D; border-radius: 22px; }
.listo.ambar { border-color: #F5D58A; border-bottom-color: #E8930C; }
.listo-cabeza { display: flex; align-items: center; gap: 16px; }
.sello { display: grid; place-items: center; flex-shrink: 0; width: 70px; height: 70px; border-radius: 22px; background: #1A8F57; color: #fff; box-shadow: inset 0 -5px 0 #0D5634; }
.ambar .sello { background: #E8930C; box-shadow: inset 0 -5px 0 #A35D00; }
.listo-titulo { font-size: 26px; font-weight: 900; color: #145C3C; }
.ambar .listo-titulo { color: #8A5A06; }
.listo-quien { font-size: 16px; font-weight: 700; color: #334155; }
.listo-lista { display: grid; gap: 6px; margin: 18px 0; }
.listo-lista li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 10px 14px; border-radius: 12px; background: #F4FBF7; font-size: 15px; color: #1E293B; }
.listo-lista li.falta { background: #FFF7E6; }
.dato { font-weight: 700; color: #145C3C; font-size: 14px; }
.dato.rojo { color: #A52A2A; }
.listo-botones { display: flex; flex-wrap: wrap; gap: 10px; }
.listo-botones .b-btn { flex: 1 1 240px; }

/* Hoja */
.hoja { background: #fff; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 22px; overflow: hidden; }
.hoja-cabeza { display: flex; align-items: center; gap: 16px; padding: 18px 22px; background: #F7F9FD; border-bottom: 2px solid #E2E8F0; }
.paciente { font-size: 22px; font-weight: 900; color: #14244A; line-height: 1.15; }
.datos { margin-top: 3px; font-size: 14px; font-weight: 600; color: #64748B; }
.sello-ver { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; padding: 5px 12px; border: 2px solid #1A8F57; border-bottom-width: 3px; border-radius: 11px; font-size: 13px; font-weight: 800; color: #145C3C; background: #EAF7F0; }

.meds-lista { display: grid; gap: 10px; padding: 18px 22px; }
.med { display: grid; grid-template-columns: minmax(0, 1fr) 90px 120px; align-items: center; gap: 14px; padding: 14px 16px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-left: 6px solid #4A9BD6; border-radius: 16px; }
.med.hecho { border-left-color: #1A8F57; background: #FAFDFB; }
.med.falta { border-left-color: #E8930C; }
@media (max-width: 700px) { .med { grid-template-columns: 1fr 1fr; } .med-info { grid-column: 1 / -1; } }
.med-nombre { font-size: 17px; font-weight: 800; color: #14244A; }
.med-indic { display: flex; align-items: flex-start; gap: 6px; margin-top: 4px; font-size: 15px; font-weight: 600; color: #334155; }
.med-indic svg { flex-shrink: 0; margin-top: 3px; color: #2F83C4; }
.med-lotes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.lote-chip { padding: 3px 10px; border-radius: 9px; background: #EAF7F0; color: #145C3C; font-size: 13px; font-weight: 700; }
.lote-chip b { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
.lote-chip.rojo { background: #FDECEC; color: #A52A2A; }
.med-cant { display: grid; justify-items: center; gap: 3px; }
.etq { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #64748B; }
.recetado { font-size: 24px; font-weight: 900; color: #64748B; font-variant-numeric: tabular-nums; }
.entregado { font-size: 28px; font-weight: 900; color: #1A8F57; font-variant-numeric: tabular-nums; }
.entregado.rojo { color: #C03535; }
.cant-campo { width: 110px; height: 56px; border: 2px solid #CBD5E1; border-bottom-width: 4px; border-radius: 14px; text-align: center; font-size: 26px; font-weight: 900; color: #14244A; background: #F8FAFC; }
.cant-campo:focus { outline: none; border-color: #4A9BD6; background: #fff; box-shadow: 0 0 0 4px rgba(74, 155, 214, .15); }
.cant-campo.mal { border-color: #D64545; background: #FDECEC; }
.no-hay { display: grid; place-items: center; width: 110px; height: 56px; border: 2px solid #F3BDBD; border-bottom-width: 4px; border-radius: 14px; background: #FDECEC; color: #A52A2A; font-size: 17px; font-weight: 900; }
.hay { font-size: 12px; font-weight: 800; color: #8A5A06; }

.fuera { margin: 0 22px 18px; padding: 12px 16px; border: 2px dashed #CBD5E1; border-radius: 16px; background: #F8FAFC; }
.fuera-titulo { display: flex; align-items: center; gap: 6px; font-weight: 800; color: #334155; }
.fuera ul { margin-top: 6px; display: grid; gap: 4px; font-size: 15px; color: #1E293B; }

.hoja-pie { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; padding: 16px 22px; border-top: 2px solid #E2E8F0; background: #F7F9FD; }
.hoja-pie .b-btn.exito { min-width: 220px; }
</style>
