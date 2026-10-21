<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { RouterLink } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import inventario from '../../services/inventario';
import farmacia from '../../services/farmacia';
import { textoEspera } from '../../dominio/espera';
import { estiloTono, miles } from '../../components/bodega/diseno/PiezasBodega';
import Icono from '../../components/comunes/Icono.vue';
import TarjetaCifra from '../../components/paneles/TarjetaCifra.vue';
import Dona from '../../components/paneles/Dona.vue';

/**
 * Inicio de farmacia. La farmacia hace cuatro cosas en el día y el panel las
 * sigue en ese orden:
 *  1. Entregar las recetas de quien sale de consulta.
 *  2. Anotar lo que no pudo entregar (va al SIGSA 4 como no entregado).
 *  3. Pedir a bodega lo que se le acabó en el estante.
 *  4. Sacar del estante lo vencido y ponerle lote a lo que no lo tiene.
 * Arriba, las tres tareas del día en grande (como el inicio de la bodega) y
 * los documentos del mes de post-consulta: su kardex y su BRES, que salen
 * solos de lo que se entregó y de lo que mandó la bodega.
 */
const auth = useAuthStore();
const porAtender = ref(null);
const dia = ref(null);
const estante = ref(null);
const error = ref('');

const hora = Number(new Intl.DateTimeFormat('es-GT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Guatemala' }).format(new Date()));
const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
const primerNombre = computed(() => (auth.usuario?.nombre ?? '').replace(/^(Dr|Dra|Lic|Licda|Ing|P\.C)\.?\s+/i, '').split(' ')[0]);

const intentar = async (p) => { try { return await p; } catch { return null; } };

async function cargar() {
  const [p, d, e] = await Promise.all([intentar(inventario.porAtender()), intentar(farmacia.dia()), intentar(farmacia.existencias())]);
  porAtender.value = p?.porAtender ?? null;
  dia.value = d;
  estante.value = e?.insumos ?? null;
  if (!p && !d && !e) error.value = 'No se pudo cargar el panel.';
}

// Periodos de los documentos del mes: el kardex del mes en curso y el BRES del que ya cerró.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const local = new Date(Date.now() - 6 * 3600000);
const mesActual = local.toISOString().slice(0, 7);
const mesAnterior = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const nombreMes = (p) => MESES[Number(p.slice(5, 7)) - 1];

