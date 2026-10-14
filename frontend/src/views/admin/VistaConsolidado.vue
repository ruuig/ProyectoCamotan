<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import indicadores from '../../services/indicadores';
import inventario from '../../services/inventario';
import bodega from '../../services/bodega';
import sigsa from '../../services/sigsa';
import http from '../../services/http';
import Icono from '../../components/comunes/Icono.vue';

/**
 * Consolidado del mes: los documentos que se imprimen o se entregan (SIGSA y
 * bodega) con su estado, y los indicadores de atención del mismo mes.
 */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const mesActual = hoy.slice(0, 7);

const mes = ref(mesActual);
const pestana = ref('documentos');
const datos = ref(null);
const estado = ref({});
const error = ref('');
const cargando = ref(false);
const descargando = ref('');

const nombreMes = computed(() => {
  const [a, m] = mes.value.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
});
const rango = computed(() => {
  const [a, m] = mes.value.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const hasta = mes.value === mesActual ? hoy : `${mes.value}-${String(ultimo).padStart(2, '0')}`;
  return { desde: `${mes.value}-01`, hasta };
});

function moverMes(paso) {
  const [a, m] = mes.value.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + paso, 1));
  const nuevo = d.toISOString().slice(0, 7);
  if (nuevo <= mesActual) mes.value = nuevo;
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Cada consulta se pide por separado: si una falla, las demás se muestran.
async function intentar(promesa) {
  try {
    return await promesa;
  } catch {
    return null;
  }
}

async function cargar() {
  cargando.value = true;
  error.value = '';
  const periodo = mes.value;
  const [consolidado, tresCs, cuatro, bres, reportes, cierre, semaforo] = await Promise.all([
    intentar(indicadores.consolidado(periodo)),
    intentar(sigsa.tresCs(rango.value)),
    intentar(inventario.sigsa4(periodo)),
    intentar(inventario.bresDe(periodo)),
    intentar(bodega.estadoReportes(periodo)),
    intentar(bodega.inventarioCierre({ periodo })),
    intentar(bodega.semaforo({})),
  ]);
  if (periodo !== mes.value) return;
  datos.value = consolidado;
  if (!consolidado) error.value = 'No se pudo cargar el consolidado del mes.';
  estado.value = { tresCs, cuatro, bres: bres?.bres ?? null, reportes, cierre, semaforo };
  cargando.value = false;
}

async function descargar(clave, ruta, nombre) {
  descargando.value = clave;
  error.value = '';
  try {
    const url = await http.descargarArchivo(ruta);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    descargando.value = '';
  }
}

const consulta = (p) => new URLSearchParams(p).toString();

/* ---------- Documentos ---------- */
/** Estado del SIGSA-4: sin entregas, con firmas pendientes o completo. */
function selloSigsa4(totalEntregas, sinConstancia) {
  if (!totalEntregas) return { tono: 'vacio', texto: 'Sin entregas' };
  if (sinConstancia) return { tono: 'pendiente', texto: 'Faltan firmas' };
  return { tono: 'listo', texto: 'Completo' };
}

const documentosSigsa = computed(() => {
  const { tresCs, cuatro } = estado.value;
  const consultas = tresCs?.renglones.length ?? 0;
  const entregas = cuatro?.renglones ?? [];
  // Entregas de farmacia que todavía no tienen constancia de quien recibió.
  const sinConstancia = entregas.filter((entrega) => !entrega.constancia).length;
  return [
    {
      clave: 'sigsa3cs',
      codigo: 'FOR-SIGSA-3CS',
      nombre: 'Registro diario de consulta',
      color: '#3D7BE0',
      detalle: tresCs ? plural(consultas, 'consulta cerrada', 'consultas cerradas') : 'Sin datos',
      sello: consultas ? { tono: 'listo', texto: 'Con datos' } : { tono: 'vacio', texto: 'Sin consultas' },
      imprimir: `/imprimir/sigsa3cs?${consulta(rango.value)}`,
      excel: () => descargar('sigsa3cs', `/sigsa/3cs/excel?${consulta(rango.value)}`, `sigsa3cs-${mes.value}.xlsx`),
      abrir: '/sigsa',
    },
    {
      clave: 'sigsa4',
      codigo: 'FOR-SIGSA-4',
      nombre: 'Registro diario de post-consulta',
      color: '#9466D6',
      detalle: cuatro
        ? `${plural(entregas.length, 'renglón', 'renglones')}${sinConstancia ? ` · ${sinConstancia} sin constancia` : ''}`
        : 'Sin datos',
      sello: selloSigsa4(entregas.length, sinConstancia),
      imprimir: `/imprimir/sigsa4/${mes.value}`,
      abrir: '/dispensacion',
    },
  ];
});

