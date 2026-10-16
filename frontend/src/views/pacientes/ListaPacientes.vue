<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { cronometro } from '../../dominio/cronometro';
import servicio from '../../services/pacientes';
import catalogos from '../../services/catalogos';
import Icono from '../../components/comunes/Icono.vue';
import { ETAPAS, estiloEtapa, etapaDe, iniciales } from '../../dominio/etapas';

/**
 * Búsqueda de pacientes.
 *
 * Tolera cómo se busca de verdad: sin tildes, con errores de escritura y por
 * el nombre de la madre. Cada resultado dice por qué apareció.
 *
 * La lista está pensada para recorrerse con la vista: el nombre manda, el
 * resto es una sola línea de apoyo, y las marcas de estado solo aparecen
 * cuando dicen algo. Una fila de tres renglones con la misma advertencia
 * repetida en todas deja de ser una advertencia y se vuelve ruido.
 */
const router = useRouter();
const pacientes = ref([]);
const paginacion = ref(null);
const lugares = ref([]);
const cargando = ref(false);
const error = ref('');

const filtros = reactive({
  buscar: '',
  lugarPobladoId: '',
  sexo: '',
  etapa: '',
  edadMinima: '',
  edadMaxima: '',
  embarazoActivo: '',
  fichaIncompleta: '',
  conAlertas: '',
  pagina: 1,
});


/** Cuántos filtros hay puestos, para avisarlo sin tener que abrir el panel. */
const filtrosActivos = computed(
  () =>
    Object.entries(filtros).filter(
      ([clave, valor]) => clave !== 'buscar' && clave !== 'pagina' && valor !== '',
    ).length,
);

/** La edad en dos piezas: la cifra grande y su unidad. */
function edad(p) {
  const { anios, meses } = p.edad ?? {};
  if (anios == null) return null;
  return anios >= 1
    ? { n: anios, u: anios === 1 ? 'año' : 'años' }
    : { n: meses, u: meses === 1 ? 'mes' : 'meses' };
}

/**
 * Cuánto le falta a la ficha, como número.
 * Un número sí distingue: no es lo mismo que falten dos datos que nueve.
 */
function faltan(p) {
  if (!p.ficha || p.ficha.completa) return null;
  const n = p.ficha.faltantes.length;
  return `Faltan ${n} ${n === 1 ? "dato" : "datos"}`;
}

async function buscar() {
  cargando.value = true;
  try {
    // Solo viajan los filtros con valor: la API no debe recibir cadenas vacías.
    const parametros = Object.fromEntries(
      Object.entries(filtros).filter(([, v]) => v !== '' && v != null),
    );
    const datos = await servicio.listar(parametros);
    pacientes.value = datos.pacientes;
    paginacion.value = datos.paginacion;
    error.value = '';
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    cargando.value = false;
  }
}

// Se busca al escribir, con espera: sin esto cada tecla dispara una consulta.
let temporizador;
watch(
  () => filtros.buscar,
  () => {
    clearTimeout(temporizador);
    filtros.pagina = 1;
    temporizador = setTimeout(buscar, 300);
  },
);

// Los demás filtros se aplican de inmediato.
watch(
  () => [
    filtros.lugarPobladoId, filtros.sexo, filtros.etapa, filtros.edadMinima,
    filtros.edadMaxima, filtros.embarazoActivo, filtros.fichaIncompleta, filtros.conAlertas,
  ],
  () => {
    filtros.pagina = 1;
    buscar();
  },
);

watch(() => filtros.pagina, buscar);

/** Los filtros de sí o no se encienden y se apagan con la misma ficha. */
function alternar(campo) {
  filtros[campo] = filtros[campo] === 'true' ? '' : 'true';
}

function limpiar() {
  Object.assign(filtros, {
    buscar: '', lugarPobladoId: '', sexo: '', etapa: '', edadMinima: '',
    edadMaxima: '', embarazoActivo: '', fichaIncompleta: '', conAlertas: '', pagina: 1,
  });
}

onMounted(async () => {
  await buscar();
  try {
    lugares.value = (await catalogos.lugares()).lugares;
  } catch {
    // El filtro de comunidad queda vacío; la búsqueda por texto sigue sirviendo.
  }
});

// Tiempo de consulta: de la primera tecla en la búsqueda hasta abrir la ficha.
const reloj = cronometro('consulta', 'lista_pacientes');
function abrirFicha(id) {
  reloj.terminar(id);
  router.push(`/pacientes/${id}`);
}
</script>