const minutosDesde = (f) => Math.max(0, Math.round((Date.now() - new Date(f)) / 60000));
const horaDe = (f) => new Date(f).toLocaleTimeString('es-GT', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Guatemala' });

/* ---------- Estante ---------- */
const lotes = computed(() => (estante.value ?? []).flatMap((i) => i.lotes.map((l) => ({ ...l, insumo: i }))));
const sinLote = computed(() => lotes.value.filter((l) => l.numeroLote === 'SIN-LOTE'));
const vencidos = computed(() => lotes.value.filter((l) => l.semaforo === 'vencido'));
const partesEstante = computed(() => {
  const con = (f) => lotes.value.filter((l) => l.numeroLote !== 'SIN-LOTE' && f(l)).length;
  return [
    { clave: 'vencido', texto: 'Vencidos', valor: con((l) => l.semaforo === 'vencido'), color: '#9B2C2C', a: '/dispensacion/control' },
    { clave: 'rojo', texto: 'Menos de 12 meses', valor: con((l) => l.semaforo === 'rojo'), color: '#E8590C', a: '/dispensacion/control' },
    { clave: 'amarillo', texto: 'De 12 a 18 meses', valor: con((l) => l.semaforo === 'amarillo'), color: '#D9A30A', a: '/dispensacion/control' },
    { clave: 'verde', texto: 'Más de 18 meses', valor: con((l) => l.semaforo === 'verde'), color: '#22A06B', a: '/dispensacion/control' },
  ];
});
const lotesConFecha = computed(() => partesEstante.value.reduce((t, p) => t + p.valor, 0));

/* ---------- Qué pedir ---------- */
const noEntregadoHoy = computed(() => (dia.value?.filas ?? []).filter((f) => f.noEntregado > 0));
const recetables = computed(() => (estante.value ?? []).filter((i) => i.prescribible));
// Se acabó en el estante pero bodega tiene: se resuelve hoy con una requisición.
const pedirABodega = computed(() => {
  const faltaHoy = new Set(noEntregadoHoy.value.map((f) => f.insumoId));
  return recetables.value
    .filter((i) => i.entregable === 0 && i.enBodega > 0)
    .sort((a, b) => Number(faltaHoy.has(b.insumoId)) - Number(faltaHoy.has(a.insumoId)) || a.nombre.localeCompare(b.nombre));
});
// No hay en todo el centro: el médico debe saberlo para recetar otra cosa o dar receta externa.
const sinEnElCentro = computed(() => recetables.value.filter((i) => i.enFarmacia === 0 && i.enBodega === 0));

const tarjetas = computed(() => {
  const t = dia.value?.totales;
  const p = porAtender.value;
  const masAntiguo = p?.length ? Math.max(...p.map((x) => minutosDesde(x.registradaEn))) : 0;
  return [
    {
      titulo: 'Esperando su receta',
      valor: p ? p.length : '·',
      nota: !p ? '' : p.length ? `El que más lleva: ${textoEspera(masAntiguo)} desde que llegó` : 'Nadie esperando',
      icono: 'dispensacion',
      tono: p?.length ? 'accion' : 'neutro',
      a: '/dispensacion',
    },
    {
      titulo: 'Entregado hoy',
      valor: t ? t.pacientes : '·',
      unidad: t ? (t.pacientes === 1 ? 'paciente' : 'pacientes') : '',
      nota: t ? `${miles(t.entregado)} unidades de medicamento` : '',
      icono: 'correcto',
    },
    {
      titulo: 'No se pudo entregar hoy',
      valor: t ? miles(t.noEntregado) : '·',
      unidad: t?.noEntregado ? 'unidades' : '',
      nota: t?.noEntregado ? `De ${noEntregadoHoy.value.length} medicamentos. Queda en el SIGSA 4 como no entregado.` : 'Todo lo recetado se entregó',
      icono: 'alerta',
      tono: t?.noEntregado ? 'atencion' : 'neutro',
    },
    {
      titulo: 'Estante por revisar',
      valor: estante.value ? vencidos.value.length + sinLote.value.length : '·',
      nota: estante.value ? `${vencidos.value.length} lotes vencidos para devolver · ${sinLote.value.length} sin lote que no se pueden entregar` : '',
      icono: 'vencimiento',
      tono: vencidos.value.length ? 'critico' : sinLote.value.length ? 'atencion' : 'neutro',
      a: '/dispensacion/control',
    },
  ];
});

let reloj = null;
onMounted(() => {
  cargar();
  // Los pacientes salen de consulta durante todo el día.
  reloj = setInterval(async () => {
    const p = await intentar(inventario.porAtender());
    if (p) porAtender.value = p.porAtender;
  }, 15000);
});
onBeforeUnmount(() => clearInterval(reloj));
</script>

<template>
  <section class="panel-far">
    <header class="b-cabecera">
      <div>
        <span class="b-antetitulo">Farmacia · post-consulta</span>
        <h1 class="b-titulo mt-1">{{ saludo }}{{ primerNombre ? `, ${primerNombre}` : '' }}</h1>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>

    <!-- Las tres tareas del día -->
    <div class="tareas">
      <RouterLink to="/dispensacion" class="tarea azul">
        <span class="ic"><Icono nombre="dispensacion" :tamano="46" /></span>
        <span class="txt"><b>Entregar recetas</b><small>Lo que recetó el médico, con el lote que vence primero</small></span>
        <span v-if="porAtender?.length" class="pend">{{ porAtender.length }} {{ porAtender.length === 1 ? 'espera' : 'esperan' }}</span>
      </RouterLink>
      <RouterLink to="/dispensacion/control?pestana=pedir" class="tarea verde">
        <span class="ic"><Icono nombre="trasladar" :tamano="46" /></span>
        <span class="txt"><b>Pedir a bodega</b><small>La requisición ya va llena; usted la revisa y la envía</small></span>
        <span v-if="pedirABodega.length" class="pend ambar">{{ pedirABodega.length }} por pedir</span>
      </RouterLink>
      <RouterLink to="/dispensacion/control?pestana=contar" class="tarea marino">
        <span class="ic"><Icono nombre="correcto" :tamano="46" /></span>
        <span class="txt"><b>Cerrar el día</b><small>Contar el estante y copiar el resumen al SIGSA</small></span>
      </RouterLink>
    </div>

    <!-- Documentos del mes de post-consulta -->
    <nav class="consultas" aria-label="Documentos del mes">
      <RouterLink :to="`/imprimir/kardex?ubicacion=farmacia&periodo=${mesActual}`" target="_blank" class="consulta"><Icono nombre="hojaCalculo" :tamano="22" /> Kardex de {{ nombreMes(mesActual) }}</RouterLink>
      <RouterLink :to="`/imprimir/bres/${mesAnterior}?ubicacion=farmacia`" target="_blank" class="consulta"><Icono nombre="imprimir" :tamano="22" /> BRES de {{ nombreMes(mesAnterior) }}</RouterLink>
      <RouterLink :to="`/imprimir/sigsa4/${mesActual}`" target="_blank" class="consulta"><Icono nombre="consolidado" :tamano="22" /> SIGSA-4</RouterLink>
      <RouterLink :to="`/imprimir/inventario-farmacia?fecha=${local.toISOString().slice(0, 10)}`" target="_blank" class="consulta"><Icono nombre="recibir" :tamano="22" /> Informe del día</RouterLink>
    </nav>

    <div class="cifras">
      <TarjetaCifra v-for="t in tarjetas" :key="t.titulo" v-bind="t" />
    </div>

    <div class="rejilla">
      <!-- Esperando su receta -->
      <section class="tarjeta ancha">
        <header class="cabeza">
          <div>
            <h2>Esperando su receta</h2>
            <p class="porque">Salieron de consulta con receta y todavía no pasan por la ventanilla. Primero el que llegó antes.</p>
          </div>
          <RouterLink to="/dispensacion" class="ver">Ir a entregar</RouterLink>
        </header>
        <ul v-if="porAtender?.length" class="espera">
          <li v-for="p in porAtender" :key="p.atencionId">
            <RouterLink to="/dispensacion" class="persona">
              <span class="hora"><b>{{ horaDe(p.registradaEn) }}</b><small>{{ textoEspera(minutosDesde(p.registradaEn)) }}</small></span>
              <span class="min-w-0 flex-1">
                <b class="nombre">{{ p.paciente.nombreCompleto }}</b>
                <span class="meds">
                  <span v-for="m in p.medicamentos" :key="m" class="med">{{ m }}</span>
                </span>
              </span>
              <span class="ficha">{{ p.paciente.expedientePapel || p.paciente.expediente }}</span>
            </RouterLink>
          </li>
        </ul>
        <p v-else-if="porAtender" class="b-vacio">Nadie esperando. Cuando el médico cierre una consulta con receta, el paciente aparece aquí.</p>
      </section>

      <!-- Estante -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>Lotes en el estante</h2>
            <p class="porque">Se entrega primero lo que vence primero; lo vencido regresa a bodega.</p>
          </div>
        </header>
        <Dona v-if="estante" :partes="partesEstante" :centro="lotesConFecha" bajo-centro="lotes" />
        <RouterLink v-if="sinLote.length" to="/dispensacion/control" class="aviso" :style="estiloTono('atencion')">
          <Icono nombre="alerta" :tamano="18" :grosor="2.2" />
          <span><b>{{ sinLote.length }} sin número de lote.</b> No se pueden entregar hasta ponérselo.</span>
        </RouterLink>
      </section>

      <!-- Pedir a bodega -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>Pedir a bodega</h2>
            <p class="porque">Se acabaron en el estante y bodega sí tiene. Primero lo que hoy no se pudo entregar.</p>
          </div>
        </header>
        <ul v-if="pedirABodega.length" class="lista">
          <li v-for="i in pedirABodega.slice(0, 8)" :key="i.insumoId">
            <span class="min-w-0 flex-1 nombre-completo">{{ i.nombre }}</span>
            <small>Bodega: <b>{{ miles(i.enBodega) }}</b></small>
          </li>
        </ul>
        <p v-else-if="estante" class="b-vacio">Nada que pedir: lo que bodega tiene también está en el estante.</p>
        <RouterLink v-if="pedirABodega.length" to="/dispensacion/control?pestana=pedir" class="b-btn primario w-full"><Icono nombre="trasladar" :tamano="20" /> Armar el pedido</RouterLink>
      </section>

      <!-- No se pudo entregar hoy -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>Lo que no se entregó hoy</h2>
            <p class="porque">Recetado y sin existencia en el estante. Es la demanda no atendida del SIGSA 4.</p>
          </div>
        </header>
        <ul v-if="noEntregadoHoy.length" class="lista">
          <li v-for="f in noEntregadoHoy" :key="f.insumoId">
            <span class="min-w-0 flex-1 nombre-completo">{{ f.nombre }}</span>
            <b class="rojo">{{ miles(f.noEntregado) }}</b>
          </li>
        </ul>
        <p v-else-if="dia" class="b-vacio">Hoy se entregó todo lo recetado.</p>
      </section>

      <!-- Sin existencia en el centro -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>No hay en todo el centro</h2>
            <p class="porque">Ni en el estante ni en bodega. Avisar al médico para que recete otra opción o dé receta externa.</p>
          </div>
          <span class="contador" :style="estiloTono(sinEnElCentro.length ? 'critico' : 'bien')">{{ sinEnElCentro.length }}</span>
        </header>
        <ul v-if="sinEnElCentro.length" class="lista corta">
          <li v-for="i in sinEnElCentro" :key="i.insumoId"><span class="min-w-0 flex-1 nombre-completo">{{ i.nombre }}</span></li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
/* Tareas grandes y documentos del mes, con el mismo diseño del inicio de la bodega. */
.tareas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1100px) { .tareas { grid-template-columns: 1fr; } }
.tarea { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; min-height: 210px; padding: 22px 24px; border: 2px solid #E2E8F0; border-bottom-width: 6px; border-radius: 24px; background: #fff; color: #14244A; transition: transform .08s, border-color .12s; }
.tarea:hover { border-color: var(--c); }
.tarea:active { transform: translateY(3px); border-bottom-width: 3px; }
.tarea .ic { display: grid; place-items: center; width: 80px; height: 80px; border-radius: 22px; background: var(--c); color: #fff; box-shadow: inset 0 -5px 0 rgba(0, 0, 0, .22); }
.tarea .txt { display: grid; gap: 4px; }
.tarea b { font-size: 27px; font-weight: 900; line-height: 1.1; }
.tarea small { font-size: 16px; font-weight: 700; color: #64748B; }
.tarea.azul { --c: #2F83C4; } .tarea.verde { --c: #1A8F57; } .tarea.marino { --c: #172A5A; }
.pend { position: absolute; top: 16px; right: 18px; padding: 4px 12px; border-radius: 10px; background: #2F83C4; color: #fff; font-size: 14px; font-weight: 900; }
.pend.ambar { background: #E8930C; }
.consultas { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 800px) { .consultas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.consulta { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 68px; padding: 8px 12px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 16px; background: #fff; font-size: 16px; font-weight: 800; color: #172A5A; text-align: center; }
.consulta:hover { border-color: #9FCDEC; background: #F7FBFE; }
.consulta svg { color: #2F83C4; flex-shrink: 0; }

.panel-far { display: grid; gap: 20px; }
.cifras { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1200px) { .cifras { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .cifras { grid-template-columns: 1fr; } }
.rejilla { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
.ancha { grid-column: span 2; }
@media (max-width: 1200px) { .rejilla { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .rejilla { grid-template-columns: 1fr; } .ancha { grid-column: auto; } }

.tarjeta { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; min-width: 0; padding: 18px 20px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.cabeza { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cabeza h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.porque { margin-top: 2px; font-size: 13px; font-weight: 600; color: #64748B; line-height: 1.35; }
.ver { flex-shrink: 0; font-size: 14px; font-weight: 800; color: #1F6AA5; }
.ver:hover { text-decoration: underline; }
.contador { flex-shrink: 0; min-width: 36px; padding: 4px 10px; border-radius: 12px; background: var(--t); color: #fff; font-size: 16px; font-weight: 900; text-align: center; box-shadow: inset 0 -3px 0 rgba(0, 0, 0, .18); }

.espera { display: grid; gap: 8px; max-height: 440px; overflow-y: auto; }
.persona { display: flex; align-items: center; gap: 14px; padding: 10px 14px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 16px; }
.persona:hover { border-color: #9FCDEC; background: #F7FBFE; }
.persona:active { transform: translateY(2px); border-bottom-width: 2px; }
.hora { display: grid; place-items: center; min-width: 76px; padding: 6px 8px; border-radius: 12px; background: #EAF3FB; color: #174E80; }
.hora b { font-size: 16px; font-weight: 900; }
.hora small { font-size: 12px; font-weight: 700; }
.nombre { display: block; font-size: 16px; font-weight: 900; color: #14244A; }
.meds { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; }
.med { padding: 2px 8px; border-radius: 8px; background: #F1F5F9; font-size: 12px; font-weight: 700; color: #334155; }
.ficha { flex-shrink: 0; padding: 4px 10px; border: 2px solid #14244A; border-radius: 10px; font-size: 14px; font-weight: 900; color: #14244A; }

.aviso { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 14px; background: var(--t-fondo); color: var(--t-tinta); font-size: 13px; font-weight: 600; }
.aviso svg { flex-shrink: 0; color: var(--t-hondo); margin-top: 1px; }
.aviso:hover { box-shadow: inset 0 0 0 2px var(--t-borde); }

.lista { display: grid; }
.lista li { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid #F1F5F9; font-size: 14px; font-weight: 700; color: #1E293B; }
.lista li:last-child { border-bottom: none; }
.lista small { flex-shrink: 0; font-size: 13px; font-weight: 600; color: #64748B; }
.lista small b { color: #14244A; font-weight: 900; }
.lista .rojo { color: #A83232; font-weight: 900; font-variant-numeric: tabular-nums; }
.corta { max-height: 260px; overflow-y: auto; }
</style>
