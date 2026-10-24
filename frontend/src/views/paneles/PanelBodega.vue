<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import { cierre, nombrePeriodo } from '../../dominio/bodega';
import { miles, situacion } from '../../components/bodega/diseno/PiezasBodega';
import Icono from '../../components/comunes/Icono.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';

/**
 * Inicio de bodega: en qué paso del ciclo del mes va la bodega.
 *   1. Requisición a la DDRISS (sale del BRES).
 *   2. Recibir lo que dio la DDRISS, lote por lote.
 *   3. Salidas: despachar las requisiciones de los puestos.
 *   4. Consumo de puestos: lo que cada puesto entregó en el mes.
 *   5. BRES del mes, que sale solo de lo anterior.
 *   6. Trazadores para la DDRISS.
 * Debajo, lo que pide atención: agotados, vencidos, faltantes por reclamar y
 * requisiciones sin número de formulario.
 */
const router = useRouter();
const hoy = ref(null);
const requisiciones = ref([]);
const balance = ref(null);
const semaforo = ref(null);
const bres = ref(null);
const insumos = ref([]);

const intentar = async (p) => { try { return await p; } catch { return null; } };
onMounted(async () => {
  const [h, r, b, s, br, i] = await Promise.all([
    intentar(bodega.hoy({})),
    intentar(bodega.requisiciones()),
    intentar(bodega.balance({})),
    intentar(bodega.semaforo({})),
    intentar(inventario.bresDe(cierre.periodo)),
    intentar(inventario.insumos()),
  ]);
  hoy.value = h;
  requisiciones.value = r?.requisiciones ?? [];
  balance.value = b;
  semaforo.value = s?.resumen ?? null;
  bres.value = br?.bres ?? null;
  insumos.value = i?.insumos ?? i ?? [];
});

