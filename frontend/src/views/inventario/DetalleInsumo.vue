<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import servicio from '../../services/inventario';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import AliasInsumo from '../../components/bodega/AliasInsumo.vue';
import EstanteCategoria from '../../components/bodega/diseno/EstanteCategoria.vue';
import ReglaCobertura from '../../components/bodega/diseno/ReglaCobertura.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import GraficaDemanda from '../../components/bodega/diseno/GraficaDemanda.vue';
import { estiloCategoria, situacion, miles, decimal, general } from '../../components/bodega/diseno/PiezasBodega';
import { fecha } from '../../dominio/bodega';

/** Ficha de un insumo: cifras del balance, demanda mes a mes y sus lotes. */
const route = useRoute();
const id = computed(() => Number(route.params.id));

const datos = ref(null);
const catalogos = ref(null);
const error = ref('');
const aviso = ref('');
const verAgotados = ref(false);

const abierto = ref(null); // 'uso' | 'reajuste' | 'estado'
const enviando = ref(false);
const reajuste = reactive({ loteId: '', cantidad: '', causa: '', motivo: '' });
const uso = reactive({ cantidad: '', motivo: '', servicio: '', loteId: '' });
const cambioEstado = reactive({ loteId: '', estado: 'cuarentena', motivo: '' });

