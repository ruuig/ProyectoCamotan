<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import servicio from '../../services/inventario';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import HorarioDibujo from '../../components/farmacia/HorarioDibujo.vue';
import { orientacionPara } from '../../dominio/orientacion';
import { establecimiento as cargarEstablecimiento, registrarImpresion } from '../../dominio/impresionBodega';

/**
 * Receta para el paciente: qué se le entregó, cómo y cuándo tomarlo, y qué
 * tiene que comprar fuera. Letra grande para leerla en casa. Lleva el lote
 * de lo entregado: si hay un retiro sanitario, el paciente lo tiene a mano.
 */
const route = useRoute();
const h = ref(null);
const est = ref(null);
const error = ref('');

onMounted(async () => {
  try {
    est.value = await cargarEstablecimiento();
    h.value = await servicio.hojaDeEntrega(route.params.id);
    registrarImpresion('receta_paciente', String(route.params.id), false);
  } catch (fallo) {
    error.value = fallo.message;
  }
});

const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const vence = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '');
function edad(e) {
  if (!e) return '';
  if (e.anios > 0) return `${e.anios} ${e.anios === 1 ? 'año' : 'años'}`;
  if (e.meses > 0) return `${e.meses} ${e.meses === 1 ? 'mes' : 'meses'}`;
  return `${e.dias} días`;
}
const renglones = computed(() => h.value?.renglones ?? []);
const orientacion = computed(() => (h.value ? orientacionPara([h.value.diagnosticoCie, ...h.value.diagnosticos.map((d) => d.cie)]) : []));
const fechaCita = (v) => (v ? new Date(v).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
</script>

<template>
  <p v-if="error" class="m-8 font-bold text-red-700">{{ error }}</p>
  <HojaImpresion
    v-if="h"
    titulo="Receta e indicaciones"
    :establecimiento="est"
    :firmas="[{ etiqueta: 'Entregó (farmacia)', conNombre: true }]"
    imprimir-al-abrir
  >
    <table class="bloque-impresion receta-datos">
      <tbody>
        <tr>
          <th>Paciente</th><td class="fuerte">{{ h.paciente.nombreCompleto }}</td>
          <th>Fecha</th><td>{{ fecha(h.fecha) }}</td>
        </tr>
        <tr>
          <th>Edad</th><td>{{ edad(h.paciente.edad) }}</td>
          <th>Expediente</th><td>{{ h.paciente.expedientePapel || h.paciente.expediente }}</td>
        </tr>
        <tr>
          <th>Médico</th><td colspan="3">{{ h.medico?.nombre ?? '—' }}</td>
        </tr>
      </tbody>
    </table>

    <h2 class="receta-titulo">Sus medicamentos</h2>
    <ol class="receta-lista">
      <li v-for="(r, i) in renglones" :key="r.prescripcionId" class="bloque-impresion">
        <span class="num">{{ i + 1 }}</span>
        <div class="flex-1">
          <p class="med">{{ r.medicamento }}</p>
          <p class="como">{{ r.indicaciones || 'Como le indicó el médico' }}</p>
          <HorarioDibujo v-if="r.indicaciones && !r.aplicada" :indicaciones="r.indicaciones" impreso class="mt-1.5" />
          <p v-if="r.aplicada" class="detalle"><b>Se le aplicó en el centro.</b></p>
          <p class="detalle">
            <template v-if="r.entregado">Se le entregaron <b>{{ r.entregado }}</b><template v-if="r.entregas?.length"> · lote {{ r.entregas.map((l) => `${l.numeroLote} (vence ${vence(l.fechaVence)})`).join(', ') }}</template></template>
            <template v-if="r.noHabia"><b class="falta"> · No había {{ r.noHabia }} en el centro</b></template>
          </p>
        </div>
      </li>
    </ol>

    <template v-if="h.recetasExternas.length">
      <h2 class="receta-titulo">Para comprar fuera del centro</h2>
      <ol class="receta-lista">
        <li v-for="(x, i) in h.recetasExternas" :key="i" class="bloque-impresion">
          <span class="num externo">{{ i + 1 }}</span>
          <div class="flex-1">
            <p class="med">{{ x.medicamento }}<template v-if="x.cantidad"> · {{ x.cantidad }}</template></p>
            <p class="como">{{ x.indicaciones || 'Como le indicó el médico' }}</p>
          </div>
        </li>
      </ol>
    </template>

    <div class="bloque-impresion salida">
      <div class="cita">
        <span>Próxima cita</span>
        <b class="first-letter:uppercase">{{ h.proximaCita ? fechaCita(h.proximaCita) : 'Solo si empeora o no mejora' }}</b>
      </div>
      <div class="alarma">
        <span>Regrese de inmediato si…</span>
        <template v-for="g in orientacion" :key="g.clave">
          <ul><li v-for="x in g.signos" :key="x">{{ x }}</li></ul>
          <p v-if="g.consejo" class="consejo">{{ g.consejo }}</p>
        </template>
      </div>
    </div>

    <p class="bloque-impresion receta-aviso">Tome los medicamentos completos aunque se sienta mejor.</p>
  </HojaImpresion>
</template>

<style scoped>
.receta-datos { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 14px; }
.receta-datos th { width: 90px; padding: 4px 6px; text-align: left; font-weight: 700; color: #334155; border: 1px solid #94A3B8; background: #F1F5F9; }
.receta-datos td { padding: 4px 8px; border: 1px solid #94A3B8; }
.receta-datos .fuerte { font-weight: 700; font-size: 15px; }
.receta-titulo { margin: 14px 0 6px; font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.receta-lista { display: grid; gap: 8px; }
.receta-lista li { display: flex; gap: 12px; align-items: flex-start; padding: 8px 10px; border: 1.5px solid #334155; border-radius: 6px; }
.num { display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #111827; color: #fff; font-weight: 800; }
.num.externo { background: #fff; color: #111827; border: 2px solid #111827; }
.med { font-size: 16px; font-weight: 800; }
.como { margin-top: 2px; font-size: 18px; font-weight: 600; line-height: 1.3; }
.detalle { margin-top: 3px; font-size: 12px; color: #334155; }
.falta { color: #991B1B; }
.salida { display: grid; grid-template-columns: 34% 1fr; gap: 10px; margin-top: 14px; }
.salida > div { padding: 8px 10px; border: 2px solid #111827; border-radius: 6px; }
.salida span { display: block; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.cita b { display: block; margin-top: 4px; font-size: 18px; font-weight: 900; line-height: 1.2; }
.alarma ul { margin-top: 4px; padding-left: 18px; list-style: disc; font-size: 14px; font-weight: 600; }
.consejo { margin-top: 4px; font-size: 13px; font-weight: 700; }
.receta-aviso { margin-top: 14px; padding: 8px 10px; border: 1.5px dashed #334155; border-radius: 6px; font-size: 13px; font-weight: 600; }
</style>