const mesActual = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 7);
const fecha = (v) => new Date(v).toLocaleDateString('es-GT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const r = computed(() => hoy.value?.resumen ?? null);

const aDdriss = computed(() => requisiciones.value.filter((x) => x.direccion === 'superior' && x.estado !== 'anulada'));
const delMes = computed(() => aDdriss.value.find((x) => String(x.fechaSolicitud).slice(0, 7) === mesActual) ?? null);
const porRecibir = computed(() => aDdriss.value.filter((x) => ['solicitada', 'autorizada', 'parcial'].includes(x.estado)).length);
const porDespachar = computed(() => requisiciones.value.filter((x) => x.direccion !== 'superior' && ['solicitada', 'autorizada'].includes(x.estado)).length);

/* El ciclo: cada paso con su estado (listo, pendiente o en espera). */
const pasos = computed(() => {
  const inf = r.value?.informes;
  return [
    {
      texto: 'Requisición', a: '/inventario/pedir-ddriss',
      estado: delMes.value ? `Enviada ${fecha(delMes.value.fechaSolicitud)}` : 'Pendiente',
      tono: delMes.value ? 'listo' : 'pendiente',
    },
    {
      texto: 'Recibir', a: '/inventario/recibir',
      estado: porRecibir.value ? `${porRecibir.value} por recibir` : 'Al día',
      tono: porRecibir.value ? 'pendiente' : 'listo',
    },
    {
      texto: 'Salidas', a: '/inventario/requisiciones?ver=pedidos',
      estado: porDespachar.value ? `${porDespachar.value} por despachar` : 'Al día',
      tono: porDespachar.value ? 'pendiente' : 'listo',
    },
    {
      texto: 'Consumo de puestos', a: '/inventario/informes',
      estado: inf ? `${inf.listos} de ${inf.de} · ${hoy.value?.periodo ? nombrePeriodo(hoy.value.periodo).split(' ')[0] : ''}` : '·',
      tono: inf && inf.de > 0 && inf.listos === inf.de ? 'listo' : 'pendiente',
    },
    {
      texto: `BRES ${nombrePeriodo(cierre.periodo).split(' ')[0]}`, a: '/inventario/bres',
      estado: !bres.value ? 'Sin generar' : bres.value.estado === 'cerrado' ? 'Cerrado' : 'Borrador',
      tono: bres.value?.estado === 'cerrado' ? 'listo' : 'pendiente',
    },
    { texto: 'Trazadores', a: '/inventario/trazadores', estado: 'Imprimir', tono: 'espera' },
  ];
});

/* Lo que pide atención. */
const agotados = computed(() => (balance.value?.filas ?? []).filter((f) => situacion(f.bres) === 'agotado').length);
const alertas = computed(() => [
  { texto: 'Agotados', valor: balance.value ? agotados.value : null, a: '/inventario/productos', tono: 'rojo' },
  { texto: 'Lotes vencidos', valor: semaforo.value ? semaforo.value.vencido : null, a: '/inventario/semaforo', tono: 'rojo' },
  { texto: 'Faltantes por reclamar', valor: r.value ? r.value.faltantes.productos : null, a: '/inventario/recibir?ver=faltantes', tono: 'ambar' },
  { texto: 'Sin número de formulario', valor: r.value ? r.value.sinNumero : null, a: '/inventario/requisiciones?ver=sin_numero', tono: 'ambar' },
]);
</script>

<template>
  <section class="panel-bod">
    <header class="b-cabecera">
      <div>
        <p class="b-antetitulo">Bodega</p>
        <h1 class="b-titulo">Ciclo del mes</h1>
      </div>
      <div class="buscar"><BuscadorInsumo :insumos="insumos" placeholder="Buscar un producto" @elegir="(i) => router.push(`/inventario/${i.id}`)" /></div>
    </header>

    <ol class="ciclo">
      <li v-for="(p, i) in pasos" :key="p.texto">
        <RouterLink :to="p.a" class="paso" :class="p.tono">
          <span class="num">{{ i + 1 }}</span>
          <span class="txt">
            <b>{{ p.texto }}</b>
            <small>{{ p.estado }}</small>
          </span>
          <Icono v-if="p.tono === 'listo'" nombre="correcto" :tamano="22" :grosor="2.6" class="ok" />
        </RouterLink>
      </li>
    </ol>

    <div class="alertas">
      <RouterLink v-for="a in alertas" :key="a.texto" :to="a.a" class="alerta" :class="{ [a.tono]: a.valor }">
        <b>{{ a.valor === null ? '·' : miles(a.valor) }}</b>
        <span>{{ a.texto }}</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.panel-bod { display: grid; gap: 18px; }
.buscar { width: min(360px, 100%); }
.ciclo { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1000px) { .ciclo { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .ciclo { grid-template-columns: 1fr; } }
.paso { display: flex; align-items: center; gap: 14px; min-height: 84px; padding: 14px 16px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 18px; background: #fff; color: #14244A; }
.paso:hover { border-color: #9FCDEC; background: #F7FBFE; }
.paso:active { transform: translateY(2px); border-bottom-width: 2px; }
.num { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 12px; background: #F1F5F9; color: #475569; font-size: 18px; font-weight: 900; }
.paso.pendiente .num { background: #172A5A; color: #fff; }
.paso.listo .num { background: #E2F5EA; color: #145C3C; }
.txt { display: grid; flex: 1; min-width: 0; }
.txt b { font-size: 17px; font-weight: 900; }
.txt small { font-size: 14px; font-weight: 700; color: #64748B; }
.paso.pendiente small { color: #8A4B00; }
.paso.listo small { color: #145C3C; }
.ok { flex-shrink: 0; color: #1E8E5E; }
.alertas { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .alertas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.alerta { display: flex; align-items: baseline; gap: 10px; padding: 12px 16px; border: 2px solid #E2E8F0; border-radius: 16px; background: #fff; color: #475569; }
.alerta:hover { border-color: #9FCDEC; }
.alerta b { font-size: 26px; font-weight: 900; color: #94A3B8; font-variant-numeric: tabular-nums; }
.alerta span { font-size: 14px; font-weight: 800; }
.alerta.rojo b { color: #A83232; }
.alerta.ambar b { color: #B4610A; }
</style>
