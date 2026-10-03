<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../services/http';
import catalogos from '../../services/catalogos';
import inventario from '../../services/inventario';
import DialogoAutorizacion from '../../components/comunes/DialogoAutorizacion.vue';
import CargaCie10 from '../../components/admin/CargaCie10.vue';
import Ubicaciones from '../../components/admin/Ubicaciones.vue';
import TiemposDeViaje from '../../components/admin/TiemposDeViaje.vue';

// Se puede abrir directo en una pestaña: /administracion?pestana=logistica
const pestana = ref(useRoute().query.pestana ?? 'signos');

// --- Configuración logística ----------------------------------------------
// Los niveles del BRES del centro (mínimo 2 y máximo 4 meses) mandan en todo
// el sistema: de ellos sale cuánto se pide de cada insumo.
const logistica = reactive({
  nivelMinimoMeses: 2,
  nivelMaximoMeses: 4,
  mesesPromedio: 6,
  formulaPedido: 'centro',
  semaforoRojoMeses: 12,
  semaforoAmarilloMeses: 18,
  diaCorteBres: 25,
  diaCorteReportes: 25,
  diaInventarioFisico: 28,
  diasMaximoCuarentena: 7,
  encargadoBodega: '',
  coordinadorMunicipal: '',
  cargoEncargadoBodega: 'Encargado de Bodega',
  cargoCoordinador: 'Coordinador Municipal de Salud',
  provisional: true,
});
const guardandoLogistica = ref(false);

async function cargarLogistica() {
  try {
    const { configuracion } = await inventario.configuracion();
    Object.assign(logistica, {
      nivelMinimoMeses: Number(configuracion.nivelMinimoMeses),
      nivelMaximoMeses: Number(configuracion.nivelMaximoMeses),
      mesesPromedio: configuracion.mesesPromedio,
      formulaPedido: configuracion.formulaPedido,
      semaforoRojoMeses: configuracion.semaforoRojoMeses,
      semaforoAmarilloMeses: configuracion.semaforoAmarilloMeses,
      diaCorteReportes: configuracion.diaCorteReportes,
      encargadoBodega: configuracion.encargadoBodega ?? '',
      coordinadorMunicipal: configuracion.coordinadorMunicipal ?? '',
      cargoEncargadoBodega: configuracion.cargoEncargadoBodega ?? 'Encargado de Bodega',
      cargoCoordinador: configuracion.cargoCoordinador ?? 'Coordinador Municipal de Salud',
      diaCorteBres: configuracion.diaCorteBres,
      diaInventarioFisico: configuracion.diaInventarioFisico,
      diasMaximoCuarentena: configuracion.diasMaximoCuarentena,
      provisional: configuracion.provisional,
    });
  } catch (fallo) {
    error.value = fallo.message;
  }
}

async function guardarLogistica() {
  guardandoLogistica.value = true;
  try {
    // Los tiempos del MSPAS se guardan derivados de los niveles del centro,
    // para que el cálculo de abastecimiento y el BRES digan lo mismo.
    await inventario.guardarConfiguracion({
      ...logistica,
      mesesSolicitudRecepcion: logistica.nivelMinimoMeses / 2,
      mesesFrecuenciaPedido: Math.max(0.5, logistica.nivelMaximoMeses - logistica.nivelMinimoMeses),
      encargadoBodega: logistica.encargadoBodega || null,
      coordinadorMunicipal: logistica.coordinadorMunicipal || null,
      cargoEncargadoBodega: logistica.cargoEncargadoBodega,
      cargoCoordinador: logistica.cargoCoordinador,
    });
    aviso.value = 'Parámetros logísticos guardados';
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardandoLogistica.value = false;
  }
}

// --- Lugares poblados ------------------------------------------------------
// El municipio tiene sus propias aldeas y caserios. El sistema no los inventa:
// se cargan desde un archivo que prepara la direccion.
const lugares = ref([]);
const csvTexto = ref('');
const importando = ref(false);
const resultadoCarga = ref(null);

const CATEGORIA_LUGAR = {
  aldea: 'Aldea',
  caserio: 'Caserío',
  barrio: 'Barrio',
  colonia: 'Colonia',
  otro: 'Otro',
};

