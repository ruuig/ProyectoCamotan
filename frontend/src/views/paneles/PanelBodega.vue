<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import bodega from '../../services/bodega';
import inventario from '../../services/inventario';
import { useAuthStore } from '../../stores/auth';
import { cierre, nombrePeriodo } from '../../dominio/bodega';
import { estiloTono, miles, situacion } from '../../components/bodega/diseno/PiezasBodega';
import Icono from '../../components/comunes/Icono.vue';
import TarjetaCifra from '../../components/paneles/TarjetaCifra.vue';
import Dona from '../../components/paneles/Dona.vue';
import Anillo from '../../components/paneles/Anillo.vue';
import BuscadorInsumo from '../../components/bodega/diseno/BuscadorInsumo.vue';

/**
 * Inicio de bodega. Quien maneja la bodega responde por tres cosas, y el
 * panel las sigue en ese orden:
 *  1. Atender a tiempo lo que piden farmacia y los servicios (pedidos).
 *  2. Que haya medicamento y que no se venza (agotados, faltantes por
 *     reclamar, semáforo).
 *  3. Cerrar el mes: informes de los servicios, BRES e inventario de cierre.
 */
const auth = useAuthStore();
const router = useRouter();
const hoy = ref(null);
const pedidos = ref([]);
const balance = ref(null);
const semaforo = ref(null);
const bres = ref(null);
const insumos = ref([]);

const hora = Number(new Intl.DateTimeFormat('es-GT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Guatemala' }).format(new Date()));
const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
const primerNombre = computed(() => (auth.usuario?.nombre ?? '').replace(/^(Dr|Dra|Lic|Licda|Ing|P\.C)\.?\s+/i, '').split(' ')[0]);

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
  pedidos.value = (r?.requisiciones ?? []).filter((x) => x.direccion !== 'superior' && ['solicitada', 'autorizada'].includes(x.estado))
    .sort((a, b) => new Date(a.fechaSolicitud) - new Date(b.fechaSolicitud));
  balance.value = b;
  semaforo.value = s?.resumen ?? null;
  bres.value = br?.bres ?? null;
  insumos.value = i?.insumos ?? i ?? [];
});

const dias = (f) => Math.max(0, Math.floor((Date.now() - new Date(f)) / 86400000));
const hace = (f) => (dias(f) === 0 ? 'Hoy' : `Hace ${dias(f)} ${dias(f) === 1 ? 'día' : 'días'}`);

/* --- Existencia con la regla del BRES ------------------------------------------ */
const filas = computed(() => (balance.value?.filas ?? []).map((f) => ({ ...f, situacion: situacion(f.bres) })));
const conteo = computed(() => {
  const c = { agotado: 0, bajo: 0 };
  for (const f of filas.value) if (f.situacion in c) c[f.situacion] += 1;
  return c;
});
const faltan = computed(() => filas.value
  .filter((f) => f.situacion === 'agotado' || f.situacion === 'bajo')
  .sort((a, b) => b.bres.J - a.bres.J)
  .slice(0, 6));
const meses = (k) => (k == null ? '—' : k < 1 ? 'menos de 1 mes' : `${k.toLocaleString('es-GT', { maximumFractionDigits: 1 })} meses`);

const r = computed(() => hoy.value?.resumen ?? null);
const tarjetas = computed(() => [
  {
    titulo: 'Pedidos por atender',
    valor: pedidos.value.length,
    nota: pedidos.value.length ? `El más antiguo: ${hace(pedidos.value[0].fechaSolicitud).toLowerCase()} (${pedidos.value[0].unidadSeccion})` : 'Ningún servicio espera',
    icono: 'trasladar',
    tono: pedidos.value.some((p) => dias(p.fechaSolicitud) >= 2) ? 'atencion' : pedidos.value.length ? 'accion' : 'neutro',
    a: '/inventario/requisiciones?ver=pedidos',
  },
  {
    titulo: 'Por reclamar al proveedor',
    valor: r.value ? r.value.faltantes.productos : '·',
    nota: r.value?.faltantes.productos ? `${miles(r.value.faltantes.unidades)} unidades que el documento dice y no llegaron` : 'Todo lo recibido llegó completo',
    icono: 'recibir',
    tono: r.value?.faltantes.productos ? 'atencion' : 'neutro',
    a: '/inventario/recibir?ver=faltantes',
  },
  {
    titulo: 'Agotados en bodega',
    valor: balance.value ? conteo.value.agotado : '·',
    nota: balance.value ? `${conteo.value.bajo} más con el municipio bajo el mínimo` : '',
    icono: 'inventario',
    tono: conteo.value.agotado ? 'critico' : 'neutro',
    a: '/inventario/productos',
  },
  {
    titulo: 'Lotes vencidos',
    valor: semaforo.value ? semaforo.value.vencido : '·',
    nota: semaforo.value?.vencido ? 'Separarlos y dar de baja con oficio' : 'Nada vencido',
    icono: 'quitar',
    tono: semaforo.value?.vencido ? 'critico' : 'neutro',
    a: '/inventario/bajas',
  },
]);