<template>
  <section>
    <header class="b-cabecera">
      <div class="flex items-baseline gap-4">
        <h1 class="b-titulo">Pacientes</h1>
        <span v-if="paginacion" class="b-antetitulo">{{ paginacion.total.toLocaleString('en-US') }} {{ paginacion.total === 1 ? 'registrado' : 'registrados' }}</span>
      </div>
      <RouterLink to="/pacientes/nuevo" class="b-btn primario alto"><Icono nombre="agregar" :tamano="22" :grosor="2.4" /> Registrar paciente</RouterLink>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <!-- Búsqueda -->
    <label class="buscador mt-5">
      <Icono nombre="buscar" :tamano="26" :grosor="2.4" />
      <input v-model="filtros.buscar" type="search" placeholder="Buscar por nombre, CUI, expediente o teléfono" aria-label="Buscar paciente" @input="filtros.buscar ? reloj.iniciar() : reloj.reiniciar()" />
      <button v-if="filtrosActivos > 0 || filtros.buscar" type="button" class="limpiar" @click="limpiar"><Icono nombre="cerrar" :tamano="16" :grosor="2.4" /> Limpiar</button>
    </label>

    <!-- Filtros, en tres grupos con nombre -->
    <div class="filtros mt-4">
      <div class="grupo-filtro etapas">
        <span class="g-titulo">Etapa de vida</span>
        <div class="fichas-etapa">
          <button
            v-for="e in ETAPAS"
            :key="e.valor"
            type="button"
            class="etapa"
            :class="filtros.etapa === e.valor ? 'on' : ''"
            :style="estiloEtapa(e)"
            :aria-pressed="filtros.etapa === e.valor"
            @click="filtros.etapa = filtros.etapa === e.valor ? '' : e.valor"
          >
            <span class="etapa-punto" />
            <span class="min-w-0 text-left">
              <span class="block truncate">{{ e.corta }}</span>
              <small>{{ e.rango }}</small>
            </span>
          </button>
        </div>
      </div>

      <div class="grupo-filtro">
        <span class="g-titulo">Quién</span>
        <div class="flex flex-wrap items-center gap-2">
          <div class="b-segmentado" role="radiogroup" aria-label="Sexo">
            <button v-for="o in [['', 'Todos'], ['F', 'Mujeres'], ['M', 'Hombres']]" :key="o[0]" type="button" role="radio" :aria-checked="filtros.sexo === o[0]" :class="filtros.sexo === o[0] ? 'on' : ''" @click="filtros.sexo = o[0]">{{ o[1] }}</button>
          </div>
          <span class="flex items-center gap-2">
            <input v-model="filtros.edadMinima" inputmode="numeric" placeholder="Edad desde" aria-label="Edad desde" class="b-campo edad" />
            <span class="font-bold text-apagado">a</span>
            <input v-model="filtros.edadMaxima" inputmode="numeric" placeholder="hasta" aria-label="Edad hasta" class="b-campo edad" />
          </span>
          <select v-model="filtros.lugarPobladoId" aria-label="Comunidad" class="b-campo comunidad">
            <option value="">Todas las comunidades</option>
            <option v-for="l in lugares" :key="l.id" :value="l.id">{{ l.nombre }}{{ l.sector ? ` (${l.sector})` : '' }}</option>
          </select>
        </div>
      </div>

      <div class="grupo-filtro">
        <span class="g-titulo">Marcas</span>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="marca m-embarazo" :class="filtros.embarazoActivo === 'true' ? 'on' : ''" :aria-pressed="filtros.embarazoActivo === 'true'" @click="alternar('embarazoActivo')">Embarazo</button>
          <button type="button" class="marca m-aviso" :class="filtros.conAlertas === 'true' ? 'on' : ''" :aria-pressed="filtros.conAlertas === 'true'" @click="alternar('conAlertas')"><Icono nombre="alerta" :tamano="16" :grosor="2.4" /> Con avisos clínicos</button>
          <button type="button" class="marca m-ficha" :class="filtros.fichaIncompleta === 'true' ? 'on' : ''" :aria-pressed="filtros.fichaIncompleta === 'true'" @click="alternar('fichaIncompleta')">Ficha incompleta</button>
        </div>
      </div>
    </div>

    <!-- Resultados -->
    <ul class="lista mt-5" aria-label="Pacientes">
      <li v-for="p in pacientes" :key="p.id">
        <RouterLink :to="`/pacientes/${p.id}`" class="tarjeta-p" :style="estiloEtapa(etapaDe(p))" @click.prevent="abrirFicha(p.id)">
          <span class="avatar" :title="etapaDe(p)?.corta">{{ iniciales(p) }}</span>

          <span class="min-w-0 flex-1">
            <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="nombre">{{ p.apellidos }}, {{ p.nombres }}</span>
              <span v-if="p.embarazoActivo" class="sello s-embarazo">Embarazo</span>
              <span v-if="p.conAlertas" class="sello s-aviso"><Icono nombre="alerta" :tamano="13" :grosor="2.6" /> Avisos</span>
            </span>
            <span class="linea">
              <span v-if="etapaDe(p)" class="etapa-txt">{{ etapaDe(p).corta }}</span>
              <span>{{ p.sexo === 'M' ? 'Hombre' : 'Mujer' }}</span>
              <span v-if="p.comunidad" class="inline-flex items-center gap-1"><Icono nombre="ubicacion" :tamano="14" :grosor="2.2" /> {{ p.comunidad }}</span>
              <span v-if="p.responsableNombre" class="truncate">responsable {{ p.responsableNombre }}</span>
            </span>
            <span v-if="p.razonCoincidencia" class="razon">{{ p.razonCoincidencia }}</span>
          </span>

          <span v-if="edad(p)" class="edad-g">
            <b>{{ edad(p).n }}</b>
            <small>{{ edad(p).u }}{{ p.fechaNacimientoEstimada ? ' aprox.' : '' }}</small>
          </span>

          <span class="codigo" :class="p.expedientePapel ? '' : 'sin-papel'">
            <small class="et">{{ p.expedientePapel ? 'Ficha' : 'Expediente' }}</small>
            <b>{{ p.expedientePapel || p.expediente }}</b>
            <small>{{ p.expedientePapel ? p.expediente : 'sin ficha de papel' }}</small>
          </span>

          <span class="estado-ficha" :class="faltan(p) ? 'falta' : 'ok'">
            <Icono :nombre="faltan(p) ? 'lapiz' : 'correcto'" :tamano="15" :grosor="2.4" />
            {{ faltan(p) ?? 'Ficha completa' }}
          </span>
          <Icono nombre="irA" :tamano="22" :grosor="2.6" class="flecha" />
        </RouterLink>
      </li>
      <li v-if="!cargando && !pacientes.length" class="b-vacio">Ningún paciente coincide.</li>
      <li v-if="cargando && !pacientes.length" class="b-vacio">Buscando…</li>
    </ul>

    <nav v-if="paginacion && paginacion.paginas > 1" class="mt-5 flex items-center justify-center gap-3" aria-label="Páginas">
      <button type="button" class="b-btn secundario" :disabled="paginacion.pagina <= 1" @click="filtros.pagina -= 1"><Icono nombre="volver" :tamano="18" :grosor="2.2" /> Anterior</button>
      <span class="font-bold tabular-nums text-apagado">Página <b class="text-tinta">{{ paginacion.pagina }}</b> de {{ paginacion.paginas }}</span>
      <button type="button" class="b-btn secundario" :disabled="paginacion.pagina >= paginacion.paginas" @click="filtros.pagina += 1">Siguiente <Icono nombre="irA" :tamano="18" :grosor="2.2" /></button>
    </nav>
  </section>
