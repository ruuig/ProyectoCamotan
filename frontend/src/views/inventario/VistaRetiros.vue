<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import NavTramites from '../../components/bodega/NavTramites.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import { estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/**
 * Retiro sanitario.
 *
 * Cuando llega una alerta hay que sacar los lotes de circulación y encontrar
 * a quien ya los recibió. Lo primero lo hace el sistema al registrar el
 * retiro; lo segundo es la lista de personas, armada desde las entregas.
 */
const route = useRoute();
const router = useRouter();

const retiros = ref([]);
const retiro = ref(null);
const insumos = ref([]);
const error = ref('');
const aviso = ref('');
const cargando = ref(true);
const enviando = ref(false);
const registrando = ref(false);
const buscarLote = ref('');

const f = reactive({ referencia: '', motivo: '', emitidoEn: new Date().toISOString().slice(0, 10), loteIds: [] });
const detalle = computed(() => Boolean(route.params.id));

async function cargar() {
  cargando.value = true;
  try {
    if (detalle.value) retiro.value = (await servicio.retiro(route.params.id)).retiro;
    else retiros.value = (await servicio.retiros()).retiros;
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}
watch(() => route.params.id, cargar);

/** Todos los lotes con existencia, de una sola consulta. */
async function abrirRegistro() {
  registrando.value = true;
  try {
    insumos.value = (await bodega.semaforo({})).filas;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const sinTildes = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const insumosVisibles = computed(() => {
  const clave = sinTildes(buscarLote.value.trim());
  if (!clave) return insumos.value.filter((i) => i.lotes.some((l) => f.loteIds.includes(l.id)));
  return insumos.value.filter((i) => sinTildes(i.nombre).includes(clave) || i.lotes.some((l) => sinTildes(l.numeroLote).includes(clave))).slice(0, 20);
});

function alternarLote(id) {
  const i = f.loteIds.indexOf(id);
  if (i === -1) f.loteIds.push(id);
  else f.loteIds.splice(i, 1);
}

async function registrar() {
  enviando.value = true;
  error.value = '';
  try {
    const r = await servicio.registrarRetiro({ referencia: f.referencia.trim(), motivo: f.motivo.trim(), emitidoEn: f.emitidoEn, loteIds: f.loteIds });
    registrando.value = false;
    router.push(`/inventario/retiros/${r.retiro.id}`);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function marcar(fila, localizado) {
  enviando.value = true;
  try {
    await servicio.marcarLocalizacion(fila.id, { localizado, notas: fila.notas ?? null });
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

async function cerrar() {
  enviando.value = true;
  error.value = '';
  try {
    await servicio.cerrarRetiro(retiro.value.id);
    aviso.value = 'Retiro cerrado.';
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

onMounted(cargar);
</script>

<template>
  <!-- ===================== Detalle de un retiro ===================== -->
  <section v-if="detalle && retiro">
    <RouterLink to="/inventario/retiros" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Retiros sanitarios</RouterLink>
    <header class="b-cabecera">
      <div class="min-w-0">
        <h1 class="b-titulo">{{ retiro.referencia }}</h1>
        <p class="mt-1 text-sm font-semibold text-apagado">Emitido {{ fecha(retiro.emitidoEn) }} · {{ retiro.motivo }}</p>
      </div>
      <button v-if="!retiro.cerradoEn" type="button" class="b-btn exito" :disabled="enviando || !retiro.resumen.puedeCerrarse" @click="cerrar">
        <Icono nombre="bloqueo" :tamano="20" /> Cerrar retiro
      </button>
      <span v-else class="b-estado agotado">Cerrado {{ fecha(retiro.cerradoEn) }}</span>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4">{{ aviso }}</p>

    <div class="b-franja mt-5">
      <div class="b-cifra"><span class="n">{{ retiro.resumen.lotes }}</span><span class="e">Lotes</span></div>
      <div class="b-cifra"><span class="n">{{ retiro.resumen.servicios ?? 0 }}</span><span class="e">Servicios</span></div>
      <div class="b-cifra"><span class="n">{{ retiro.resumen.pacientes }}</span><span class="e">Pacientes</span></div>
      <div class="b-cifra"><span class="n text-[#1E8E5E]">{{ retiro.resumen.localizados }}</span><span class="e">Localizados</span></div>
      <div class="b-cifra"><span class="n" :class="retiro.resumen.pendientes ? 'text-[#C03535]' : ''">{{ retiro.resumen.pendientes }}</span><span class="e">Por localizar</span></div>
    </div>

    <div class="rejilla mt-4">
      <div class="space-y-4">
        <section class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Lotes retirados</h2></header>
          <ul class="space-y-2 p-3">
            <li v-for="rl in retiro.lotes" :key="rl.id">
              <RouterLink :to="`/inventario/lotes/${rl.lote.id}`" class="b-boleto">
                <span class="min-w-0">
                  <span class="block nombre-completo font-semibold text-tinta">{{ rl.lote.insumo.nombreGenerico }}</span>
                  <span class="codigo text-[13px]">{{ rl.lote.numeroLote }}</span>
                </span>
                <span class="cant">{{ miles(rl.lote.cantidadActual) }}</span>
                <SelloVence :fecha="rl.lote.fechaVence" semaforo="rojo" />
              </RouterLink>
            </li>
          </ul>
        </section>

        <section v-if="retiro.servicios?.length" class="b-panel">
          <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Servicios que lo recibieron</h2></header>
          <ul>
            <li v-for="(s, i) in retiro.servicios" :key="i" class="fila-simple">
              <span class="min-w-0 flex-1">
                <b class="block text-tinta">{{ s.ubicacion }}</b>
                <small>{{ s.insumo }} · <span class="font-mono">{{ s.numeroLote }}</span> · {{ s.numeroTraslado }}</small>
              </span>
              <span class="text-right"><b class="tabular-nums text-tinta">{{ miles(s.cantidad) }}</b><small class="block">{{ fecha(s.fecha) }}</small></span>
            </li>
          </ul>
        </section>
      </div>

      <section class="b-panel">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Personas que lo recibieron</h2><span class="b-contador gris">{{ retiro.pacientes.length }}</span></header>
        <p v-if="!retiro.pacientes.length" class="b-vacio">Ninguno de estos lotes se había entregado.</p>
        <ul v-else class="personas">
          <li v-for="p in retiro.pacientes" :key="p.id" class="fila-simple" :class="p.localizado ? 'localizado' : ''">
            <span class="min-w-0 flex-1">
              <RouterLink :to="`/pacientes/${p.paciente.id}`" class="block font-bold text-tinta hover:underline">{{ p.paciente.apellidos }}, {{ p.paciente.nombres }}</RouterLink>
              <small>Exp. {{ p.paciente.expediente }} · {{ p.paciente.comunidad }}<template v-if="p.paciente.telefono"> · {{ p.paciente.telefono }}</template></small>
              <small>{{ p.lote.insumo.nombreGenerico }} · {{ miles(p.cantidad) }} el {{ fecha(p.entregadoEn) }}</small>
            </span>
            <button v-if="!retiro.cerradoEn" type="button" class="b-btn chico" :class="p.localizado ? 'exito' : 'secundario'" :disabled="enviando" @click="marcar(p, !p.localizado)">
              <Icono v-if="p.localizado" nombre="correcto" :tamano="16" /> {{ p.localizado ? 'Localizado' : 'Marcar localizado' }}
            </button>
            <span v-else class="b-estado" :class="p.localizado ? 'disponible' : 'retirado'">{{ p.localizado ? 'Localizado' : 'No localizado' }}</span>
          </li>
        </ul>
      </section>
    </div>
  </section>

  <!-- ===================== Listado y registro ===================== -->
  <section v-else>
    <header class="b-cabecera">
      <h1 class="b-titulo">Bajas y retiros</h1>
      <div class="b-acciones">
        <NavTramites />
        <button v-if="!registrando" type="button" class="b-btn peligro" @click="abrirRegistro"><Icono nombre="alerta" :tamano="20" /> Registrar retiro</button>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <form v-if="registrando" class="b-panel formulario mt-5" @submit.prevent="registrar">
      <header class="b-panel-cabeza">
        <h2 class="b-panel-titulo">Nuevo retiro sanitario</h2>
        <button type="button" class="cerrar" aria-label="Cerrar" @click="registrando = false"><Icono nombre="cerrar" :tamano="20" :grosor="2.2" /></button>
      </header>
      <div class="b-panel-cuerpo grid gap-4 panel:grid-cols-[1fr_1.3fr]">
        <div class="space-y-4">
          <div>
            <label for="ref" class="b-etiqueta">Referencia de la alerta</label>
            <input id="ref" v-model="f.referencia" required minlength="2" maxlength="80" class="b-campo" />
          </div>
          <div>
            <label for="emitido" class="b-etiqueta">Fecha de emisión</label>
            <input id="emitido" v-model="f.emitidoEn" type="date" required class="b-campo" />
          </div>
          <div>
            <label for="mot" class="b-etiqueta">Motivo</label>
            <textarea id="mot" v-model="f.motivo" rows="3" required minlength="5" maxlength="500" class="b-campo" />
          </div>
        </div>
        <div>
          <span class="b-etiqueta">Lotes afectados · {{ f.loteIds.length }} elegidos</span>
          <label class="b-buscar block">
            <Icono nombre="buscar" :tamano="20" />
            <input v-model="buscarLote" type="search" class="b-campo" placeholder="Insumo o número de lote" aria-label="Buscar insumo o lote" />
          </label>
          <div class="selector-lotes">
            <div v-for="i in insumosVisibles" :key="i.insumoId" class="mb-3">
              <p class="mb-1.5 flex items-center gap-2 text-sm font-bold text-tinta" :style="estiloCategoria(i.categoria)">
                <span class="cat-mini"><Pictograma :categoria="i.categoria" :grosor="2" /></span>{{ i.nombre }}
              </p>
              <div class="flex flex-wrap gap-2">
                <button v-for="l in i.lotes" :key="l.id" type="button" class="ficha-lote" :class="f.loteIds.includes(l.id) ? 'on' : ''" :aria-pressed="f.loteIds.includes(l.id)" @click="alternarLote(l.id)">
                  <span class="font-mono">{{ l.numeroLote === 'SIN-LOTE' ? 'Sin lote' : l.numeroLote }}</span>
                  <span class="tabular-nums text-apagado">{{ miles(l.cantidad) }}</span>
                </button>
              </div>
            </div>
            <p v-if="!insumosVisibles.length" class="b-vacio">Sin resultados.</p>
          </div>
        </div>
      </div>
      <footer class="flex justify-end px-[18px] pb-4">
        <button type="submit" class="b-btn peligro" :disabled="enviando || !f.loteIds.length">Registrar y retirar {{ f.loteIds.length ? `${f.loteIds.length} lote(s)` : '' }}</button>
      </footer>
    </form>

    <p v-if="cargando" class="b-vacio">Cargando retiros…</p>
    <div v-else-if="!registrando" class="b-tabla-marco mt-5">
      <table class="b-tabla">
        <thead><tr><th>Referencia</th><th>Emitido</th><th>Motivo</th><th class="n">Lotes</th><th class="n">Pacientes</th><th>Estado</th></tr></thead>
        <tbody>
          <tr v-for="r in retiros" :key="r.id" class="cursor-pointer" @click="router.push(`/inventario/retiros/${r.id}`)">
            <td class="font-semibold text-tinta">{{ r.referencia }}</td>
            <td class="whitespace-nowrap">{{ fecha(r.emitidoEn) }}</td>
            <td class="max-w-[320px] truncate">{{ r.motivo }}</td>
            <td class="n">{{ r.lotes }}</td>
            <td class="n">{{ r.pacientes }}</td>
            <td><span class="b-estado" :class="r.cerradoEn ? 'agotado' : r.pendientes ? 'retirado' : 'disponible'">{{ r.cerradoEn ? 'Cerrado' : r.pendientes ? `${r.pendientes} por localizar` : 'Listo para cerrar' }}</span></td>
          </tr>
          <tr v-if="!retiros.length"><td colspan="6" class="b-vacio">Sin retiros sanitarios.</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.fila-simple { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-top: 1px solid #EEF2F6; }
.fila-simple:first-child { border-top: none; }
.fila-simple small { display: block; font-size: 12px; font-weight: 600; color: #64748B; }
.fila-simple.localizado { background: #F4FBF7; }
.personas { max-height: max(360px, calc(100vh - 420px)); overflow-y: auto; }
.formulario { border-color: #172A5A; }
.cerrar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; color: #475569; }
.cerrar:hover { background: #F1F5F9; }
.selector-lotes { margin-top: 10px; max-height: 300px; overflow-y: auto; padding: 12px; border: 2px solid #E2E8F0; border-radius: 12px; }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 14px; height: 14px; }
.ficha-lote { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 2px solid #CBD5E1; border-radius: 9px; font-size: 13px; font-weight: 600; color: #14244A; background: #fff; }
.ficha-lote:hover { border-color: #64748B; }
.ficha-lote.on { border-color: #C03535; background: #FDECEC; color: #8C1D1D; }
/* --- Relieve (estilo duo) --- */
.selector-lotes { border-bottom-width: 4px; border-radius: 16px; }
.ficha-lote { border-bottom-width: 3px; border-radius: 11px; }
</style>
