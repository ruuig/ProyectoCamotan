<script setup>
import { CARGOS_SIGSA, CARGOS_OTROS } from '../../dominio/cargos';
import { ref, reactive, computed, onMounted } from 'vue';
import http from '../../services/http';
import bodega from '../../services/bodega';
import { useAuthStore } from '../../stores/auth';
import { usarAutorizacion } from '../../dominio/autorizacion';
import DialogoAutorizacion from '../comunes/DialogoAutorizacion.vue';
import Icono from '../comunes/Icono.vue';

/**
 * Personal del centro: quién entra al sistema, con qué rol y con qué nombre y
 * cargo sale en las hojas que firma. Rol, dirección, contraseña y baja piden
 * la autorización del director.
 */
const ROLES = [
  { valor: 'admin', texto: 'Dirección', color: '#172A5A', fondo: '#E6EAF4' },
  { valor: 'preconsulta', texto: 'Preconsulta', color: '#2F64B8', fondo: '#E6EFFB' },
  { valor: 'medico', texto: 'Médico', color: '#1F7A4D', fondo: '#E3F4EA' },
  { valor: 'farmacia', texto: 'Farmacia', color: '#6B44A8', fondo: '#F0EAFA' },
  { valor: 'bodega', texto: 'Bodega', color: '#A6561A', fondo: '#FDEEE2' },
  // Encargado de un puesto o centro comunitario: sus requisiciones y su informe.
  { valor: 'servicio', texto: 'Encargado de servicio', color: '#0F766E', fondo: '#DFF5F2' },
];
const ROL = Object.fromEntries(ROLES.map((r) => [r.valor, r]));
const CARGOS = [...CARGOS_SIGSA.map((c) => c.nombre), ...CARGOS_OTROS];

const auth = useAuthStore();
const usuarios = ref([]);
const filtroRol = ref('');
const buscar = ref('');
const seleccion = ref(null); // id del usuario, o 'nuevo'
const error = ref('');
const aviso = ref('');
const guardando = ref(false);
const verClave = ref(false);

const datos = reactive({ nombre: '', cargo: '', dpi: '' });
const acceso = reactive({ rol: 'preconsulta', esDirector: false, password: '', ubicacionId: null });
// Centros y puestos que puede manejar un encargado de servicio (no la bodega).
const lugares = ref([]);
const nuevo = reactive({ usuario: '', nombre: '', cargo: '', dpi: '', rol: 'preconsulta', esDirector: false, password: '', ubicacionId: null });

const iniciales = (n) => n.split(/\s+/).filter((p) => p && !p.endsWith('.')).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const lista = computed(() => {
  const q = buscar.value.trim().toLowerCase();
  return usuarios.value.filter((u) =>
    (!filtroRol.value || u.rol === filtroRol.value)
    && (!q || `${u.nombre} ${u.usuario} ${u.cargo ?? ''}`.toLowerCase().includes(q)));
});
const conteo = computed(() => Object.fromEntries(ROLES.map((r) => [r.valor, usuarios.value.filter((u) => u.rol === r.valor && u.activo).length])));
const elegido = computed(() => usuarios.value.find((u) => u.id === seleccion.value) ?? null);
const accesoCambiado = computed(() => elegido.value && (
  acceso.rol !== elegido.value.rol || acceso.esDirector !== elegido.value.esDirector || acceso.password.length > 0
  || (acceso.rol === 'servicio' && acceso.ubicacionId !== elegido.value.ubicacionId)));

