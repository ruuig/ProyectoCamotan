<script setup>
// Iconos en SVG dentro del componente: no se agrega ninguna libreria fuera
// del stack, y al ser trazos heredan el color y el grosor del contexto.
defineProps({
  nombre: { type: String, required: true },
  tamano: { type: [Number, String], default: 20 },
  grosor: { type: [Number, String], default: 1.75 },
});

// Cada icono es una lista de elementos SVG. Trazo redondeado, caja 24x24.
const ICONOS = {
  // --- Navegacion y modulos ---
  panel: [['path', 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z']],
  cola: [
    ['path', 'M3 6h18M3 12h12M3 18h7'],
    ['circle', '19 17 2.5'],
  ],
  pacientes: [
    ['circle', '9 8 3.2'],
    ['path', 'M3.5 20a5.5 5.5 0 0 1 11 0'],
    ['path', 'M16 4.5a3 3 0 0 1 0 6M18.5 20a5.6 5.6 0 0 0-2.8-4.8'],
  ],
  inventario: [
    ['path', 'M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z'],
    ['path', 'M3 8.5 12 13l9-4.5M12 13v7'],
  ],
  dispensacion: [
    ['path', 'M10.5 3.5h3l.7 3.5h3.3l-1.2 12a2 2 0 0 1-2 1.8H9.7a2 2 0 0 1-2-1.8L6.5 7h3.3l.7-3.5Z'],
    ['path', 'M9.8 12h4.4M12 9.8v4.4'],
  ],
  consolidado: [
    ['path', 'M6 3h8l5 5v13H6V3Z'],
    ['path', 'M14 3v5h5'],
    ['path', 'M9.5 17v-3M12 17v-5.5M14.5 17v-2'],
  ],
  administracion: [
    ['circle', '12 12 3'],
    ['path', 'M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6'],
  ],
  consulta: [
    ['path', 'M7.5 4h9a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Z'],
    ['path', 'M12 8v5M9.5 10.5h5'],
  ],

  // --- Acciones ---
  buscar: [['circle', '11 11 6.5'], ['path', 'M20 20l-4.3-4.3']],
  irA: [['path', 'M9.5 5.5l6.5 6.5-6.5 6.5']],
  volver: [['path', 'M14.5 5.5L8 12l6.5 6.5']],
  agregar: [['path', 'M12 5v14M5 12h14']],
  actualizar: [
    ['path', 'M20 12a8 8 0 1 1-2.6-5.9'],
    ['path', 'M20 4v4h-4'],
  ],
  guardar: [
    ['path', 'M5 4h11l3 3v13H5V4Z'],
    ['path', 'M8 4v5h7V4M8 20v-6h8v6'],
  ],
  quitar: [
    ['path', 'M6 6l12 12M18 6L6 18'],
  ],
  salir: [
    ['path', 'M15 4h3.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H15'],
    ['path', 'M11 8l-4 4 4 4M7 12h9'],
  ],
  descargar: [
    ['path', 'M12 3.5v11'],
    ['path', 'M8 11l4 4 4-4'],
    ['path', 'M4.5 19.5h15'],
  ],
  llamar: [
    ['path', 'M4 9V6.5A1.5 1.5 0 0 1 5.5 5h3l1.5 3.5-2 1.4a11 11 0 0 0 5.1 5.1l1.4-2 3.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5A14.5 14.5 0 0 1 4 9Z'],
  ],
  ausente: [
    ['circle', '12 12 8.5'],
    ['path', 'M9 9l6 6M15 9l-6 6'],
  ],

  // --- Estado y avisos ---
  alerta: [
    ['path', 'M12 4.5 2.8 20h18.4L12 4.5Z'],
    ['path', 'M12 10v4M12 17h.01'],
  ],
  reloj: [['circle', '12 12 8.5'], ['path', 'M12 7.5V12l3 1.8']],
  correcto: [['circle', '12 12 8.5'], ['path', 'M8.3 12.2l2.6 2.6 4.8-5.2']],
  informacion: [['circle', '12 12 8.5'], ['path', 'M12 11v5M12 8h.01']],
  sinConexion: [
    ['path', 'M3 3l18 18'],
    ['path', 'M8.5 15.5a5 5 0 0 1 6.2-.9M5.4 12.3a9.5 9.5 0 0 1 4-2.2M2.5 9a14 14 0 0 1 3.4-2.2M13 6.2a14 14 0 0 1 8.5 2.8'],
    ['path', 'M12 19h.01'],
  ],
  crecimiento: [
    ['path', 'M4 19h16'],
    ['path', 'M4 15.5c3-6 5-7.5 7.5-4.5S17 10 20 5'],
  ],
  vencimiento: [
    ['path', 'M5 6h14v14H5V6Z'],
    ['path', 'M5 10h14M9 3.5v3M15 3.5v3'],
    ['path', 'M12 13v3'],
  ],
  trazabilidad: [
    ['circle', '6 6 2.2'],
    ['circle', '18 18 2.2'],
    ['path', 'M6 8.2v4.3a3.5 3.5 0 0 0 3.5 3.5H16'],
  ],
  imprimir: [['path', 'M6 9V3.5h12V9M6 17.5H4V10h16v7.5h-2'], ['path', 'M7 14h10v6.5H7z']],
  trasladar: [['path', 'M4 12h13M12 6l6 6-6 6']],
  recibir: [['path', 'M4 13v6h16v-6'], ['path', 'M12 3.5v10M8 9.5l4 4 4-4']],
  hojaCalculo: [['path', 'M5 3.5h10l4 4V20.5H5z'], ['path', 'M8 11h8M8 14.5h8M8 18h8M11.5 11v7']],
  lapiz: [['path', 'M4 20h4L19 9l-4-4L4 16v4Z'], ['path', 'M13.5 6.5l4 4']],
  cerrar: [['path', 'M6 6l12 12M18 6 6 18']],
  bloqueo: [['path', 'M6 11h12v9H6z'], ['path', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3']],
  escudo: [
    ['path', 'M12 3.5 19 6v5.5c0 4.2-2.8 7.6-7 9-4.2-1.4-7-4.8-7-9V6l7-2.5Z'],
    ['path', 'M9 12l2.2 2.2L15.2 10'],
  ],
};

function esCirculo(elemento) {
  return elemento[0] === 'circle';
}

function circulo(elemento) {
  const [cx, cy, r] = elemento[1].split(' ');
  return { cx, cy, r };
}
</script>

<template>
  <svg
    :width="tamano"
    :height="tamano"
    viewBox="0 0 24 24"
    fill="none"
    :stroke-width="grosor"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <template v-for="(elemento, i) in ICONOS[nombre] ?? []" :key="i">
      <circle v-if="esCirculo(elemento)" v-bind="circulo(elemento)" />
      <path v-else :d="elemento[1]" />
    </template>
  </svg>
</template>
