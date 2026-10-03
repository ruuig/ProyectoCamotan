<script setup>
import { computed } from 'vue';
import Icono from './Icono.vue';
import GraficaBarras from './GraficaBarras.vue';
import EstadoVacio from './EstadoVacio.vue';

/**
 * Alertas abiertas del establecimiento.
 *
 * Una lista plana de siete avisos sueltos no deja ver qué está pasando. Aquí
 * se muestran primero en proporción (cuántas de cada tipo), luego agrupadas
 * por tipo, y cada grupo dice con qué regla se genera: sin eso, "Patrón
 * clínico" no significa nada para quien lee el panel.
 *
 * Ninguna se marca a mano como resuelta. Las de inventario y cobertura se
 * cierran solas cuando su causa desaparece; las clínicas se cierran cuando el
 * paciente vuelve o la medición mejora. Lo único que se registra aquí es que
 * alguien ya actuó.
 */
const props = defineProps({
  alertas: { type: Array, required: true },
});

// El orden es el de urgencia con que conviene mirarlas, no alfabético.
const TIPOS = [
  {
    clave: 'existencia_baja',
    etiqueta: 'Existencia',
    icono: 'inventario',
    regla: 'Un insumo se queda sin existencia, baja del mínimo definido, o le '
      + 'quedan menos de 15 días de cobertura al ritmo de consumo actual.',
  },
  {
    clave: 'vencimiento',
    etiqueta: 'Vencimiento',
    icono: 'vencimiento',
    regla: 'Un lote con existencia entra en su ventana de vencimiento. El aviso '
      + 'incluye cuánto sobraría sin usar, para poder redistribuirlo a tiempo.',
  },
  {
    clave: 'comunidad_sin_atencion',
    etiqueta: 'Cobertura territorial',
    icono: 'trazabilidad',
    regla: 'Una comunidad con pacientes inscritos lleva más de 30 días sin que '
      + 'se registre una atención, o nunca ha registrado ninguna.',
  },
  {
    clave: 'desnutricion',
    etiqueta: 'Desnutrición',
    icono: 'crecimiento',
    regla: 'La última medición de un paciente dio desnutrición aguda y no hay '
      + 'una medición posterior. Avisa además si lleva más de 30 días sin control.',
  },
  {
    clave: 'cita_vencida',
    etiqueta: 'Cita vencida',
    icono: 'reloj',
    regla: 'Pasó la fecha de la próxima cita y el paciente no ha vuelto al '
      + 'establecimiento.',
  },
  {
    clave: 'patron_clinico',
    etiqueta: 'Patrón clínico',
    icono: 'consulta',
    regla: 'Un mismo paciente repite el mismo diagnóstico CIE-10 varias veces '
      + 'dentro de 60 días.',
  },
];

const ORDEN_SEVERIDAD = { alta: 0, media: 1, baja: 2 };

const SEVERIDAD = {
  alta: { texto: 'Alta', punto: 'bg-empeora', color: 'text-empeora' },
  media: { texto: 'Media', punto: 'bg-advertencia-marca', color: 'text-advertencia' },
  baja: { texto: 'Baja', punto: 'bg-marino-apagado', color: 'text-apagado' },
};

const grupos = computed(() =>
  TIPOS.map((tipo) => ({
    ...tipo,
    // Dentro del grupo, primero lo que más urge.
    alertas: props.alertas
      .filter((a) => a.tipo === tipo.clave)
      .sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad]),
  })).filter((g) => g.alertas.length > 0),
);

// Solo se grafican los tipos que tienen alertas: una barra en cero no informa.
const porTipo = computed(() =>
  grupos.value.map((g) => ({ etiqueta: g.etiqueta, total: g.alertas.length })),
);

const tipoMasAlto = computed(() => {
  let mejor = null;
  porTipo.value.forEach((t, i) => {
    if (mejor === null || t.total > porTipo.value[mejor].total) mejor = i;
  });
  return mejor;
});