/* --- Cierre del mes ------------------------------------------------------------- */
const pasos = computed(() => {
  const rep = r.value?.informes;
  return [
    {
      texto: 'Informes de los servicios',
      detalle: rep ? `${rep.listos} de ${rep.de} recibidos` : '·',
      listo: rep ? rep.de > 0 && rep.listos === rep.de : false,
      a: '/inventario/informes',
    },
    {
      texto: 'BRES',
      detalle: !bres.value ? 'Sin generar' : bres.value.estado === 'cerrado' ? 'Cerrado' : 'Generado, falta cerrarlo',
      listo: bres.value?.estado === 'cerrado',
      a: '/inventario/bres',
    },
    {
      texto: 'Requisiciones con número',
      detalle: r.value?.sinNumero ? `${r.value.sinNumero} sin número de formulario` : 'Todas anotadas',
      listo: !r.value?.sinNumero,
      a: '/inventario/requisiciones?ver=sin_numero',
    },
  ];
});
const listos = computed(() => pasos.value.filter((p) => p.listo).length);

const partesSemaforo = computed(() => {
  const s = semaforo.value ?? {};
  return [
    { clave: 'vencido', texto: 'Vencidos', valor: s.vencido ?? 0, color: '#9B2C2C', a: '/inventario/semaforo' },
    { clave: 'rojo', texto: 'Menos de 12 meses', valor: s.rojo ?? 0, color: '#E8590C', a: '/inventario/semaforo' },
    { clave: 'amarillo', texto: 'De 12 a 18 meses', valor: s.amarillo ?? 0, color: '#D9A30A', a: '/inventario/semaforo' },
    { clave: 'verde', texto: 'Más de 18 meses', valor: s.verde ?? 0, color: '#22A06B', a: '/inventario/semaforo' },
  ];
});
const lotes = computed(() => partesSemaforo.value.reduce((t, p) => t + p.valor, 0));
</script>

<template>
  <section class="panel-bod">
    <header class="b-cabecera">
      <div>
        <span class="b-antetitulo">Bodega</span>
        <h1 class="b-titulo mt-1">{{ saludo }}{{ primerNombre ? `, ${primerNombre}` : '' }}</h1>
      </div>
      <div class="b-acciones">
        <div class="buscar"><BuscadorInsumo :insumos="insumos" placeholder="Buscar un producto" @elegir="(i) => router.push(`/inventario/${i.id}`)" /></div>
        <RouterLink to="/inventario/recibir" class="b-btn secundario"><Icono nombre="recibir" :tamano="20" /> Recibir</RouterLink>
        <RouterLink to="/inventario/requisiciones?ver=nueva" class="b-btn primario"><Icono nombre="trasladar" :tamano="20" /> Entregar</RouterLink>
      </div>
    </header>

    <div class="cifras">
      <TarjetaCifra v-for="t in tarjetas" :key="t.titulo" v-bind="t" />
    </div>

    <div class="rejilla">
      <!-- Pedidos por atender -->
      <section class="tarjeta ancha">
        <header class="cabeza">
          <div>
            <h2>Pedidos por atender</h2>
            <p class="porque">Lo que pidieron farmacia y los servicios. Se autoriza lo que se puede dar y se despacha con el número del formulario.</p>
          </div>
          <RouterLink to="/inventario/requisiciones" class="ver">Ver todos</RouterLink>
        </header>
        <ul v-if="pedidos.length" class="pedidos">
          <li v-for="p in pedidos.slice(0, 6)" :key="p.id">
            <RouterLink :to="`/inventario/requisiciones?pedido=${p.id}`" class="pedido" :style="estiloTono(dias(p.fechaSolicitud) >= 2 ? 'atencion' : 'accion')">
              <span class="min-w-0 flex-1">
                <b>{{ p.unidadSeccion }}</b>
                <small>{{ p.renglones }} {{ p.renglones === 1 ? 'producto' : 'productos' }} · {{ miles(p.solicitado) }} unidades · pidió {{ p.solicitante }}</small>
              </span>
              <span class="cuando">
                <span class="chip">{{ p.estado === 'autorizada' ? 'Falta despachar' : 'Nuevo' }}</span>
                <small>{{ hace(p.fechaSolicitud) }}</small>
              </span>
              <span class="b-btn chico primario">Atender</span>
            </RouterLink>
          </li>
        </ul>
        <p v-else class="b-vacio">Nadie espera. Cuando farmacia o un servicio pida, aparece aquí.</p>
      </section>

      <!-- Cierre del mes -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2 class="first-letter:uppercase">Cierre de {{ nombrePeriodo(cierre.periodo) }}</h2>
            <p class="porque">Lo que el Área de Salud espera de bodega cada mes.</p>
          </div>
          <Anillo :valor="listos" :de="pasos.length" :texto="`${listos}/${pasos.length}`" :color="listos === pasos.length ? '#22A06B' : '#E8930C'" />
        </header>
        <ul class="pasos">
          <li v-for="p in pasos" :key="p.texto">
            <RouterLink :to="p.a" class="paso" :style="estiloTono(p.listo ? 'bien' : 'atencion')">
              <span class="marca"><Icono :nombre="p.listo ? 'correcto' : 'reloj'" :tamano="20" :grosor="2.2" /></span>
              <span class="min-w-0 flex-1"><b>{{ p.texto }}</b><small>{{ p.detalle }}</small></span>
              <Icono nombre="irA" :tamano="18" :grosor="2.2" class="text-slate-400" />
            </RouterLink>
          </li>
        </ul>
      </section>

      <!-- Insumos que más faltan -->
      <section class="tarjeta ancha">
        <header class="cabeza">
          <div>
            <h2>Lo que más falta</h2>
            <p class="porque">Agotados en bodega o con el municipio bajo el mínimo, primero lo que más se consume: es lo primero que se pide al Área.</p>
          </div>
          <RouterLink to="/inventario/productos" class="ver">Ver existencias</RouterLink>
        </header>
        <ul v-if="faltan.length" class="faltan">
          <li v-for="f in faltan" :key="f.insumoId">
            <RouterLink :to="`/inventario/${f.insumoId}`" class="falta" :style="estiloTono(f.situacion === 'agotado' ? 'critico' : 'atencion')">
              <span class="min-w-0">
                <b class="nombre">{{ f.nombre }}</b>
                <span class="datos">
                  <span>En bodega <b>{{ miles(f.bres.I) }}</b></span>
                  <span>Se consumen <b>{{ miles(f.bres.J) }}</b> al mes</span>
                  <span>Al municipio le alcanza <b>{{ meses(f.bres.K) }}</b></span>
                </span>
              </span>
              <span class="estado">{{ f.situacion === 'agotado' ? 'Agotado' : 'Bajo el mínimo' }}</span>
            </RouterLink>
          </li>
        </ul>
        <p v-else-if="balance" class="b-vacio">Nada agotado ni bajo el mínimo.</p>
      </section>

      <!-- Semáforo -->
      <section class="tarjeta">
        <header class="cabeza">
          <div>
            <h2>Lotes por vencimiento</h2>
            <p class="porque">Se despacha primero lo que vence primero; lo vencido se da de baja.</p>
          </div>
        </header>
        <Dona v-if="semaforo" :partes="partesSemaforo" :centro="lotes" bajo-centro="lotes" />
      </section>
    </div>
  </section>