const documentosBodega = computed(() => {
  const delMes = estado.value;
  const servicios = delMes.reportes?.servicios ?? [];
  const recibidos = servicios.filter((servicio) => servicio.reportado).length;
  const filasCierre = delMes.cierre?.filas?.length ?? 0;
  const semaforo = delMes.semaforo?.resumen;
  const bres = delMes.bres;
  return [
    {
      clave: 'bres',
      codigo: 'BRES',
      nombre: 'Balance, requisición y envío de suministros',
      color: '#2FA772',
      detalle: bres ? `${plural(bres.renglones?.length ?? 0, 'insumo', 'insumos')}` : 'Aún no se ha generado',
      sello: !bres
        ? { tono: 'vacio', texto: 'Sin generar' }
        : bres.estado === 'cerrado' ? { tono: 'listo', texto: 'Cerrado' } : { tono: 'pendiente', texto: 'Generado' },
      imprimir: bres ? `/imprimir/bres/${mes.value}` : null,
      excel: bres ? () => descargar('bres', `/bodega/bres/${mes.value}/excel?orden=alfabetico`, `bres-${mes.value}.xlsx`) : null,
      abrir: '/inventario/bres',
    },
    {
      clave: 'balance',
      codigo: 'Balance',
      nombre: 'Balance por servicio',
      color: '#F08A3C',
      detalle: servicios.length ? `${recibidos} de ${servicios.length} servicios reportaron` : 'Sin servicios',
      sello: !servicios.length || !recibidos
        ? { tono: 'vacio', texto: 'Sin reportes' }
        : recibidos < servicios.length ? { tono: 'pendiente', texto: 'Incompleto' } : { tono: 'listo', texto: 'Completo' },
      imprimir: `/imprimir/balance/${mes.value}`,
      excel: () => descargar('balance', `/bodega/balance/${mes.value}/excel?orden=alfabetico`, `balance-${mes.value}.xlsx`),
      abrir: '/inventario/reportes',
    },
    {
      clave: 'cierre',
      codigo: 'Cierre',
      nombre: 'Inventario de cierre de medicamentos',
      color: '#E5AE2B',
      detalle: delMes.cierre ? `${plural(filasCierre, 'insumo', 'insumos')} · corte el día ${delMes.cierre.diaCorte}` : 'Sin datos',
      sello: filasCierre ? { tono: 'listo', texto: delMes.cierre.fuente === 'excel' ? 'Histórico' : 'Del sistema' } : { tono: 'vacio', texto: 'Sin datos' },
      imprimir: `/imprimir/cierre/${mes.value}`,
      abrir: '/inventario/cierre',
    },
    {
      clave: 'semaforo',
      codigo: 'Semáforo',
      nombre: 'Semáforo de vencimientos',
      color: '#C8456A',
      detalle: semaforo ? `${semaforo.vencido} vencidos · ${semaforo.rojo} en rojo · ${semaforo.amarillo} en amarillo` : 'Sin datos',
      sello: { tono: 'hoy', texto: 'Al día de hoy' },
      imprimir: '/imprimir/semaforo',
      abrir: '/inventario/semaforo',
    },
  ];
});

const OTROS = [
  { texto: 'Tarjeta de control', donde: 'Existencias de cada insumo', a: '/inventario/productos' },
  { texto: 'Requisiciones', donde: 'Requisiciones', a: '/inventario/requisiciones' },
  { texto: 'Oficios de baja', donde: 'Bajas y retiros', a: '/inventario/bajas' },
  { texto: 'Ficha, resumen y referencia', donde: 'Expediente de cada paciente', a: '/pacientes' },
];