async function cargarLugares() {
  try {
    lugares.value = (await catalogos.lugares()).lugares;
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function leerArchivo(evento) {
  const archivo = evento.target.files?.[0];
  if (!archivo) return;

  const lector = new FileReader();
  lector.onload = () => {
    csvTexto.value = String(lector.result ?? '');
  };
  // Los archivos del MSPAS suelen venir de Excel en Windows.
  lector.readAsText(archivo, 'UTF-8');
}

async function importarLugares() {
  error.value = '';
  aviso.value = '';
  resultadoCarga.value = null;
  importando.value = true;

  try {
    const r = await catalogos.importarLugares(csvTexto.value);
    resultadoCarga.value = r;
    aviso.value = r.mensaje;
    csvTexto.value = '';
    await cargarLugares();
  } catch (fallo) {
    error.value = fallo.message;
    resultadoCarga.value = { errores: fallo.detalles ?? [] };
  } finally {
    importando.value = false;
  }
}
const signos = ref([]);
const usuarios = ref([]);
const establecimiento = ref(null);
const totp = ref(null);
const codigoTotp = ref('');
const error = ref('');
const aviso = ref('');

// Operacion protegida en espera de la autorizacion del director.
const pendiente = ref(null);
const errorAutorizacion = ref('');
const autorizando = ref(false);

const nuevoSigno = reactive({
  codigo: '',
  descripcion: '',
  grupoEtario: 'todos',
  gravedadSugerida: 'urgente',
  orden: 0,
});

const nuevoUsuario = reactive({
  usuario: '',
  password: '',
  nombre: '',
  dpi: '',
  rol: 'preconsulta',
  esDirector: false,
});

async function cargar() {
  try {
    const [s, u, e] = await Promise.all([
      http.get('/admin/signos-peligro/todos'),
      http.get('/admin/usuarios'),
      http.get('/admin/establecimiento'),
    ]);
    signos.value = s.signos;
    usuarios.value = u.usuarios;
    establecimiento.value = e.establecimiento;
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  }
}

// Abre el dialogo y recuerda que hacer cuando el director autorice.
function pedirAutorizacion(operacion, ejecutar) {
  errorAutorizacion.value = '';
  pendiente.value = { operacion, ejecutar };
}

async function confirmarAutorizacion(autorizacion) {
  autorizando.value = true;
  errorAutorizacion.value = '';

  try {
    await pendiente.value.ejecutar(autorizacion);
    pendiente.value = null;
    aviso.value = 'Cambio aplicado y registrado en bitacora.';
    await cargar();
  } catch (fallo) {
    errorAutorizacion.value = fallo.message;
  } finally {
    autorizando.value = false;
  }
}

function crearSigno() {
  pedirAutorizacion('crear un signo de peligro', (autorizacion) =>
    http.post('/admin/signos-peligro', { ...nuevoSigno, orden: Number(nuevoSigno.orden), autorizacion }),
  );
}

function alternarSigno(signo) {
  pedirAutorizacion(`${signo.activo ? 'desactivar' : 'activar'} el signo "${signo.codigo}"`, (autorizacion) =>
    http.patch(`/admin/signos-peligro/${signo.id}`, { activo: !signo.activo, autorizacion }),
  );
}

function cambiarGravedad(signo, gravedadSugerida) {
  if (gravedadSugerida === signo.gravedadSugerida) return;
  pedirAutorizacion(`cambiar la gravedad de "${signo.codigo}"`, (autorizacion) =>
    http.patch(`/admin/signos-peligro/${signo.id}`, { gravedadSugerida, autorizacion }),
  );
}

async function crearUsuario() {
  error.value = '';
  try {
    await http.post('/admin/usuarios', {
      ...nuevoUsuario,
      dpi: nuevoUsuario.dpi || null,
    });
    aviso.value = 'Usuario creado.';
    Object.assign(nuevoUsuario, { usuario: '', password: '', nombre: '', dpi: '' });
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

function alternarUsuario(usuario) {
  pedirAutorizacion(`${usuario.activo ? 'desactivar' : 'activar'} a ${usuario.usuario}`, (autorizacion) =>
    http.patch(`/admin/usuarios/${usuario.id}/estado`, { activo: !usuario.activo, autorizacion }),
  );
}

function guardarEstablecimiento() {
  const { id, creadoEn, activo, ...datos } = establecimiento.value;
  pedirAutorizacion('modificar la configuracion del establecimiento', (autorizacion) =>
    http.patch('/admin/establecimiento', { ...datos, autorizacion }),
  );
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
    await http.post('/admin/totp/confirmar', { codigo: codigoTotp.value, secreto: totp.value.secreto });
    aviso.value = 'Segundo factor activado. Se pedira al iniciar sesion.';
    totp.value = null;
    codigoTotp.value = '';
    await cargar();
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(() => {
  cargar();
  if (pestana.value === 'logistica') cargarLogistica();
});
</script>

<template>
  <section class="space-y-4">
    <h1 class="titulo-pagina">Administración</h1>

    <nav class="flex gap-1 border-b border-slate-200 text-sm">
      <button
        v-for="p in [
          { id: 'signos', etiqueta: 'Signos de peligro' },
          { id: 'usuarios', etiqueta: 'Usuarios' },
          { id: 'establecimiento', etiqueta: 'Establecimiento' },
          { id: 'lugares', etiqueta: 'Lugares poblados' },
          { id: 'cie10', etiqueta: 'CIE-10' },
          { id: 'ubicaciones', etiqueta: 'Ubicaciones de bodega' },
          { id: 'logistica', etiqueta: 'Logística' },
          { id: 'seguridad', etiqueta: 'Seguridad' },
        ]"
        :key="p.id"
        type="button"
        class="px-3 py-2 -mb-px border-b-2"
        :class="pestana === p.id
          ? 'border-mspas-700 font-semibold text-mspas-700'
          : 'border-transparent text-slate-600 hover:text-slate-800'"
        @click="pestana = p.id; p.id === 'lugares' && cargarLugares(); p.id === 'logistica' && cargarLogistica()"
      >
        {{ p.etiqueta }}
      </button>
    </nav>

    <p v-if="aviso" class="aviso border-l-estable-500">
      {{ aviso }}
    </p>
    <p v-if="error" role="alert" class="aviso aviso-urgente">
      {{ error }}
    </p>

    <!-- Signos de peligro -->
    <div v-if="pestana === 'signos'" class="space-y-4">
      <p class="text-slate-500">
        Cambiarlos exige la autorización del director.
      </p>

      <div class="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-left text-slate-600">
            <tr>
              <th class="px-4 py-2 font-medium">Código</th>
              <th class="px-4 py-2 font-medium">Descripción</th>
              <th class="px-4 py-2 font-medium">Grupo</th>
              <th class="px-4 py-2 font-medium">Gravedad</th>
              <th class="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody class="lista">
            <tr v-for="s in signos" :key="s.id" :class="s.activo ? '' : 'opacity-50'">
              <td class="px-4 py-2 font-mono text-sm">{{ s.codigo }}</td>
              <td class="px-4 py-2">{{ s.descripcion }}</td>
              <td class="px-4 py-2 text-slate-600">{{ s.grupoEtario }}</td>
              <td class="px-4 py-2">
                <select
                  :value="s.gravedadSugerida"
                  class="rounded border border-slate-300 px-2 py-1 text-sm"
                  @change="cambiarGravedad(s, $event.target.value)"
                >
                  <option value="urgente">urgente</option>
                  <option value="moderado">moderado</option>
                </select>
              </td>
              <td class="px-4 py-2 text-right">
                <button type="button" class="enlace" @click="alternarSigno(s)">
                  {{ s.activo ? 'Desactivar' : 'Activar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <form class="bg-white rounded-lg border border-slate-200 p-6 space-y-3" @submit.prevent="crearSigno">
        <h2 class="font-medium text-slate-800">Agregar signo de peligro</h2>
        <div class="grid gap-2 sm:grid-cols-5">
          <input v-model="nuevoSigno.codigo" required placeholder="código"
            class="campo" />
          <input v-model="nuevoSigno.descripcion" required placeholder="Descripción"
            class="campo sm:col-span-2" />
          <select v-model="nuevoSigno.grupoEtario" class="campo">
            <option value="todos">todos</option>
            <option value="menor_5">menor_5</option>
            <option value="embarazada">embarazada</option>
            <option value="adulto_mayor">adulto_mayor</option>
          </select>
          <select v-model="nuevoSigno.gravedadSugerida" class="campo">
            <option value="urgente">urgente</option>
            <option value="moderado">moderado</option>
          </select>
        </div>
        <button type="submit" class="boton-primario !py-2.5">
          Agregar
        </button>
      </form>
    </div>

    <!-- Usuarios -->
    <div v-else-if="pestana === 'usuarios'" class="space-y-4">
      <div class="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-left text-slate-600">
            <tr>
              <th class="px-4 py-2 font-medium">Usuario</th>
              <th class="px-4 py-2 font-medium">Nombre</th>
              <th class="px-4 py-2 font-medium">Rol</th>
              <th class="px-4 py-2 font-medium">Estado</th>
              <th class="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody class="lista">
            <tr v-for="u in usuarios" :key="u.id" :class="u.activo ? '' : 'opacity-50'">
              <td class="px-4 py-2">
                {{ u.usuario }}
                <span v-if="u.esDirector" class="text-sm text-mspas-700">(director)</span>
                <span v-if="u.tieneTotp" class="text-slate-500">&middot; 2FA</span>
              </td>
              <td class="px-4 py-2">{{ u.nombre }}</td>
              <td class="px-4 py-2 text-slate-600">{{ u.rol }}</td>
              <td class="px-4 py-2">
                <span :class="u.activo ? 'text-slate-600' : 'text-urgente-700'">
                  {{ u.activo ? 'activo' : 'inactivo' }}
                </span>
              </td>
              <td class="px-4 py-2 text-right">
                <button type="button" class="enlace" @click="alternarUsuario(u)">
                  {{ u.activo ? 'Desactivar' : 'Activar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <form class="bg-white rounded-lg border border-slate-200 p-6 space-y-3" @submit.prevent="crearUsuario">
        <h2 class="font-medium text-slate-800">Nuevo usuario</h2>
        <div class="grid gap-2 sm:grid-cols-3">
          <input v-model="nuevoUsuario.usuario" required placeholder="usuario"
            class="campo" />
          <input v-model="nuevoUsuario.nombre" required placeholder="Nombre completo"
            class="campo" />
          <input v-model="nuevoUsuario.password" type="password" required minlength="10"
            placeholder="Contraseña (mín. 10)" class="campo" />
          <input v-model="nuevoUsuario.dpi" inputmode="numeric" maxlength="13" placeholder="DPI (opcional)"
            class="campo" />
          <select v-model="nuevoUsuario.rol" class="campo">
            <option value="preconsulta">preconsulta</option>
            <option value="medico">médico</option>
            <option value="farmacia">farmacia</option>
            <option value="bodega">bodega</option>
            <option value="admin">admin</option>
          </select>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input v-model="nuevoUsuario.esDirector" type="checkbox" class="rounded border-slate-300" />
            Es director
          </label>
        </div>
        <button type="submit" class="boton-primario !py-2.5">
          Crear usuario
        </button>
      </form>
    </div>

    <!-- Establecimiento -->
    <form
      v-else-if="pestana === 'establecimiento' && establecimiento"
      class="bg-white rounded-lg border border-slate-200 p-6 space-y-3 max-w-2xl"
      @submit.prevent="guardarEstablecimiento"
    >
      <h2 class="font-medium text-slate-800">Configuración del establecimiento</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-sm">
          <span class="block text-slate-700 mb-1">Código institucional MSPAS</span>
          <input v-model="establecimiento.codigo" class="campo" />
        </label>
        <label class="text-sm">
          <span class="block text-slate-700 mb-1">Nombre</span>
          <input v-model="establecimiento.nombre" class="campo" />
        </label>
        <label class="text-sm">
          <span class="block text-slate-700 mb-1">Municipio</span>
          <input v-model="establecimiento.municipio" class="campo" />
        </label>
        <label class="text-sm">
          <span class="block text-slate-700 mb-1">Departamento</span>
          <input v-model="establecimiento.departamento" class="campo" />
        </label>
        <label class="text-sm">
          <span class="block text-slate-700 mb-1">Tipo</span>
          <select v-model="establecimiento.tipo" class="campo">
            <option value="centro_salud_a">Centro de salud tipo A (con encamamiento)</option>
            <option value="centro_salud_b">Centro de salud tipo B (ambulatorio)</option>
            <option value="puesto_salud">Puesto de salud</option>
          </select>
        </label>
      </div>
      <button type="submit" class="boton-primario !py-2.5">
        Guardar cambios
      </button>
    </form>

    <!-- Seguridad -->
    <!-- Lugares poblados: el catalogo del municipio, cargado por la direccion -->
    <div v-else-if="pestana === 'lugares'" class="space-y-5">
      <div class="tarjeta space-y-5 p-6">
        <div>
          <h2 class="mb-1 font-semibold text-mspas-700">Cargar lugares poblados</h2>
          <p class="text-slate-500">
            Prepare un archivo CSV con las columnas
            <code class="font-mono">nombre,categoria,territorio,sector</code> y cárguelo aquí.
            Lo que ya existe se actualiza; nada se borra.
          </p>
          <p class="mt-2 text-sm text-slate-500">
            Categorías válidas: aldea, caserío, barrio, colonia, otro.
            Territorio y sector pueden ir vacíos.
          </p>
        </div>

        <div>
          <label for="archivoCsv" class="etiqueta-campo">Archivo CSV</label>
          <input
            id="archivoCsv"
            type="file"
            accept=".csv,text/csv"
            class="campo"
            @change="leerArchivo"
          />
        </div>

        <div v-if="csvTexto">
          <p class="etiqueta-campo">Contenido leído</p>
          <pre class="max-h-48 overflow-auto rounded-xl border border-slate-200 bg-slate-50
                      p-3 text-sm text-slate-700">{{ csvTexto.slice(0, 2000) }}</pre>
        </div>

        <button
          type="button"
          class="boton-primario"
          :disabled="!csvTexto || importando"
          @click="importarLugares"
        >
          {{ importando ? 'Cargando...' : 'Cargar archivo' }}
        </button>

        <!-- Las líneas con error se muestran una por una, con su número -->
        <div v-if="resultadoCarga?.errores?.length" class="aviso aviso-atencion">
          <div>
            <p class="font-medium text-slate-900">
              {{ resultadoCarga.errores.length }} línea(s) con problemas
            </p>
            <ul class="mt-1.5 list-inside list-disc text-slate-600">
              <li v-for="e in resultadoCarga.errores" :key="e.linea">
                Línea {{ e.linea }}: {{ e.mensaje }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <TiemposDeViaje />
    </div>

    <CargaCie10 v-else-if="pestana === 'cie10'" />

    <Ubicaciones v-else-if="pestana === 'ubicaciones'" />

    <!-- Parámetros logísticos -->
    <form
      v-else-if="pestana === 'logistica'"
      class="panel max-w-3xl space-y-5 p-relleno"
      @submit.prevent="guardarLogistica"
    >
      <div>
        <h2 class="font-titulo text-titulo-seccion font-medium text-tinta">BRES del centro</h2>
        <p class="mt-1 text-sm text-apagado">
          Niveles con que el centro calcula el pedido. Mandan en todo el sistema: inventario, alertas y BRES.
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <div>
          <label for="nmin" class="etiqueta-campo">Nivel mínimo (meses)</label>
          <input id="nmin" v-model.number="logistica.nivelMinimoMeses" type="number" step="0.5" min="0.5" max="24" required class="campo tabular-nums" />
        </div>
        <div>
          <label for="nmax" class="etiqueta-campo">Nivel máximo (meses)</label>
          <input id="nmax" v-model.number="logistica.nivelMaximoMeses" type="number" step="0.5" :min="logistica.nivelMinimoMeses" max="24" required class="campo tabular-nums" />
        </div>
        <div>
          <label for="mprom" class="etiqueta-campo">Meses del promedio</label>
          <input id="mprom" v-model.number="logistica.mesesPromedio" type="number" min="1" max="24" required class="campo tabular-nums" />
          <p class="mt-1 text-sm text-apagado">El MSPAS indica 6.</p>
        </div>
      </div>

      <fieldset>
        <legend class="etiqueta-campo">Cantidad a pedir</legend>
        <label class="flex items-start gap-3">
          <input v-model="logistica.formulaPedido" type="radio" value="centro" class="mt-1" />
          <span class="text-tinta-2">Fórmula del centro: máximo − existencia en bodega <span class="block text-sm text-apagado">La que acepta hoy el Área de Salud.</span></span>
        </label>
        <label class="mt-2 flex items-start gap-3">
          <input v-model="logistica.formulaPedido" type="radio" value="mspas" class="mt-1" />
          <span class="text-tinta-2">Fórmula del MSPAS: máximo − saldo total del municipio</span>
        </label>
      </fieldset>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label for="srojo" class="etiqueta-campo">Semáforo: rojo a menos de (meses)</label>
          <input id="srojo" v-model.number="logistica.semaforoRojoMeses" type="number" min="1" max="60" required class="campo tabular-nums" />
        </div>
        <div>
          <label for="samar" class="etiqueta-campo">Semáforo: amarillo hasta (meses)</label>
          <input id="samar" v-model.number="logistica.semaforoAmarilloMeses" type="number" :min="logistica.semaforoRojoMeses + 1" max="72" required class="campo tabular-nums" />
        </div>
      </div>

      <fieldset class="rounded-control border border-linea p-4">
        <legend class="px-1 font-bold text-tinta">Firmas de los formatos de bodega</legend>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="encargado" class="etiqueta-campo">Encargado de bodega</label>
            <input id="encargado" v-model="logistica.encargadoBodega" maxlength="160" placeholder="P.C. Nombre Apellido" class="campo" />
          </div>
          <div>
            <label for="cargoEncargado" class="etiqueta-campo">Cargo bajo su firma</label>
            <input id="cargoEncargado" v-model="logistica.cargoEncargadoBodega" maxlength="160" class="campo" />
          </div>
          <div>
            <label for="coordinador" class="etiqueta-campo">Visto bueno</label>
            <input id="coordinador" v-model="logistica.coordinadorMunicipal" maxlength="160" placeholder="Dr. Nombre Apellido" class="campo" />
          </div>
          <div>
            <label for="cargoCoordinador" class="etiqueta-campo">Cargo bajo su firma</label>
            <input id="cargoCoordinador" v-model="logistica.cargoCoordinador" maxlength="160" class="campo" />
          </div>
        </div>
      </fieldset>

      <div class="grid gap-4 sm:grid-cols-3">
        <div>
          <label for="corte" class="etiqueta-campo">Día de corte del BRES</label>
          <input id="corte" v-model.number="logistica.diaCorteBres" type="number" min="1" max="28" required class="campo tabular-nums" />
        </div>
        <div>
          <label for="dcrep" class="etiqueta-campo">Día de corte de los reportes de servicios</label>
          <input id="dcrep" v-model.number="logistica.diaCorteReportes" type="number" min="1" max="28" required class="campo tabular-nums" />
        </div>
        <div>
          <label for="dcua" class="etiqueta-campo">Días máximos en cuarentena</label>
          <input id="dcua" v-model.number="logistica.diasMaximoCuarentena" type="number" min="1" max="90" required class="campo tabular-nums" />
        </div>
      </div>

      <label class="flex items-start gap-3">
        <input v-model="logistica.provisional" type="checkbox" class="mt-1 h-4 w-4" />
        <span class="text-tinta-2">
          Estos valores son provisionales
          <span class="block text-sm text-apagado">
            Mientras esté marcado, toda cifra derivada de ellos se muestra señalada como
            pendiente de confirmar. Desmárquelo solo cuando el Área de Salud los haya entregado.
          </span>
        </span>
      </label>

      <button type="submit" class="boton-primario" :disabled="guardandoLogistica">
        {{ guardandoLogistica ? 'Guardando...' : 'Guardar parámetros' }}
      </button>
    </form>

    <div v-else-if="pestana === 'seguridad'" class="bg-white rounded-lg border border-slate-200 p-6 space-y-3 max-w-2xl">
      <h2 class="font-medium text-slate-800">Segundo factor de autenticación</h2>
      <p class="text-slate-600">
        Aplica solo al rol administrador. Una vez activado, se pedira el código al iniciar sesión.
      </p>

      <button
        v-if="!totp"
        type="button"
        class="boton-primario !py-2.5"
        @click="iniciarTotp"
      >
        Activar segundo factor
      </button>

      <div v-else class="space-y-3">
        <img :src="totp.qr" alt="Codigo QR para la aplicacion de autenticacion" class="w-44 h-44 border rounded" />
        <p class="text-slate-600">
          Si no puede escanear, ingrese esta clave a mano:
          <code class="bg-slate-100 px-1.5 py-0.5 rounded">{{ totp.secreto }}</code>
        </p>
        <form class="flex gap-2 items-end" @submit.prevent="confirmarTotp">
          <label class="text-sm">
            <span class="block text-slate-700 mb-1">Código de 6 dígitos</span>
            <input v-model="codigoTotp" inputmode="numeric" maxlength="6" required
              class="campo" />
          </label>
          <button type="submit" class="boton-primario !py-2.5">
            Confirmar
          </button>
        </form>
      </div>
    </div>

    <DialogoAutorizacion
      :abierto="Boolean(pendiente)"
      :operacion="pendiente?.operacion ?? ''"
      :error="errorAutorizacion"
      :enviando="autorizando"
      @confirmar="confirmarAutorizacion"
      @cancelar="pendiente = null"
    />
  </section>
</template>