</template>

<style scoped>
.b-btn.alto { min-height: 52px; padding: 0 22px; font-size: 16px; }

/* --- Buscador -------------------------------------------------------------- */
.buscador {
  display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 12px 0 20px; background: #fff; color: #64748B;
  border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; transition: border-color .12s, box-shadow .12s;
}
.buscador:focus-within { border-color: #4A9BD6; border-bottom-color: #2F83C4; box-shadow: 0 0 0 4px rgba(74, 155, 214, .15); color: #2F83C4; }
.buscador input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: 19px; font-weight: 700; color: #14244A; }
.buscador input::placeholder { font-weight: 600; color: #94A3B8; }
.limpiar { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 12px; background: #F1F4F8; font-weight: 800; font-size: 14px; color: #475569; }

/* --- Filtros ---------------------------------------------------------------- */
.filtros { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 12px; }
.filtros .etapas { grid-column: 1 / -1; }
@media (max-width: 1100px) { .filtros { grid-template-columns: 1fr; } }
.grupo-filtro { padding: 12px 14px; background: #fff; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 18px; }
.g-titulo { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; color: #64748B; }
.fichas-etapa { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 800px) { .fichas-etapa { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.etapa {
  display: flex; align-items: center; gap: 10px; min-height: 58px; padding: 8px 12px; border-radius: 16px; background: #fff;
  border: 2px solid #E5E9F0; border-bottom-width: 4px; font-weight: 800; color: #334155; transition: transform .06s, background .12s;
}
.etapa small { display: block; font-size: 12px; font-weight: 700; color: #64748B; }
.etapa:hover { border-color: var(--et); }
.etapa:active { transform: translateY(2px); border-bottom-width: 2px; }
.etapa.on { background: var(--et-fondo); border-color: var(--et); border-bottom-color: var(--et-tinta); color: var(--et-tinta); }
.etapa.on small { color: var(--et-tinta); }
.etapa-punto { flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; background: var(--et); box-shadow: inset 0 -3px 0 rgba(0, 0, 0, .18); }
.edad { width: 110px; height: 44px; }
.comunidad { width: 240px; height: 44px; }
.marca {
  display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 14px; border-radius: 14px; background: #fff;
  border: 2px solid #E5E9F0; border-bottom-width: 4px; font-weight: 800; font-size: 14px; color: #334155; transition: transform .06s;
}
.marca:active { transform: translateY(2px); border-bottom-width: 2px; }
.m-embarazo { --m: #C8456A; --m-fondo: #FBE3EA; --m-tinta: #922845; }
.m-aviso { --m: #D64545; --m-fondo: #FDECEC; --m-tinta: #8C2323; }
.m-ficha { --m: #E8930C; --m-fondo: #FFF4E0; --m-tinta: #8A4B00; }
.marca:hover { border-color: var(--m); }
.marca.on { background: var(--m-fondo); border-color: var(--m); color: var(--m-tinta); }

/* --- Tarjetas de paciente ---------------------------------------------------- */
.lista { display: flex; flex-direction: column; gap: 10px; }
.tarjeta-p {
  --et: #94A3B8; --et-fondo: #F1F4F8; --et-tinta: #475569;
  display: flex; align-items: center; gap: 16px; min-height: 88px; padding: 12px 16px; background: #fff;
  border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; transition: border-color .12s, transform .06s;
}
.tarjeta-p:hover { border-color: var(--et); }
.tarjeta-p:active { transform: translateY(2px); border-bottom-width: 2px; }
.avatar {
  display: grid; place-items: center; flex-shrink: 0; width: 56px; height: 56px; border-radius: 50%;
  background: var(--et); color: #fff; font-size: 20px; font-weight: 900; letter-spacing: .02em; box-shadow: inset 0 -4px 0 rgba(0, 0, 0, .18);
}
.nombre { font-size: 18px; font-weight: 900; line-height: 1.2; color: #14244A; }
.linea { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 3px; font-size: 14px; font-weight: 700; color: #64748B; }
.etapa-txt { padding: 1px 9px; border-radius: 8px; background: var(--et-fondo); color: var(--et-tinta); font-weight: 800; font-size: 12.5px; }
.razon { display: block; margin-top: 3px; font-size: 13px; font-weight: 800; color: #1F6AA5; }
.sello { display: inline-flex; align-items: center; gap: 4px; padding: 1px 9px; border-radius: 8px; font-size: 12px; font-weight: 800; }
.s-embarazo { background: #FBE3EA; color: #922845; }
.s-aviso { background: #FDECEC; color: #8C2323; }
.edad-g { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 82px; line-height: 1; }
.edad-g b { font-size: 30px; font-weight: 900; color: #14244A; font-variant-numeric: tabular-nums; }
.edad-g small { margin-top: 4px; font-size: 12px; font-weight: 800; color: #64748B; white-space: nowrap; }
.codigo {
  display: inline-flex; flex-direction: column; align-items: center; flex-shrink: 0; min-width: 112px; padding: 4px 10px;
  border: 2px solid #172A5A; border-bottom-width: 4px; border-radius: 14px; line-height: 1.15;
}
.codigo .et { font-size: 10px; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; color: #64748B; }
.codigo b { font-size: 20px; font-weight: 900; color: #172A5A; font-variant-numeric: tabular-nums; }
.codigo small { font-size: 11px; font-weight: 700; color: #64748B; font-variant-numeric: tabular-nums; }
.codigo.sin-papel { border-color: #CBD5E1; }
.codigo.sin-papel b { font-size: 15px; }
.estado-ficha { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; width: 150px; font-size: 13px; font-weight: 800; }
.estado-ficha.falta { color: #8A4B00; }
.estado-ficha.ok { color: #17784F; }
.flecha { flex-shrink: 0; color: #94A3B8; }
.tarjeta-p:hover .flecha { color: var(--et-tinta); }
@media (max-width: 900px) {
  .estado-ficha { display: none; }
}
@media (max-width: 640px) {
  .tarjeta-p { flex-wrap: wrap; gap: 12px; }
  .tarjeta-p > .min-w-0 { flex-basis: calc(100% - 72px); }
  .avatar { width: 46px; height: 46px; font-size: 17px; }
  .flecha { display: none; }
  .comunidad { width: 100%; }
}
</style>