async function cargar() {
  try {
    datos.value = await bodega.ficha(id.value);
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function abrir(cual, loteId = '') {
  abierto.value = abierto.value === cual && !loteId ? null : cual;
  aviso.value = '';
  if (cual === 'reajuste') Object.assign(reajuste, { loteId, cantidad: '', causa: '', motivo: '' });
  if (cual === 'uso') Object.assign(uso, { cantidad: '', motivo: '', servicio: '', loteId: '' });
  if (cual === 'estado') Object.assign(cambioEstado, { loteId, estado: 'cuarentena', motivo: '' });
}

async function ejecutar(accion) {
  enviando.value = true;
  error.value = '';
  try {
    const r = await accion();
    aviso.value = r?.mensaje ?? 'Registrado';
    abierto.value = null;
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    enviando.value = false;
  }
}

const entero = (v) => Number(String(v).replace(/[^\d-]/g, ''));

const enviarReajuste = () => ejecutar(() => servicio.reajustar({
  loteId: Number(reajuste.loteId),
  cantidad: entero(reajuste.cantidad),
  causa: reajuste.causa,
  ...(reajuste.motivo ? { motivo: reajuste.motivo } : {}),
}));

const enviarUso = () => ejecutar(() => servicio.usoInterno({
  insumoId: id.value,
  cantidad: entero(uso.cantidad),
  motivo: uso.motivo,
  ...(uso.servicio ? { servicio: uso.servicio } : {}),
  ...(uso.loteId ? { loteId: Number(uso.loteId) } : {}),
}));

// Lo que se usa en el servicio (guantes, reactivos) no aparece en la receta del médico.
const guardandoReceta = ref(false);
async function cambiarPrescribible(valor) {
  guardandoReceta.value = true;
  error.value = '';
  try {
    await bodega.cambiarPrescribible(id.value, valor);
    datos.value.insumo.prescribible = valor;
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardandoReceta.value = false;
  }
}

const enviarEstado = () => ejecutar(async () => {
  await servicio.cambiarEstadoLote(Number(cambioEstado.loteId), { estado: cambioEstado.estado, motivo: cambioEstado.motivo });
  return { mensaje: 'Estado del lote actualizado' };
});

const fila = computed(() => datos.value?.fila);
const bres = computed(() => fila.value?.bres);
const tono = computed(() => (bres.value ? situacion(bres.value) : 'bien'));
const config = computed(() => datos.value?.configuracion ?? { nivelMinimoMeses: 2, nivelMaximoMeses: 4, mesesPromedio: 4 });

const conExistencia = computed(() => datos.value?.lotes.filter((l) => l.cantidadActual > 0) ?? []);
const sinExistencia = computed(() => datos.value?.lotes.filter((l) => l.cantidadActual === 0) ?? []);
const lotesVisibles = computed(() => (verAgotados.value ? [...conExistencia.value, ...sinExistencia.value] : conExistencia.value));
const lotesMovibles = computed(() => conExistencia.value.filter((l) => l.estado !== 'dado_de_baja'));
const lotesDisponibles = computed(() => conExistencia.value.filter((l) => l.estado === 'disponible'));
const enCuarentena = computed(() => conExistencia.value.filter((l) => l.estado === 'cuarentena').reduce((s, l) => s + l.cantidadActual, 0));

const ESTADO = { disponible: 'Disponible', cuarentena: 'Cuarentena', retirado: 'Retirado', vencido: 'Vencido', agotado: 'Agotado', dado_de_baja: 'De baja' };
const PIE = { bajo: 'bajo el mínimo', agotado: 'agotado', sin_consumo: 'sin consumo', bien: 'de cobertura' };

onMounted(async () => {
  cargar();
  try {
    catalogos.value = await servicio.catalogos();
  } catch {
    // Sin catálogos solo el reajuste queda sin causas.
  }
});
</script>

<template>
  <section v-if="datos && fila" :style="estiloCategoria(datos.insumo.categoria)">
    <RouterLink to="/inventario" class="b-volver"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Existencias</RouterLink>

    <header class="b-cabecera items-start">
      <div class="min-w-0">
        <EstanteCategoria :categoria="datos.insumo.categoria" />
        <h1 class="b-titulo mt-3">{{ datos.insumo.nombreGenerico }}</h1>
        <p class="mt-1 text-sm text-apagado">
          <span class="font-mono">{{ datos.insumo.codigoInterno }}</span>
          <span v-if="datos.insumo.presentacion && datos.insumo.presentacion !== 'unidad'"> · {{ datos.insumo.presentacion }}</span>
          <span v-if="datos.insumo.cadenaFrio" class="b-estado cuarentena ml-2">Cadena de frío</span>
        </p>
      </div>
      <div class="b-acciones">
        <RouterLink :to="`/imprimir/tarjeta-control/${id}`" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> Tarjeta de control</RouterLink>
        <RouterLink :to="`/inventario/${id}/recibir`" class="b-btn primario"><Icono nombre="recibir" :tamano="20" :grosor="2" /> Recibir lote</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>
    <p v-if="aviso" class="b-aviso ok mt-4">{{ aviso }}</p>

    <div class="rejilla mt-5">
      <!-- Columna del cálculo -->
      <div class="space-y-4">
        <div class="b-panel p-4">
          <div class="flex items-end justify-between gap-3">
            <div>
              <p class="b-subtitulo">En bodega</p>
              <p class="mt-1 text-[34px] font-bold leading-none tabular-nums text-tinta">{{ miles(bres.I) }}</p>
            </div>
            <div class="text-right" :class="`cob-${tono}`">
              <p class="text-[26px] font-bold leading-none tabular-nums">{{ bres.K === null ? '—' : decimal(bres.K) }}</p>
              <p class="mt-1 text-[11px] font-bold uppercase tracking-wider">{{ bres.K === null ? PIE.sin_consumo : `meses ${PIE[tono] === 'de cobertura' ? '' : '· ' + PIE[tono]}` }}</p>
            </div>
          </div>
          <ReglaCobertura class="mt-3 w-full" :ancho="300" :meses="bres.K" :minimo="config.nivelMinimoMeses" :maximo="config.nivelMaximoMeses" :tono="tono" />
        </div>

        <dl class="b-recibo">
          <div><dt>Saldo del mes anterior</dt><dd>{{ miles(bres.B) }}</dd></div>
          <div><dt>Entradas del mes</dt><dd>{{ miles(bres.C) }}</dd></div>
          <div><dt>Entregado del mes</dt><dd>{{ miles(bres.D) }}</dd></div>
          <div><dt>Saldo del municipio</dt><dd>{{ miles(bres.H) }}</dd></div>
          <div v-if="enCuarentena"><dt>En cuarentena</dt><dd>{{ miles(enCuarentena) }}</dd></div>
          <div><dt>Consumo mensual</dt><dd>{{ miles(bres.J) }}</dd></div>
          <div><dt>Mínimo ({{ config.nivelMinimoMeses }} meses)</dt><dd>{{ miles(bres.minimo) }}</dd></div>
          <div><dt>Máximo ({{ config.nivelMaximoMeses }} meses)</dt><dd>{{ general(bres.L) }}</dd></div>
          <div class="total"><dt>Pedir</dt><dd>{{ bres.M > 0 ? miles(bres.M) : '—' }}</dd></div>
        </dl>

        <div class="grid gap-2">
          <button type="button" class="b-btn secundario" :class="abierto === 'uso' ? 'activo' : ''" @click="abrir('uso')"><Icono nombre="dispensacion" :tamano="20" /> Consumo interno</button>
          <button type="button" class="b-btn secundario" :class="abierto === 'reajuste' ? 'activo' : ''" @click="abrir('reajuste')"><Icono nombre="lapiz" :tamano="20" /> Reajuste</button>
          <RouterLink to="/inventario/requisiciones" class="b-btn secundario"><Icono nombre="trasladar" :tamano="20" :grosor="2.2" /> Requisiciones</RouterLink>
        </div>
      </div>

      <!-- Columna de demanda, formularios y lotes -->
      <div class="min-w-0 space-y-4">
        <!-- Consumo interno -->
        <form v-if="abierto === 'uso'" class="b-panel formulario" @submit.prevent="enviarUso">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Consumo interno</h2>
            <button type="button" class="cerrar" aria-label="Cerrar" @click="abierto = null"><Icono nombre="cerrar" :tamano="20" :grosor="2.2" /></button>
          </header>
          <div class="b-panel-cuerpo grid gap-4 sm:grid-cols-[160px_1fr]">
            <div>
              <label for="usoCantidad" class="b-etiqueta">Cantidad</label>
              <input id="usoCantidad" v-model="uso.cantidad" inputmode="numeric" required class="b-campo num" />
            </div>
            <div>
              <label for="usoServicio" class="b-etiqueta">Servicio</label>
              <input id="usoServicio" v-model="uso.servicio" maxlength="60" placeholder="Curaciones, vacunación…" class="b-campo" />
            </div>
            <div class="sm:col-span-2">
              <label for="usoMotivo" class="b-etiqueta">En qué se usó</label>
              <input id="usoMotivo" v-model="uso.motivo" required minlength="5" maxlength="300" class="b-campo" />
            </div>
            <div class="sm:col-span-2">
              <label for="usoLote" class="b-etiqueta">Lote</label>
              <select id="usoLote" v-model="uso.loteId" class="b-campo">
                <option value="">El que vence primero</option>
                <option v-for="l in lotesDisponibles" :key="l.id" :value="l.id">{{ l.numeroLote }} · vence {{ fecha(l.fechaVence) }} · {{ miles(l.cantidadActual) }}</option>
              </select>
            </div>
          </div>
          <footer class="pie"><button type="submit" class="b-btn primario" :disabled="enviando">Registrar consumo</button></footer>
        </form>

        <!-- Reajuste -->
        <form v-if="abierto === 'reajuste'" class="b-panel formulario" @submit.prevent="enviarReajuste">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Reajuste</h2>
            <button type="button" class="cerrar" aria-label="Cerrar" @click="abierto = null"><Icono nombre="cerrar" :tamano="20" :grosor="2.2" /></button>
          </header>
          <div class="b-panel-cuerpo grid gap-4 sm:grid-cols-[1fr_160px]">
            <div>
              <label for="reaLote" class="b-etiqueta">Lote</label>
              <select id="reaLote" v-model="reajuste.loteId" required class="b-campo">
                <option value="">Elija el lote</option>
                <option v-for="l in lotesMovibles" :key="l.id" :value="l.id">{{ l.sinFecha ? 'Sin lote' : l.numeroLote }} · {{ miles(l.cantidadActual) }} en existencia</option>
              </select>
            </div>
            <div>
              <label for="reaCantidad" class="b-etiqueta">Cantidad (±)</label>
              <input id="reaCantidad" v-model="reajuste.cantidad" inputmode="numeric" required placeholder="-5 o 3" class="b-campo num" />
            </div>
            <div class="sm:col-span-2">
              <label for="reaCausa" class="b-etiqueta">Causa</label>
              <select id="reaCausa" v-model="reajuste.causa" required class="b-campo">
                <option value="">Elija la causa</option>
                <optgroup v-if="catalogos" label="Suman existencia">
                  <option v-for="c in catalogos.causasPositivas" :key="c.valor" :value="c.valor">{{ c.etiqueta }}</option>
                </optgroup>
                <optgroup v-if="catalogos" label="Restan existencia">
                  <option v-for="c in catalogos.causasNegativas" :key="c.valor" :value="c.valor">{{ c.etiqueta }}</option>
                </optgroup>
              </select>
            </div>
            <div class="sm:col-span-2">
              <label for="reaMotivo" class="b-etiqueta">Detalle</label>
              <input id="reaMotivo" v-model="reajuste.motivo" maxlength="300" class="b-campo" />
            </div>
          </div>
          <footer class="pie"><button type="submit" class="b-btn primario" :disabled="enviando">Registrar reajuste</button></footer>
        </form>

        <!-- Estado de un lote -->
        <form v-if="abierto === 'estado'" class="b-panel formulario" @submit.prevent="enviarEstado">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Estado del lote {{ datos.lotes.find((l) => l.id === cambioEstado.loteId)?.numeroLote }}</h2>
            <button type="button" class="cerrar" aria-label="Cerrar" @click="abierto = null"><Icono nombre="cerrar" :tamano="20" :grosor="2.2" /></button>
          </header>
          <div class="b-panel-cuerpo grid gap-4 sm:grid-cols-[auto_1fr]">
            <div>
              <span class="b-etiqueta">Nuevo estado</span>
              <div class="b-segmentado" role="radiogroup">
                <button v-for="e in [['disponible', 'Disponible'], ['cuarentena', 'Cuarentena'], ['retirado', 'Retirado']]" :key="e[0]" type="button" role="radio" :aria-checked="cambioEstado.estado === e[0]" :class="cambioEstado.estado === e[0] ? 'on' : ''" @click="cambioEstado.estado = e[0]">{{ e[1] }}</button>
              </div>
            </div>
            <div>
              <label for="estMotivo" class="b-etiqueta">Motivo</label>
              <input id="estMotivo" v-model="cambioEstado.motivo" required minlength="5" maxlength="300" class="b-campo" />
            </div>
          </div>
          <footer class="pie"><button type="submit" class="b-btn primario" :disabled="enviando">Cambiar estado</button></footer>
        </form>

        <section class="b-panel">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Demanda del municipio</h2>
            <span class="text-sm font-bold text-apagado">Promedio de {{ config.mesesPromedio }} meses</span>
          </header>
          <div class="px-3 pb-2 pt-3">
            <GraficaDemanda :demanda="datos.demanda" :promedio="bres.J" :meses-promedio="config.mesesPromedio" />
          </div>
        </section>

        <section class="b-panel">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Lotes</h2>
            <button v-if="sinExistencia.length" type="button" class="b-btn secundario chico" @click="verAgotados = !verAgotados">
              {{ verAgotados ? 'Ocultar agotados' : `Ver ${sinExistencia.length} agotados` }}
            </button>
          </header>
          <ul class="space-y-2 p-4">
            <li v-for="l in lotesVisibles" :key="l.id" class="lote" :class="l.cantidadActual === 0 ? 'opacity-60' : ''">
              <RouterLink :to="`/inventario/lotes/${l.id}`" class="b-boleto flex-1" :class="l.sinFecha ? 'vacio' : ''">
                <span class="min-w-0">
                  <span class="codigo block truncate">{{ l.sinFecha ? 'Sin lote' : l.numeroLote }}</span>
                  <span class="mt-0.5 flex items-center gap-2 text-[12px] text-apagado">
                    <span class="b-estado" :class="l.estado">{{ ESTADO[l.estado] }}</span>
                    <span v-if="l.fabricante" class="truncate">{{ l.fabricante }}</span>
                  </span>
                </span>
                <span class="cant text-right">{{ miles(l.cantidadActual) }}<span class="block text-[11px] font-semibold text-apagado">de {{ miles(l.cantidadInicial) }}</span></span>
                <SelloVence :fecha="l.fechaVence" :semaforo="l.semaforo" />
              </RouterLink>
              <button v-if="l.cantidadActual > 0" type="button" class="b-btn secundario chico" @click="abrir('estado', l.id)">Estado</button>
            </li>
            <li v-if="!lotesVisibles.length" class="b-vacio">Sin lotes con existencia.</li>
          </ul>
        </section>

        <section class="b-panel">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Receta del médico</h2>
          </header>
          <div class="b-panel-cuerpo">
            <label class="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                class="mt-1 h-5 w-5 shrink-0 accent-[#172A5A]"
                :checked="datos.insumo.prescribible"
                :disabled="guardandoReceta"
                @change="cambiarPrescribible($event.target.checked)"
              />
              <span>
                <b class="block text-tinta">El médico puede recetarlo</b>
                <small class="text-sm text-apagado">
                  {{ datos.insumo.prescribible
                    ? 'Aparece en la lista de medicamentos de la consulta.'
                    : 'No aparece en la consulta: es de uso del servicio y no se entrega al paciente.' }}
                </small>
              </span>
            </label>
          </div>
        </section>

        <AliasInsumo :insumo-id="id" />
      </div>
    </div>
  </section>

  <section v-else>
    <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
    <p v-else class="b-vacio">Cargando insumo…</p>
  </section>
</template>

<style scoped>
.rejilla { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.cob-bien { color: #14244A; }
.cob-bajo { color: #B7710A; }
.cob-agotado { color: #C03535; }
.cob-sin_consumo { color: #94A3B8; }
.formulario { border-color: #172A5A; box-shadow: 0 8px 24px -12px rgba(23, 42, 90, .35); }
.pie { display: flex; justify-content: flex-end; padding: 0 18px 16px; }
.cerrar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; color: #475569; }
.cerrar:hover { background: #F1F5F9; color: #14244A; }
.b-btn.secundario.activo, .b-btn.secundario.activo:hover { background: #172A5A; color: #fff; }
.lote { display: flex; align-items: center; gap: 8px; }
</style>
