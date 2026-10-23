<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import farmacia from '../../services/farmacia';
import { nuevaClaveIdempotencia } from '../../services/almacenLocal';
import Icono from '../comunes/Icono.vue';
import { miles } from '../bodega/diseno/PiezasBodega';
import { usarBorrador } from '../../dominio/borrador';

/**
 * Cerrar el día de post-consulta: el cuaderno en línea.
 *
 * Como lo hacen a mano: al final del día cuentan lo que hay en el estante. El
 * sistema ya sabe cuántos debe haber (lo que entró de bodega menos lo
 * entregado), así que:
 *   - se revisa todo el estante, uno por uno; si cuadra, es un solo toque;
 *   - lo que se movió hoy va primero, que es donde suele haber diferencias.
 * La cantidad acepta cajas: 3x100+27 = 327. Lo contado se guarda en el equipo
 * por si los interrumpen. Lo que no cuadra pide una razón y se ajusta. Ya
 * cerrado, queda el resumen del día para copiarlo al cuaderno y al SIGSA.
 */
const emit = defineEmits(['aviso', 'error']);
const hoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const fecha = ref(hoy);
const dia = ref(null);
const quedan = reactive({});
const razon = reactive({});
const enviando = ref(false);
const RAZONES = ['Dañado', 'Se perdió', 'Error al entregar', 'Otra'];
const buscar = ref('');
// Lo contado no se pierde si los interrumpen.
const borrador = usarBorrador(() => `cierre-farmacia-${fecha.value}`, { quedan, razon }, { vacio: (d) => !Object.keys(d.quedan).length });

