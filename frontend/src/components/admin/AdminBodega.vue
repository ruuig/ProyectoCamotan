<script setup>
import { ref, reactive, onMounted } from 'vue';
import inventario from '../../services/inventario';
import Icono from '../comunes/Icono.vue';
import Ubicaciones from './Ubicaciones.vue';

/**
 * Parámetros con que la bodega calcula el pedido, el semáforo y los cortes
 * del mes. Mandan en todo el sistema: inventario, alertas y BRES.
 */
const p = reactive({
  nivelMinimoMeses: 2,
  nivelMaximoMeses: 4,
  mesesPromedio: 6,
  formulaPedido: 'centro',
  semaforoRojoMeses: 12,
  semaforoAmarilloMeses: 18,
  diaCorteBres: 25,
  diaCorteReportes: 25,
  lugaresReparto: 32,
  diasMaximoCuarentena: 7,
  provisional: true,
});
const config = ref(null);
const error = ref('');
const aviso = ref('');
const guardando = ref(false);
const vista = ref('parametros');

async function cargar() {
  try {
    const { configuracion: c } = await inventario.configuracion();
    config.value = c;
    for (const k of Object.keys(p)) p[k] = typeof p[k] === 'number' ? Number(c[k]) : c[k];
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function guardar() {
  guardando.value = true;
  error.value = '';
  aviso.value = '';
  try {
    const c = config.value;
    // Los tiempos del MSPAS se derivan de los niveles del centro, para que el
    // cálculo de abastecimiento y el BRES digan lo mismo.
    const { configuracion } = await inventario.guardarConfiguracion({
      ...p,
      mesesSolicitudRecepcion: p.nivelMinimoMeses / 2,
      mesesFrecuenciaPedido: Math.max(0.5, p.nivelMaximoMeses - p.nivelMinimoMeses),
      diaInventarioFisico: c.diaInventarioFisico,
      encargadoBodega: c.encargadoBodega,
      coordinadorMunicipal: c.coordinadorMunicipal,
      cargoEncargadoBodega: c.cargoEncargadoBodega,
      cargoCoordinador: c.cargoCoordinador,
    });
    config.value = configuracion;
    aviso.value = 'Parámetros guardados.';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

onMounted(cargar);
</script>

<template>
  <div>
    <div class="b-segmentado" role="tablist" aria-label="Bodega">
      <button type="button" role="tab" :aria-selected="vista === 'parametros'" :class="vista === 'parametros' ? 'on' : ''" @click="vista = 'parametros'">Parámetros</button>
      <button type="button" role="tab" :aria-selected="vista === 'servicios'" :class="vista === 'servicios' ? 'on' : ''" @click="vista = 'servicios'">Servicios que abastece</button>
    </div>

    <Ubicaciones v-if="vista === 'servicios'" class="mt-5" />

    <form v-else class="mt-5" @submit.prevent="guardar">
      <p v-if="aviso" class="b-aviso ok mb-4">{{ aviso }}</p>
      <p v-if="error" role="alert" class="b-aviso error mb-4">{{ error }}</p>

      <section class="b-form-seccion">
        <header>
          <h2>Pedido del BRES</h2>
          <p>Cuánto se pide de cada insumo.</p>
        </header>
        <div class="b-rejilla">
          <div class="c4">
            <label for="nmin" class="b-etiqueta">Nivel mínimo</label>
            <div class="unidad"><input id="nmin" v-model.number="p.nivelMinimoMeses" type="number" step="0.5" min="0.5" max="24" required class="b-campo num" /><span>meses</span></div>
          </div>
          <div class="c4">
            <label for="nmax" class="b-etiqueta">Nivel máximo</label>
            <div class="unidad"><input id="nmax" v-model.number="p.nivelMaximoMeses" type="number" step="0.5" :min="p.nivelMinimoMeses" max="24" required class="b-campo num" /><span>meses</span></div>
          </div>
          <div class="c4">
            <label for="mprom" class="b-etiqueta">Promedio de</label>
            <div class="unidad"><input id="mprom" v-model.number="p.mesesPromedio" type="number" min="1" max="24" required class="b-campo num" /><span>meses</span></div>
          </div>
          <div class="c12">
            <span class="b-etiqueta">Cantidad a pedir</span>
            <div class="opciones">
              <label class="opcion" :class="p.formulaPedido === 'centro' ? 'on' : ''">
                <input v-model="p.formulaPedido" type="radio" value="centro" />
                <span><b>Fórmula del centro</b><small>Máximo − existencia en bodega</small></span>
              </label>
              <label class="opcion" :class="p.formulaPedido === 'mspas' ? 'on' : ''">
                <input v-model="p.formulaPedido" type="radio" value="mspas" />
                <span><b>Fórmula del MSPAS</b><small>Máximo − saldo total del municipio</small></span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section class="b-form-seccion">
        <header>
          <h2>Semáforo de vencimientos</h2>
          <p>Meses que faltan para que venza un lote.</p>
        </header>
        <div class="b-rejilla">
          <div class="c4">
            <label for="srojo" class="b-etiqueta"><i class="punto rojo" /> Rojo a menos de</label>
            <div class="unidad"><input id="srojo" v-model.number="p.semaforoRojoMeses" type="number" min="1" max="60" required class="b-campo num" /><span>meses</span></div>
          </div>
          <div class="c4">
            <label for="samar" class="b-etiqueta"><i class="punto amarillo" /> Amarillo hasta</label>
            <div class="unidad"><input id="samar" v-model.number="p.semaforoAmarilloMeses" type="number" :min="p.semaforoRojoMeses + 1" max="72" required class="b-campo num" /><span>meses</span></div>
          </div>
          <div class="c4 self-end">
            <div class="regla" aria-hidden="true">
              <span class="rojo" :style="{ flex: p.semaforoRojoMeses }" />
              <span class="amarillo" :style="{ flex: Math.max(1, p.semaforoAmarilloMeses - p.semaforoRojoMeses) }" />
              <span class="verde" :style="{ flex: 12 }" />
            </div>
          </div>
        </div>
      </section>

      <section class="b-form-seccion">
        <header>
          <h2>Fechas del mes</h2>
          <p>Cortes del cierre mensual.</p>
        </header>
        <div class="b-rejilla">
          <div class="c4">
            <label for="corte" class="b-etiqueta">Corte del BRES</label>
            <div class="unidad"><span class="antes">día</span><input id="corte" v-model.number="p.diaCorteBres" type="number" min="1" max="28" required class="b-campo num" /></div>
          </div>
          <div class="c4">
            <label for="dcrep" class="b-etiqueta">Corte de reportes</label>
            <div class="unidad"><span class="antes">día</span><input id="dcrep" v-model.number="p.diaCorteReportes" type="number" min="1" max="28" required class="b-campo num" /></div>
          </div>
          <div class="c4">
            <label for="dcua" class="b-etiqueta">Cuarentena máxima</label>
            <div class="unidad"><input id="dcua" v-model.number="p.diasMaximoCuarentena" type="number" min="1" max="90" required class="b-campo num" /><span>días</span></div>
          </div>
        </div>
      </section>

      <section class="b-form-seccion">
        <header>
          <h2>Reparto</h2>
          <p>Entre cuántos lugares se divide la existencia para saber cuánto le toca a cada uno.</p>
        </header>
        <div class="b-rejilla">
          <div class="c4">
            <label for="lugares" class="b-etiqueta">Lugares</label>
            <div class="unidad"><input id="lugares" v-model.number="p.lugaresReparto" type="number" min="1" max="200" required class="b-campo num" /><span>lugares</span></div>
          </div>
          <p class="c8 self-end text-sm text-apagado">
            Saldo actual ÷ {{ p.lugaresReparto }}, como en el inventario de cierre. Lo de los lugares que no son servicios se queda en bodega.
          </p>
        </div>
      </section>

      <section class="b-form-seccion">
        <header>
          <h2>Estado</h2>
        </header>
        <label class="opcion ancha" :class="p.provisional ? 'aviso' : ''">
          <input v-model="p.provisional" type="checkbox" />
          <span>
            <b>Valores provisionales</b>
            <small>Las cifras que salen de ellos se marcan como pendientes hasta que el Área de Salud los confirme.</small>
          </span>
        </label>
      </section>

      <div class="flex justify-end border-t-2 border-slate-100 pt-4">
        <button type="submit" class="b-btn primario" :disabled="guardando"><Icono nombre="guardar" :tamano="20" /> {{ guardando ? 'Guardando…' : 'Guardar parámetros' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.unidad { display: flex; align-items: center; border: 2px solid #CBD5E1; border-radius: 12px; background: #fff; overflow: hidden; }
.unidad:focus-within { border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.unidad .b-campo { border: none; box-shadow: none; border-radius: 0; flex: 1; min-width: 0; }
.unidad span { padding: 0 14px; font-size: 14px; font-weight: 600; color: #64748B; white-space: nowrap; }
.unidad .antes { padding-right: 0; }

.opciones { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.opcion { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border: 2px solid #E2E8F0; border-radius: 12px; cursor: pointer; }
.opcion:hover { border-color: #CBD5E1; }
.opcion.on { border-color: #172A5A; background: #F6F8FC; }
.opcion.ancha.aviso { border-color: #F5D58A; background: #FFFBF0; }
.opcion input { margin-top: 3px; width: 18px; height: 18px; accent-color: #172A5A; flex-shrink: 0; }
.opcion b { display: block; font-size: 15px; color: #14244A; }
.opcion small { display: block; font-size: 13px; color: #64748B; }

.punto { display: inline-block; width: 10px; height: 10px; margin-right: 4px; border-radius: 3px; vertical-align: 0; }
.punto.rojo, .regla .rojo { background: #E06363; }
.punto.amarillo, .regla .amarillo { background: #E9B949; }
.regla .verde { background: #5BB98A; }
.regla { display: flex; height: 14px; margin-bottom: 16px; border-radius: 7px; overflow: hidden; gap: 2px; }
@media (max-width: 640px) { .opciones { grid-template-columns: 1fr; } }
/* --- Relieve (estilo duo) --- */
.unidad { border-bottom-width: 4px; border-radius: 14px; }
.opcion { border-bottom-width: 4px; border-radius: 14px; }
</style>
