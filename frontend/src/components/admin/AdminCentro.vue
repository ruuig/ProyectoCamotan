<script setup>
import { ref, computed, onMounted } from 'vue';
import http from '../../services/http';
import { usarAutorizacion } from '../../dominio/autorizacion';
import { useAuthStore } from '../../stores/auth';
import DialogoAutorizacion from '../comunes/DialogoAutorizacion.vue';
import { useLogoStore } from '../../stores/logo';
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

const CAMPOS = ['codigo', 'nombre', 'municipio', 'departamento', 'areaSalud', 'distritoSalud', 'tipo'];
const cambiado = computed(() => est.value && CAMPOS.some((k) => (est.value[k] ?? '') !== (original.value[k] ?? '')));

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

// --- Logo institucional ------------------------------------------------------
const logo = useLogoStore();
const subiendo = ref('');
async function cambiarLogo(variante, evento) {
  const archivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!archivo) return;
  error.value = '';
  aviso.value = '';
  subiendo.value = variante;
  try {
    await http.subirArchivo(`/logo/${variante}`, archivo);
    await logo.cargar(true);
    aviso.value = 'Logo cambiado. Ya aparece en todo el sistema y en las hojas impresas.';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    subiendo.value = '';
  }
}
async function logoOficial(variante) {
  error.value = '';
  try {
    await http.request('DELETE', `/logo/${variante}`);
    await logo.cargar(true);
    aviso.value = 'Se volvió al logo oficial del MSPAS.';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(() => { cargar(); logo.cargar(); });
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
          <div class="c6">
            <label for="e-area" class="b-etiqueta">Área de Salud</label>
            <input id="e-area" v-model="est.areaSalud" maxlength="120" :placeholder="est.departamento" class="b-campo" />
          </div>
          <div class="c6">
            <label for="e-distrito" class="b-etiqueta">Distrito de Salud</label>
            <input id="e-distrito" v-model="est.distritoSalud" maxlength="120" :placeholder="est.municipio" class="b-campo" />
          </div>
          <p class="c12 -mt-2 text-sm text-apagado">Encabezado de los formularios SIGSA. Vacío: departamento y municipio.</p>
          <div class="c4">
            <label for="e-tipo" class="b-etiqueta">Tipo</label>
            <select id="e-tipo" v-model="est.tipo" class="b-campo">
              <option v-for="(t, v) in TIPOS" :key="v" :value="v">{{ t }}</option>
            </select>
          </div>
        </div>

        <!-- Encabezado tal como sale -->
        <div class="encabezado" aria-label="Vista del encabezado impreso">
          <img :src="logo.vertical" alt="" class="h-[54px] w-auto" />
          <div>
            <p class="text-[12px] font-bold">Ministerio de Salud Pública y Asistencia Social</p>
            <p class="text-[14px] font-bold">Título del documento</p>
            <p class="text-[12px]">{{ est.nombre }} · {{ est.municipio }}, {{ est.departamento }}</p>
            <p class="text-[12px]">Área de Salud: {{ est.areaSalud || est.departamento }} · Distrito de Salud: {{ est.distritoSalud || est.municipio }}</p>
          </div>
        </div>
        <p v-if="est.codigo?.startsWith('PENDIENTE')" class="b-aviso atencion mt-4"><Icono nombre="alerta" :tamano="20" /> Falta el código institucional del MSPAS.</p>
      </div>
    </form>

    <section class="b-panel logos">
      <header class="b-panel-cabeza">
        <h2 class="b-panel-titulo flex items-center gap-2"><Icono nombre="escudo" :tamano="20" /> Logo del Ministerio</h2>
      </header>
      <div class="b-panel-cuerpo logos-cuerpo">
        <div v-for="v in [{ clave: 'horizontal', titulo: 'Horizontal', donde: 'Menú e inicio de sesión' }, { clave: 'vertical', titulo: 'Vertical', donde: 'Hojas impresas' }]" :key="v.clave" class="logo-caja">
          <div class="logo-marco" :class="v.clave"><img :src="logo[v.clave]" :alt="`Logo ${v.titulo}`" /></div>
          <p class="logo-titulo">{{ v.titulo }} <span>{{ v.donde }}</span></p>
          <p class="logo-estado" :class="{ propio: logo.personalizado[v.clave] }">{{ logo.personalizado[v.clave] ? 'Logo cambiado' : 'Oficial del MSPAS' }}</p>
          <div class="flex flex-wrap gap-2">
            <label class="b-btn primario chico">
              <Icono nombre="recibir" :tamano="16" /> {{ subiendo === v.clave ? 'Subiendo…' : 'Cambiar' }}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="sr-only" :disabled="Boolean(subiendo)" @change="cambiarLogo(v.clave, $event)" />
            </label>
            <button v-if="logo.personalizado[v.clave]" type="button" class="b-btn secundario chico" @click="logoOficial(v.clave)"><Icono nombre="actualizar" :tamano="16" /> Volver al oficial</button>
          </div>
        </div>
      </div>
    </section>

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
.logos { grid-column: 1 / -1; }
.logos-cuerpo { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.logo-caja { display: grid; gap: 8px; align-content: start; padding: 14px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 16px; }
.logo-marco { display: grid; place-items: center; height: 120px; padding: 12px; border-radius: 12px; background: repeating-conic-gradient(#F1F5F9 0% 25%, #fff 0% 50%) 50% / 18px 18px; }
.logo-marco img { max-height: 96px; max-width: 100%; object-fit: contain; }
.logo-titulo { font-weight: 800; color: #14244A; }
.logo-titulo span { margin-left: 6px; font-size: 13px; font-weight: 600; color: #64748B; }
.logo-estado { font-size: 13px; font-weight: 700; color: #145C3C; }
.logo-estado.propio { color: #8A5A06; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.centro { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; }
@media (max-width: 1100px) { .centro { grid-template-columns: 1fr; } }
.encabezado { display: flex; align-items: flex-start; gap: 14px; margin-top: 18px; padding: 14px 16px; border: 1px solid #DDE3EC; border-bottom: 2px solid #111827; border-radius: 6px 6px 0 0; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #111827; }
.estado { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: #F1F5F9; color: #64748B; }
.estado.activa { background: #EAF7F0; color: #1E8E5E; }
.estado b { display: block; color: #14244A; }
.estado small { font-size: 13px; color: #64748B; }
</style>
