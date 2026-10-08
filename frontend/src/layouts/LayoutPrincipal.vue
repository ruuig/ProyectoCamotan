<script setup>
import { computed, ref, onMounted } from 'vue';
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useEstablecimientoStore } from '../stores/establecimiento';
import BarraConexion from '../components/comunes/BarraConexion.vue';
import LogoInstitucional from '../components/comunes/LogoInstitucional.vue';
import Icono from '../components/comunes/Icono.vue';

const auth = useAuthStore();
const establecimiento = useEstablecimientoStore();
const router = useRouter();
const route = useRoute();
const menuAbierto = ref(false);
// Bodega trabaja en un solo módulo: su pantalla ocupa todo el ancho, sin menú.
const sinMenu = computed(() => auth.rol === 'bodega');

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
      { ruta: '/sigsa', etiqueta: 'SIGSA 3CS', icono: 'consolidado', roles: ['admin', 'medico'] },
    ],
  },
  {
    titulo: 'Farmacia y bodega',
    enlaces: [
      // Exacto: el control de farmacia vive dentro de /dispensacion y tiene su propio enlace.
      { ruta: '/dispensacion', etiqueta: 'Dispensación', icono: 'dispensacion', roles: ['admin', 'farmacia'], exacto: true },
      { ruta: '/dispensacion/control', etiqueta: 'Control de farmacia', icono: 'inventario', roles: ['admin', 'farmacia'] },
      // Farmacia pide a bodega con requisición, como los demás servicios.
      { ruta: '/inventario/requisiciones', etiqueta: 'Requisiciones', icono: 'trasladar', roles: ['farmacia'] },
      { ruta: '/inventario', etiqueta: 'Bodega', icono: 'inventario', roles: ['admin', 'bodega'] },
    ],
  },
  {
    titulo: 'Dirección',
    enlaces: [
      { ruta: '/consolidado', etiqueta: 'Consolidado', icono: 'consolidado', roles: ['admin'] },
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
      <RouterLink :to="auth.rutaPanel" class="flex min-h-[72px] items-center gap-3 border-b border-linea px-5 py-3">
        <LogoInstitucional orientacion="vertical" :alto="40" />
        <span class="min-w-0">
          <span class="block font-titulo text-sm font-medium leading-tight text-tinta">
            {{ establecimiento.nombre || 'Centro de Salud' }}
          </span>
          <span class="mt-0.5 block truncate text-xs text-apagado">
            {{ establecimiento.ubicacion }}
          </span>
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
            class="mb-1 flex min-h-tocable items-center gap-3 rounded-control px-3 py-2.5
                   text-tinta-2 transition-colors hover:bg-linea-suave hover:text-tinta"
            :active-class="enlace.exacto ? '' : '!bg-marino !font-bold !text-superficie'"
            exact-active-class="!bg-marino !font-bold !text-superficie"
          >
            <Icono :nombre="enlace.icono" :tamano="20" class="shrink-0" />
            <span class="truncate">{{ enlace.etiqueta }}</span>
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
      <div class="flex min-h-[72px] items-center gap-3 border-b border-linea px-5 py-3">
        <LogoInstitucional orientacion="vertical" :alto="40" />
        <span class="min-w-0">
          <span class="block font-titulo text-sm font-medium leading-tight text-tinta">
            {{ establecimiento.nombre || 'Centro de Salud' }}
          </span>
          <span class="mt-0.5 block truncate text-xs text-apagado">
            {{ establecimiento.ubicacion }}
          </span>
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
            class="mb-1 flex min-h-tocable items-center gap-3 rounded-control px-3 py-2.5
                   text-tinta-2 transition-colors hover:bg-linea-suave hover:text-tinta"
            :active-class="enlace.exacto ? '' : '!bg-marino !font-bold !text-superficie'"
            exact-active-class="!bg-marino !font-bold !text-superficie"
            @click="menuAbierto = false"
          >
            <Icono :nombre="enlace.icono" :tamano="20" class="shrink-0" />
            <span class="truncate">{{ enlace.etiqueta }}</span>
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
