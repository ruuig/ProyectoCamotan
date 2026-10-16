<script setup>
import { ref, computed } from 'vue';
import Icono from '../comunes/Icono.vue';
import { miles, estiloTono } from '../bodega/diseno/PiezasBodega';

/**
 * El día de la farmacia en una sola hoja, como un libro de inventario:
 * con cuánto abrió, qué entró de bodega, qué salió a los pacientes, qué no
 * hubo, qué se devolvió y con cuánto cierra. La tabla por medicamento es a la
 * vez el Registro diario de demanda real (salió + no hubo) que se imprime.
 */
const props = defineProps({
  dia: { type: Object, required: true },
  fecha: { type: String, required: true },
  hoy: { type: String, required: true },
});
const emit = defineEmits(['update:fecha']);

const vista = ref('medicamento');
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = computed(() => {
  const d = new Date(`${props.fecha}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
});
function mover(paso) {
  const d = new Date(`${props.fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + paso);
  const nueva = d.toISOString().slice(0, 10);
  if (nueva <= props.hoy) emit('update:fecha', nueva);
}

const filas = computed(() => props.dia.filas ?? []);
const conMovimiento = computed(() => filas.value
  .filter((f) => f.recibido || f.entregado || f.noEntregado || f.devuelto || f.ajuste)
  .sort((a, b) => (b.entregado + b.noEntregado) - (a.entregado + a.noEntregado)));
const suma = (k) => filas.value.reduce((t, f) => t + (f[k] ?? 0), 0);
const flujo = computed(() => [
  { clave: 'abrio', texto: 'Abrió con', valor: suma('saldoInicial'), signo: '' },
  { clave: 'entro', texto: 'Entró de bodega', valor: suma('recibido'), signo: '+', tono: 'bien' },
  { clave: 'salio', texto: `Salió a ${props.dia.totales.pacientes} ${props.dia.totales.pacientes === 1 ? 'paciente' : 'pacientes'}`, valor: suma('entregado'), signo: '−', tono: 'accion' },
  { clave: 'devuelto', texto: 'Devuelto a bodega', valor: suma('devuelto'), signo: '−', tono: 'neutro' },
  ...(suma('ajuste') ? [{ clave: 'ajuste', texto: 'Ajuste del conteo', valor: Math.abs(suma('ajuste')), signo: suma('ajuste') > 0 ? '+' : '−', tono: 'atencion' }] : []),
  { clave: 'cierra', texto: 'Cierra con', valor: suma('saldoFinal'), signo: '=' },
]);
const faltantes = computed(() => filas.value.filter((f) => f.noEntregado > 0));

const recibidos = computed(() => (props.dia.movimientosBodega ?? []).filter((m) => m.tipo === 'recibido'));
const devueltos = computed(() => (props.dia.movimientosBodega ?? []).filter((m) => m.tipo !== 'recibido'));
const movimientosBodega = computed(() => [...recibidos.value, ...devueltos.value].sort((a, b) => new Date(a.hora) - new Date(b.hora)));

const hora = (v) => (v ? new Date(v).toLocaleTimeString('es-GT', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Guatemala' }) : '');
const cero = (n) => (n ? miles(n) : '');
const imprimir = () => window.print();
</script>

<template>
  <div class="hoy-far">
    <!-- Qué día: flechas grandes en vez de un calendario -->
    <div class="dia no-imprimir">
      <button type="button" class="flecha" aria-label="Día anterior" @click="mover(-1)"><Icono nombre="volver" :tamano="24" :grosor="2.4" /></button>
      <div class="dia-texto">
        <b class="first-letter:uppercase">{{ fecha === hoy ? `Hoy, ${fechaLarga}` : fechaLarga }}</b>
        <small v-if="dia.cierre">Día cerrado a las {{ hora(dia.cierre.cerradoEn) }}</small>
        <small v-else-if="fecha === hoy">El día sigue abierto</small>
      </div>
      <button type="button" class="flecha" aria-label="Día siguiente" :disabled="fecha >= hoy" @click="mover(1)"><Icono nombre="irA" :tamano="24" :grosor="2.4" /></button>
      <button v-if="fecha !== hoy" type="button" class="b-btn chico secundario" @click="emit('update:fecha', hoy)">Ir a hoy</button>
      <button type="button" class="b-btn secundario ml-auto" @click="imprimir"><Icono nombre="imprimir" :tamano="20" /> Imprimir la hoja del día</button>
    </div>

    <!-- El día como una cuenta: abrió + entró − salió − devolvió = cierra -->
    <div class="flujo" aria-label="Cuenta del día">
      <template v-for="(p, i) in flujo" :key="p.clave">
        <span v-if="i" class="signo" aria-hidden="true">{{ p.signo }}</span>
        <div class="paso" :class="p.clave" :style="estiloTono(p.tono ?? 'neutro')">
          <b>{{ miles(p.valor) }}</b>
          <small>{{ p.texto }}</small>
        </div>
      </template>
    </div>

    <p v-if="faltantes.length" class="no-hubo" :style="estiloTono('atencion')">
      <Icono nombre="alerta" :tamano="20" :grosor="2.2" />
      <span><b>No hubo {{ miles(dia.totales.noEntregado) }} unidades</b> de {{ faltantes.length }} {{ faltantes.length === 1 ? 'medicamento' : 'medicamentos' }}: {{ faltantes.map((f) => f.nombre).join(', ') }}. Quedan en el SIGSA 4 como no entregado y suben el pedido.</span>
    </p>

    <!-- Tres formas de ver el mismo día -->
    <div class="b-segmentado selector no-imprimir" role="radiogroup" aria-label="Ver el día">
      <button v-for="o in [['medicamento', `Por medicamento (${conMovimiento.length})`], ['paciente', `Por paciente (${dia.entregas.length})`], ['bodega', `Con bodega (${movimientosBodega.length})`]]" :key="o[0]" type="button" role="radio" :aria-checked="vista === o[0]" :class="vista === o[0] ? 'on' : ''" @click="vista = o[0]">{{ o[1] }}</button>
    </div>

    <!-- Por medicamento = Registro diario de demanda real -->
    <section v-show="vista === 'medicamento'" class="hoja">
      <header class="hoja-cabeza">
        <h2>Registro diario de demanda real</h2>
        <p>Farmacia (post-consulta) · <span class="first-letter:uppercase">{{ fechaLarga }}</span>. Demanda real = salió + no hubo.</p>
      </header>
      <div v-if="conMovimiento.length" class="b-tabla-marco">
        <table class="b-tabla libro">
          <thead>
            <tr>
              <th>Medicamento</th>
              <th class="n">Abrió</th>
              <th class="n">Entró</th>
              <th class="n">Salió</th>
              <th class="n">No hubo</th>
              <th class="n">Devuelto</th>
              <th class="n">Cierra</th>
              <th class="n demanda">Demanda real</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in conMovimiento" :key="f.insumoId">
              <td class="nombre">{{ f.nombre }}</td>
              <td class="n gris">{{ miles(f.saldoInicial) }}</td>
              <td class="n entro">{{ cero(f.recibido) }}</td>
              <td class="n salio">{{ cero(f.entregado) }}</td>
              <td class="n falta">{{ cero(f.noEntregado) }}</td>
              <td class="n gris">{{ cero(f.devuelto) }}</td>
              <td class="n fuerte">{{ miles(f.saldoFinal) }}</td>
              <td class="n demanda"><b>{{ miles(f.entregado + f.noEntregado) }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="vacio">Este día no se movió nada en farmacia.</p>
    </section>

    <!-- Por paciente: quién se llevó qué -->
    <section v-if="vista === 'paciente'" class="lista no-imprimir">
      <p v-if="!dia.entregas.length" class="vacio">Este día no se entregó a ningún paciente.</p>
      <ul v-else>
        <li v-for="e in dia.entregas" :key="e.atencionId" class="renglon">
          <span class="hora">{{ hora(e.hora) }}</span>
          <div class="min-w-0">
            <b class="quien">{{ e.paciente.nombreCompleto }}</b>
            <span class="meds">
              <span v-for="(x, i) in e.renglones" :key="i" class="med" :title="`Lote ${x.numeroLote}`">{{ x.medicamento }} <b>× {{ x.cantidad }}</b></span>
            </span>
          </div>
          <small class="por">Entregó {{ e.entregadoPor }}</small>
        </li>
      </ul>
    </section>

    <!-- Con bodega: lo que entró y lo que regresó -->
    <section v-if="vista === 'bodega'" class="lista no-imprimir">
      <p v-if="!movimientosBodega.length" class="vacio">Este día no hubo entradas ni devoluciones. Lo que bodega despacha a farmacia entra solo aquí.</p>
      <ul v-else>
        <li v-for="(m, i) in movimientosBodega" :key="i" class="renglon" :style="estiloTono(m.tipo === 'recibido' ? 'bien' : 'neutro')">
          <span class="hora">{{ hora(m.hora) }}</span>
          <div class="min-w-0">
            <b class="quien"><span class="tipo">{{ m.tipo === 'recibido' ? 'Entró de bodega' : 'Devuelto a bodega' }}</span> {{ m.numero ?? '' }} {{ m.motivo ? `· ${m.motivo.replace('Devolución a bodega: ', '')}` : '' }}</b>
            <span class="meds">
              <span v-for="(x, k) in m.renglones" :key="k" class="med" :title="`Lote ${x.numeroLote}`">{{ x.medicamento }} <b>× {{ miles(x.cantidad) }}</b></span>
            </span>
          </div>
          <small class="por">{{ m.usuario }}</small>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.hoy-far { display: grid; gap: 14px; }
.dia { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.flecha { display: grid; place-items: center; width: 52px; height: 52px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 16px; background: #fff; color: #172A5A; }
.flecha:hover:not(:disabled) { border-color: #9FCDEC; }
.flecha:disabled { opacity: .35; }
.dia-texto { display: grid; min-width: 230px; text-align: center; }
.dia-texto b { font-size: 20px; font-weight: 900; color: #14244A; }
.dia-texto small { font-size: 13px; font-weight: 700; color: #64748B; }

.flujo { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; padding: 14px; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; }
.paso { flex: 1; min-width: 120px; display: grid; gap: 2px; padding: 10px 14px; border-radius: 14px; background: var(--t-fondo); }
.paso b { font-size: 26px; font-weight: 900; line-height: 1.1; color: var(--t-hondo); font-variant-numeric: tabular-nums; }
.paso small { font-size: 13px; font-weight: 800; color: var(--t-tinta); }
.paso.abrio, .paso.cierra { background: #F1F5F9; }
.paso.abrio b, .paso.cierra b { color: #14244A; }
.paso.cierra { box-shadow: inset 0 0 0 2px #CBD5E1; }
.signo { align-self: center; font-size: 24px; font-weight: 900; color: #94A3B8; }

.no-hubo { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 16px; background: var(--t-fondo); color: var(--t-tinta); font-size: 14.5px; font-weight: 600; }
.no-hubo svg { flex-shrink: 0; color: var(--t-hondo); }
.no-hubo b { font-weight: 900; }
.selector { justify-self: start; }

.hoja { display: grid; gap: 8px; }
.hoja-cabeza h2 { font-size: 18px; font-weight: 900; color: #14244A; }
.hoja-cabeza p { font-size: 13.5px; font-weight: 600; color: #64748B; }
.libro .nombre { font-weight: 800; color: #14244A; }
.libro .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.libro td.n { font-size: 16px; font-weight: 800; }
.libro .gris { color: #94A3B8; }
.libro .entro { color: #17784F; }
.libro .salio { color: #1F6AA5; }
.libro .falta { color: #A83232; }
.libro .fuerte { color: #14244A; font-weight: 900; }
.libro .demanda { background: #F8FAFC; }
.libro td.demanda b { font-size: 17px; font-weight: 900; color: #14244A; }

.lista ul { display: grid; border: 2px solid #E5E9F0; border-bottom-width: 4px; border-radius: 20px; background: #fff; overflow: hidden; }
.renglon { display: grid; grid-template-columns: 80px minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 12px 16px; border-top: 2px solid #F1F4F8; }
.renglon:first-child { border-top: 0; }
.hora { font-size: 15px; font-weight: 900; color: #475569; font-variant-numeric: tabular-nums; }
.quien { display: block; font-size: 16px; font-weight: 900; color: #14244A; }
.tipo { padding: 1px 8px; border-radius: 8px; background: var(--t-fondo); color: var(--t-tinta); font-size: 13px; }
.meds { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; }
.med { padding: 2px 9px; border-radius: 9px; background: #F1F5F9; font-size: 13.5px; font-weight: 600; color: #334155; }
.med b { font-weight: 900; color: #14244A; }
.por { font-size: 13px; font-weight: 600; color: #64748B; }
@media (max-width: 700px) { .renglon { grid-template-columns: 60px minmax(0, 1fr); } .por { grid-column: 2; } }
.vacio { padding: 16px; border: 2px dashed #CBD5E1; border-radius: 16px; font-weight: 700; color: #64748B; }
</style>
