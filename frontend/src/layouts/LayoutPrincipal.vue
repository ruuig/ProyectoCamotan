<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useEstablecimientoStore } from '../stores/establecimiento';
import { useLogoStore } from '../stores/logo';
import BarraConexion from '../components/comunes/BarraConexion.vue';
import LogoInstitucional from '../components/comunes/LogoInstitucional.vue';
import Icono from '../components/comunes/Icono.vue';
import bodega from '../services/bodega';

// El estilo con relieve (styles/duo.css) vive solo dentro de la aplicación:
// el login y las hojas de impresión no pasan por este layout.
onMounted(() => document.body.classList.add('duo'));
onBeforeUnmount(() => document.body.classList.remove('duo'));

const auth = useAuthStore();
const establecimiento = useEstablecimientoStore();
const logo = useLogoStore();
logo.cargar();
const router = useRouter();
const route = useRoute();
const menuAbierto = ref(false);
// Todos los roles tienen el menú a la izquierda: bodega también, con sus tareas.
const sinMenu = computed(() => false);

// Pedidos de los servicios que esperan a bodega: el número junto a "Pedidos".
const contadores = ref({});
async function contar() {
  if (auth.rol !== 'bodega') return;
  try {
    const { requisiciones } = await bodega.requisiciones();
    contadores.value = { pedidos: requisiciones.filter((r) => ['solicitada', 'autorizada'].includes(r.estado)).length };
  } catch {
    // El menú no se detiene por un contador.
  }
}
onMounted(contar);
watch(() => route.fullPath, contar);

/**
 * Los módulos se agrupan por lo que la persona hace, no por cómo está hecho
 * el sistema. Cada grupo se separa con una línea; el título no se dibuja
 * porque la separación ya se lee, pero queda como etiqueta accesible.
 */
const GRUPOS = [
  {
    titulo: 'Atención',
    enlaces: [
      { ruta: '__panel', etiqueta: 'Panel de inicio', icono: 'panel', roles: ['admin', 'preconsulta', 'medico', 'farmacia', 'bodega'] },
      { ruta: '/cola', etiqueta: 'Cola de atención', icono: 'cola', roles: ['admin', 'preconsulta', 'medico'] },
      { ruta: '/pacientes', etiqueta: 'Pacientes', icono: 'pacientes', roles: ['admin', 'preconsulta', 'medico'] },
      // El médico revisa su propio 3C/S; dirección lo ve por responsable en Consolidados.
      { ruta: '/sigsa', etiqueta: 'Mi SIGSA 3C/S', icono: 'consolidado', roles: ['medico'] },
    ],
  },
  {
    titulo: 'Farmacia y bodega',
    enlaces: [
      // Exacto: el control de farmacia vive dentro de /dispensacion y tiene su propio enlace.
      { ruta: '/dispensacion', etiqueta: 'Dispensación', icono: 'dispensacion', roles: ['admin', 'farmacia'], exacto: true },
      // Estante, pedido a bodega, el día y el conteo: todo el inventario de farmacia en un lugar.
      { ruta: '/dispensacion/control', etiqueta: 'Estante y pedidos', icono: 'inventario', roles: ['admin', 'farmacia'] },
      { ruta: '/inventario', etiqueta: 'Bodega', icono: 'inventario', roles: ['admin'] },
    ],
  },
  // Bodega: lo del día arriba, el cierre del mes en medio, las consultas abajo.
  {
    titulo: 'Bodega',
    enlaces: [
      { ruta: '/inventario/requisiciones', etiqueta: 'Pedidos', icono: 'trasladar', roles: ['bodega'], contador: 'pedidos' },
      { ruta: '/inventario/recibir', etiqueta: 'Recibir', icono: 'recibir', roles: ['bodega'] },
      { ruta: '/inventario/productos', etiqueta: 'Existencias', icono: 'inventario', roles: ['bodega'] },
      { ruta: '/inventario/semaforo', etiqueta: 'Semáforo', icono: 'vencimiento', roles: ['bodega'] },
    ],
  },
  {
    titulo: 'Cierre del mes',
    enlaces: [
      { ruta: '/inventario/informes', etiqueta: 'Informes de servicios', icono: 'consolidado', roles: ['bodega'] },
      { ruta: '/inventario/bres', etiqueta: 'BRES', icono: 'hojaCalculo', roles: ['bodega'] },
      { ruta: '/inventario/cierre', etiqueta: 'Inventario de cierre', icono: 'correcto', roles: ['bodega'] },
    ],
  },
  {
    titulo: 'Consultas',
    enlaces: [
      { ruta: '/inventario/kardex', etiqueta: 'Kardex', icono: 'hojaCalculo', roles: ['bodega'] },
      { ruta: '/inventario/trazabilidad', etiqueta: 'Trazabilidad', icono: 'trazabilidad', roles: ['bodega'] },
      { ruta: '/inventario/bajas', etiqueta: 'Bajas y retiros', icono: 'quitar', roles: ['bodega'] },
    ],
  },
  {
    titulo: 'Dirección',
    enlaces: [
      { ruta: '/consolidado', etiqueta: 'Consolidados', icono: 'consolidado', roles: ['admin'] },
      { ruta: '/administracion', etiqueta: 'Administración', icono: 'administracion', roles: ['admin'] },
    ],
  },
];

