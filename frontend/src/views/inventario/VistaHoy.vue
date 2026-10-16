<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import { miles } from '../../components/bodega/diseno/PiezasBodega';
import { nombrePeriodo } from '../../dominio/bodega';

/**
 * Hoy en bodega: las cifras que importan arriba, lo que hay que hacer a la
 * izquierda y, a la derecha, el cierre del mes anterior y el kardex.
 * La fecha hasta la que se pasó el kardex se recuerda en este equipo.
 */
const datos = ref(null);
const error = ref('');

const CLAVE_KARDEX = 'camotan_kardex_pasado_hasta';
const leer = () => { try { return localStorage.getItem(CLAVE_KARDEX) ?? ''; } catch { return ''; } };
const kardexHasta = ref(leer());
const editandoKardex = ref(!kardexHasta.value);

const hoyTexto = new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
const mes = (p) => (p ? nombrePeriodo(p).split(' ')[0] : '');
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const fechaCorta = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-GT', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');
const diaSiguiente = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

const r = computed(() => datos.value?.resumen);

/** Lo que hay que hacer, en el orden en que conviene hacerlo. */
// Primero lo urgente: faltantes y vencidos; después lo administrativo.
const ORDEN = ['faltantes', 'vencidos', 'sin_numero', 'informes', 'por_vencer'];
const tareas = computed(() => (datos.value?.pendientes ?? [])
  .filter((p) => p.clave !== 'kardex' && p.clave !== 'cierre')
  .sort((a, b) => ORDEN.indexOf(a.clave) - ORDEN.indexOf(b.clave))
  .map((p) => {
    switch (p.clave) {
      case 'faltantes': return { ...p, tono: 'rojo', titulo: `Reclamar faltantes de ${p.cantidad} ${p.cantidad === 1 ? 'producto' : 'productos'}`, detalle: `${miles(p.unidades)} unidades que dice el documento y no llegaron`, accion: 'Ver faltantes' };
      case 'vencidos': return { ...p, tono: 'rojo', titulo: `Verificar ${p.cantidad} ${p.cantidad === 1 ? 'lote vencido' : 'lotes vencidos'}`, detalle: 'Tienen existencia en el sistema: confirme si siguen en la estantería', accion: 'Revisar' };
      case 'sin_numero': return { ...p, tono: 'ambar', titulo: `Anotar el número de ${p.cantidad} ${p.cantidad === 1 ? 'requisición' : 'requisiciones'}`, detalle: 'Sin número, el kardex queda sin referencia', accion: 'Completar' };
      case 'informes': return { ...p, tono: 'azul', titulo: `Capturar ${p.cantidad} ${p.cantidad === 1 ? 'informe' : 'informes'} de ${mes(p.periodo)}`, detalle: `${p.de - p.cantidad} de ${p.de} servicios ya informaron`, accion: 'Ir a informes' };
      case 'por_vencer': return { ...p, tono: 'ambar', titulo: `Entregar primero ${p.cantidad} ${p.cantidad === 1 ? 'lote' : 'lotes'} por vencer`, detalle: 'Vencen en menos de 3 meses', accion: 'Ver semáforo' };
      default: return { ...p, tono: 'azul', titulo: p.clave, detalle: '', accion: 'Ver' };
    }
  }));

