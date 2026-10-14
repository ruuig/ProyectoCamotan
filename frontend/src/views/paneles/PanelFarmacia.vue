<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import servicio from '../../services/indicadores';
import TarjetaDato from '../../components/comunes/TarjetaDato.vue';
import Icono from '../../components/comunes/Icono.vue';
import Etiqueta from '../../components/comunes/Etiqueta.vue';
import EstadoVacio from '../../components/comunes/EstadoVacio.vue';

const auth = useAuthStore();
// Farmacia consulta existencias pero la ficha del insumo es de bodega.
const veBodega = computed(() => auth.rol !== 'farmacia');
const datos = ref(null);
const error = ref('');

const TONO_SEMAFORO = { rojo: 'urgente', amarillo: 'atencion', verde: 'estable' };

function fecha(v) {
  return v ? new Date(v).toLocaleDateString('es-GT') : '';
}

// Cuenta total de cosas que exigen accion: el numero que decide si hay que
// hacer algo hoy o no.
const totalAccion = computed(() => {
  if (!datos.value) return 0;
  return datos.value.requierenAccion.insumos.length + datos.value.requierenAccion.lotes.length;
});

async function cargar() {
  try {
    datos.value = await servicio.panel(auth.rol === 'bodega' ? 'bodega' : 'farmacia');
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargar);
</script>

<template>
  <section v-if="datos" class="space-y-6">
    <div>
      <h1 class="titulo-pagina">Farmacia</h1>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <TarjetaDato
        etiqueta="Requieren acción"
        :valor="totalAccion"
        icono="alerta"
        :alerta="totalAccion > 0"
        :nota="totalAccion === 0 ? 'Nada pendiente' : 'Insumos y lotes por revisar'"
      />
      <TarjetaDato
        etiqueta="Recetas por entregar"
        :valor="datos.prescripcionesPendientes.length"
        icono="dispensacion"
      />
      <TarjetaDato
        etiqueta="Diferencia del mes"
        :valor="datos.diferenciasDelMes.diferenciaNeta"
        icono="inventario"
        :alerta="datos.diferenciasDelMes.diferenciaNeta < 0"
        :nota="datos.diferenciasDelMes.mayorDiscrepancia
          ? `Mayor: ${datos.diferenciasDelMes.mayorDiscrepancia.insumo.nombreGenerico}`
          : `${datos.diferenciasDelMes.totalAjustes} ajuste(s)`"
      />
    </div>

    <!-- Requieren accion -->
    <div class="panel">
      <div class="panel-encabezado">
        <h2 class="panel-titulo">
          <Icono nombre="alerta" :tamano="20" class="text-celeste-400" />
          Requieren acción
        </h2>
      </div>

      <EstadoVacio
        v-if="totalAccion === 0"
        icono="correcto"
        titulo="Todo en orden"
        descripcion="Ningun insumo por agotarse ni lote próximo a vencer."
      />

      <div v-else class="lista">
        <!-- Insumos por agotarse -->
        <div v-if="datos.requierenAccion.insumos.length > 0" class="px-5 py-4">
          <p class="mb-3 text-sm font-semibold text-slate-500">
            Se van a agotar ({{ datos.requierenAccion.insumos.length }})
          </p>
          <ul class="space-y-2.5">
            <li
              v-for="i in datos.requierenAccion.insumos"
              :key="i.insumoId"
              class="flex flex-wrap items-center justify-between gap-3 border-l-4 bg-slate-50 px-4 py-3"
              :class="i.saldoTotal === 0 ? 'border-l-urgente-500' : 'border-l-atencion-500'"
            >
              <div class="min-w-0">
                <RouterLink
                  :to="veBodega ? `/inventario/${i.insumoId}` : '/dispensacion'"
                  class="font-medium text-slate-900 hover:underline"
                >
                  {{ i.nombreGenerico }}
                </RouterLink>
                <!-- Nunca un 0 inventado: si no se puede calcular, se dice -->
                <p class="text-slate-600">
                  {{ i.cobertura.calculable
                    ? `Alcanza para unos ${i.cobertura.dias} dias mas`
                    : i.cobertura.mensaje }}
                </p>
              </div>
              <span
                class="shrink-0 font-semibold tabular-nums"
                :class="i.saldoTotal === 0 ? 'text-urgente-700' : 'text-slate-700'"
              >
                {{ i.saldoTotal }} {{ i.unidadMedida }}
              </span>
            </li>
          </ul>
        </div>

        <!-- Lotes proximos a vencer -->
        <div v-if="datos.requierenAccion.lotes.length > 0" class="px-5 py-4">
          <p class="mb-3 text-sm font-semibold text-slate-500">
            Se vencen pronto ({{ datos.requierenAccion.lotes.length }})
          </p>
          <ul class="space-y-2.5">
            <li
              v-for="l in datos.requierenAccion.lotes"
              :key="l.loteId"
              class="flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-slate-300
                     bg-slate-50 px-4 py-3"
            >
              <div class="min-w-0">
                <RouterLink
                  :to="veBodega ? `/inventario/${l.insumoId}` : '/dispensacion'"
                  class="font-medium text-slate-900 hover:underline"
                >
                  {{ l.nombreGenerico }}
                </RouterLink>
                <span class="text-slate-500"> &middot; lote {{ l.numeroLote }}</span>
                <!-- El excedente convierte la fecha en una decision -->
                <p v-if="l.excedenteProyectado !== null" class="text-slate-600">
                  Al ritmo actual sobrarán unas {{ l.excedenteProyectado }} de {{ l.cantidadActual }}
                </p>
                <p v-else class="text-slate-600">
                  {{ l.cantidadActual }} en existencia; no hay consumo suficiente para proyectar
                </p>
              </div>
              <Etiqueta :tono="TONO_SEMAFORO[l.semaforo]" punto>
                {{ l.diasParaVencer }} días &middot; {{ fecha(l.fechaVence) }}
              </Etiqueta>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Prescripciones pendientes -->
    <div class="panel">
      <div class="panel-encabezado">
        <h2 class="panel-titulo">
          <Icono nombre="dispensacion" :tamano="20" class="text-celeste-400" />
          Recetas por entregar ({{ datos.prescripcionesPendientes.length }})
        </h2>
        <RouterLink to="/dispensacion" class="enlace">Ir a dispensación &rarr;</RouterLink>
      </div>

      <EstadoVacio
        v-if="datos.prescripcionesPendientes.length === 0"
        icono="correcto"
        titulo="Nada pendiente de entrega"
        descripcion="Todas las recetas del día fueron despachadas."
      />
      <ul v-else class="lista">
        <li
          v-for="p in datos.prescripcionesPendientes.slice(0, 8)"
          :key="p.prescripcionId"
          class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
        >
          <div class="min-w-0">
            <p class="truncate font-medium text-slate-900">{{ p.paciente.nombreCompleto }}</p>
            <p class="truncate text-slate-500">{{ p.insumo.nombreGenerico }}</p>
          </div>
          <span class="shrink-0 font-semibold tabular-nums text-mspas-700">
            {{ p.pendiente }} {{ p.insumo.unidadMedida }}
          </span>
        </li>
      </ul>
    </div>
  </section>

  <section v-else>
    <p v-if="error" role="alert" class="aviso aviso-urgente">
      <Icono nombre="alerta" :tamano="20" class="mt-0.5 shrink-0 text-urgente-600" />
      <span class="text-slate-700">{{ error }}</span>
    </p>
    <p v-else class="text-slate-500">Cargando panel...</p>
  </section>
</template>