// El panel de inicio depende del rol, por eso se resuelve aquí y no arriba.
const gruposVisibles = computed(() =>
  GRUPOS.map((g) => ({
    ...g,
    enlaces: g.enlaces
      .filter((e) => e.roles.includes(auth.rol))
      .map((e) => ({ ...e, ruta: e.ruta === '__panel' ? auth.rutaPanel : e.ruta })),
  })).filter((g) => g.enlaces.length > 0),
);

const ETIQUETA_ROL = {
  admin: 'Dirección',
  preconsulta: 'Preconsulta',
  medico: 'Médico',
  farmacia: 'Farmacia',
  bodega: 'Bodega',
};

const iniciales = computed(() =>
  (auth.usuario?.nombre ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join(''),
);

// En español el día de la semana y el mes van en minúscula: "lunes, 28 de
// septiembre de 2026". Por eso no se capitaliza.
const FORMATO_FECHA = new Intl.DateTimeFormat('es-GT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const hoy = computed(() => FORMATO_FECHA.format(new Date()));

async function salir() {
  await auth.cerrarSesion();
  establecimiento.limpiar();
  router.push('/login');
}

onMounted(() => establecimiento.cargar());
</script>

<template>
  <div class="min-h-screen bg-fondo">
    <!--
      Barra lateral fija de 248 px. Arriba la marca del establecimiento y
      debajo la navegación, agrupada y separada con líneas.
    -->
    <aside
      v-if="!sinMenu"
      class="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-linea
             bg-superficie panel:flex"
      aria-label="Módulos del sistema"
    >
      <RouterLink :to="auth.rutaPanel" class="marca-lateral">
        <img :src="logo.horizontal" alt="Ministerio de Salud Pública y Asistencia Social" class="marca-logo" />
        <span class="marca-centro">
          <strong>{{ establecimiento.nombre || 'Centro de Salud' }}</strong>
          <span v-if="establecimiento.ubicacion"><Icono nombre="ubicacion" :tamano="14" /> {{ establecimiento.ubicacion }}</span>
        </span>
      </RouterLink>

      <nav class="flex-1 overflow-y-auto px-3 pb-4">
        <div
          v-for="(grupo, i) in gruposVisibles"
          :key="grupo.titulo"
          class="py-3"
          :class="i > 0 ? 'border-t border-linea' : ''"
          role="group"
          :aria-label="grupo.titulo"
        >
          <RouterLink
            v-for="enlace in grupo.enlaces"
            :key="enlace.ruta"
            :to="enlace.ruta"
            class="menu-enlace mb-1 flex min-h-tocable items-center gap-3 px-3 py-2.5 transition-colors"
            :active-class="enlace.exacto ? '' : 'menu-activo'"
            exact-active-class="menu-activo"
          >
            <Icono :nombre="enlace.icono" :tamano="20" class="shrink-0" />
            <span class="truncate">{{ enlace.etiqueta }}</span>
            <span v-if="enlace.contador && contadores[enlace.contador]" class="contador-menu">{{ contadores[enlace.contador] }}</span>
          </RouterLink>
        </div>
      </nav>
    </aside>

    <!-- Menú desplegable en pantalla angosta: la barra fija no cabe -->
    <div
      v-if="menuAbierto"
      class="fixed inset-0 z-40 bg-tinta/40 panel:hidden"
      @click="menuAbierto = false"
    />
    <aside
      v-if="menuAbierto"
      class="fixed inset-y-0 left-0 z-50 w-[248px] overflow-y-auto border-r border-linea
             bg-superficie panel:hidden"
      aria-label="Módulos del sistema"
    >
      <div class="marca-lateral">
        <img :src="logo.horizontal" alt="Ministerio de Salud Pública y Asistencia Social" class="marca-logo" />
        <span class="marca-centro">
          <strong>{{ establecimiento.nombre || 'Centro de Salud' }}</strong>
          <span v-if="establecimiento.ubicacion"><Icono nombre="ubicacion" :tamano="14" /> {{ establecimiento.ubicacion }}</span>
        </span>
      </div>

      <nav class="px-3 pb-4">
        <div
          v-for="(grupo, i) in gruposVisibles"
          :key="grupo.titulo"
          class="py-3"
          :class="i > 0 ? 'border-t border-linea' : ''"
          role="group"
          :aria-label="grupo.titulo"
        >
          <RouterLink
            v-for="enlace in grupo.enlaces"
            :key="enlace.ruta"
            :to="enlace.ruta"
            class="menu-enlace mb-1 flex min-h-tocable items-center gap-3 px-3 py-2.5 transition-colors"
            :active-class="enlace.exacto ? '' : 'menu-activo'"
            exact-active-class="menu-activo"
            @click="menuAbierto = false"
          >
            <Icono :nombre="enlace.icono" :tamano="20" class="shrink-0" />
            <span class="truncate">{{ enlace.etiqueta }}</span>
            <span v-if="enlace.contador && contadores[enlace.contador]" class="contador-menu">{{ contadores[enlace.contador] }}</span>
          </RouterLink>
        </div>
      </nav>
    </aside>

    <div :class="sinMenu ? '' : 'panel:pl-[248px]'">
      <!-- Barra superior: la fecha de hoy y quién está operando -->
      <header
        class="sticky top-0 z-30 flex h-[72px] items-center justify-between gap-4
               border-b border-linea bg-superficie px-5 lg:px-8"
      >
        <div class="flex min-w-0 items-center gap-3">
          <template v-if="sinMenu">
            <LogoInstitucional orientacion="vertical" :alto="40" />
            <span class="min-w-0 border-r border-linea pr-4">
              <span class="block font-titulo text-sm font-medium leading-tight text-tinta">{{ establecimiento.nombre || 'Centro de Salud' }}</span>
              <span class="block truncate text-xs text-apagado">{{ establecimiento.ubicacion }}</span>
            </span>
          </template>
          <button
            v-else
            type="button"
            class="rounded-control border border-linea p-2.5 text-tinta-2 panel:hidden"
            aria-label="Abrir menú"
            @click="menuAbierto = true"
          >
            <Icono nombre="cola" :tamano="20" />
          </button>
          <p class="truncate text-apagado">{{ hoy }}</p>
        </div>

        <div class="flex shrink-0 items-center gap-3">
          <div class="hidden text-right sm:block">
            <p class="font-bold leading-tight text-tinta">{{ auth.usuario?.nombre }}</p>
            <p class="text-sm text-apagado">{{ ETIQUETA_ROL[auth.rol] ?? auth.rol }}</p>
          </div>
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marino
                   font-titulo font-bold text-superficie"
          >
            {{ iniciales }}
          </div>
          <button
            type="button"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            class="flex h-11 w-11 items-center justify-center rounded-control border border-linea
                   text-apagado transition hover:border-marino-apagado hover:text-tinta"
            @click="salir"
          >
            <Icono nombre="salir" :tamano="19" />
          </button>
        </div>
      </header>

      <BarraConexion />

      <main class="px-5 py-bloque lg:px-8">
        <RouterView :key="route.path" />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* Marca de la barra lateral: el logo del Ministerio completo y, debajo, el
   centro con su ubicación. */
.marca-lateral { display: block; padding: 18px 16px 14px; border-bottom: 2px solid #E2E8F0; }
.marca-logo { display: block; width: 100%; max-width: 200px; height: auto; }
.marca-centro { display: block; margin-top: 12px; padding-top: 10px; border-top: 2px dashed #E2E8F0; }
.marca-centro strong { display: block; font-size: 15px; font-weight: 800; line-height: 1.2; color: #14244A; }
.marca-centro span { display: flex; align-items: center; gap: 4px; margin-top: 3px; font-size: 13px; font-weight: 600; color: #64748B; }
.marca-centro svg { flex-shrink: 0; color: #4A9BD6; }
.contador-menu { margin-left: auto; min-width: 24px; padding: 1px 8px; border-radius: 9px; background: #D64545; color: #fff; font-size: 13px; font-weight: 900; text-align: center; }
</style>