/* ---------- Indicadores ---------- */
const maxGrupo = computed(() => Math.max(1, ...(datos.value?.atencionesPorGrupo ?? []).map((g) => g.total)));
const maxDiagnostico = computed(() => Math.max(1, ...(datos.value?.diagnosticos ?? []).map((d) => d.veces)));
const GRAVEDAD = { urgente: 'Urgente', moderado: 'Moderado', leve: 'Leve' };
const COLOR_GRAVEDAD = { urgente: '#D9534F', moderado: '#E5AE2B', leve: '#2FA772' };

watch(mes, cargar);
onMounted(cargar);
</script>

<template>
  <div class="b-hoja">
    <nav class="b-carpetas" aria-label="Consolidado">
      <button type="button" class="b-carpeta" :class="pestana === 'documentos' ? 'activa' : ''" :aria-current="pestana === 'documentos' ? 'page' : undefined" @click="pestana = 'documentos'">
        Documentos del mes
      </button>
      <button type="button" class="b-carpeta" :class="pestana === 'indicadores' ? 'activa' : ''" :aria-current="pestana === 'indicadores' ? 'page' : undefined" @click="pestana = 'indicadores'">
        Indicadores
      </button>
    </nav>

    <div class="b-cuerpo">
      <header class="b-cabecera">
        <div>
          <span class="b-antetitulo">Consolidado</span>
          <h1 class="b-titulo mt-1 first-letter:uppercase">{{ nombreMes }}</h1>
        </div>
        <div class="b-acciones">
          <div class="selector-mes" role="group" aria-label="Mes">
            <button type="button" aria-label="Mes anterior" @click="moverMes(-1)"><Icono nombre="volver" :tamano="20" :grosor="2.2" /></button>
            <span class="first-letter:uppercase">{{ nombreMes }}</span>
            <button type="button" aria-label="Mes siguiente" :disabled="mes >= mesActual" @click="moverMes(1)"><Icono nombre="irA" :tamano="20" :grosor="2.2" /></button>
          </div>
        </div>
      </header>

      <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

      <!-- ===================== Documentos ===================== -->
      <div v-if="pestana === 'documentos'" class="mt-5 space-y-5" :class="cargando ? 'opacity-60' : ''">
        <section class="b-panel">
          <template v-for="grupo in [{ titulo: 'SIGSA', docs: documentosSigsa }, { titulo: 'Bodega', docs: documentosBodega }]" :key="grupo.titulo">
            <h2 class="grupo">{{ grupo.titulo }}</h2>
            <ul>
              <li v-for="d in grupo.docs" :key="d.clave" class="doc" :style="{ '--doc': d.color }">
                <span class="doc-codigo">{{ d.codigo }}</span>
                <div class="doc-info">
                  <RouterLink :to="d.abrir" class="doc-nombre">{{ d.nombre }}</RouterLink>
                  <span class="doc-detalle">{{ d.detalle }}</span>
                </div>
                <span class="sello" :class="d.sello.tono">{{ d.sello.texto }}</span>
                <div class="doc-acciones">
                  <button v-if="d.excel" type="button" class="b-btn secundario chico" :disabled="descargando === d.clave" @click="d.excel()">
                    <Icono nombre="hojaCalculo" :tamano="16" /> Excel
                  </button>
                  <RouterLink v-if="d.imprimir" :to="d.imprimir" target="_blank" class="b-btn primario chico">
                    <Icono nombre="imprimir" :tamano="16" /> Imprimir
                  </RouterLink>
                  <span v-else class="b-btn secundario chico pointer-events-none opacity-50"><Icono nombre="imprimir" :tamano="16" /> Imprimir</span>
                </div>
              </li>
            </ul>
          </template>
        </section>

        <section class="b-panel">
          <header class="b-panel-cabeza">
            <h2 class="b-panel-titulo">Documentos de cada registro</h2>
          </header>
          <div class="otros">
            <RouterLink v-for="o in OTROS" :key="o.texto" :to="o.a" class="otro">
              <span>
                <b>{{ o.texto }}</b>
                <small>{{ o.donde }}</small>
              </span>
              <Icono nombre="irA" :tamano="18" :grosor="2.2" />
            </RouterLink>
          </div>
        </section>
      </div>

      <!-- ===================== Indicadores ===================== -->
      <div v-else-if="datos" class="mt-5 space-y-5" :class="cargando ? 'opacity-60' : ''">
        <div class="b-franja">
          <div class="b-cifra"><span class="n">{{ datos.resumen.atencionesRegistradas }}</span><span class="e">Atenciones</span></div>
          <div class="b-cifra"><span class="n">{{ datos.resumen.atendidas }}</span><span class="e">Concluidas</span></div>
          <div class="b-cifra" style="color: #B23A3A"><span class="n">{{ datos.resumen.urgentes }}</span><span class="e">Urgentes</span></div>
          <div class="b-cifra"><span class="n">{{ datos.resumen.ausentes }}</span><span class="e">Ausentes</span></div>
          <div class="b-cifra" style="color: #8A5A06"><span class="n">{{ datos.resumen.sinCodificar }}</span><span class="e">Sin CIE-10</span></div>
        </div>

        <div class="grid gap-5 lg:grid-cols-2">
          <section class="b-panel">
            <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Atenciones por grupo de edad</h2></header>
            <div class="b-panel-cuerpo">
              <table class="w-full text-[15px]">
                <thead>
                  <tr class="text-left text-sm text-apagado">
                    <th class="pb-2 font-bold">Grupo</th>
                    <th class="pb-2 text-right font-bold">M</th>
                    <th class="pb-2 text-right font-bold">F</th>
                    <th class="pb-2 pl-4 font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="g in datos.atencionesPorGrupo" :key="g.grupo" class="border-t border-slate-100">
                    <td class="py-2 text-tinta">{{ g.grupo === '60 años y mas' ? '60 años y más' : g.grupo }}</td>
                    <td class="py-2 text-right tabular-nums">{{ g.M }}</td>
                    <td class="py-2 text-right tabular-nums">{{ g.F }}</td>
                    <td class="w-[42%] py-2 pl-4">
                      <div class="barra-fila">
                        <span class="barra"><span :style="{ width: `${(g.total / maxGrupo) * 100}%` }" /></span>
                        <b class="tabular-nums">{{ g.total }}</b>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="b-panel">
            <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Tiempo de espera por prioridad</h2></header>
            <ul class="b-panel-cuerpo space-y-1">
              <li v-for="t in datos.tiemposEspera" :key="t.gravedad" class="espera">
                <span class="punto" :style="{ background: COLOR_GRAVEDAD[t.gravedad] ?? '#94A3B8' }" />
                <span class="flex-1 font-semibold text-tinta">{{ GRAVEDAD[t.gravedad] ?? t.gravedad }}</span>
                <span class="text-sm text-apagado">{{ plural(t.casos, 'caso', 'casos') }}</span>
                <b class="w-[90px] text-right tabular-nums text-tinta">{{ t.promedioMin === null ? '—' : `${t.promedioMin} min` }}</b>
              </li>
            </ul>
          </section>
        </div>

        <div class="grid gap-5 lg:grid-cols-2">
          <section class="b-panel">
            <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Diagnósticos CIE-10</h2></header>
            <div class="b-panel-cuerpo lista-alta">
              <p v-if="!datos.diagnosticos.length" class="b-vacio">Sin diagnósticos codificados en el mes.</p>
              <ul v-else class="space-y-2">
                <li v-for="d in datos.diagnosticos" :key="d.codigo" class="diag">
                  <span class="font-mono text-sm font-bold text-tinta">{{ d.codigo }}</span>
                  <span class="min-w-0 flex-1 truncate">{{ d.descripcion }}</span>
                  <span class="barra corta"><span :style="{ width: `${(d.veces / maxDiagnostico) * 100}%` }" /></span>
                  <b class="w-8 text-right tabular-nums">{{ d.veces }}</b>
                </li>
              </ul>
            </div>
          </section>

          <section class="b-panel">
            <header class="b-panel-cabeza"><h2 class="b-panel-titulo">Medicamentos entregados</h2></header>
            <div class="b-panel-cuerpo lista-alta">
              <p v-if="!datos.consumoInsumos.length" class="b-vacio">Sin entregas registradas en el mes.</p>
              <ul v-else>
                <li v-for="c in datos.consumoInsumos" :key="c.nombreGenerico" class="flex justify-between gap-4 border-t border-slate-100 py-2 first:border-t-0">
                  <span>{{ c.nombreGenerico }}</span>
                  <span class="whitespace-nowrap tabular-nums text-tinta"><b>{{ c.consumo }}</b> {{ c.unidadMedida }}</span>
                </li>
              </ul>
            </div>
          </section>
        </div>
      </div>

      <p v-else-if="cargando" class="b-vacio mt-6">Cargando…</p>
    </div>
  </div>