async function cargar() {
  error.value = '';
  try {
    datos.value = await bodega.hoy(kardexHasta.value ? { kardexDesde: diaSiguiente(kardexHasta.value) } : {});
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function guardarKardex() {
  try { localStorage.setItem(CLAVE_KARDEX, kardexHasta.value); } catch { /* sin almacenamiento */ }
  editandoKardex.value = false;
  cargar();
}

onMounted(cargar);
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">Hoy</h1>
        <span class="b-antetitulo">{{ hoyTexto }}</span>
      </div>
      <div class="b-acciones">
        <RouterLink to="/inventario/recibir" class="b-btn secundario"><Icono nombre="recibir" :tamano="20" :grosor="2" /> Recibir</RouterLink>
        <RouterLink to="/inventario/requisiciones" class="b-btn primario"><Icono nombre="trasladar" :tamano="20" :grosor="2.2" /> Entregar</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <template v-if="r">
      <!-- Cifras -->
      <div class="b-franja mt-5">
        <RouterLink to="/inventario/informes" class="b-cifra enlace">
          <span class="n">{{ r.informes.listos }}<small>/{{ r.informes.de }}</small></span><span class="e">Informes de {{ mes(datos.periodo) }}</span>
        </RouterLink>
        <RouterLink to="/inventario/recibir?ver=faltantes" class="b-cifra enlace">
          <span class="n" :class="r.faltantes.productos ? 'rojo' : 'cero'">{{ r.faltantes.productos }}</span><span class="e">Faltantes por reclamar</span>
        </RouterLink>
        <RouterLink to="/inventario/requisiciones?ver=sin_numero" class="b-cifra enlace">
          <span class="n" :class="r.sinNumero ? 'ambar' : 'cero'">{{ r.sinNumero }}</span><span class="e">Sin número</span>
        </RouterLink>
        <RouterLink to="/inventario/semaforo" class="b-cifra enlace">
          <span class="n" :class="r.vencidos ? 'rojo' : 'cero'">{{ r.vencidos }}</span><span class="e">Lotes vencidos</span>
        </RouterLink>
        <RouterLink to="/inventario/semaforo" class="b-cifra enlace">
          <span class="n" :class="r.porVencer ? 'ambar' : 'cero'">{{ r.porVencer }}</span><span class="e">Vencen en 3 meses</span>
        </RouterLink>
      </div>

      <div class="rejilla mt-5">
        <!-- Por hacer -->
        <div>
          <h2 class="b-subtitulo">Por hacer</h2>
          <ul class="tareas mt-2">
            <li v-for="t in tareas" :key="t.clave" class="tarea">
              <span class="marca" :class="t.tono" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block font-semibold text-tinta">{{ t.titulo }}</span>
                <small>{{ t.detalle }}</small>
              </span>
              <RouterLink :to="t.a" class="b-btn chico" :class="t.tono === 'rojo' ? 'primario' : 'secundario'">{{ t.accion }}</RouterLink>
            </li>
            <li v-if="!tareas.length" class="tarea">
              <span class="marca verde" aria-hidden="true" />
              <span class="flex-1">
                <span class="block font-semibold text-tinta">Todo al día</span>
                <small>No hay nada pendiente en bodega</small>
              </span>
            </li>
          </ul>
        </div>

        <!-- Cierre y kardex -->
        <div class="space-y-4">
          <article class="b-panel">
            <header class="b-panel-cabeza">
              <h2 class="b-panel-titulo">Cierre de {{ mes(datos.anterior) }}</h2>
              <span class="b-estado" :class="r.cierreAnterior === 'cerrado' ? 'disponible' : 'cuarentena'">{{ r.cierreAnterior === 'cerrado' ? 'Cerrado' : r.cierreAnterior === 'borrador' ? 'Sin cerrar' : 'Sin generar' }}</span>
            </header>
            <div class="b-panel-cuerpo flex items-center justify-between gap-3">
              <p class="text-sm font-semibold text-apagado">
                {{ r.cierreAnterior === 'cerrado' ? 'El BRES ya está cerrado y sus cifras no cambian.' : 'Revise el BRES y ciérrelo para enviarlo.' }}
              </p>
              <RouterLink to="/inventario/bres" class="b-btn chico secundario">BRES</RouterLink>
            </div>
          </article>

          <article class="b-panel">
            <header class="b-panel-cabeza">
              <h2 class="b-panel-titulo">Kardex en tarjetas</h2>
              <button v-if="!editandoKardex" type="button" class="text-sm font-bold text-[#172A5A] underline" @click="editandoKardex = true">Cambiar fecha</button>
            </header>
            <div class="b-panel-cuerpo">
              <form v-if="editandoKardex" class="flex flex-wrap items-end gap-2" @submit.prevent="guardarKardex">
                <div class="flex-1">
                  <label for="kd" class="b-etiqueta">Pasado a las tarjetas hasta el</label>
                  <input id="kd" v-model="kardexHasta" type="date" required class="b-campo" />
                </div>
                <button type="submit" class="b-btn chico primario">Guardar</button>
              </form>
              <template v-else>
                <div class="flex items-baseline gap-2">
                  <span class="text-[34px] font-bold leading-none tabular-nums" :class="r.kardex ? 'text-tinta' : 'text-[#94A3B8]'">{{ miles(r.kardex ?? 0) }}</span>
                  <span class="b-antetitulo">movimientos por pasar</span>
                </div>
                <p class="mt-1 text-sm font-semibold text-apagado">Desde el {{ fechaCorta(diaSiguiente(kardexHasta)) }}</p>
                <div v-if="r.kardex" class="mt-3 grid grid-cols-2 gap-2">
                  <RouterLink :to="`/inventario/kardex?desde=${diaSiguiente(kardexHasta)}`" class="b-btn chico secundario">Ver</RouterLink>
                  <RouterLink :to="`/imprimir/kardex?desde=${diaSiguiente(kardexHasta)}`" target="_blank" class="b-btn chico primario"><Icono nombre="imprimir" :tamano="16" /> Imprimir</RouterLink>
                </div>
              </template>
            </div>
          </article>
        </div>
      </div>
    </template>
    <p v-else-if="!error" class="b-vacio">Cargando…</p>
  </section>
</template>

<style scoped>
.b-cifra.enlace { text-decoration: none; }
.b-cifra.enlace:hover { background: #F8FAFC; }
.b-cifra .n small { font-size: 18px; font-weight: 700; color: #94A3B8; }
.b-cifra .n.rojo { color: #C03535; }
.b-cifra .n.ambar { color: #B7710A; }
.b-cifra .n.cero { color: #94A3B8; }
.rejilla { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 24px; align-items: start; }
@media (max-width: 1099px) { .rejilla { grid-template-columns: 1fr; } }
.tareas { border-top: 2px solid #E2E8F0; }
.tarea { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 8px 4px; border-bottom: 1px solid #EEF2F6; }
.tarea small { display: block; font-size: 13px; font-weight: 600; color: #64748B; }
.marca { flex-shrink: 0; width: 4px; align-self: stretch; margin: 6px 0; border-radius: 2px; }
.marca.rojo { background: #C03535; }
.marca.ambar { background: #E8930C; }
.marca.azul { background: #172A5A; }
.marca.verde { background: #22A06B; }
</style>
