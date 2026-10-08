<script setup>
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import LogoInstitucional from './LogoInstitucional.vue';

/**
 * Marco comun de todo documento que se imprime.
 *
 * Pone el encabezado institucional, el pie con la constancia de impresion y la
 * leyenda de confidencialidad. Lo que cambia entre documentos va en el slot.
 */
const props = defineProps({
  titulo: { type: String, required: true },
  establecimiento: { type: Object, default: null },
  // Quien imprime y cuando: la ficha en papel debe poder rastrearse.
  imprimirAlAbrir: { type: Boolean, default: false },
  // Quien firma cambia segun el documento: una ficha clinica la firma el
  // paciente, y un informe de bodega no. Sin esto, el BRES salia pidiendo la
  // huella de un paciente que no existe.
  // Los documentos de pacientes son confidenciales; los de bodega no.
  confidencial: { type: Boolean, default: true },
  firmas: {
    type: Array,
    default: () => [
      { etiqueta: 'Firma y sello del proveedor', conNombre: true },
      { etiqueta: 'Firma o huella del paciente o responsable' },
    ],
  },
});

const auth = useAuthStore();
const router = useRouter();

function imprimir() {
  window.print();
}

// Las hojas se abren en una pestaña nueva: sin historial, se cierra la pestaña.
function volver() {
  if (window.history.length > 1) router.back();
  else window.close();
}

const impresoEn = computed(() =>
  new Intl.DateTimeFormat('es-GT', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date()),
);

onMounted(() => {
  // Se deja un respiro para que las imágenes y las fuentes terminen de cargar
  // antes de abrir el diálogo del navegador.
  if (props.imprimirAlAbrir) setTimeout(() => window.print(), 600);
});
</script>

<template>
  <div class="hoja-impresion mx-auto max-w-[8.5in] bg-white p-8 text-slate-900">
    <!-- Encabezado institucional -->
    <header class="encabezado-impresion bloque-impresion mb-4 border-b-2 border-slate-900 pb-3">
      <div class="flex items-start gap-4">
        <LogoInstitucional orientacion="vertical" :alto="70" />
        <div class="flex-1">
          <p class="font-semibold">Ministerio de Salud Pública y Asistencia Social</p>
          <h1 class="text-lg font-bold">{{ titulo }}</h1>
          <p v-if="establecimiento" class="text-sm">
            {{ establecimiento.nombre }}
            <span v-if="establecimiento.municipio">
              &middot; {{ establecimiento.municipio }}, {{ establecimiento.departamento }}
            </span>
          </p>
          <p class="text-sm">
            Área de Salud: {{ establecimiento?.departamento ?? '____________' }}
            &middot; Distrito: {{ establecimiento?.municipio ?? '____________' }}
          </p>
        </div>
      </div>
    </header>

    <main><slot /></main>

    <!-- Firmas: el documento en papel no vale sin ellas -->
    <section
      v-if="firmas.length > 0"
      class="bloque-impresion mt-8 grid gap-8"
      :class="firmas.length === 3 ? 'grid-cols-3' : 'grid-cols-2'"
    >
      <div v-for="(f, i) in firmas" :key="i" class="border-t border-slate-900 pt-1 text-sm">
        <!-- Con nombre fijo (firmas de bodega): nombre y debajo el cargo -->
        <template v-if="f.nombre">
          <p class="font-semibold">{{ f.nombre }}</p>
          <p>{{ f.etiqueta }}</p>
        </template>
        <template v-else>
          <p>{{ f.etiqueta }}</p>
          <p v-if="f.conNombre">{{ auth.usuario?.nombre }}<template v-if="auth.usuario?.cargo">, {{ auth.usuario.cargo }}</template></p>
        </template>
      </div>
    </section>

    <!-- Pie con la constancia de impresión -->
    <footer class="pie-impresion mt-6 border-t border-slate-400 pt-2 text-xs">
      <p v-if="confidencial" class="font-semibold">Documento confidencial</p>
      <p>
        Impreso el {{ impresoEn }} por {{ auth.usuario?.nombre }}
        ({{ auth.rol }}).
      </p>
      <slot name="pie" />
    </footer>

    <!-- Controles: no salen en el papel -->
    <div class="no-imprimir mt-6 flex gap-3 border-t border-slate-200 pt-4">
      <button type="button" class="boton-primario" @click="imprimir">
        Imprimir
      </button>
      <button type="button" class="boton-secundario" @click="volver">
        Volver
      </button>
    </div>
  </div>
</template>
