<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { partesEspera, deOtroDia } from '../../dominio/espera';
import { RouterLink, useRouter } from 'vue-router';
import http from '../../services/http';
import { useAuthStore } from '../../stores/auth';
import CodigoPaciente from '../../components/comunes/CodigoPaciente.vue';
import Icono from '../../components/comunes/Icono.vue';
import EstadoVacio from '../../components/comunes/EstadoVacio.vue';

/**
 * Cola de atención, pensada para la tablet de preconsulta y del consultorio:
 * el siguiente a llamar en grande con su botón, los demás en orden debajo, y
 * a un lado cuánta gente espera y quién está en consulta.
 */
const auth = useAuthStore();
const router = useRouter();

const datos = ref(null);
const error = ref('');
const cargando = ref(false);
const desdeCache = ref(false);
const minutosDeAntiguedad = ref(0);
const actualizadaEn = ref(null);
const confirmandoAusente = ref(null);
// Atención abierta por error: se cancela con su motivo y sale de la cola.
const cancelando = ref(null);
const motivoCancelacion = ref('');
// En la lista, las acciones de cada paciente se abren al tocarlo.
const abierto = ref(null);

const puedeRegistrar = computed(() => auth.rol === 'preconsulta');
const puedeConsultar = computed(() => auth.rol === 'medico');

// Un color por nivel, el mismo en la tarjeta, la etiqueta y el resumen.
const NIVEL = {
  urgente: { texto: 'Urgente', icono: 'alerta' },
  moderado: { texto: 'Moderado', icono: 'alerta' },
  leve: { texto: 'Leve', icono: 'correcto' },
};
const nivelDe = (e) => e.nivel ?? e.gravedad ?? 'leve';
const textoNivel = (e) => (nivelDe(e) === 'moderado' && e.subio ? 'Moderado · por espera' : NIVEL[nivelDe(e)]?.texto ?? 'Leve');

// El porqué de la prioridad: primero lo clínico, después lo demás.
const clinicos = (e) => e.factores.filter((f) => f.tipo === 'clinico' || f.tipo === 'espera_excedida');
const otros = (e) => e.factores.filter((f) => f.tipo !== 'clinico' && f.tipo !== 'espera_excedida');

/** 45 min · 2 h 10 min · 2 d 7 h: se lee de un vistazo. */
const espera = partesEspera;
const fechaCorta = (f) => new Date(f).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', timeZone: 'America/Guatemala' });

const siguiente = computed(() => datos.value?.cola[0] ?? null);
const despues = computed(() => datos.value?.cola.slice(1) ?? []);
const porNivel = computed(() => {
  const c = { urgente: 0, moderado: 0, leve: 0 };
  for (const e of datos.value?.cola ?? []) c[nivelDe(e)] = (c[nivelDe(e)] ?? 0) + 1;
  return c;
});
// Los que quedaron en espera de otro día no entran a la cola: se cierran aquí.
const anteriores = computed(() => datos.value?.anteriores ?? []);
const verAnteriores = ref(false);
const cerrandoAnteriores = ref(false);
async function cerrarAnteriores() {
  cerrandoAnteriores.value = true;
  try {
    for (const e of anteriores.value) {
      await http.patch(`/atenciones/${e.id}/cancelar`, { motivo: 'Quedó en espera de un día anterior y no fue atendido' });
    }
    verAnteriores.value = false;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cerrandoAnteriores.value = false;
  }
}
const horaActualizada = computed(() => (actualizadaEn.value ? actualizadaEn.value.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) : ''));