const porSeveridad = computed(() => {
  const cuenta = { alta: 0, media: 0, baja: 0 };
  for (const a of props.alertas) cuenta[a.severidad] = (cuenta[a.severidad] ?? 0) + 1;
  return cuenta;
});

function severidadDe(alerta) {
  return SEVERIDAD[alerta.severidad] ?? SEVERIDAD.baja;
}

const BORDE_SEVERIDAD = {
  alta: 'border-l-empeora',
  media: 'border-l-advertencia-marca',
  baja: 'border-l-marino-apagado',
};

/** Quién puso la alerta en gestión y cuándo. */
function gestionDe(alerta) {
  if (alerta.estado !== 'en_gestion' || !alerta.estadoEn) return null;
  const cuando = new Date(alerta.estadoEn).toLocaleDateString('es-GT');
  return alerta.usuario?.nombre
    ? `En gestión por ${alerta.usuario.nombre} desde el ${cuando}`
    : `En gestión desde el ${cuando}`;
}
</script>

<template>
  <div class="panel">
    <div class="border-b border-linea px-relleno py-4">
      <h2 class="panel-titulo">
        <Icono nombre="alerta" :tamano="20" class="text-apagado" />
        Alertas abiertas ({{ alertas.length }})
      </h2>
    </div>

    <EstadoVacio
      v-if="alertas.length === 0"
      icono="correcto"
      titulo="Sin alertas abiertas"
      descripcion="Nada requiere atención en este momento."
    />

    <template v-else>
      <!-- Proporción: de qué es lo que más hay -->
      <div class="grid gap-5 border-b border-linea p-relleno panel:grid-cols-3">
        <div class="panel:col-span-2">
          <p class="mb-3 text-etiqueta font-bold uppercase tracking-wide text-apagado">Por tipo</p>
          <GraficaBarras
            :datos="porTipo"
            :destacado="tipoMasAlto"
            unidad="alertas"
            preposicion="de"
            descripcion-destacado="el tipo con más avisos abiertos"
            :alto="Math.max(140, porTipo.length * 46)"
            horizontal
          />
        </div>

        <div>
          <p class="mb-3 text-etiqueta font-bold uppercase tracking-wide text-apagado">
            Por severidad
          </p>
          <ul class="space-y-2.5">
            <li
              v-for="(nivel, clave) in SEVERIDAD"
              :key="clave"
              class="flex items-center justify-between gap-3 border-l-4 bg-fondo px-4 py-2.5"
              :class="BORDE_SEVERIDAD[clave]"
            >
              <span class="text-tinta-2">{{ nivel.texto }}</span>
              <span class="font-titulo text-xl font-bold tabular-nums text-tinta">
                {{ porSeveridad[clave] }}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Agrupadas por tipo, con la regla que las genera -->
      <section
        v-for="grupo in grupos"
        :key="grupo.clave"
        class="border-b border-linea last:border-b-0"
      >
        <header class="bg-fondo px-relleno py-3.5">
          <h3 class="flex items-center gap-2 font-titulo font-medium text-tinta">
            <Icono :nombre="grupo.icono" :tamano="19" class="text-apagado" />
            {{ grupo.etiqueta }} ({{ grupo.alertas.length }})
          </h3>
          <p class="mt-1 text-sm text-apagado">{{ grupo.regla }}</p>
        </header>

        <ul class="lista">
          <li
            v-for="a in grupo.alertas"
            :key="a.id"
            class="flex flex-wrap items-center justify-between gap-3 px-relleno py-3.5"
          >
            <div class="min-w-0">
              <p class="text-tinta-2">{{ a.mensaje }}</p>
              <!-- Única señal de color de la fila: qué tan urgente es -->
              <p class="mt-0.5 flex items-center gap-2 text-sm" :class="severidadDe(a).color">
                <span class="h-2 w-2 shrink-0 rounded-full" :class="severidadDe(a).punto" />
                Severidad {{ severidadDe(a).texto.toLowerCase() }}
              </p>
              <p v-if="gestionDe(a)" class="mt-0.5 text-sm font-bold text-mejora">
                {{ gestionDe(a) }}
              </p>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
