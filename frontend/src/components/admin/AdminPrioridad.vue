<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import http from '../../services/http';
import { usarAutorizacion } from '../../dominio/autorizacion';
import DialogoAutorizacion from '../comunes/DialogoAutorizacion.vue';
import Icono from '../comunes/Icono.vue';

/**
 * Quién pasa primero. Tres capas, todas editables por dirección:
 *  1. Señales clínicas: un valor medido en preconsulta pone el nivel.
 *  2. Puntos: dentro del mismo nivel, ordenan la cola.
 *  3. Tiempo máximo: un leve que espera demasiado sube a moderado.
 * Guardar pide la autorización del director y queda en la bitácora.
 */
const CAMPO = {
  temperatura: { texto: 'Temperatura', unidad: '°C', paso: 0.1 },
  satOxigeno: { texto: 'Saturación de oxígeno', unidad: '%' },
  frecRespiratoria: { texto: 'Frecuencia respiratoria', unidad: 'rpm' },
  frecCardiaca: { texto: 'Frecuencia cardíaca', unidad: 'lpm' },
  presionSis: { texto: 'Presión sistólica', unidad: 'mmHg' },
  presionDia: { texto: 'Presión diastólica', unidad: 'mmHg' },
  dolor: { texto: 'Dolor', unidad: 'de 10' },
  conciencia: { texto: 'Conciencia', opciones: [[1, 'Confuso'], [2, 'Responde a la voz'], [3, 'Solo al dolor'], [4, 'No responde']] },
  glucosa: { texto: 'Glucosa', unidad: 'mg/dL' },
  desnutricion: { texto: 'Desnutrición aguda', opciones: [[1, 'Moderada'], [2, 'Severa']] },
};
const ORDEN_CAMPOS = Object.keys(CAMPO);

const vista = ref('criterios');
const cargado = ref(false);
const error = ref('');
const aviso = ref('');
const criterios = ref([]);
const puntos = ref(null);
const meta = ref({});
let originalCriterios = '';
let originalPuntos = '';

