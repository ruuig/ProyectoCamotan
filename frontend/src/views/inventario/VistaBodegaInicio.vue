<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';
import { miles, situacion } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Inicio de la bodega: tres tareas (recibir, entregar, cerrar el mes), cada
 * una con lo que tiene pendiente. Los vencimientos son raros si se entrega
 * primero lo que vence primero: van con las consultas.
 * Lo demás (productos, kardex, trazabilidad, bajas) se consulta abajo o desde
 * el buscador.
 */
const router = useRouter();
const resumen = ref(null);
const insumos = ref([]);
const pedidos = ref(0);
const estado = ref(null);

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (p) => (p ? MESES[Number(p.slice(5, 7)) - 1] : '');

onMounted(async () => {
  const [h, i, r, b] = await Promise.allSettled([bodega.hoy({}), inventario.insumos(), bodega.requisiciones(), bodega.balance({})]);
  if (h.status === 'fulfilled') resumen.value = h.value;
  if (b.status === 'fulfilled') {
    const conteo = { agotado: 0, bajo: 0 };
    for (const f of b.value.filas) {
      const x = situacion(f.bres);
      if (x in conteo) conteo[x] += 1;
    }
    estado.value = conteo;
  }
  if (i.status === 'fulfilled') insumos.value = i.value.insumos ?? i.value;
  if (r.status === 'fulfilled') pedidos.value = r.value.requisiciones.filter((x) => x.direccion !== 'superior' && ['solicitada', 'autorizada'].includes(x.estado)).length;
});

const r = computed(() => resumen.value?.resumen ?? null);
const cierre = computed(() => {
  if (!r.value) return null;
  const { listos, de } = r.value.informes;
  const cerrado = r.value.cierreAnterior === 'cerrado';
  return { listos, de, cerrado, avance: cerrado ? 100 : de ? Math.round((listos / de) * 70) : 0 };
});
</script>

<template>
  <section class="inicio">
    <header class="cabeza">
      <h1 class="b-titulo">Bodega</h1>
      <div class="buscar">
        <BuscadorInsumo :insumos="insumos" placeholder="Buscar un producto" @elegir="(i) => router.push(`/inventario/${i.id}`)" />
      </div>
    </header>

    <div class="tareas">
      <RouterLink to="/inventario/recibir" class="tarea verde">
        <span class="ic"><Icono nombre="recibir" :tamano="46" /></span>
        <span class="txt">
          <b>Recibir</b>
        </span>
        <span v-if="r?.faltantes.productos" class="pend ambar">{{ r.faltantes.productos }} por reclamar</span>
      </RouterLink>

      <RouterLink to="/inventario/requisiciones" class="tarea azul">
        <span class="ic"><Icono nombre="trasladar" :tamano="46" /></span>
        <span class="txt">
          <b>Entregar</b>
        </span>
        <span v-if="pedidos" class="pend azul">{{ pedidos }} {{ pedidos === 1 ? 'pedido' : 'pedidos' }}</span>
      </RouterLink>

      <RouterLink to="/inventario/informes" class="tarea marino">
        <span class="ic"><Icono nombre="hojaCalculo" :tamano="46" /></span>
        <span class="txt">
          <b>Cerrar el mes</b>
          <small v-if="cierre">{{ cierre.cerrado ? `${nombreMes(resumen.anterior)}: cerrado` : `${nombreMes(resumen.anterior)}: ${cierre.listos} de ${cierre.de} informes` }}</small>
        </span>
        <span v-if="cierre" class="barra"><span :style="{ width: `${cierre.avance}%` }" /></span>
      </RouterLink>
    </div>

    <nav class="consultas" aria-label="Consultar">
      <RouterLink to="/inventario/productos" class="consulta">
        <Icono nombre="inventario" :tamano="22" /> Productos
        <!-- Agotados con la regla del BRES, la misma de Existencias -->
        <span v-if="estado?.agotado" class="aviso-rojo" :title="`${estado.agotado} agotados en bodega`">{{ estado.agotado }}</span>
      </RouterLink>
      <RouterLink to="/inventario/semaforo" class="consulta">
        <Icono nombre="vencimiento" :tamano="22" /> Semáforo
        <span v-if="r?.vencidos" class="aviso-rojo">{{ r.vencidos }}</span>
      </RouterLink>
      <RouterLink to="/inventario/kardex" class="consulta"><Icono nombre="hojaCalculo" :tamano="22" /> Kardex</RouterLink>
      <RouterLink to="/inventario/trazabilidad" class="consulta"><Icono nombre="trazabilidad" :tamano="22" /> Trazabilidad</RouterLink>
      <RouterLink to="/inventario/bajas" class="consulta"><Icono nombre="quitar" :tamano="22" /> Bajas y retiros</RouterLink>
    </nav>

    <p v-if="r && (r.sinNumero || r.kardex)" class="pendientes">
      <RouterLink v-if="r.sinNumero" to="/inventario/requisiciones?ver=sin_numero" class="chip">{{ r.sinNumero }} requisiciones sin número de formulario</RouterLink>
      <RouterLink v-if="r.kardex" to="/inventario/kardex" class="chip">{{ miles(r.kardex) }} movimientos por pasar a tarjetas</RouterLink>
    </p>
  </section>
