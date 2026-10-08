<script setup>
import { ref, computed, onMounted } from 'vue';
import http from '../../services/http';
import { usarAutorizacion } from '../../dominio/autorizacion';
import { useAuthStore } from '../../stores/auth';
import DialogoAutorizacion from '../comunes/DialogoAutorizacion.vue';
import Icono from '../comunes/Icono.vue';

/**
 * Datos del establecimiento, que van en el encabezado de toda hoja impresa,
 * y la verificación en dos pasos de la cuenta de dirección.
 */
const TIPOS = {
  centro_salud_a: 'Tipo A, con encamamiento',
  centro_salud_b: 'Tipo B, ambulatorio',
  puesto_salud: 'Puesto de salud',
};
const auth = useAuthStore();
const est = ref(null);
const original = ref(null);
const tieneTotp = ref(false);
const totp = ref(null);
const codigo = ref('');
const error = ref('');
const aviso = ref('');

const CAMPOS = ['codigo', 'nombre', 'municipio', 'departamento', 'tipo'];
const cambiado = computed(() => est.value && CAMPOS.some((k) => est.value[k] !== original.value[k]));

async function cargar() {
  try {
    const [e, u] = await Promise.all([http.get('/admin/establecimiento'), http.get('/admin/usuarios')]);
    est.value = { ...e.establecimiento };
    original.value = { ...e.establecimiento };
    tieneTotp.value = Boolean(u.usuarios.find((x) => x.id === auth.usuario?.id)?.tieneTotp);
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const autorizacion = usarAutorizacion(async () => {
  aviso.value = 'Datos del establecimiento guardados.';
  await cargar();
});

function guardar() {
  aviso.value = '';
  const datos = Object.fromEntries(CAMPOS.map((k) => [k, est.value[k]]));
  autorizacion.pedir('modificar los datos del establecimiento', (aut) => http.patch('/admin/establecimiento', { ...datos, autorizacion: aut }));
}

async function iniciarTotp() {
  error.value = '';
  try {
    totp.value = await http.post('/admin/totp/iniciar');
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function confirmarTotp() {
  error.value = '';
  try {
    await http.post('/admin/totp/confirmar', { codigo: codigo.value, secreto: totp.value.secreto });
    aviso.value = 'Verificación en dos pasos activada.';
    totp.value = null;
    codigo.value = '';
    tieneTotp.value = true;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargar);
</script>

<template>
  <div class="centro">
    <form v-if="est" class="b-panel" @submit.prevent="guardar">
      <header class="b-panel-cabeza">
        <div>
          <h2 class="b-panel-titulo">Establecimiento</h2>
          <p class="mt-0.5 text-sm text-apagado">Encabezado de toda hoja impresa</p>
        </div>
        <button type="submit" class="b-btn primario" :disabled="!cambiado"><Icono nombre="guardar" :tamano="20" /> Guardar</button>
      </header>
      <div class="b-panel-cuerpo">
        <p v-if="aviso" class="b-aviso ok mb-4">{{ aviso }}</p>
        <p v-if="error" role="alert" class="b-aviso error mb-4">{{ error }}</p>
        <div class="b-rejilla">
          <div class="c8">
            <label for="e-nombre" class="b-etiqueta">Nombre</label>
            <input id="e-nombre" v-model="est.nombre" required class="b-campo" />
          </div>
          <div class="c4">
            <label for="e-codigo" class="b-etiqueta">Código MSPAS</label>
            <input id="e-codigo" v-model="est.codigo" required class="b-campo font-mono" />
          </div>
          <div class="c4">
            <label for="e-muni" class="b-etiqueta">Municipio</label>
            <input id="e-muni" v-model="est.municipio" required class="b-campo" />
          </div>
          <div class="c4">
            <label for="e-depto" class="b-etiqueta">Departamento</label>
            <input id="e-depto" v-model="est.departamento" required class="b-campo" />
          </div>
          <div class="c4">
            <label for="e-tipo" class="b-etiqueta">Tipo</label>
            <select id="e-tipo" v-model="est.tipo" class="b-campo">
              <option v-for="(t, v) in TIPOS" :key="v" :value="v">{{ t }}</option>
            </select>
          </div>
        </div>

        <!-- Encabezado tal como sale -->
        <div class="encabezado" aria-label="Vista del encabezado impreso">
          <img src="/mspas-vertical.png" alt="" class="h-[54px] w-auto" />
          <div>
            <p class="text-[12px] font-bold">Ministerio de Salud Pública y Asistencia Social</p>
            <p class="text-[14px] font-bold">Título del documento</p>
            <p class="text-[12px]">{{ est.nombre }} · {{ est.municipio }}, {{ est.departamento }}</p>
            <p class="text-[12px]">Área de Salud: {{ est.departamento }} · Distrito: {{ est.municipio }}</p>
          </div>
        </div>
        <p v-if="est.codigo?.startsWith('PENDIENTE')" class="b-aviso atencion mt-4"><Icono nombre="alerta" :tamano="20" /> Falta el código institucional del MSPAS.</p>
      </div>
    </form>

    <section class="b-panel self-start">
      <header class="b-panel-cabeza">
        <h2 class="b-panel-titulo flex items-center gap-2"><Icono nombre="escudo" :tamano="20" /> Verificación en dos pasos</h2>
      </header>
      <div class="b-panel-cuerpo space-y-3">
        <div class="estado" :class="tieneTotp ? 'activa' : ''">
          <Icono :nombre="tieneTotp ? 'correcto' : 'bloqueo'" :tamano="22" />
          <span>
            <b>{{ tieneTotp ? 'Activada' : 'Sin activar' }}</b>
            <small>Cuenta de dirección</small>
          </span>
        </div>

        <button v-if="!totp" type="button" class="b-btn w-full" :class="tieneTotp ? 'secundario' : 'primario'" @click="iniciarTotp">
          {{ tieneTotp ? 'Cambiar de teléfono' : 'Activar' }}
        </button>

        <form v-else class="space-y-3" @submit.prevent="confirmarTotp">
          <img :src="totp.qr" alt="Código QR para la aplicación de autenticación" class="mx-auto h-44 w-44 rounded-lg border" />
          <p class="text-center text-sm text-apagado">Clave manual: <code class="font-mono text-tinta">{{ totp.secreto }}</code></p>
          <div>
            <label for="codigo-totp" class="b-etiqueta">Código de 6 dígitos</label>
            <input id="codigo-totp" v-model="codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required class="b-campo text-center font-mono text-xl tracking-[0.4em]" />
          </div>
          <div class="flex gap-2">
            <button type="button" class="b-btn secundario flex-1" @click="totp = null">Cancelar</button>
            <button type="submit" class="b-btn primario flex-1" :disabled="codigo.length !== 6">Confirmar</button>
          </div>
        </form>
      </div>
    </section>

    <DialogoAutorizacion
      :abierto="Boolean(autorizacion.pendiente.value)"
      :operacion="autorizacion.pendiente.value?.operacion ?? ''"
      :error="autorizacion.error.value"
      :enviando="autorizacion.enviando.value"
      @confirmar="autorizacion.confirmar"
      @cancelar="autorizacion.cancelar"
    />
  </div>
</template>

<style scoped>
.centro { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; }
@media (max-width: 1100px) { .centro { grid-template-columns: 1fr; } }
.encabezado { display: flex; align-items: flex-start; gap: 14px; margin-top: 18px; padding: 14px 16px; border: 1px solid #DDE3EC; border-bottom: 2px solid #111827; border-radius: 6px 6px 0 0; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #111827; }
.estado { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: #F1F5F9; color: #64748B; }
.estado.activa { background: #EAF7F0; color: #1E8E5E; }
.estado b { display: block; color: #14244A; }
.estado small { font-size: 13px; color: #64748B; }
</style>