async function cargar() {
  error.value = '';
  try {
    const r = await http.get('/admin/priorizacion');
    criterios.value = r.criterios.map(({ campo, edadDesdeMeses, edadHastaMeses, soloEmbarazo, operador, valor, nivel, etiqueta, activo }) => ({
      campo, edadDesdeMeses, edadHastaMeses, soloEmbarazo, operador, valor, nivel, etiqueta, activo,
    }));
    puntos.value = r.puntos;
    meta.value = { actualizadoEn: r.actualizadoEn, actualizadoPor: r.actualizadoPor };
    originalCriterios = JSON.stringify(criterios.value);
    originalPuntos = JSON.stringify(puntos.value);
    cargado.value = true;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const criteriosCambiados = computed(() => cargado.value && JSON.stringify(criterios.value) !== originalCriterios);
const puntosCambiados = computed(() => cargado.value && JSON.stringify(puntos.value) !== originalPuntos);

// Signo elegido a la izquierda; sus reglas a la derecha.
const campoSel = ref('temperatura');
const filasSel = computed(() => criterios.value.map((c, i) => ({ c, i })).filter(({ c }) => c.campo === campoSel.value));
const conteo = (campo, nivel) => criterios.value.filter((c) => c.campo === campo && c.nivel === nivel && c.activo).length;
const cifras = computed(() => ({
  total: criterios.value.filter((c) => c.activo).length,
  urgentes: criterios.value.filter((c) => c.activo && c.nivel === 'urgente').length,
  moderados: criterios.value.filter((c) => c.activo && c.nivel === 'moderado').length,
}));

function agregar(campo) {
  const ultimo = [...criterios.value].reverse().find((c) => c.campo === campo);
  const nuevo = { campo, edadDesdeMeses: 0, edadHastaMeses: null, soloEmbarazo: false, operador: ultimo?.operador ?? 'mayor_igual', valor: ultimo?.valor ?? 0, nivel: 'moderado', etiqueta: '', activo: true };
  // Queda junto a los de su mismo signo.
  const pos = criterios.value.map((c) => c.campo).lastIndexOf(campo);
  criterios.value.splice(pos === -1 ? criterios.value.length : pos + 1, 0, nuevo);
}
const quitar = (i) => criterios.value.splice(i, 1);

/** "De 2 a 11 meses", "5 años o más", "Toda edad". */
function textoEdad(c) {
  const t = (m) => (m < 24 ? `${m} ${m === 1 ? 'mes' : 'meses'}` : `${Math.round(m / 12)} años`);
  const desde = Number(c.edadDesdeMeses) || 0;
  const hasta = c.edadHastaMeses === '' || c.edadHastaMeses == null ? null : Number(c.edadHastaMeses);
  if (!desde && hasta == null) return 'Toda edad';
  if (!desde) return `Menos de ${t(hasta)}`;
  if (hasta == null) return `${t(desde)} o más`;
  return `De ${t(desde)} a menos de ${t(hasta)}`;
}

const autorizacion = usarAutorizacion(async () => {
  aviso.value = 'Cambios guardados. La cola los usa desde ahora.';
  await cargar();
});

function guardarCriterios() {
  aviso.value = '';
  const limpios = criterios.value.map((c) => ({
    ...c,
    edadDesdeMeses: Number(c.edadDesdeMeses) || 0,
    edadHastaMeses: c.edadHastaMeses === '' || c.edadHastaMeses == null ? null : Number(c.edadHastaMeses),
    valor: Number(c.valor),
  }));
  autorizacion.pedir('cambiar las señales clínicas de la prioridad', (aut) => http.put('/admin/priorizacion/criterios', { criterios: limpios, autorizacion: aut }));
}

function guardarPuntos() {
  aviso.value = '';
  autorizacion.pedir('cambiar los puntos y tiempos de la prioridad', (aut) => http.put('/admin/priorizacion/puntos', { puntos: puntos.value, autorizacion: aut }));
}

function deshacer() {
  criterios.value = JSON.parse(originalCriterios);
  puntos.value = JSON.parse(originalPuntos);
}

const agregarTramo = (lista) => lista.push({ desde: (lista.at(-1)?.desde ?? 0) + 30, puntos: (lista.at(-1)?.puntos ?? 0) + 5 });

// --- Probar --------------------------------------------------------------------
const prueba = reactive({
  anios: 1, meses: 0, embarazada: false,
  temperatura: '', satOxigeno: '', frecRespiratoria: '', frecCardiaca: '', presionSis: '', presionDia: '',
  dolor: '', conciencia: '', glucosa: '', minutosEsperando: 0, tiempoViajeMinutos: '', condiciones: [],
});
const resultado = ref(null);
const probando = ref(false);

async function probar() {
  probando.value = true;
  error.value = '';
  try {
    const cuerpo = { edadMeses: Number(prueba.anios) * 12 + Number(prueba.meses), embarazada: prueba.embarazada, condiciones: prueba.condiciones, minutosEsperando: Number(prueba.minutosEsperando) || 0 };
    for (const k of ['temperatura', 'satOxigeno', 'frecRespiratoria', 'frecCardiaca', 'presionSis', 'presionDia', 'dolor', 'glucosa', 'tiempoViajeMinutos']) {
      if (prueba[k] !== '' && prueba[k] !== null) cuerpo[k] = Number(prueba[k]);
    }
    if (prueba.conciencia) cuerpo.conciencia = prueba.conciencia;
    resultado.value = await http.post('/admin/priorizacion/probar', cuerpo);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    probando.value = false;
  }
}

const NIVEL = { urgente: 'Urgente', moderado: 'Moderado', leve: 'Leve' };
const fecha = (v) => (v ? new Date(v).toLocaleString('es-GT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

onMounted(cargar);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="b-segmentado" role="tablist">
        <button type="button" :class="{ on: vista === 'criterios' }" @click="vista = 'criterios'">Señales de alarma</button>
        <button type="button" :class="{ on: vista === 'puntos' }" @click="vista = 'puntos'">Puntos y esperas</button>
        <button type="button" :class="{ on: vista === 'probar' }" @click="vista = 'probar'">Probar un caso</button>
      </div>
      <p v-if="meta.actualizadoEn" class="ultimo"><Icono nombre="reloj" :tamano="15" /> {{ meta.actualizadoPor }} · {{ fecha(meta.actualizadoEn) }}</p>
    </div>

    <p v-if="aviso" class="b-aviso ok">{{ aviso }}</p>
    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>

    <!-- 1. Señales de alarma: signos a la izquierda, sus reglas a la derecha -->
    <section v-if="cargado && vista === 'criterios'" class="b-panel">
      <header class="b-panel-cabeza">
        <div class="cifras">
          <span><b>{{ cifras.total }}</b> señales</span>
          <span class="u"><b>{{ cifras.urgentes }}</b> urgentes</span>
          <span class="m"><b>{{ cifras.moderados }}</b> moderadas</span>
        </div>
        <div class="b-acciones">
          <button v-if="criteriosCambiados" type="button" class="b-btn secundario chico" @click="deshacer">Deshacer</button>
          <button type="button" class="b-btn primario chico" :disabled="!criteriosCambiados" @click="guardarCriterios"><Icono nombre="guardar" /> Guardar</button>
        </div>
      </header>

      <div class="dos">
        <nav class="signos" aria-label="Signos">
          <button v-for="k in ORDEN_CAMPOS" :key="k" type="button" class="signo" :class="{ sel: campoSel === k }" @click="campoSel = k">
            <span class="min-w-0 flex-1 truncate">{{ CAMPO[k].texto }}</span>
            <span v-if="conteo(k, 'urgente')" class="cuenta u">{{ conteo(k, 'urgente') }}</span>
            <span v-if="conteo(k, 'moderado')" class="cuenta m">{{ conteo(k, 'moderado') }}</span>
          </button>
        </nav>

        <div class="reglas">
          <div class="reglas-cabeza">
            <h3>{{ CAMPO[campoSel].texto }} <small v-if="CAMPO[campoSel].unidad">{{ CAMPO[campoSel].unidad }}</small></h3>
            <button type="button" class="b-btn secundario chico" @click="agregar(campoSel)"><Icono nombre="agregar" /> Regla</button>
          </div>

          <div v-for="{ c, i } in filasSel" :key="i" class="regla" :class="[c.nivel, { apagada: !c.activo }]">
            <div class="nivel-dos" role="radiogroup" aria-label="Nivel">
              <button type="button" class="u" :class="{ on: c.nivel === 'urgente' }" @click="c.nivel = 'urgente'">Urgente</button>
              <button type="button" class="m" :class="{ on: c.nivel === 'moderado' }" @click="c.nivel = 'moderado'">Moderado</button>
            </div>
            <template v-if="!CAMPO[campoSel].opciones">
              <button type="button" class="op" :title="c.operador === 'mayor_igual' ? 'Igual o mayor' : 'Menor'" @click="c.operador = c.operador === 'mayor_igual' ? 'menor' : 'mayor_igual'">{{ c.operador === 'mayor_igual' ? '≥' : '<' }}</button>
              <input v-model="c.valor" type="number" :step="CAMPO[campoSel].paso ?? 1" class="b-campo num valor" aria-label="Valor" />
            </template>
            <select v-else v-model.number="c.valor" class="b-campo valor-op" aria-label="Valor">
              <option v-for="[v, t] in CAMPO[campoSel].opciones" :key="v" :value="v">{{ t }}{{ c.operador === 'mayor_igual' ? ' o peor' : '' }}</option>
            </select>
            <details class="edad">
              <summary><Icono nombre="usuario" :tamano="14" /> {{ textoEdad(c) }}<span v-if="c.soloEmbarazo"> · embarazo</span></summary>
              <div class="edad-pop">
                <label>Desde <input v-model="c.edadDesdeMeses" type="number" min="0" class="b-campo num" /> meses</label>
                <label>Hasta <input v-model="c.edadHastaMeses" type="number" min="1" placeholder="—" class="b-campo num" /> meses</label>
                <label class="flex items-center gap-2"><input v-model="c.soloEmbarazo" type="checkbox" /> Solo embarazadas</label>
              </div>
            </details>
            <input v-model="c.etiqueta" class="b-campo etiqueta" placeholder="Nombre de la señal" aria-label="Nombre de la señal" />
            <label class="interruptor" :title="c.activo ? 'Activa' : 'Apagada'">
              <input v-model="c.activo" type="checkbox" :aria-label="`${c.etiqueta} activa`" />
              <span />
            </label>
            <button type="button" class="quitar" aria-label="Quitar regla" @click="quitar(i)"><Icono nombre="quitar" :tamano="18" /></button>
          </div>
          <p v-if="!filasSel.length" class="b-vacio">Sin reglas</p>
        </div>
      </div>
    </section>

    <!-- 2. Puntos y esperas -->
    <section v-if="cargado && vista === 'puntos'" class="b-panel">
      <header class="b-panel-cabeza">
        <h2 class="b-panel-titulo">Orden dentro de cada nivel</h2>
        <div class="b-acciones">
          <button v-if="puntosCambiados" type="button" class="b-btn secundario chico" @click="deshacer">Deshacer</button>
          <button type="button" class="b-btn primario chico" :disabled="!puntosCambiados" @click="guardarPuntos"><Icono nombre="guardar" /> Guardar</button>
        </div>
      </header>
      <div class="b-panel-cuerpo tablero">
        <fieldset class="caja destacada">
          <legend><Icono nombre="reloj" :tamano="15" /> Espera máxima</legend>
          <label class="par"><span class="tono m">Moderado</span><input v-model.number="puntos.tiempoMaximo.moderado" type="number" class="b-campo num" /><small>min</small></label>
          <label class="par"><span class="tono l">Leve</span><input v-model.number="puntos.tiempoMaximo.leve" type="number" class="b-campo num" /><small>min</small></label>
        </fieldset>
        <fieldset class="caja">
          <legend>Nivel</legend>
          <label v-for="n in ['urgente', 'moderado', 'leve']" :key="n" class="par"><span class="tono" :class="n[0]">{{ NIVEL[n] }}</span><input v-model.number="puntos.gravedad[n]" type="number" class="b-campo num" /><small>pts</small></label>
        </fieldset>
        <fieldset class="caja">
          <legend>Persona</legend>
          <label class="par"><span>Embarazada</span><input v-model.number="puntos.condicion.embarazo" type="number" class="b-campo num" /><small>pts</small></label>
          <label class="par"><span>Menor de 5 años</span><input v-model.number="puntos.condicion.menor_5" type="number" class="b-campo num" /><small>pts</small></label>
          <label class="par"><span>Menor de 2 meses</span><input v-model.number="puntos.condicion.menor_2_meses" type="number" class="b-campo num" /><small>+pts</small></label>
          <label class="par"><span>Persona mayor</span><input v-model.number="puntos.condicion.adulto_mayor" type="number" class="b-campo num" /><small>pts</small></label>
          <label class="par"><span>Discapacidad</span><input v-model.number="puntos.condicion.discapacidad" type="number" class="b-campo num" /><small>pts</small></label>
        </fieldset>
        <fieldset class="caja">
          <legend>Tiempo esperando</legend>
          <div v-for="(t, k) in puntos.espera" :key="k" class="tramo">
            <input v-model.number="t.desde" type="number" class="b-campo num" /><small>min</small>
            <input v-model.number="t.puntos" type="number" class="b-campo num" /><small>pts</small>
            <button v-if="puntos.espera.length > 1" type="button" class="quitar" aria-label="Quitar tramo" @click="puntos.espera.splice(k, 1)"><Icono nombre="quitar" :tamano="16" /></button>
          </div>
          <button type="button" class="b-btn secundario chico mt-1 justify-self-start" @click="agregarTramo(puntos.espera)"><Icono nombre="agregar" /> Tramo</button>
        </fieldset>
        <fieldset class="caja">
          <legend>Distancia de viaje</legend>
          <div v-for="(t, k) in puntos.distancia" :key="k" class="tramo">
            <input v-model.number="t.desde" type="number" class="b-campo num" /><small>min</small>
            <input v-model.number="t.puntos" type="number" class="b-campo num" /><small>pts</small>
            <button type="button" class="quitar" aria-label="Quitar tramo" @click="puntos.distancia.splice(k, 1)"><Icono nombre="quitar" :tamano="16" /></button>
          </div>
          <button type="button" class="b-btn secundario chico mt-1 justify-self-start" @click="agregarTramo(puntos.distancia)"><Icono nombre="agregar" /> Tramo</button>
        </fieldset>
        <fieldset class="caja">
          <legend>Ausente al llamarlo</legend>
          <label class="par"><span>Cada vez</span><input v-model.number="puntos.ausencia" type="number" class="b-campo num" /><small>−pts</small></label>
        </fieldset>
      </div>
    </section>

    <!-- 3. Probar un caso -->
    <section v-if="cargado && vista === 'probar'" class="probar">
      <form class="b-panel" @submit.prevent="probar">
        <header class="b-panel-cabeza">
          <h2 class="b-panel-titulo">Paciente de ejemplo</h2>
          <button type="submit" class="b-btn primario chico" :disabled="probando"><Icono nombre="irA" /> Calcular</button>
        </header>
        <div class="b-panel-cuerpo caso">
          <label><span class="b-etiqueta">Años</span><input v-model="prueba.anios" type="number" min="0" class="b-campo num" /></label>
          <label><span class="b-etiqueta">Meses</span><input v-model="prueba.meses" type="number" min="0" max="11" class="b-campo num" /></label>
          <label><span class="b-etiqueta">Temp. °C</span><input v-model="prueba.temperatura" type="number" step="0.1" class="b-campo num" /></label>
          <label><span class="b-etiqueta">SatO₂ %</span><input v-model="prueba.satOxigeno" type="number" class="b-campo num" /></label>
          <label><span class="b-etiqueta">F. resp.</span><input v-model="prueba.frecRespiratoria" type="number" class="b-campo num" /></label>
          <label><span class="b-etiqueta">F. card.</span><input v-model="prueba.frecCardiaca" type="number" class="b-campo num" /></label>
          <label><span class="b-etiqueta">P/A sist.</span><input v-model="prueba.presionSis" type="number" class="b-campo num" /></label>
          <label><span class="b-etiqueta">P/A diast.</span><input v-model="prueba.presionDia" type="number" class="b-campo num" /></label>
          <label><span class="b-etiqueta">Dolor /10</span><input v-model="prueba.dolor" type="number" min="0" max="10" class="b-campo num" /></label>
          <label><span class="b-etiqueta">Glucosa</span><input v-model="prueba.glucosa" type="number" class="b-campo num" /></label>
          <label class="ancho"><span class="b-etiqueta">Conciencia</span>
            <select v-model="prueba.conciencia" class="b-campo">
              <option value="">Alerta</option><option value="confuso">Confuso</option><option value="voz">Responde a la voz</option><option value="dolor">Solo al dolor</option><option value="no_responde">No responde</option>
            </select>
          </label>
          <label><span class="b-etiqueta">Espera min</span><input v-model="prueba.minutosEsperando" type="number" min="0" class="b-campo num" /></label>
          <label><span class="b-etiqueta">Viaje min</span><input v-model="prueba.tiempoViajeMinutos" type="number" min="0" class="b-campo num" /></label>
          <div class="ancho fichas">
            <label class="ficha"><input v-model="prueba.embarazada" type="checkbox" /> Embarazada</label>
            <label class="ficha"><input v-model="prueba.condiciones" type="checkbox" value="discapacidad" /> Discapacidad</label>
          </div>
        </div>
      </form>

      <aside class="resultado" :class="resultado ? `nivel-${resultado.nivelEnCola}` : 'vacio'">
        <template v-if="resultado">
          <div class="res-cabeza">
            <span class="sello-res">Resultado</span>
            <p class="grande">{{ NIVEL[resultado.nivelEnCola] }}</p>
            <div class="medidor"><span v-for="n in ['leve', 'moderado', 'urgente']" :key="n" :class="{ lleno: ['leve', 'moderado', 'urgente'].indexOf(n) <= ['leve', 'moderado', 'urgente'].indexOf(resultado.nivelEnCola) }" /></div>
          </div>
          <div class="p-4">
            <p v-if="resultado.subio" class="mb-2 text-sm font-bold text-atencion-700">Subió por la espera</p>
            <ul v-if="resultado.motivos.length" class="motivos-p">
              <li v-for="m in resultado.motivos" :key="m.texto" :class="m.nivel">{{ m.texto }}</li>
            </ul>
            <div class="puntaje">
              <span>Puntaje</span><b>{{ resultado.puntaje }}</b>
            </div>
            <ul class="factores">
              <li v-for="f in resultado.factores.filter((x) => x.puntos)" :key="f.etiqueta"><span>{{ f.etiqueta }}</span><b>{{ f.puntos > 0 ? '+' : '' }}{{ f.puntos }}</b></li>
            </ul>
          </div>
        </template>
        <div v-else class="espera"><Icono nombre="consulta" :tamano="28" /><b>Sin calcular</b></div>
      </aside>
    </section>

    <DialogoAutorizacion
      :abierto="Boolean(autorizacion.pendiente.value)"
      :operacion="autorizacion.pendiente.value?.operacion ?? ''"
      :error="autorizacion.error.value"
      :enviando="autorizacion.enviando.value"
      @confirmar="autorizacion.confirmar"
      @cancelar="autorizacion.cancelar"
    />
  </div>
</template>

<style scoped>
.ultimo { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px; background: #F1F5F9; font-size: 13px; font-weight: 700; color: #475569; }
.cifras { display: flex; flex-wrap: wrap; gap: 8px; }
.cifras span { padding: 4px 12px; border-radius: 9px; background: #F1F5F9; font-size: 14px; font-weight: 600; color: #475569; }
.cifras b { margin-right: 3px; font-size: 18px; font-weight: 800; color: #14244A; font-variant-numeric: tabular-nums; }
.cifras .u { background: #FDECEC; color: #8C1D1D; } .cifras .u b { color: #A52A2A; }
.cifras .m { background: #FFF4D6; color: #7A4F05; } .cifras .m b { color: #8A5A06; }
.dos { display: grid; grid-template-columns: 215px minmax(0, 1fr); min-height: 420px; }
@media (max-width: 900px) { .dos { grid-template-columns: 1fr; } }
.signos { display: grid; align-content: start; gap: 2px; padding: 10px; background: #F8FAFC; border-right: 2px solid #E2E8F0; }
.signo { display: flex; align-items: center; gap: 6px; padding: 9px 10px; border-radius: 10px; text-align: left; font-size: 14px; font-weight: 700; color: #334155; border-left: 4px solid transparent; }
.signo:hover { background: #EEF2F7; }
.signo.sel { background: #fff; color: #14244A; border-left-color: #172A5A; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
.cuenta { min-width: 22px; padding: 0 6px; border-radius: 6px; font-size: 12px; font-weight: 800; text-align: center; color: #fff; }
.cuenta.u { background: #C03535; }
.cuenta.m { background: #E8930C; }
.reglas { padding: 14px 18px 18px; }
.reglas-cabeza { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.reglas-cabeza h3 { font-size: 20px; font-weight: 800; color: #14244A; }
.reglas-cabeza small { margin-left: 6px; font-size: 14px; font-weight: 600; color: #64748B; }
.regla { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 10px; border: 2px solid #E2E8F0; border-left-width: 6px; border-radius: 12px; }
.regla.urgente { border-left-color: #C03535; }
.regla.moderado { border-left-color: #E8930C; }
.regla.apagada { opacity: .5; }
.nivel-dos { display: inline-flex; padding: 3px; border-radius: 9px; background: #F1F5F9; }
.nivel-dos button { padding: 4px 10px; border-radius: 7px; font-size: 12px; font-weight: 800; color: #64748B; }
.nivel-dos button.u.on { background: #C03535; color: #fff; }
.nivel-dos button.m.on { background: #E8930C; color: #fff; }
.op { width: 36px; height: 34px; border: 2px solid #CBD5E1; border-radius: 8px; font-size: 17px; font-weight: 800; color: #14244A; background: #fff; }
.op:hover { border-color: #172A5A; }
.regla .b-campo { height: 34px; padding: 0 8px; font-size: 14px; border-radius: 8px; }
.valor { width: 66px; }
.valor-op { width: 190px; }
.etiqueta { flex: 1 1 170px; min-width: 170px; font-weight: 600; }
.edad { position: relative; }
.edad summary { display: inline-flex; align-items: center; gap: 4px; list-style: none; cursor: pointer; padding: 5px 10px; border-radius: 8px; background: #EEF2FA; font-size: 13px; font-weight: 700; color: #172A5A; white-space: nowrap; }
.edad summary::-webkit-details-marker { display: none; }
.edad[open] summary { background: #172A5A; color: #fff; }
.edad-pop { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; display: grid; gap: 8px; width: 240px; padding: 12px; background: #fff; border: 2px solid #172A5A; border-radius: 10px; box-shadow: 0 10px 24px rgba(15,23,42,.18); font-size: 13px; font-weight: 700; color: #334155; }
.edad-pop label { display: flex; align-items: center; gap: 6px; }
.edad-pop .b-campo { width: 80px; height: 32px; }
.interruptor { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; cursor: pointer; }
.interruptor input { position: absolute; opacity: 0; width: 0; height: 0; }
.interruptor span { position: absolute; inset: 0; border-radius: 999px; background: #CBD5E1; transition: background .15s; }
.interruptor span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.interruptor input:checked + span { background: #1E8E5E; }
.interruptor input:checked + span::after { transform: translateX(18px); }
.interruptor input:focus-visible + span { outline: 3px solid #DCE4F5; }
.quitar { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; color: #94A3B8; }
.quitar:hover { background: #FDECEC; color: #A52A2A; }
.tablero { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
.caja { min-width: 0; }
.caja { display: grid; align-content: start; gap: 8px; padding: 12px 14px 14px; border: 2px solid #E2E8F0; border-radius: 14px; }
.caja.destacada { border-color: #172A5A; background: #F7F9FD; }
.caja legend { display: inline-flex; align-items: center; gap: 6px; padding: 0 6px; font-size: 13px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #14244A; }
.par, .tramo { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: #334155; }
.par span { flex: 1; }
.par .tono { flex: 0 0 auto; margin-right: auto; padding: 2px 10px; border-radius: 7px; font-size: 13px; font-weight: 800; color: #fff; }
.tono.u { background: #C03535; } .tono.m { background: #E8930C; } .tono.l { background: #1E8E5E; }
.par .b-campo, .tramo .b-campo { width: 72px; height: 36px; padding: 0 8px; }
.tramo .b-campo { width: 64px; }
.par small, .tramo small { width: 30px; font-size: 12px; font-weight: 700; color: #64748B; }
.tramo span { font-size: 13px; color: #64748B; }
.probar { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
@media (max-width: 1023px) { .probar { grid-template-columns: 1fr; } }
.caso { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 12px; }
.caso .ancho { grid-column: span 2; }
.caso .fichas { grid-column: 1 / -1; flex-direction: row; }
.fichas { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }
.ficha { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border: 2px solid #E2E8F0; border-radius: 10px; font-weight: 700; color: #334155; cursor: pointer; }
.ficha:has(input:checked) { border-color: #172A5A; background: #EEF2FA; color: #14244A; }
.resultado { position: sticky; top: 88px; overflow: hidden; background: #fff; border: 2px solid #E2E8F0; border-radius: 16px; }
.res-cabeza { padding: 14px 18px 16px; color: #fff; background: #1E8E5E; }
.nivel-moderado .res-cabeza { background: #C77A06; }
.nivel-urgente .res-cabeza { background: #B42F2F; }
.sello-res { padding: 2px 8px; border: 2px solid rgba(255,255,255,.55); border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.grande { margin-top: 8px; font-size: 32px; font-weight: 800; line-height: 1; }
.medidor { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 12px; }
.medidor span { height: 7px; border-radius: 4px; background: rgba(255,255,255,.28); }
.medidor span.lleno { background: #fff; }
.motivos-p { display: grid; gap: 6px; }
.motivos-p li { padding: 6px 10px; border-radius: 8px; font-size: 14px; font-weight: 700; }
.motivos-p li.urgente { background: #FDECEC; color: #8C1D1D; }
.motivos-p li.moderado { background: #FFF4DE; color: #7A4F05; }
.puntaje { display: flex; align-items: baseline; justify-content: space-between; margin-top: 12px; padding: 8px 12px; border-radius: 10px; background: #14244A; color: #fff; font-weight: 700; }
.puntaje b { font-size: 24px; font-variant-numeric: tabular-nums; }
.factores { margin-top: 6px; display: grid; font-size: 14px; }
.factores li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 2px; border-bottom: 1px dashed #E2E8F0; color: #334155; }
.factores b { font-variant-numeric: tabular-nums; color: #14244A; }
.espera { display: grid; justify-items: center; gap: 6px; padding: 48px 16px; color: #94A3B8; }
.espera b { color: #64748B; }
</style>