/** La cantidad escrita: acepta cajas, 3x100+27 = 327. Vacío es «sin contar». */
function entero(v) {
  const t = String(v ?? '').replace(/\s/g, '').replace(/[×*X]/g, 'x');
  if (!t) return null;
  if (!/^[0-9x+]+$/.test(t)) return Number(t.replace(/[^0-9]/g, '')) || 0;
  return t.split('+').filter(Boolean).reduce((s, termino) => s + termino.split('x').filter(Boolean).reduce((m, n) => m * Number(n), 1), 0);
}
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = computed(() => {
  const d = new Date(`${fecha.value}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
});

async function cargar() {
  try {
    dia.value = await farmacia.dia(fecha.value);
    for (const k of Object.keys(quedan)) delete quedan[k];
    for (const k of Object.keys(razon)) delete razon[k];
    buscar.value = '';
    if (dia.value.esHoy && !dia.value.cierre) borrador.recuperar();
  } catch (fallo) {
    emit('error', fallo.message);
  }
}
watch(fecha, cargar);
onMounted(cargar);
function mover(paso) {
  const d = new Date(`${fecha.value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + paso);
  const nueva = d.toISOString().slice(0, 10);
  if (nueva <= hoy) fecha.value = nueva;
}

// Todos los medicamentos del estante, en orden alfabético como el cuaderno.
const filas = computed(() => [...(dia.value?.filas ?? [])].sort((a, b) => sinTildes(a.nombre).localeCompare(sinTildes(b.nombre))));
const porContar = computed(() => dia.value?.esHoy && !dia.value?.cierre);
const seMovio = (f) => Boolean(f.recibido || f.entregado || f.devuelto);
// Todo se revisa a mano; lo que se movió hoy, primero.
const lista = computed(() => [...filas.value.filter(seMovio), ...filas.value.filter((f) => !seMovio(f))]);
const visibles = computed(() => {
  const q = sinTildes(buscar.value.trim());
  return q ? lista.value.filter((f) => sinTildes(f.nombre).includes(q)) : lista.value;
});
const diferencia = (f) => (entero(quedan[f.insumoId]) === null ? null : entero(quedan[f.insumoId]) - f.saldoFinal);
const cuadra = (f) => { quedan[f.insumoId] = String(f.saldoFinal); };
const contados = computed(() => filas.value.filter((f) => entero(quedan[f.insumoId]) !== null));
const contadoDe = (f) => entero(quedan[f.insumoId]);
const noCuadran = computed(() => filas.value.filter((f) => diferencia(f) !== null && diferencia(f) !== 0));
const sinRazon = computed(() => noCuadran.value.filter((f) => !razon[f.insumoId]));
const faltan = computed(() => filas.value.length - contados.value.length);
const listo = computed(() => filas.value.length > 0 && !faltan.value && !sinRazon.value.length);

/** Enter (o «siguiente» en el teclado) baja al medicamento de abajo. */
function bajar(e, i) {
  e.preventDefault();
  const sig = document.getElementById(`quedan-${i + 1}`);
  if (sig) { sig.focus(); sig.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else e.target.blur();
}

async function cerrar() {
  enviando.value = true;
  try {
    const r = await farmacia.cerrarDia({
      conteos: contados.value.map((f) => ({
        insumoId: f.insumoId,
        contado: contadoDe(f),
        ...(diferencia(f) !== 0 ? { motivo: razon[f.insumoId] } : {}),
      })),
    }, nuevaClaveIdempotencia());
    emit('aviso', r.ajustes.length
      ? `Día cerrado. ${r.ajustes.length} ${r.ajustes.length === 1 ? 'medicamento no cuadró y se ajustó' : 'medicamentos no cuadraron y se ajustaron'}.`
      : 'Día cerrado. Todo cuadró.');
    borrador.limpiar();
    await cargar();
  } catch (fallo) {
    emit('error', fallo.message);
  } finally {
    enviando.value = false;
  }
}

// Resumen para copiar: solo lo que se movió o quedó en el estante.
const resumen = computed(() => filas.value.filter((f) => f.saldoFinal || f.recibido || f.entregado || f.noEntregado));
const total = (k) => resumen.value.reduce((s, f) => s + (f[k] ?? 0), 0);
const cero = (n) => (n ? miles(n) : '–');
const hora = (v) => (v ? new Date(v).toLocaleTimeString('es-GT', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Guatemala' }) : '');
</script>

<template>
  <div class="cierre">
    <!-- Qué día -->
    <div class="dia">
      <button type="button" class="flecha" aria-label="Día anterior" @click="mover(-1)"><Icono nombre="volver" :tamano="22" :grosor="2.4" /></button>
      <div class="dia-texto">
        <b>{{ fecha === hoy ? `Hoy, ${fechaLarga}` : fechaLarga }}</b>
        <small v-if="dia?.cierre">Cerrado por {{ dia.cierre.cerradoPor }} a las {{ hora(dia.cierre.cerradoEn) }}</small>
        <small v-else-if="porContar">Falta contar y cerrar</small>
        <small v-else>No se cerró</small>
      </div>
      <button type="button" class="flecha" aria-label="Día siguiente" :disabled="fecha >= hoy" @click="mover(1)"><Icono nombre="irA" :tamano="22" :grosor="2.4" /></button>
    </div>

    <!-- ====== Contar: el cuaderno ====== -->
    <template v-if="dia && porContar">
      <div class="barra">
        <h3 class="titulo-grupo">Contados <span>{{ contados.length }} de {{ filas.length }}</span></h3>
        <label class="buscar">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" autocomplete="off" placeholder="Buscar medicamento" aria-label="Buscar medicamento" />
        </label>
      </div>
      <ul class="lista">
        <li v-for="(f, i) in visibles" :key="f.insumoId" class="med" :class="{ ok: diferencia(f) === 0, mal: diferencia(f) !== null && diferencia(f) !== 0 }">
          <div class="info">
            <b class="nombre">{{ f.nombre }}</b>
            <span class="debe">
              Debe haber <b>{{ miles(f.saldoFinal) }}</b> {{ f.unidadEntrega }}
              <span v-if="seMovio(f)" class="movio">Se movió hoy<template v-if="f.entregado"> · salieron {{ miles(f.entregado) }}</template></span>
            </span>
          </div>
          <button v-if="entero(quedan[f.insumoId]) === null" type="button" class="toque" @click="cuadra(f)">
            <Icono nombre="correcto" :tamano="20" :grosor="3" /> Hay {{ miles(f.saldoFinal) }}
          </button>
          <span v-else-if="diferencia(f) === 0" class="estado ok"><Icono nombre="correcto" :tamano="18" :grosor="3" /> Cuadra</span>
          <span v-else class="estado mal">{{ diferencia(f) > 0 ? `Sobran ${diferencia(f)}` : `Faltan ${-diferencia(f)}` }}</span>
          <label class="quedan">
            <span>{{ entero(quedan[f.insumoId]) === null ? 'Otro número' : 'Hay' }}</span>
            <input :id="`quedan-${i}`" v-model="quedan[f.insumoId]" inputmode="text" enterkeyhint="next" placeholder="—" @keydown.enter="bajar($event, i)" />
            <small v-if="/[x+]/i.test(quedan[f.insumoId] ?? '')">= {{ miles(entero(quedan[f.insumoId])) }}</small>
          </label>
          <div v-if="diferencia(f) !== null && diferencia(f) !== 0" class="razones" role="radiogroup" :aria-label="`Por qué no cuadra ${f.nombre}`">
            <span>¿Por qué?</span>
            <button v-for="r in RAZONES" :key="r" type="button" role="radio" :aria-checked="razon[f.insumoId] === r" :class="{ on: razon[f.insumoId] === r }" @click="razon[f.insumoId] = r">{{ r }}</button>
          </div>
        </li>
        <li v-if="!filas.length" class="b-vacio">No hay medicamentos en el estante.</li>
        <li v-else-if="!visibles.length" class="b-vacio">Ninguno con ese nombre.</li>
      </ul>

      <div class="pie">
        <span v-if="!listo" class="falta">{{ faltan ? `Faltan ${faltan} por contar` : `Falta la razón de ${sinRazon.length}` }}</span>
        <button type="button" class="b-btn exito cerrar-btn" :disabled="enviando || !listo" @click="cerrar">
          <Icono nombre="correcto" :tamano="22" /> {{ enviando ? 'Cerrando…' : 'Cerrar el día' }}
        </button>
      </div>
    </template>

    <!-- ====== Resumen para copiar al cuaderno y al SIGSA ====== -->
    <template v-else-if="dia">
      <div class="copiar-cabeza">
        <p><b>Resumen del día</b> para copiar al cuaderno y al SIGSA.</p>
        <RouterLink :to="`/imprimir/sigsa4/${fecha.slice(0, 7)}`" target="_blank" class="b-btn secundario chico"><Icono nombre="consolidado" :tamano="16" /> Ver el SIGSA-4 del mes</RouterLink>
      </div>
      <div v-if="resumen.length" class="b-tabla-marco">
        <table class="b-tabla copiar">
          <thead>
            <tr><th>Medicamento</th><th class="n">Entró</th><th class="n">Salió</th><th class="n">No hubo</th><th class="n">Quedan</th></tr>
          </thead>
          <tbody>
            <tr v-for="f in resumen" :key="f.insumoId">
              <td class="nombre">{{ f.nombre }}</td>
              <td class="n">{{ cero(f.recibido) }}</td>
              <td class="n">{{ cero(f.entregado) }}</td>
              <td class="n" :class="{ naranja: f.noEntregado }">{{ cero(f.noEntregado) }}</td>
              <td class="n fuerte">{{ miles(f.saldoFinal) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td>Total</td><td class="n">{{ miles(total('recibido')) }}</td><td class="n">{{ miles(total('entregado')) }}</td><td class="n">{{ miles(total('noEntregado')) }}</td><td class="n">{{ miles(total('saldoFinal')) }}</td></tr>
          </tfoot>
        </table>
      </div>
      <p v-else class="b-vacio">Este día no hubo movimiento en farmacia.</p>
    </template>
    <p v-else class="b-vacio">Cargando…</p>
  </div>
</template>

<style scoped>
.cierre { display: grid; gap: 12px; }
.dia { display: flex; align-items: center; gap: 10px; }
.flecha { display: grid; place-items: center; width: 46px; height: 46px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 14px; background: #fff; color: #172A5A; }
.flecha:disabled { color: #CBD5E1; }
.dia-texto b { display: block; font-size: 19px; font-weight: 900; color: #14244A; }
.dia-texto b::first-letter { text-transform: uppercase; }
.dia-texto small { font-size: 14px; font-weight: 700; color: #64748B; }
.avance { font-size: 15px; font-weight: 700; color: #475569; }
.avance b { color: #14244A; }
.naranja { color: #B4610A; font-weight: 900; }
.lista { display: grid; gap: 8px; }
.barra { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.buscar { display: flex; flex: 1; max-width: 420px; min-width: 0; align-items: center; gap: 8px; height: 48px; padding: 0 14px; border: 2px solid #E5E9F0; border-radius: 14px; background: #fff; color: #64748B; }
.buscar:focus-within { border-color: #4A9BD6; }
.buscar input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: 16px; font-weight: 700; color: #14244A; }
.movio { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 8px; background: #EAF3FB; color: #174E80; font-size: 12.5px; font-weight: 800; }
.med { display: grid; grid-template-columns: minmax(0, 1fr) auto 130px; align-items: center; gap: 12px; padding: 10px 14px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 16px; background: #fff; }
.med.ok { border-color: #9BD3B5; background: #F6FCF8; }
.med.mal { border-color: #F3C677; background: #FFF8EB; }
.nombre { display: block; font-size: 17px; font-weight: 900; line-height: 1.25; color: #14244A; overflow-wrap: anywhere; }
.debe { font-size: 14px; font-weight: 600; color: #475569; }
.debe b { font-size: 16px; color: #14244A; }
.quedan { display: grid; gap: 2px; min-width: 0; }
.quedan span { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; color: #64748B; }
.quedan input { width: 100%; min-width: 0; height: 52px; border: 2px solid #CBD5E1; border-radius: 14px; background: #fff; text-align: center; font-size: 22px; font-weight: 900; color: #14244A; }
.quedan input:focus { outline: none; border-color: #172A5A; box-shadow: 0 0 0 3px #DCE4F5; }
.estado { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 10px; border-radius: 12px; font-size: 14px; font-weight: 900; }
.estado.ok { background: #E2F5EA; color: #145C3C; }
.estado.mal { background: #FFE8C2; color: #8A4B00; }
.razones { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.razones span { font-size: 14px; font-weight: 800; color: #8A4B00; }
.razones button { height: 40px; padding: 0 14px; border: 2px solid #F3C677; border-radius: 12px; background: #fff; font-size: 14px; font-weight: 800; color: #6B3D00; }
.razones button.on { background: #E8930C; border-color: #B4610A; color: #fff; }
.titulo-grupo { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 900; color: #14244A; }
.titulo-grupo span { padding: 1px 10px; border-radius: 9px; background: #EAF3FB; color: #174E80; font-size: 14px; }
.toque { display: inline-flex; align-items: center; gap: 6px; height: 50px; padding: 0 16px; border: 2px solid #17784F; border-bottom-width: 4px; border-radius: 14px; background: #22A06B; color: #fff; font-size: 17px; font-weight: 900; white-space: nowrap; }
.toque:active { transform: translateY(2px); border-bottom-width: 2px; }
.toque.grande { height: 56px; font-size: 18px; }
.quedan small { font-size: 12px; font-weight: 800; color: #475569; text-align: center; }
.pie { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; padding: 12px 0; background: linear-gradient(transparent, #fff 30%); }
.falta { font-size: 14px; font-weight: 800; color: #64748B; }
.cerrar-btn { height: 56px; padding: 0 26px; font-size: 18px; border-radius: 16px; }
.copiar-cabeza { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; font-size: 15px; color: #334155; }
.copiar td, .copiar th { font-size: 16px; }
.copiar .nombre { font-size: 16px; }
.copiar .n { font-variant-numeric: tabular-nums; }
.copiar .fuerte { font-weight: 900; color: #14244A; }
.copiar tfoot td { font-weight: 900; border-top: 2px solid #CBD5E1; }
@media (max-width: 640px) {
  .med { grid-template-columns: 1fr 1fr; }
  .med .info { grid-column: 1 / -1; }
}
</style>