async function cargar() {
  try {
    const [u, l] = await Promise.all([http.get('/admin/usuarios'), bodega.ubicaciones().catch(() => ({ ubicaciones: [] }))]);
    usuarios.value = u.usuarios;
    lugares.value = l.ubicaciones.filter((x) => x.tipo !== 'bodega');
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function elegir(u) {
  seleccion.value = u.id;
  Object.assign(datos, { nombre: u.nombre, cargo: u.cargo ?? '', dpi: u.dpi ?? '' });
  Object.assign(acceso, { rol: u.rol, esDirector: u.esDirector, password: '', ubicacionId: u.ubicacionId ?? null });
  verClave.value = false;
  error.value = '';
  aviso.value = '';
}

function abrirNuevo() {
  seleccion.value = 'nuevo';
  Object.assign(nuevo, { usuario: '', nombre: '', cargo: '', dpi: '', rol: 'preconsulta', esDirector: false, password: '', ubicacionId: null });
  verClave.value = false;
  error.value = '';
  aviso.value = '';
}

async function recargarYElegir(id, mensaje) {
  await cargar();
  aviso.value = mensaje;
  const u = usuarios.value.find((x) => x.id === id);
  if (u) {
    const texto = aviso.value;
    elegir(u);
    aviso.value = texto;
  }
}

async function crear() {
  guardando.value = true;
  error.value = '';
  try {
    const { usuario } = await http.post('/admin/usuarios', {
      ...nuevo,
      ubicacionId: nuevo.rol === 'servicio' ? nuevo.ubicacionId : null,
      cargo: nuevo.cargo || null,
      dpi: nuevo.dpi || null,
    });
    await recargarYElegir(usuario.id, `Usuario ${usuario.usuario} creado.`);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

async function guardarDatos() {
  guardando.value = true;
  error.value = '';
  try {
    await http.patch(`/admin/usuarios/${elegido.value.id}`, {
      nombre: datos.nombre,
      cargo: datos.cargo || null,
      dpi: datos.dpi || null,
    });
    // Las hojas que imprime quien tiene la sesión toman el nombre y el cargo de ella.
    if (elegido.value.id === auth.usuario?.id) {
      auth.guardarSesion(auth.token, { ...auth.usuario, nombre: datos.nombre, cargo: datos.cargo || null });
    }
    await recargarYElegir(elegido.value.id, 'Datos guardados.');
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}

const autorizacion = usarAutorizacion(async (mensaje) => {
  await recargarYElegir(seleccion.value, mensaje ?? 'Cambio aplicado.');
});

function cambiarAcceso() {
  const u = elegido.value;
  const cuerpo = {};
  if (acceso.rol !== u.rol) cuerpo.rol = acceso.rol;
  if (acceso.esDirector !== u.esDirector) cuerpo.esDirector = acceso.esDirector;
  if (acceso.rol === 'servicio' && acceso.ubicacionId !== u.ubicacionId) cuerpo.ubicacionId = acceso.ubicacionId;
  if (acceso.password) cuerpo.password = acceso.password;
  autorizacion.pedir(`cambiar el acceso de ${u.usuario}`, async (aut) => {
    await http.patch(`/admin/usuarios/${u.id}/acceso`, { ...cuerpo, autorizacion: aut });
    return cuerpo.password ? 'Acceso actualizado. Entregue la contraseña nueva en persona.' : 'Acceso actualizado.';
  });
}

function alternarEstado() {
  const u = elegido.value;
  autorizacion.pedir(`${u.activo ? 'desactivar' : 'activar'} a ${u.usuario}`, async (aut) => {
    await http.patch(`/admin/usuarios/${u.id}/estado`, { activo: !u.activo, autorizacion: aut });
    return u.activo ? `${u.usuario} ya no puede entrar al sistema.` : `${u.usuario} puede volver a entrar.`;
  });
}

onMounted(cargar);
</script>

<template>
  <div class="personal">
    <!-- Lista -->
    <section class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <div class="b-buscar min-w-[220px] flex-1">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" class="b-campo" placeholder="Buscar por nombre, usuario o cargo" aria-label="Buscar personal" />
        </div>
        <button type="button" class="b-btn primario" @click="abrirNuevo"><Icono nombre="agregar" :tamano="20" /> Nuevo usuario</button>
      </div>

      <div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar por rol">
        <button type="button" class="b-chip" :class="!filtroRol ? 'on' : ''" @click="filtroRol = ''">Todos <span class="n">{{ usuarios.length }}</span></button>
        <button v-for="r in ROLES" :key="r.valor" type="button" class="b-chip" :class="filtroRol === r.valor ? 'on' : ''" @click="filtroRol = r.valor">
          {{ r.texto }} <span class="n">{{ conteo[r.valor] }}</span>
        </button>
      </div>

      <ul class="gente mt-3">
        <li v-for="u in lista" :key="u.id">
          <button type="button" class="persona" :class="[seleccion === u.id ? 'sel' : '', u.activo ? '' : 'inactivo']" @click="elegir(u)">
            <span class="avatar" :style="{ background: ROL[u.rol]?.fondo, color: ROL[u.rol]?.color }">{{ iniciales(u.nombre) }}</span>
            <span class="min-w-0 flex-1">
              <b class="nombre">{{ u.nombre }}</b>
              <small class="detalle">
                <span class="font-mono">{{ u.usuario }}</span>
                <template v-if="u.cargo"> · {{ u.cargo }}</template><template v-if="u.ubicacion"> · {{ u.ubicacion.nombre }}</template>
                <template v-else> · <i class="sin-cargo">sin cargo</i></template>
              </small>
            </span>
            <span class="marcas">
              <span v-if="u.esDirector" class="marca director">Director</span>
              <span v-if="u.tieneTotp" class="marca">2 pasos</span>
              <span v-if="!u.activo" class="marca baja">Inactivo</span>
              <span class="rol" :style="{ background: ROL[u.rol]?.fondo, color: ROL[u.rol]?.color }">{{ ROL[u.rol]?.texto ?? u.rol }}</span>
            </span>
          </button>
        </li>
        <li v-if="!lista.length" class="b-vacio">Nadie coincide con la búsqueda.</li>
      </ul>
    </section>

    <!-- Ficha -->
    <aside class="ficha">
      <p v-if="aviso" class="b-aviso ok mb-3">{{ aviso }}</p>
      <p v-if="error" role="alert" class="b-aviso error mb-3">{{ error }}</p>

      <!-- Nuevo -->
      <form v-if="seleccion === 'nuevo'" class="b-panel" @submit.prevent="crear">
        <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Nuevo usuario</h2></header>
        <div class="b-panel-cuerpo b-rejilla">
          <div class="c6">
            <label for="n-usuario" class="b-etiqueta">Usuario</label>
            <input id="n-usuario" v-model="nuevo.usuario" required autocomplete="off" autocapitalize="none" placeholder="rudy.oloroso"
              pattern="[A-Za-z0-9._\-]{3,40}" title="Sin espacios: letras, números, punto, guion o guion bajo" class="b-campo" />
          </div>
          <div class="c6">
            <label for="n-rol" class="b-etiqueta">Rol</label>
            <select id="n-rol" v-model="nuevo.rol" class="b-campo">
              <option v-for="r in ROLES" :key="r.valor" :value="r.valor">{{ r.texto }}</option>
            </select>
          </div>
          <div v-if="nuevo.rol === 'servicio'" class="c12">
            <label for="n-lugar" class="b-etiqueta">Centro o puesto que maneja</label>
            <select id="n-lugar" v-model="nuevo.ubicacionId" required class="b-campo">
              <option :value="null" disabled>Elija…</option>
              <option v-for="l in lugares" :key="l.id" :value="l.id">{{ l.nombre }}</option>
            </select>
          </div>
          <div class="c12">
            <label for="n-nombre" class="b-etiqueta">Nombre completo</label>
            <input id="n-nombre" v-model="nuevo.nombre" required placeholder="Nombres y apellidos" class="b-campo" />
          </div>
          <div class="c7">
            <label for="n-cargo" class="b-etiqueta">Cargo <span class="b-opcional">opcional</span></label>
            <input id="n-cargo" v-model="nuevo.cargo" list="cargos" maxlength="120" class="b-campo" />
          </div>
          <div class="c5">
            <label for="n-dpi" class="b-etiqueta">DPI <span class="b-opcional">opcional</span></label>
            <input id="n-dpi" v-model="nuevo.dpi" inputmode="numeric" maxlength="13" class="b-campo font-mono" />
          </div>
          <div class="c12">
            <label for="n-clave" class="b-etiqueta">Contraseña inicial</label>
            <div class="clave">
              <input id="n-clave" v-model="nuevo.password" :type="verClave ? 'text' : 'password'" required minlength="10" autocomplete="new-password" class="b-campo" />
              <button type="button" :aria-label="verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'" :aria-pressed="verClave" @click="verClave = !verClave"><Icono :nombre="verClave ? 'ojoTachado' : 'ojo'" :tamano="20" /></button>
            </div>
            <span class="pista" :class="nuevo.password.length >= 10 ? 'bien' : ''">{{ nuevo.password.length }} de 10 caracteres mínimo</span>
          </div>
          <label class="c12 casilla"><input v-model="nuevo.esDirector" type="checkbox" /> Es el director: autoriza los cambios protegidos</label>
        </div>
        <footer class="pie">
          <button type="button" class="b-btn secundario" @click="seleccion = null">Cancelar</button>
          <button type="submit" class="b-btn primario" :disabled="guardando">Crear usuario</button>
        </footer>
      </form>

      <!-- Elegido -->
      <div v-else-if="elegido" class="b-panel">
        <header class="cabeza-ficha">
          <span class="avatar grande" :style="{ background: ROL[elegido.rol]?.fondo, color: ROL[elegido.rol]?.color }">{{ iniciales(elegido.nombre) }}</span>
          <div class="min-w-0">
            <h2 class="truncate text-lg font-bold text-tinta">{{ elegido.nombre }}</h2>
            <p class="text-sm text-apagado"><span class="font-mono">{{ elegido.usuario }}</span> · {{ elegido.activo ? 'activo' : 'inactivo' }}</p>
          </div>
        </header>

        <form class="seccion" @submit.prevent="guardarDatos">
          <h3 class="b-subtitulo">Cómo sale en las hojas</h3>
          <div class="b-rejilla mt-3">
            <div class="c12">
              <label for="e-nombre" class="b-etiqueta">Nombre</label>
              <input id="e-nombre" v-model="datos.nombre" required class="b-campo" />
            </div>
            <div class="c7">
              <label for="e-cargo" class="b-etiqueta">Cargo</label>
              <input id="e-cargo" v-model="datos.cargo" list="cargos" maxlength="120" class="b-campo" />
            </div>
            <div class="c5">
              <label for="e-dpi" class="b-etiqueta">DPI</label>
              <input id="e-dpi" v-model="datos.dpi" inputmode="numeric" maxlength="13" class="b-campo font-mono" />
            </div>
          </div>
          <div class="firma-muestra" aria-hidden="true">
            <span class="linea" />
            <b>{{ datos.nombre || ' ' }}</b>
            <small>{{ datos.cargo || 'Cargo' }}</small>
          </div>
          <div class="mt-3 flex justify-end">
            <button type="submit" class="b-btn secundario chico" :disabled="guardando">Guardar datos</button>
          </div>
        </form>

        <form class="seccion" @submit.prevent="cambiarAcceso">
          <h3 class="b-subtitulo flex items-center gap-2"><Icono nombre="bloqueo" :tamano="15" /> Acceso <span class="b-opcional">· pide al director</span></h3>
          <div class="b-rejilla mt-3">
            <div class="c6">
              <label for="e-rol" class="b-etiqueta">Rol</label>
              <select id="e-rol" v-model="acceso.rol" class="b-campo">
                <option v-for="r in ROLES" :key="r.valor" :value="r.valor">{{ r.texto }}</option>
              </select>
            </div>
            <div v-if="acceso.rol === 'servicio'" class="c12">
              <label for="e-lugar" class="b-etiqueta">Centro o puesto que maneja</label>
              <select id="e-lugar" v-model="acceso.ubicacionId" class="b-campo">
                <option :value="null" disabled>Elija…</option>
                <option v-for="l in lugares" :key="l.id" :value="l.id">{{ l.nombre }}</option>
              </select>
            </div>
            <div class="c6">
              <label for="e-clave" class="b-etiqueta">Contraseña nueva</label>
              <div class="clave">
                <input id="e-clave" v-model="acceso.password" :type="verClave ? 'text' : 'password'" minlength="10" autocomplete="new-password" placeholder="Sin cambio" class="b-campo" />
                <button type="button" :aria-label="verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'" :aria-pressed="verClave" @click="verClave = !verClave"><Icono :nombre="verClave ? 'ojoTachado' : 'ojo'" :tamano="20" /></button>
              </div>
            </div>
            <label class="c12 casilla"><input v-model="acceso.esDirector" type="checkbox" /> Es el director</label>
          </div>
          <div class="mt-3 flex items-center justify-between gap-2">
            <button type="button" class="b-btn chico" :class="elegido.activo ? 'peligro' : 'exito'" @click="alternarEstado">
              {{ elegido.activo ? 'Desactivar usuario' : 'Activar usuario' }}
            </button>
            <button type="submit" class="b-btn primario chico" :disabled="!accesoCambiado || (acceso.password && acceso.password.length < 10)">Aplicar cambios</button>
          </div>
        </form>
      </div>

      <div v-else class="vacia">
        <Icono nombre="pacientes" :tamano="34" :grosor="1.4" />
        <p>Ninguna persona elegida</p>
      </div>
    </aside>

    <datalist id="cargos"><option v-for="c in CARGOS" :key="c" :value="c" /></datalist>

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
.personal { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 22px; align-items: start; }
@media (max-width: 1100px) { .personal { grid-template-columns: 1fr; } }

.gente { display: flex; flex-direction: column; gap: 6px; max-height: calc(100vh - 330px); min-height: 280px; overflow-y: auto; padding-right: 2px; }
.persona { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px; border: 2px solid #EEF2F6; border-radius: 12px; background: #fff; text-align: left; transition: border-color .15s, background .15s; }
.persona:hover { border-color: #CBD5E1; }
.persona.sel { border-color: #172A5A; background: #F6F8FC; }
.persona.inactivo { opacity: .55; }
.avatar { display: grid; place-items: center; flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px; font-size: 14px; font-weight: 700; }
.avatar.grande { width: 52px; height: 52px; border-radius: 14px; font-size: 18px; }
.nombre { display: block; font-size: 15px; color: #14244A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.detalle { display: block; font-size: 13px; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sin-cargo { color: #B45309; font-style: normal; }
.marcas { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.marca { padding: 2px 8px; border-radius: 6px; background: #EEF2F6; color: #475569; font-size: 12px; font-weight: 700; }
.marca.director { background: #FDF0D5; color: #8A5A06; }
.marca.baja { background: #FBE3E3; color: #8C1D1D; }
.rol { min-width: 96px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; text-align: center; }

.ficha { position: sticky; top: 16px; }
.cabeza-ficha { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-bottom: 2px solid #EEF2F6; }
.seccion { padding: 16px 18px; border-bottom: 2px solid #EEF2F6; }
.seccion:last-child { border-bottom: none; }
.pie { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 18px; }

.firma-muestra { display: flex; flex-direction: column; align-items: center; margin: 16px auto 0; width: 70%; font-size: 13px; color: #334155; }
.firma-muestra .linea { width: 100%; border-top: 1.5px solid #334155; margin-bottom: 4px; }
.firma-muestra small { color: #64748B; }

.clave { position: relative; }
.clave .b-campo { padding-right: 48px; }
.clave button { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 38px; height: 36px; border-radius: 8px; color: #64748B; }
.clave button:hover { background: #F1F5F9; color: #172A5A; }
.pista { display: block; margin-top: 4px; font-size: 12px; font-weight: 600; color: #94A3B8; }
.pista.bien { color: #1E8E5E; }
.casilla { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: #334155; }
.casilla input { width: 18px; height: 18px; accent-color: #172A5A; }

.vacia { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; border: 2px dashed #CBD5E1; border-radius: 16px; color: #94A3B8; text-align: center; font-weight: 600; }
/* --- Relieve (estilo duo) --- */
.persona { border-color: #E2E8F0; border-bottom-width: 4px; border-radius: 14px; }
.persona:active { transform: translateY(2px); border-bottom-width: 2px; }
</style>
