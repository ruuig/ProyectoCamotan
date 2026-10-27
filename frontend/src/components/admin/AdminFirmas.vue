<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import http from '../../services/http';
import inventario from '../../services/inventario';
import Icono from '../comunes/Icono.vue';
import { CARGOS_SIGSA, codigoSigsa } from '../../dominio/cargos';

/**
 * Quién firma cada documento impreso. Los formatos de bodega llevan al
 * encargado y el visto bueno; los formularios SIGSA, a quien los genera, con
 * el cargo que tiene en Personal.
 */
const config = ref(null);
const firmas = reactive({ encargadoBodega: '', cargoEncargadoBodega: '', coordinadorMunicipal: '', cargoCoordinador: '' });
const personal = ref([]);
const cargos = reactive({});
const error = ref('');
const aviso = ref('');
const guardando = ref('');

const DOCS_BODEGA = ['BRES', 'Inventario de cierre', 'Balance por servicio', 'Semáforo'];
const SIGSA_DE = { medico: ['SIGSA-3CS'], farmacia: ['SIGSA-4'], admin: ['SIGSA-3CS', 'SIGSA-4'] };

const firmantesSigsa = computed(() => personal.value.filter((u) => u.activo && SIGSA_DE[u.rol]));
const bodegaCambiada = computed(() => config.value && Object.keys(firmas).some((k) => (firmas[k] ?? '') !== (config.value[k] ?? '')));

