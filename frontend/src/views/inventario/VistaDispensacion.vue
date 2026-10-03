<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import FirmaEntrega from '../../components/farmacia/FirmaEntrega.vue';

/**
 * Post-consulta: farmacia entrega lo que recetó el médico y toma el "Recibí
 * conforme" de quien recibe. Con eso el SIGSA-4 del mes sale solo.
 *
 * Se propone el lote que vence primero; si se elige otro, se pide el motivo.
 */
const pendientes = ref([]);
const porFirmar = ref([]);
const error = ref('');
const aviso = ref('');
const detalles = ref(null);
const enviando = ref(null);
const cantidades = ref({});
const avanzado = ref(null);
const loteId = ref('');
const motivo = ref('');
const lotes = ref([]);
const firmando = ref(null);

const periodo = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 7);

async function cargar() {
  try {
    const [p, f] = await Promise.all([servicio.pendientes(), servicio.porFirmar()]);
    pendientes.value = p.pendientes;
    porFirmar.value = f.porFirmar;
    for (const x of p.pendientes) if (!(x.id in cantidades.value)) cantidades.value[x.id] = String(x.pendiente);
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

/** Las recetas agrupadas por paciente: se entrega a una persona a la vez. */
const porPaciente = computed(() => {
  const mapa = new Map();
  for (const p of pendientes.value) {
    if (!mapa.has(p.paciente.id)) mapa.set(p.paciente.id, { paciente: p.paciente, recetas: [] });
    mapa.get(p.paciente.id).recetas.push(p);
  }
  return [...mapa.values()];
});

async function elegirLote(p) {
  if (avanzado.value === p.id) {
    avanzado.value = null;
    return;
  }
  avanzado.value = p.id;
  loteId.value = '';
  motivo.value = '';
  try {
    const cobertura = await servicio.cobertura(p.insumo.id);
    lotes.value = cobertura.lotes.filter((l) => l.cantidadActual > 0 && l.diasParaVencer > 0);
  } catch {
    lotes.value = [];
  }
}

const entero = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0;

async function entregar(p) {
  error.value = '';
  aviso.value = '';
  detalles.value = null;
  enviando.value = p.id;
  try {
    const conLote = avanzado.value === p.id && loteId.value;
    const r = await servicio.dispensar({
      prescripcionId: p.id,
      cantidad: entero(cantidades.value[p.id]),
      ...(conLote ? { loteId: Number(loteId.value) } : {}),
      ...(conLote && motivo.value ? { motivo: motivo.value } : {}),
    });
    aviso.value = r.avisoFefo ? r.avisoFefo : `${p.insumo.nombreGenerico} entregado${r.pendiente ? `; quedan ${r.pendiente} pendientes` : ''}.`;
    avanzado.value = null;
    delete cantidades.value[p.id];
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
    detalles.value = fallo.detalles;
  } finally {
    enviando.value = null;
  }
}

async function constanciaGuardada() {
  const nombre = `${firmando.value.paciente.nombres} ${firmando.value.paciente.apellidos}`;
  firmando.value = null;
  aviso.value = `Constancia de ${nombre} guardada.`;
  await cargar();
}

function fecha(v) {
  return v ? new Date(v).toLocaleDateString('es-GT') : '';
}

onMounted(cargar);
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">Dispensación</h1>
        <span class="b-antetitulo">Post-consulta</span>
      </div>
      <RouterLink :to="`/imprimir/sigsa4/${periodo}`" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> SIGSA-4 del mes</RouterLink>
    </header>

    <p v-if="aviso" class="b-aviso ok mt-4" aria-live="polite">{{ aviso }}</p>
    <div v-if="error" role="alert" class="b-aviso error mt-4 flex-col">
      <span>{{ error }}</span>
      <span v-if="detalles?.loteSugerido" class="text-sm">Lote que vence primero: <b>{{ detalles.loteSugerido.numeroLote }}</b>, vence {{ fecha(detalles.loteSugerido.fechaVence) }}</span>
    </div>

    <div class="columnas mt-5">
      <!-- Por entregar -->
      <section class="min-w-0">
        <h2 class="grupo">Por entregar <span>{{ pendientes.length }}</span></h2>
        <div v-if="!porPaciente.length" class="b-panel b-vacio">Nada pendiente de entrega.</div>
        <article v-for="g in porPaciente" :key="g.paciente.id" class="b-panel paciente">
          <header class="b-panel-cabeza">
            <div class="min-w-0">
              <h3 class="truncate text-[16px] font-bold text-tinta">{{ g.paciente.nombreCompleto }}</h3>
              <p class="text-[13px] font-semibold text-apagado">Exp. {{ g.paciente.expediente }}</p>
            </div>
            <span class="b-contador gris">{{ g.recetas.length }} {{ g.recetas.length === 1 ? 'medicamento' : 'medicamentos' }}</span>
          </header>
          <ul>
            <li v-for="p in g.recetas" :key="p.id" class="receta">
              <div class="fila">
                <span class="min-w-0 flex-1">
                  <b class="block text-tinta">{{ p.insumo.nombreGenerico }}</b>
                  <small>{{ p.indicaciones || p.insumo.presentacion }}<template v-if="p.pendiente < p.cantidad"> · faltan {{ p.pendiente }} de {{ p.cantidad }}</template></small>
                </span>
                <input v-model="cantidades[p.id]" inputmode="numeric" :aria-label="`Cantidad de ${p.insumo.nombreGenerico}`" class="b-campo num cantidad" />
                <button type="button" class="b-btn secundario chico" :class="avanzado === p.id ? 'activo' : ''" @click="elegirLote(p)">Lote</button>
                <button type="button" class="b-btn primario chico" :disabled="enviando === p.id || !entero(cantidades[p.id])" @click="entregar(p)">
                  <Icono nombre="dispensacion" :tamano="16" /> {{ enviando === p.id ? 'Entregando…' : 'Entregar' }}
                </button>
              </div>
              <div v-if="avanzado === p.id" class="b-rejilla lote">
                <div class="c6">
                  <label :for="`lote-${p.id}`" class="b-etiqueta">Lote</label>
                  <select :id="`lote-${p.id}`" v-model="loteId" class="b-campo">
                    <option value="">El que vence primero</option>
                    <option v-for="l in lotes" :key="l.id" :value="l.id">{{ l.numeroLote }} · vence {{ fecha(l.fechaVence) }} · {{ l.cantidadActual }}</option>
                  </select>
                </div>
                <div v-if="loteId" class="c6">
                  <label :for="`motivo-${p.id}`" class="b-etiqueta">Motivo del cambio de lote</label>
                  <input :id="`motivo-${p.id}`" v-model="motivo" class="b-campo" />
                </div>
              </div>
            </li>
          </ul>
        </article>
      </section>

      <!-- Por firmar -->
      <aside class="min-w-0">
        <h2 class="grupo">Por firmar <span>{{ porFirmar.length }}</span></h2>
        <div v-if="!porFirmar.length" class="b-panel b-vacio">Todas las entregas tienen su constancia.</div>
        <ul v-else class="b-panel firmar">
          <li v-for="a in porFirmar" :key="a.atencionId">
            <span class="min-w-0 flex-1">
              <b class="block truncate text-tinta">{{ a.paciente.apellidos }}, {{ a.paciente.nombres }}</b>
              <small>{{ a.entregas.length }} {{ a.entregas.length === 1 ? 'entrega' : 'entregas' }} · {{ a.entregas.map((e) => e.insumo).join(', ') }}</small>
            </span>
            <button type="button" class="b-btn primario chico" @click="firmando = a"><Icono nombre="lapiz" :tamano="16" /> Recibí conforme</button>
          </li>
        </ul>
      </aside>
    </div>

    <FirmaEntrega v-if="firmando" :atencion="firmando" @cerrar="firmando = null" @guardada="constanciaGuardada" />
  </section>
</template>

<style scoped>
.columnas { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
@media (max-width: 1099px) { .columnas { grid-template-columns: 1fr; } }
.grupo { margin-bottom: 8px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #64748B; }
.grupo span { margin-left: 4px; color: #14244A; }
.paciente + .paciente { margin-top: 12px; }
.receta { padding: 10px 18px; border-top: 1px solid #EEF2F6; }
.receta:first-child { border-top: none; }
.fila { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.fila small { display: block; font-size: 13px; color: #64748B; }
.cantidad { width: 76px; height: 36px; }
.lote { margin-top: 10px; padding: 12px; border-radius: 10px; background: #F8FAFC; }
.b-btn.secundario.activo, .b-btn.secundario.activo:hover { background: #172A5A; color: #fff; }
.firmar li { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid #EEF2F6; }
.firmar li:first-child { border-top: none; }
.firmar small { display: block; font-size: 12px; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
