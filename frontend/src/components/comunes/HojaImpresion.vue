<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import LogoInstitucional from './LogoInstitucional.vue';

/**
 * Marco comun de todo documento que se imprime.
 *
 * Pone el membrete institucional, el título, las firmas y, en los documentos de
 * pacientes, la leyenda de confidencialidad. Quién imprimió y cuándo queda en
 * la bitácora, no en el papel. Lo que cambia entre documentos va en el slot.
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

onMounted(() => {
  // Se deja un respiro para que las imágenes y las fuentes terminen de cargar
  // antes de abrir el diálogo del navegador.
  if (props.imprimirAlAbrir) setTimeout(() => window.print(), 600);
});
</script>

<template>
  <div class="hoja-impresion mx-auto bg-white text-slate-900">
    <!--
      La hoja se imprime sin márgenes de página (así el navegador no agrega el
      enlace, la fecha ni el título). El margen lo dan estas filas vacías, que
      el navegador repite al principio y al final de cada página.
    -->
    <table class="marco-impresion">
      <thead><tr><td><div class="margen-hoja" /></td></tr></thead>
      <tfoot><tr><td><div class="margen-hoja" /></td></tr></tfoot>
      <tbody><tr><td>
        <!-- Membrete institucional -->
        <header class="membrete bloque-impresion">
          <LogoInstitucional orientacion="vertical" :alto="62" />
          <div class="membrete-texto">
            <p class="membrete-ministerio">Ministerio de Salud Pública y Asistencia Social</p>
            <p>Dirección Departamental de Redes Integradas de Servicios de Salud de {{ establecimiento?.departamento ?? 'Chiquimula' }}</p>
            <p v-if="establecimiento">{{ establecimiento.nombre }}<template v-if="establecimiento.municipio">, {{ establecimiento.municipio }}</template></p>
          </div>
        </header>
        <h1 class="titulo-documento">{{ titulo }}</h1>

        <main><slot /></main>

        <!-- Firmas: el documento en papel no vale sin ellas -->
        <section
          v-if="firmas.length > 0"
          class="firmas-documento bloque-impresion"
          :class="firmas.length === 3 ? 'tres' : ''"
        >
          <div v-for="(f, i) in firmas" :key="i" class="firma-documento">
            <!-- Con nombre fijo (firmas de bodega): nombre y debajo el cargo -->
            <template v-if="f.nombre">
              <p class="font-semibold">{{ f.nombre }}</p>
              <p>{{ f.etiqueta }}</p>
            </template>
            <template v-else>
              <p v-if="f.conNombre" class="font-semibold">{{ auth.usuario?.nombre }}</p>
              <p>{{ f.etiqueta }}<template v-if="f.conNombre && auth.usuario?.cargo"> · {{ auth.usuario.cargo }}</template></p>
            </template>
          </div>
        </section>

        <footer v-if="confidencial || $slots.pie" class="pie-documento">
          <p v-if="confidencial">Documento confidencial. Uso exclusivo del servicio de salud.</p>
          <slot name="pie" />
        </footer>
      </td></tr></tbody>
    </table>

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