async function cargar() {
  try {
    const [c, u] = await Promise.all([inventario.configuracion(), http.get('/admin/usuarios')]);
    config.value = c.configuracion;
    for (const k of Object.keys(firmas)) firmas[k] = c.configuracion[k] ?? '';
    personal.value = u.usuarios;
    for (const p of u.usuarios) cargos[p.id] = p.cargo ?? '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function guardarBodega() {
  guardando.value = 'bodega';
  error.value = '';
  aviso.value = '';
  try {
    const c = config.value;
    // La configuración se guarda completa: se reenvían los parámetros tal cual.
    const { configuracion } = await inventario.guardarConfiguracion({
      mesesSolicitudRecepcion: Number(c.mesesSolicitudRecepcion),
      mesesFrecuenciaPedido: Number(c.mesesFrecuenciaPedido),
      diaCorteBres: c.diaCorteBres,
      diaInventarioFisico: c.diaInventarioFisico,
      diasMaximoCuarentena: c.diasMaximoCuarentena,
      provisional: c.provisional,
      encargadoBodega: firmas.encargadoBodega.trim() || null,
      coordinadorMunicipal: firmas.coordinadorMunicipal.trim() || null,
      cargoEncargadoBodega: firmas.cargoEncargadoBodega.trim() || 'Encargado de Bodega',
      cargoCoordinador: firmas.cargoCoordinador.trim() || 'Coordinador Municipal de Salud',
    });
    config.value = configuracion;
    aviso.value = 'Firmas de bodega guardadas. Salen así en las próximas impresiones.';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = '';
  }
}

async function guardarCargo(u) {
  guardando.value = `u${u.id}`;
  error.value = '';
  aviso.value = '';
  try {
    const { usuario } = await http.patch(`/admin/usuarios/${u.id}`, { cargo: cargos[u.id].trim() || null });
    u.cargo = usuario.cargo;
    aviso.value = `Cargo de ${u.nombre} guardado.`;
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = '';
  }
}

onMounted(cargar);
</script>

<template>
  <div class="space-y-5">
    <p v-if="aviso" class="b-aviso ok">{{ aviso }}</p>
    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>

    <!-- Bodega -->
    <form v-if="config" class="b-panel" @submit.prevent="guardarBodega">
      <header class="b-panel-cabeza">
        <div>
          <h2 class="b-panel-titulo">Formatos de bodega</h2>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <span v-for="d in DOCS_BODEGA" :key="d" class="doc">{{ d }}</span>
          </div>
        </div>
        <button type="submit" class="b-btn primario" :disabled="!bodegaCambiada || guardando === 'bodega'">
          <Icono nombre="guardar" :tamano="20" /> Guardar firmas
        </button>
      </header>

      <div class="bodega">
        <div class="b-rejilla content-start">
          <h3 class="c12 b-subtitulo">Firma</h3>
          <div class="c7">
            <label for="f-enc" class="b-etiqueta">Encargado de bodega</label>
            <input id="f-enc" v-model="firmas.encargadoBodega" maxlength="160" placeholder="P.C. Nombre Apellido" class="b-campo" />
          </div>
          <div class="c5">
            <label for="f-enc-cargo" class="b-etiqueta">Cargo</label>
            <input id="f-enc-cargo" v-model="firmas.cargoEncargadoBodega" maxlength="160" class="b-campo" />
          </div>
          <h3 class="c12 b-subtitulo mt-2">Visto bueno</h3>
          <div class="c7">
            <label for="f-vobo" class="b-etiqueta">Nombre</label>
            <input id="f-vobo" v-model="firmas.coordinadorMunicipal" maxlength="160" placeholder="Dr. Nombre Apellido" class="b-campo" />
          </div>
          <div class="c5">
            <label for="f-vobo-cargo" class="b-etiqueta">Cargo</label>
            <input id="f-vobo-cargo" v-model="firmas.cargoCoordinador" maxlength="160" class="b-campo" />
          </div>
        </div>

        <!-- Así sale al pie de la hoja -->
        <figure class="papel" aria-label="Vista del pie de la hoja">
          <div class="renglones" aria-hidden="true"><span /><span /><span /></div>
          <div class="firmas">
            <div class="firma">
              <span class="linea" />
              <b>{{ firmas.encargadoBodega || 'Sin nombre' }}</b>
              <small>{{ firmas.cargoEncargadoBodega }}</small>
            </div>
            <div class="firma">
              <span class="linea" />
              <b>Vo. Bo. {{ firmas.coordinadorMunicipal || 'Sin nombre' }}</b>
              <small>{{ firmas.cargoCoordinador }}</small>
            </div>
          </div>
          <figcaption>Pie de la hoja impresa</figcaption>
        </figure>
      </div>
    </form>

    <!-- SIGSA -->
    <section class="b-panel">
      <header class="b-panel-cabeza">
        <div>
          <h2 class="b-panel-titulo">Formularios SIGSA</h2>
          <p class="mt-1 text-sm text-apagado">Responsable de la información: quien genera la hoja.</p>
        </div>
      </header>
      <div class="b-tabla-marco !rounded-none !border-0">
        <table class="b-tabla">
          <thead>
            <tr><th>Nombre</th><th>Firma en</th><th class="w-[40%]">Cargo bajo su nombre</th><th>Código SIGSA</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="u in firmantesSigsa" :key="u.id">
              <td class="fuerte">{{ u.nombre }}</td>
              <td><span v-for="d in SIGSA_DE[u.rol]" :key="d" class="doc mr-1">{{ d }}</span></td>
              <td>
                <input v-model="cargos[u.id]" list="cargos-firmas" maxlength="120" :aria-label="`Cargo de ${u.nombre}`" class="b-campo !h-[38px]" :class="!cargos[u.id] ? 'falta' : ''" placeholder="Sin cargo" @keydown.enter.prevent="guardarCargo(u)" />
              </td>
              <td>
                <span v-if="codigoSigsa(cargos[u.id])" class="doc">{{ codigoSigsa(cargos[u.id]) }}</span>
                <span v-else-if="cargos[u.id]" class="fuera">No es del catálogo</span>
              </td>
              <td class="n">
                <button type="button" class="b-btn secundario chico" :disabled="(cargos[u.id] ?? '') === (u.cargo ?? '') || guardando === `u${u.id}`" @click="guardarCargo(u)">Guardar</button>
              </td>
            </tr>
            <tr v-if="!firmantesSigsa.length"><td colspan="5" class="b-vacio">Sin médicos ni personal de farmacia activos.</td></tr>
          </tbody>
        </table>
      </div>
      <datalist id="cargos-firmas">
        <option v-for="c in CARGOS_SIGSA" :key="c.codigo" :value="c.nombre">Código {{ c.codigo }}</option>
      </datalist>
    </section>
  </div>
</template>

<style scoped>
.doc { display: inline-block; padding: 2px 8px; border-radius: 6px; background: #EEF2F6; color: #475569; font-size: 12px; font-weight: 700; }
.bodega { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 24px; padding: 18px; }
@media (max-width: 1100px) { .bodega { grid-template-columns: 1fr; } }

.papel { display: flex; flex-direction: column; justify-content: space-between; gap: 18px; padding: 20px 22px 12px; border: 1px solid #DDE3EC; border-radius: 6px; background: #fff; box-shadow: 0 1px 0 #E2E8F0, 0 10px 24px -18px rgba(15, 23, 42, .45); }
.renglones { display: flex; flex-direction: column; gap: 9px; }
.renglones span { height: 7px; border-radius: 3px; background: #EEF2F6; }
.renglones span:nth-child(2) { width: 85%; }
.renglones span:nth-child(3) { width: 60%; }
.firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 26px; }
.firma { display: flex; flex-direction: column; align-items: center; text-align: center; font-family: Arial, Helvetica, sans-serif; color: #111827; }
.firma .linea { width: 100%; border-top: 1px solid #111827; margin-bottom: 4px; }
.firma b { font-size: 12px; }
.firma small { font-size: 11px; color: #374151; }
figcaption { font-size: 12px; font-weight: 600; color: #94A3B8; text-align: right; }
.fuera { font-size: 12px; font-weight: 700; color: #8A4B00; }
.falta { border-color: #F5C77E; background: #FFFBF2; }
</style>
