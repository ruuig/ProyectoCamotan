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
  <div class="space-y-5">
    <form class="panel max-w-3xl space-y-4 p-relleno" @submit.prevent="crear">
      <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">Agregar servicio</h2>
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="sm:col-span-3">
          <label for="ubNombre" class="etiqueta-campo">Nombre</label>
          <input id="ubNombre" v-model="nuevo.nombre" required minlength="2" maxlength="120" placeholder="C/C Nuevo" class="campo" />
        </div>
        <div>
          <label for="ubTipo" class="etiqueta-campo">Tipo</label>
          <select id="ubTipo" v-model="nuevo.tipo" class="campo">
            <option v-for="t in tipos" :key="t.valor" :value="t.valor">{{ t.etiqueta }}</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label for="ubCom" class="etiqueta-campo">Comunidad</label>
          <input id="ubCom" v-model="nuevo.comunidad" maxlength="120" class="campo" />
        </div>
      </div>
      <button type="submit" class="boton-primario"><Icono nombre="agregar" :tamano="18" /> Agregar</button>
    </form>

    <p v-if="error" role="alert" class="aviso aviso-urgente">{{ error }}</p>
    <p v-if="aviso" class="aviso aviso-informativo">{{ aviso }}</p>

    <div class="panel">
      <header class="panel-encabezado">
        <h2 class="panel-titulo">Ubicaciones</h2>
        <span class="text-sm text-apagado">{{ lista.filter((u) => u.activo).length }} activas</span>
      </header>
      <ul class="lista">
        <li v-for="u in lista" :key="u.id" class="flex flex-wrap items-center gap-3 px-relleno py-2.5" :class="u.activo ? '' : 'opacity-60'">
          <input
            :value="u.nombre"
            :aria-label="`Nombre de ${u.nombre}`"
            class="campo !min-h-0 min-w-[14rem] flex-1 !py-1.5"
            :disabled="u.tipo === 'bodega'"
            @change="renombrar(u, $event.target.value)"
          />
          <span class="w-40 text-sm text-tinta-2">{{ u.tipoEtiqueta }}</span>
          <button
            v-if="u.tipo !== 'bodega'"
            type="button"
            class="boton-secundario !min-h-0 !py-1.5"
            @click="alternar(u)"
          >
            {{ u.activo ? 'Desactivar' : 'Activar' }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