async function cargar() {
  cargando.value = true;
  try {
    const lectura = await http.getConCache('/atenciones/cola');
    datos.value = lectura.datos;
    desdeCache.value = lectura.desdeCache;
    minutosDeAntiguedad.value = lectura.minutosDeAntiguedad;
    if (!lectura.desdeCache) actualizadaEn.value = new Date();
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

async function cambiar(id, estado) {
  try {
    await http.patch(`/atenciones/${id}/estado`, { estado });
    error.value = '';
    confirmandoAusente.value = null;
    abierto.value = null;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function cancelar(id) {
  try {
    await http.patch(`/atenciones/${id}/cancelar`, { motivo: motivoCancelacion.value.trim() });
    error.value = '';
    cancelando.value = null;
    motivoCancelacion.value = '';
    abierto.value = null;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function pedirAusente(id) {
  confirmandoAusente.value = id;
  cancelando.value = null;
}
function pedirCancelar(id) {
  cancelando.value = id;
  confirmandoAusente.value = null;
  motivoCancelacion.value = '';
}
function alternar(id) {
  abierto.value = abierto.value === id ? null : id;
  confirmandoAusente.value = null;
  cancelando.value = null;
}

let temporizador;
onMounted(() => {
  cargar();
  temporizador = setInterval(cargar, 60000);
});
onUnmounted(() => clearInterval(temporizador));
</script>

<template>
  <div class="cola mx-auto max-w-[1280px]">
    <header class="cabeza">
      <h1 class="titulo-pagina">Cola de atención</h1>
      <button type="button" class="b-btn secundario actualizar" :disabled="cargando" @click="cargar">
        <Icono nombre="actualizar" :tamano="20" :class="cargando ? 'animate-spin' : ''" />
        <span>Actualizar<small v-if="horaActualizada"> · {{ horaActualizada }}</small></span>
      </button>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="desdeCache" role="status" class="b-aviso mt-4">
      Sin conexión · lista de hace {{ minutosDeAntiguedad }} min
    </p>

    <div v-if="datos" class="rejilla mt-5">
      <!-- Principal: el siguiente y los que vienen -->
      <main class="min-w-0">
        <div v-if="!siguiente" class="tarjeta">
          <EstadoVacio
            icono="correcto"
            titulo="No hay nadie esperando"
            descripcion="Cuando preconsulta registre una atención, aparecerá aquí en orden de prioridad."
          />
        </div>

        <template v-else>
          <!-- Siguiente a llamar -->
          <article class="heroe" :class="`nv-${nivelDe(siguiente)}`">
            <div class="heroe-cinta">
              <span>Siguiente a llamar</span>
              <span class="nivel-pill"><Icono :nombre="NIVEL[nivelDe(siguiente)]?.icono ?? 'correcto'" :tamano="15" :grosor="2.6" /> {{ textoNivel(siguiente) }}</span>
            </div>

            <div class="heroe-cuerpo">
              <CodigoPaciente :papel="siguiente.paciente.expedientePapel" :expediente="siguiente.paciente.expediente" />
              <div class="min-w-0 flex-1">
                <RouterLink :to="`/pacientes/${siguiente.paciente.id}`" class="heroe-nombre">{{ siguiente.paciente.nombreCompleto }}</RouterLink>
                <p class="heroe-motivo">{{ siguiente.motivoConsulta }}</p>
                <p v-if="siguiente.paciente.comunidad" class="text-sm font-semibold text-apagado">{{ siguiente.paciente.comunidad }}</p>
              </div>
              <div class="reloj" :class="siguiente.excedido ? 'excedido' : ''">
                <span class="n">{{ espera(siguiente.minutosEsperando).n }}</span>
                <span class="u">{{ espera(siguiente.minutosEsperando).u || 'esperando' }}</span>
                <span v-if="deOtroDia(siguiente)" class="otro-dia">Desde el {{ fechaCorta(siguiente.registradaEn) }}</span>
              </div>
            </div>

            <div v-if="siguiente.factores.length || !siguiente.tienePreconsulta" class="porque">
              <span v-for="f in clinicos(siguiente)" :key="f.etiqueta" class="chip clinico">{{ f.etiqueta }}</span>
              <span v-for="f in otros(siguiente)" :key="f.etiqueta" class="chip">{{ f.etiqueta }}</span>
              <span v-if="!siguiente.tienePreconsulta" class="chip falta"><Icono nombre="alerta" :tamano="14" :grosor="2.4" /> Falta tomarle signos vitales</span>
            </div>

            <div class="heroe-acciones">
              <button type="button" class="b-btn primario llamar" @click="cambiar(siguiente.id, 'en_atencion')">
                <Icono nombre="llamar" :tamano="26" :grosor="2.2" /> Llamar a consulta
              </button>
              <button v-if="!siguiente.tienePreconsulta && puedeRegistrar" type="button" class="b-btn secundario grande" @click="router.push(`/preconsulta/${siguiente.id}`)">
                <Icono nombre="agregar" :tamano="22" /> Tomar signos
              </button>
              <div class="menores">
                <button type="button" class="b-btn secundario chico" @click="pedirAusente(siguiente.id)">No se presentó</button>
                <button type="button" class="b-btn peligro chico" @click="pedirCancelar(siguiente.id)">Cancelar atención</button>
              </div>
            </div>

            <div v-if="confirmandoAusente === siguiente.id" class="confirmar">
              <p class="font-extrabold text-[#8C2323]">¿Marcar a {{ siguiente.paciente.nombreCompleto }} como ausente?</p>
              <p class="mt-1 font-semibold text-slate-600">
                {{ siguiente.ausencias >= 1 ? 'Es su segunda ausencia: saldrá del sistema y tendrá que registrarse de nuevo.' : 'Vuelve a la lista con 10 puntos menos y su espera empieza de cero.' }}
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button type="button" class="b-btn rojo" @click="cambiar(siguiente.id, 'ausente')">Sí, marcar ausente</button>
                <button type="button" class="b-btn secundario" @click="confirmandoAusente = null">No</button>
              </div>
            </div>
            <form v-if="cancelando === siguiente.id" class="confirmar" @submit.prevent="cancelar(siguiente.id)">
              <label :for="`motivo-${siguiente.id}`" class="font-extrabold text-[#8C2323]">¿Por qué se cancela la atención de {{ siguiente.paciente.nombreCompleto }}?</label>
              <p class="mt-1 font-semibold text-slate-600">Sale de la cola con su motivo.</p>
              <input :id="`motivo-${siguiente.id}`" v-model="motivoCancelacion" minlength="5" required placeholder="Ej.: se abrió por error" class="b-campo mt-2 w-full" />
              <div class="mt-3 flex flex-wrap gap-2">
                <button type="submit" class="b-btn rojo" :disabled="motivoCancelacion.trim().length < 5">Sí, cancelar atención</button>
                <button type="button" class="b-btn secundario" @click="cancelando = null">No cancelar</button>
              </div>
            </form>
          </article>

          <!-- Después -->
          <h2 v-if="despues.length" class="sub mt-6">Después <span class="cuenta">{{ despues.length }}</span></h2>
          <ol class="lista">
            <li v-for="e in despues" :key="e.id" class="turno" :class="[`nv-${nivelDe(e)}`, abierto === e.id ? 'abierto' : '']">
              <button type="button" class="turno-fila" :aria-expanded="abierto === e.id" @click="alternar(e.id)">
                <span class="pos">{{ e.posicion }}</span>
                <span class="min-w-0 flex-1 text-left">
                  <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="truncate text-[17px] font-extrabold text-tinta">{{ e.paciente.nombreCompleto }}</span>
                    <span class="nivel-mini">{{ textoNivel(e) }}</span>
                    <span v-if="!e.tienePreconsulta" class="nivel-mini sin-signos">Sin signos</span>
                  </span>
                  <span class="mt-0.5 block truncate font-semibold text-apagado">
                    {{ e.paciente.expedientePapel ?? e.paciente.expediente }} · {{ e.motivoConsulta }}
                  </span>
                </span>
                <span class="mini-reloj" :class="e.excedido ? 'excedido' : ''">
                  <b>{{ espera(e.minutosEsperando).n }}</b>
                  <small>{{ deOtroDia(e) ? `desde ${fechaCorta(e.registradaEn)}` : espera(e.minutosEsperando).u }}</small>
                </span>
                <Icono nombre="irA" :tamano="20" :grosor="2.6" class="flecha" />
              </button>

              <div v-if="abierto === e.id" class="turno-detalle">
                <div v-if="e.factores.length" class="porque">
                  <span v-for="f in clinicos(e)" :key="f.etiqueta" class="chip clinico">{{ f.etiqueta }}</span>
                  <span v-for="f in otros(e)" :key="f.etiqueta" class="chip">{{ f.etiqueta }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" class="b-btn primario" @click="cambiar(e.id, 'en_atencion')"><Icono nombre="llamar" :tamano="20" /> Llamar a consulta</button>
                  <button v-if="!e.tienePreconsulta && puedeRegistrar" type="button" class="b-btn secundario" @click="router.push(`/preconsulta/${e.id}`)"><Icono nombre="agregar" :tamano="20" /> Tomar signos</button>
                  <RouterLink :to="`/pacientes/${e.paciente.id}`" class="b-btn secundario">Ver paciente</RouterLink>
                  <span class="flex-1" />
                  <button type="button" class="b-btn secundario chico" @click="pedirAusente(e.id)">No se presentó</button>
                  <button type="button" class="b-btn peligro chico" @click="pedirCancelar(e.id)">Cancelar atención</button>
                </div>

                <div v-if="confirmandoAusente === e.id" class="confirmar">
                  <p class="font-extrabold text-[#8C2323]">¿Marcar a {{ e.paciente.nombreCompleto }} como ausente?</p>
                  <p class="mt-1 font-semibold text-slate-600">
                    {{ e.ausencias >= 1 ? 'Es su segunda ausencia: saldrá del sistema y tendrá que registrarse de nuevo.' : 'Vuelve a la lista con 10 puntos menos y su espera empieza de cero.' }}
                  </p>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button type="button" class="b-btn rojo" @click="cambiar(e.id, 'ausente')">Sí, marcar ausente</button>
                    <button type="button" class="b-btn secundario" @click="confirmandoAusente = null">No</button>
                  </div>
                </div>
                <form v-if="cancelando === e.id" class="confirmar" @submit.prevent="cancelar(e.id)">
                  <label :for="`motivo-${e.id}`" class="font-extrabold text-[#8C2323]">¿Por qué se cancela la atención de {{ e.paciente.nombreCompleto }}?</label>
                  <p class="mt-1 font-semibold text-slate-600">Sale de la cola con su motivo.</p>
                  <input :id="`motivo-${e.id}`" v-model="motivoCancelacion" minlength="5" required placeholder="Ej.: se abrió por error" class="b-campo mt-2 w-full" />
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button type="submit" class="b-btn rojo" :disabled="motivoCancelacion.trim().length < 5">Sí, cancelar atención</button>
                    <button type="button" class="b-btn secundario" @click="cancelando = null">No cancelar</button>
                  </div>
                </form>
              </div>
            </li>
          </ol>
        </template>
      </main>

      <!-- Lado: cuánta gente espera y quién está en consulta -->
      <aside class="lado">
        <div class="cifras">
          <div class="cifra principal">
            <span class="n">{{ datos.resumen.enEspera }}</span>
            <span class="e">en espera</span>
          </div>
          <div class="cifra">
            <span class="n">{{ espera(datos.resumen.esperaPromedio).n }}<small>&nbsp;{{ espera(datos.resumen.esperaPromedio).u }}</small></span>
            <span class="e">espera promedio</span>
          </div>
        </div>

        <div v-if="datos.resumen.enEspera" class="niveles" aria-label="Pacientes por nivel">
          <div v-for="(n, clave) in porNivel" :key="clave" class="nivel-fila" :class="`nv-${clave}`">
            <span class="punto" />
            <span class="flex-1 font-extrabold">{{ NIVEL[clave].texto }}</span>
            <b>{{ n }}</b>
          </div>
          <div class="barra" aria-hidden="true">
            <span v-for="(n, clave) in porNivel" :key="clave" :class="`nv-${clave}`" :style="{ flexGrow: n }" />
          </div>
        </div>

        <p v-if="datos.resumen.superan90" class="aviso-lado atencion">
          <Icono nombre="reloj" :tamano="18" :grosor="2.2" />
          {{ datos.resumen.superan90 }} llevan más de 90 minutos
        </p>
        <div v-if="anteriores.length && puedeRegistrar" class="aviso-lado neutro anteriores">
          <button type="button" class="flex w-full items-start gap-2 text-left" :aria-expanded="verAnteriores" @click="verAnteriores = !verAnteriores">
            <Icono nombre="informacion" :tamano="18" :grosor="2.2" />
            <span>{{ anteriores.length }} {{ anteriores.length === 1 ? 'quedó' : 'quedaron' }} de otro día. Ver y cerrar</span>
          </button>
          <template v-if="verAnteriores">
            <ul>
              <li v-for="e in anteriores" :key="e.id">{{ e.paciente.nombreCompleto }} <small>· {{ fechaCorta(e.registradaEn) }}</small></li>
            </ul>
            <button type="button" class="b-btn secundario chico w-full" :disabled="cerrandoAnteriores" @click="cerrarAnteriores">
              {{ cerrandoAnteriores ? 'Cerrando…' : 'Cerrar como no atendidos' }}
            </button>
          </template>
        </div>
        <p v-if="datos.jornada.aviso" class="aviso-lado atencion">
          <Icono nombre="reloj" :tamano="18" :grosor="2.2" />
          {{ datos.jornada.aviso }}
        </p>

        <section class="consulta">
          <h2 class="sub"><span class="punto verde" /> En consulta</h2>
          <p v-if="!datos.enAtencion.length" class="vacio">Nadie en consulta ahora.</p>
          <div v-for="e in datos.enAtencion" :key="e.id" class="en-consulta">
            <div class="min-w-0 flex-1">
              <p class="truncate font-extrabold text-tinta">{{ e.paciente.nombreCompleto }}</p>
              <p class="truncate text-sm font-semibold text-apagado">{{ e.paciente.expedientePapel ?? e.paciente.expediente }} · {{ e.motivoConsulta }}</p>
            </div>
            <RouterLink v-if="puedeConsultar" :to="`/consulta/${e.id}`" class="b-btn primario chico">
              <Icono nombre="consulta" :tamano="18" /> Abrir
            </RouterLink>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* Niveles: rojo urgente, ámbar moderado, verde leve (los tonos del sistema). */
.nv-urgente { --nv: #D64545; --nv-fondo: #FDECEC; --nv-borde: #F3B1B1; --nv-hondo: #A83232; --nv-tinta: #8C2323; }
.nv-moderado { --nv: #E8930C; --nv-fondo: #FFF4E0; --nv-borde: #F5C26B; --nv-hondo: #C27708; --nv-tinta: #8A4B00; }
.nv-leve { --nv: #22A06B; --nv-fondo: #E3F6EC; --nv-borde: #9ED9BC; --nv-hondo: #17784F; --nv-tinta: #145C3D; }

.cabeza { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.actualizar small { font-weight: 700; color: #64748B; }

/* Tablet horizontal: lista a la izquierda y resumen a la derecha. */
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 22px; align-items: start; }
.rejilla > main { grid-row: 1; grid-column: 1; }
.rejilla > .lado { grid-row: 1; grid-column: 2; position: sticky; top: 16px; }
@media (max-width: 1023px) {
  .rejilla { grid-template-columns: 1fr; }
  .rejilla > main, .rejilla > .lado { grid-row: auto; grid-column: 1; position: static; }
}

/* --- Lado ------------------------------------------------------------------ */
.lado { display: flex; flex-direction: column; gap: 12px; }
.cifras { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cifra { padding: 14px 16px; background: #fff; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; }
.cifra.principal { background: #EAF3FB; border-color: #9FCDEC; border-bottom-color: #4A9BD6; }
.cifra .n { display: block; font-size: 34px; font-weight: 900; line-height: 1; color: #14244A; font-variant-numeric: tabular-nums; }
.cifra .n small { font-size: 15px; font-weight: 800; }
.cifra .e { display: block; margin-top: 6px; font-size: 12px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #64748B; }
.niveles { padding: 12px 14px; background: #fff; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; }
.nivel-fila { display: flex; align-items: center; gap: 10px; padding: 4px 0; color: #334155; }
.nivel-fila b { font-size: 18px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.punto { width: 12px; height: 12px; flex-shrink: 0; border-radius: 50%; background: var(--nv); }
.punto.verde { background: #22A06B; }
.barra { display: flex; gap: 3px; height: 10px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: #EDF1F6; }
.barra span { flex-basis: 0; background: var(--nv); }
.aviso-lado { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 14px; font-size: 14px; font-weight: 700; }
.aviso-lado.atencion { background: #FFF4E0; color: #8A4B00; }
.aviso-lado.neutro { background: #F1F4F8; color: #475569; }
.consulta { padding: 12px 14px; background: #fff; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; }
.en-consulta { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 2px solid #F1F4F8; }
.en-consulta:first-of-type { border-top: 0; }
.vacio { padding: 6px 0; font-weight: 600; color: #94A3B8; }
.sub { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; color: #64748B; }
.cuenta { padding: 1px 9px; border-radius: 999px; background: #E5E9F0; color: #334155; }

/* --- Siguiente a llamar ---------------------------------------------------- */
.heroe { overflow: hidden; background: #fff; border: 3px solid var(--nv-borde); border-bottom-width: 6px; border-bottom-color: var(--nv); border-radius: 24px; }
.heroe-cinta { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 20px; background: var(--nv-fondo); color: var(--nv-tinta); font-size: 14px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
.nivel-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; background: var(--nv); color: #fff; letter-spacing: .04em; }
.heroe-cuerpo { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; padding: 20px 22px 8px; }
.heroe-nombre { display: block; font-size: 26px; font-weight: 900; line-height: 1.15; color: #14244A; }
.heroe-nombre:hover { color: #1F3A7A; }
.heroe-motivo { margin-top: 4px; font-size: 18px; font-weight: 700; color: #475569; }
.reloj { display: flex; flex-direction: column; align-items: flex-end; min-width: 110px; padding: 10px 14px; border-radius: 18px; background: #F1F4F8; }
.reloj .n { font-size: 34px; font-weight: 900; line-height: 1; color: #14244A; font-variant-numeric: tabular-nums; }
.reloj .u { margin-top: 4px; font-size: 13px; font-weight: 800; color: #64748B; }
.reloj.excedido { background: #FDECEC; }
.reloj.excedido .n, .reloj.excedido .u { color: #A83232; }
.otro-dia { margin-top: 6px; padding: 2px 8px; border-radius: 8px; background: #fff; font-size: 11px; font-weight: 800; color: #475569; white-space: nowrap; }
.porque { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 22px 4px; }
.turno-detalle .porque { padding: 0 0 12px; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 12px; background: #F1F4F8; font-size: 14px; font-weight: 700; color: #475569; }
.chip.clinico { background: var(--nv-fondo); color: var(--nv-tinta); font-weight: 800; }
.chip.falta { background: #FFF4E0; color: #8A4B00; }
.heroe-acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 16px 22px 20px; }
.llamar { min-height: 64px; padding: 0 28px; font-size: 20px; border-radius: 18px; flex: 1 1 260px; justify-content: center; }
.b-btn.grande { min-height: 64px; padding: 0 22px; font-size: 17px; border-radius: 18px; }
.menores { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.confirmar { margin: 0 22px 20px; padding: 14px 16px; border: 2px solid #F3B1B1; border-radius: 16px; background: #FFF7F7; }
.turno-detalle .confirmar { margin: 12px 0 0; }
.b-btn.rojo { background: #D64545; color: #fff; border-color: #D64545; border-bottom-color: #A83232; }

/* --- Después ---------------------------------------------------------------- */
.lista { display: flex; flex-direction: column; gap: 10px; }
.turno { background: #fff; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; overflow: hidden; }
.turno.abierto { border-color: var(--nv-borde); border-bottom-color: var(--nv); }
.turno-fila { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 76px; padding: 12px 16px; text-align: left; }
.turno-fila:active { background: #F8FAFC; }
.pos { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 14px; background: var(--nv-fondo); color: var(--nv-tinta); font-size: 19px; font-weight: 900; border-bottom: 3px solid var(--nv-borde); }
.nivel-mini { padding: 1px 9px; border-radius: 8px; background: var(--nv-fondo); color: var(--nv-tinta); font-size: 12px; font-weight: 800; white-space: nowrap; }
.nivel-mini.sin-signos { background: #FFF4E0; color: #8A4B00; }
.mini-reloj { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; min-width: 72px; line-height: 1.1; }
.mini-reloj b { font-size: 22px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.mini-reloj small { font-size: 12px; font-weight: 800; color: #64748B; white-space: nowrap; }
.mini-reloj.excedido b, .mini-reloj.excedido small { color: #A83232; }
.flecha { flex-shrink: 0; color: #94A3B8; transition: transform .15s; }
.turno.abierto .flecha { transform: rotate(90deg); color: var(--nv-hondo); }
.turno-detalle { padding: 0 16px 16px 74px; }
@media (max-width: 640px) {
  .turno-detalle { padding-left: 16px; }
  .heroe-nombre { font-size: 22px; }
  .menores { margin-left: 0; }
}
.anteriores { display: grid; gap: 8px; }
.anteriores ul { display: grid; gap: 2px; padding-left: 26px; font-size: 14px; font-weight: 700; }
.anteriores small { font-weight: 600; opacity: .8; }
</style>