</template>

<style scoped>
.panel-bod { display: grid; gap: 20px; }
.buscar { width: min(260px, 100%); }
.b-acciones { flex-wrap: nowrap; }
@media (max-width: 900px) { .b-acciones { flex-wrap: wrap; } }
.cifras { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1200px) { .cifras { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .cifras { grid-template-columns: 1fr; } }
.rejilla { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
.ancha { grid-column: span 2; }
@media (max-width: 1100px) { .rejilla { grid-template-columns: 1fr; } .ancha { grid-column: auto; } }
.tarjeta { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; min-width: 0; padding: 18px 20px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.cabeza { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cabeza h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.porque { margin-top: 2px; font-size: 13px; font-weight: 600; color: #64748B; line-height: 1.35; }
.ver { flex-shrink: 0; font-size: 14px; font-weight: 800; color: #1F6AA5; }
.ver:hover { text-decoration: underline; }

.pedidos { display: grid; gap: 8px; }
.pedido { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px; box-shadow: inset 6px 0 0 var(--t); }
.pedido:hover { border-color: var(--t-borde); background: var(--t-fondo); }
.pedido b { display: block; font-size: 16px; font-weight: 900; color: #14244A; }
.pedido small { display: block; font-size: 13px; font-weight: 600; color: #64748B; }
.cuando { display: grid; justify-items: end; gap: 2px; flex-shrink: 0; }
.chip { padding: 2px 9px; border-radius: 9px; background: var(--t); color: #fff; font-size: 12px; font-weight: 900; }

.pasos { display: grid; gap: 8px; }
.paso { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 2px solid #EEF2F6; border-radius: 14px; }
.paso:hover { border-color: var(--t-borde); background: var(--t-fondo); }
.paso b { display: block; font-size: 15px; font-weight: 800; color: #14244A; }
.paso small { font-size: 13px; font-weight: 700; color: var(--t-tinta); }
.marca { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--t-fondo); color: var(--t-hondo); flex-shrink: 0; }

.faltan { display: grid; gap: 8px; }
.falta { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 14px; background: var(--t-fondo); border: 2px solid transparent; }
.falta:hover { border-color: var(--t-borde); }
.nombre { display: block; font-size: 15px; font-weight: 800; color: #14244A; white-space: normal; overflow-wrap: anywhere; }
.datos { display: flex; flex-wrap: wrap; gap: 2px 16px; margin-top: 2px; font-size: 13px; font-weight: 600; color: var(--t-tinta); }
.datos b { font-weight: 900; }
.estado { padding: 3px 10px; border-radius: 10px; background: var(--t); color: #fff; font-size: 13px; font-weight: 900; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, .18); }
</style>
