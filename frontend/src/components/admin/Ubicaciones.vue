<script setup>
import { ref, reactive, onMounted } from 'vue';
import bodega from '../../services/bodega';
import Icono from '../comunes/Icono.vue';

/**
 * Catálogo de ubicaciones: la bodega y los servicios que abastece. Viene
 * cargado con los 31 servicios del balance del centro; el administrador lo
 * edita cuando abre o cierra un puesto.
 */
const lista = ref([]);
const tipos = ref([]);
const nuevo = reactive({ nombre: '', tipo: 'centro_comunitario', comunidad: '' });
const error = ref('');
const aviso = ref('');

async function cargar() {
  try {
    const r = await bodega.ubicaciones(true);
    lista.value = r.ubicaciones;
    tipos.value = r.tipos.filter((t) => t.valor !== 'bodega');
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function crear() {
  error.value = '';
  try {
    await bodega.crearUbicacion({ ...nuevo, comunidad: nuevo.comunidad || null });
    aviso.value = `${nuevo.nombre} agregado.`;
    Object.assign(nuevo, { nombre: '', comunidad: '' });
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function alternar(u) {
  error.value = '';
  try {
    await bodega.actualizarUbicacion(u.id, { activo: !u.activo });
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function renombrar(u, nombre) {
  if (!nombre.trim() || nombre === u.nombre) return;
  try {
    await bodega.actualizarUbicacion(u.id, { nombre: nombre.trim() });
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargar);
</script>

<template>
  <div class="ubicaciones">
    <section class="b-panel min-w-0">
      <header class="b-panel-cabeza">
        <h2 class="b-panel-titulo">Servicios</h2>
        <span class="text-sm font-semibold text-apagado">{{ lista.filter((u) => u.activo).length }} activos</span>
      </header>
      <ul class="servicios">
        <li v-for="u in lista" :key="u.id" :class="u.activo ? '' : 'inactivo'">
          <input
            :value="u.nombre"
            :aria-label="`Nombre de ${u.nombre}`"
            class="b-campo !h-[38px] min-w-0 flex-1"
            :disabled="u.tipo === 'bodega'"
            @change="renombrar(u, $event.target.value)"
          />
          <span class="tipo">{{ u.tipoEtiqueta }}</span>
          <button v-if="u.tipo !== 'bodega'" type="button" class="b-btn chico w-[110px]" :class="u.activo ? 'secundario' : 'exito'" @click="alternar(u)">
            {{ u.activo ? 'Desactivar' : 'Activar' }}
          </button>
          <span v-else class="w-[110px]" />
        </li>
      </ul>
    </section>

    <form class="b-panel self-start" @submit.prevent="crear">
      <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Agregar servicio</h2></header>
      <div class="b-panel-cuerpo b-rejilla">
        <div class="c12">
          <label for="ubNombre" class="b-etiqueta">Nombre</label>
          <input id="ubNombre" v-model="nuevo.nombre" required minlength="2" maxlength="120" placeholder="C/C Nuevo" class="b-campo" />
        </div>
        <div class="c12">
          <label for="ubTipo" class="b-etiqueta">Tipo</label>
          <select id="ubTipo" v-model="nuevo.tipo" class="b-campo">
            <option v-for="t in tipos" :key="t.valor" :value="t.valor">{{ t.etiqueta }}</option>
          </select>
        </div>
        <div class="c12">
          <label for="ubCom" class="b-etiqueta">Comunidad <span class="b-opcional">opcional</span></label>
          <input id="ubCom" v-model="nuevo.comunidad" maxlength="120" class="b-campo" />
        </div>
        <p v-if="error" role="alert" class="c12 b-aviso error">{{ error }}</p>
        <p v-if="aviso" class="c12 b-aviso ok">{{ aviso }}</p>
        <button type="submit" class="c12 b-btn primario"><Icono nombre="agregar" :tamano="20" /> Agregar</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.ubicaciones { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; }
@media (max-width: 1000px) { .ubicaciones { grid-template-columns: 1fr; } }
.servicios { max-height: calc(100vh - 360px); min-height: 260px; overflow-y: auto; }
.servicios li { display: flex; align-items: center; gap: 12px; padding: 7px 18px; border-top: 1px solid #EEF2F6; }
.servicios li:first-child { border-top: none; }
.servicios li.inactivo { opacity: .55; }
.tipo { width: 170px; font-size: 13px; font-weight: 600; color: #64748B; }
</style>