</template>

<style scoped>
/* El inicio ocupa todo el alto: las tareas crecen y las consultas quedan abajo. */
.inicio { display: flex; flex-direction: column; min-height: calc(100vh - 200px); }
.inicio .tareas { flex: 1.7; }
/* Las consultas crecen con la pantalla, pero siempre por debajo de las tareas. */
.inicio .consultas { flex: 1; max-height: 170px; min-height: 120px; }
.inicio .consulta { height: auto; flex-direction: column; gap: 10px; border-radius: 20px; border-bottom-width: 5px; font-size: 19px; }
.inicio .consulta { position: relative; }
.inicio .consulta svg { width: 34px; height: 34px; }
.inicio .aviso-rojo { position: absolute; top: 12px; right: 14px; font-size: 14px; padding: 2px 10px; }
.inicio .tarea { min-height: 0; height: 100%; justify-content: center; }
.inicio .tarea .ic { width: 84px; height: 84px; border-radius: 24px; }
.inicio .tarea b { font-size: 30px; }
.inicio .tarea small { font-size: 18px; }
.cabeza { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; }
.buscar { width: min(460px, 100%); }
.tareas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 22px; }
@media (max-width: 1100px) { .tareas { grid-template-columns: 1fr; } }
.tarea {
  position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 16px; min-height: 230px; padding: 22px 24px;
  border: 2px solid #E2E8F0; border-bottom-width: 6px; border-radius: 24px; background: #fff; color: #14244A;
  transition: transform .08s, border-color .12s;
}
.tarea:hover { border-color: var(--c); }
.tarea:active { transform: translateY(3px); border-bottom-width: 3px; }
.tarea .ic { display: grid; place-items: center; flex-shrink: 0; width: 78px; height: 78px; border-radius: 22px; background: var(--c); color: #fff; box-shadow: inset 0 -5px 0 rgba(0, 0, 0, .22); }
.tarea .txt { display: grid; gap: 4px; min-width: 0; }
.tarea b { font-size: 26px; font-weight: 900; line-height: 1.1; }
.tarea small { font-size: 16px; font-weight: 700; color: #64748B; }
.tarea.verde { --c: #1A8F57; } .tarea.azul { --c: #2F83C4; } .tarea.rojo { --c: #C03535; } .tarea.marino { --c: #172A5A; }
.pend { position: absolute; top: 16px; right: 18px; padding: 4px 12px; border-radius: 10px; font-size: 14px; font-weight: 900; color: #fff; box-shadow: inset 0 -3px 0 rgba(0, 0, 0, .2); }
.pend.rojo { background: #C03535; } .pend.ambar { background: #E8930C; } .pend.azul { background: #2F83C4; }
.barra { position: absolute; left: 24px; right: 24px; bottom: 16px; height: 10px; border-radius: 6px; background: #E2E8F0; overflow: hidden; }
.barra span { display: block; height: 100%; border-radius: 6px; background: #1A8F57; box-shadow: inset 0 3px 0 rgba(255, 255, 255, .3); }
.consultas { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
@media (max-width: 800px) { .consultas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.consulta { display: flex; align-items: center; justify-content: center; gap: 10px; height: 68px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 16px; background: #fff; font-size: 17px; font-weight: 800; color: #172A5A; transition: transform .06s; }
.consulta:hover { border-color: #9FCDEC; background: #F7FBFE; }
.consulta:active { transform: translateY(2px); border-bottom-width: 2px; }
.consulta svg { color: #2F83C4; }
.aviso-rojo { min-width: 26px; padding: 1px 8px; border-radius: 9px; background: #C03535; color: #fff; font-size: 13px; font-weight: 900; text-align: center; }
.pendientes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.chip { padding: 6px 12px; border: 2px solid #F5D58A; border-radius: 12px; background: #FFF7E6; font-size: 14px; font-weight: 800; color: #7A4F05; }
</style>