</template>

<style scoped>
.selector-mes { display: inline-flex; align-items: center; height: 46px; border: 2px solid #CBD5E1; border-radius: 12px; background: #fff; }
.selector-mes span { min-width: 150px; padding: 0 6px; text-align: center; font-weight: 700; color: #14244A; }
.selector-mes button { display: grid; place-items: center; width: 42px; height: 100%; color: #475569; }
.selector-mes button:hover:not(:disabled) { color: #172A5A; background: #F1F5F9; }
.selector-mes button:first-child { border-radius: 10px 0 0 10px; }
.selector-mes button:last-child { border-radius: 0 10px 10px 0; }
.selector-mes button:disabled { opacity: .3; cursor: not-allowed; }

.grupo { padding: 10px 20px; background: #F6F8FB; border-bottom: 2px solid #EEF2F6; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #475569; }
.grupo:first-child { border-radius: 14px 14px 0 0; }
ul + .grupo { border-top: 2px solid #EEF2F6; }
.doc {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 130px 220px;
  align-items: center;
  gap: 16px;
  padding: 11px 20px;
  border-top: 2px solid #EEF2F6;
  box-shadow: inset 4px 0 0 var(--doc);
}
.doc:first-child { border-top: none; }
.doc-info { display: flex; flex-direction: column; min-width: 0; }
.doc-codigo { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; letter-spacing: .03em; color: #475569; }
.doc-nombre { font-size: 16px; font-weight: 700; color: #14244A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.doc-nombre:hover { text-decoration: underline; }
.doc-detalle { font-size: 13px; color: #64748B; }
.doc-acciones { display: flex; justify-content: flex-end; gap: 6px; }
.sello { justify-self: start; }

.sello { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.sello.listo { background: #E3F4EA; color: #17663F; }
.sello.pendiente { background: #FDF0D5; color: #8A5A06; }
.sello.vacio { background: #EEF2F6; color: #64748B; }
.sello.hoy { background: #E6EEFB; color: #2A4F8F; }

.otros { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.otro { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px; border-right: 2px solid #EEF2F6; color: #64748B; }
.otro:last-child { border-right: none; }
.otro:hover { background: #F8FAFC; color: #172A5A; }
.otro b { display: block; font-size: 15px; color: #14244A; }
.otro small { font-size: 13px; }

.barra-fila { display: flex; align-items: center; gap: 10px; }
.barra { flex: 1; height: 8px; border-radius: 4px; background: #EEF2F6; overflow: hidden; }
.barra > span { display: block; height: 100%; border-radius: 4px; background: #3D7BE0; }
.barra.corta { flex: 0 0 90px; }
.barra.corta > span { background: #9466D6; }

.espera { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid #F1F5F9; }
.espera:first-child { border-top: none; }
.punto { width: 10px; height: 10px; border-radius: 3px; }
.diag { display: flex; align-items: center; gap: 12px; }
.lista-alta { max-height: 300px; overflow-y: auto; }

@media (max-width: 900px) {
  .otros { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .otro:nth-child(2) { border-right: none; }
}
@media (max-width: 1100px) {
  .doc { grid-template-columns: minmax(0, 1fr) auto; }
  .doc-codigo { grid-column: 1 / -1; margin-bottom: -12px; }
  .sello { display: none; }
}
@media (max-width: 640px) {
  .doc { grid-template-columns: 1fr; }
  .otros { grid-template-columns: 1fr; }
  .otro { border-right: none; border-top: 2px solid #EEF2F6; }
}
/* --- Relieve (estilo duo) --- */
.selector-mes { border-color: #E2E8F0; border-bottom-width: 4px; border-radius: 14px; }
</style>
