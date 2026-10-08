<script setup>
import { ref, reactive, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import sigsa from '../../services/sigsa';
import { useAuthStore } from '../../stores/auth';
import Icono from '../../components/comunes/Icono.vue';

/**
 * FOR-SIGSA-3CS: el registro diario de consulta sale de las consultas
 * cerradas. Se elige el rango y el médico; se imprime para sellarlo o se
 * descarga en Excel para el SIGSA web.
 */
const auth = useAuthStore();
const hoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const filtro = reactive({ desde: hoy, hasta: hoy, medicoId: '' });
const medicos = ref([]);
const datos = ref(null);
const error = ref('');
const cargando = ref(false);

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    datos.value = await sigsa.tresCs(filtro);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

async function excel() {
  try {
    const url = await sigsa.excelTresCs(filtro);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sigsa3cs-${filtro.desde}-${filtro.hasta}.xlsx`;
    a.click();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

/** Fecha de nacimiento, o la edad cuando no se conoce (va en una sola casilla del formulario). */
function textoNacimiento(n) {
  if (!n.estimada) return n.dia ? `${n.dia}/${n.mes}/${n.anio}` : '';
  if (n.anio !== '') return `${n.anio} ${n.anio === 1 ? 'año' : 'años'}`;
  if (n.mes !== '') return `${n.mes} ${n.mes === 1 ? 'mes' : 'meses'}`;
  return `${n.dia} ${n.dia === 1 ? 'día' : 'días'}`;
}

function rangoRapido(tipo) {
  const d = new Date(`${hoy}T12:00:00Z`);
  if (tipo === 'hoy') Object.assign(filtro, { desde: hoy, hasta: hoy });
  if (tipo === 'mes') Object.assign(filtro, { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy });
  if (tipo === 'anterior') {
    const inicio = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    Object.assign(filtro, { desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) });
  }
}

const enlaceImprimir = () => `/imprimir/sigsa3cs?${new URLSearchParams(Object.entries(filtro).filter(([, v]) => v !== ''))}`;

watch(filtro, cargar, { deep: true });
onMounted(async () => {
  try {
    medicos.value = (await sigsa.medicos()).medicos;
    if (auth.rol === 'medico') filtro.medicoId = auth.usuario?.id ?? '';
  } catch {
    // Sin la lista se genera de todos los médicos.
  }
  cargar();
});
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">SIGSA 3CS</h1>
        <span class="b-antetitulo">Registro diario de consulta</span>
      </div>
      <div class="b-acciones">
        <button type="button" class="b-btn secundario" :disabled="!datos?.renglones.length" @click="excel"><Icono nombre="hojaCalculo" :tamano="20" /> Excel</button>
        <RouterLink :to="enlaceImprimir()" target="_blank" class="b-btn primario"><Icono nombre="imprimir" :tamano="20" /> Imprimir</RouterLink>
      </div>
    </header>

    <div class="b-panel mt-5 p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label for="desde" class="b-etiqueta">Desde</label>
          <input id="desde" v-model="filtro.desde" type="date" class="b-campo w-[170px]" />
        </div>
        <div>
          <label for="hasta" class="b-etiqueta">Hasta</label>
          <input id="hasta" v-model="filtro.hasta" type="date" class="b-campo w-[170px]" />
        </div>
        <div class="b-segmentado" role="group" aria-label="Rangos rápidos">
          <button type="button" @click="rangoRapido('hoy')">Hoy</button>
          <button type="button" @click="rangoRapido('mes')">Este mes</button>
          <button type="button" @click="rangoRapido('anterior')">Mes anterior</button>
        </div>
        <div class="min-w-[220px] flex-1">
          <label for="medico" class="b-etiqueta">Responsable de la información</label>
          <select id="medico" v-model="filtro.medicoId" class="b-campo">
            <option value="">Todos los médicos</option>
            <option v-for="m in medicos" :key="m.id" :value="m.id">{{ m.nombre }}</option>
          </select>
        </div>
      </div>
    </div>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <div class="mt-4 flex items-center justify-between">
      <span class="text-sm font-bold text-apagado">{{ cargando ? 'Buscando…' : `${datos?.renglones.length ?? 0} consultas` }}</span>
    </div>
    <div class="b-tabla-marco alta mt-2">
      <table class="b-tabla">
        <thead>
          <tr>
            <th class="n">Día</th><th>Historia</th><th>Paciente</th><th>Sexo</th><th>Nacimiento</th><th>Comunidad</th>
            <th class="n">Consulta</th><th>Diagnóstico</th><th>CIE-10</th><th>Tratamiento</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in datos?.renglones ?? []" :key="r.atencionId">
            <td class="n">{{ r.dia }}</td>
            <td class="font-mono">{{ r.historiaClinica }}</td>
            <td class="font-semibold text-tinta">{{ r.nombre }}</td>
            <td>{{ r.sexo }}</td>
            <td class="whitespace-nowrap">{{ textoNacimiento(r.nacimiento) }}</td>
            <td>{{ r.comunidad }}</td>
            <td class="n">{{ r.consulta }}</td>
            <td><span v-for="(d, i) in r.diagnosticos" :key="i" class="block">{{ d.descripcion }}</span></td>
            <td class="font-mono"><span v-for="(d, i) in r.diagnosticos" :key="i" class="block">{{ d.cie }}</span></td>
            <td><span v-for="(t, i) in r.tratamiento" :key="i" class="block">{{ t.descripcion }} · {{ t.cantidad }}</span></td>
          </tr>
          <tr v-if="datos && !datos.renglones.length"><td colspan="10" class="b-vacio">No hay consultas cerradas en ese rango.</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.alta { max-height: max(380px, calc(100vh - 380px)); }
.b-tabla td { vertical-align: top; }
</style>
