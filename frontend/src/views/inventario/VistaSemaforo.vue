<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import bodega from '../../services/bodega';
import Icono from '../../components/comunes/Icono.vue';
import Pictograma from '../../components/bodega/diseno/Pictograma.vue';
import SelloVence from '../../components/bodega/diseno/SelloVence.vue';
import { CATEGORIA, estiloCategoria, miles } from '../../components/bodega/diseno/PiezasBodega';

/**
 * Vencimientos: todos los lotes con existencia, agrupados por el mes en que
 * vencen, del más urgente al más lejano. Las cifras de arriba filtran.
 */
const datos = ref(null);
const error = ref('');
const color = ref('');
const categoriaFiltro = ref('');
const buscar = ref('');

onMounted(async () => {
  try {
    datos.value = await bodega.semaforo({});
  } catch (fallo) {
    error.value = fallo.message;
  }
});

const COLORES = computed(() => {
  const r = datos.value?.rangos ?? { rojo: 12, amarillo: 18 };
  // Las tres luces, de lo que hay que entregar primero a lo que puede esperar.
  return [
    { clave: 'rojo', nombre: 'Rojo', texto: `menos de ${r.rojo} meses`, luz: '#E03131', tinta: '#A52A2A', fondo: '#FDECEC' },
    { clave: 'amarillo', nombre: 'Amarillo', texto: `${r.rojo} a ${r.amarillo} meses`, luz: '#F2B705', tinta: '#8A5A06', fondo: '#FFF7DB' },
    { clave: 'verde', nombre: 'Verde', texto: `más de ${r.amarillo} meses`, luz: '#22A06B', tinta: '#145C3C', fondo: '#E7F6EE' },
  ];
});

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const lotes = computed(() => {
  const clave = sinTildes(buscar.value.trim());
  return (datos.value?.filas ?? [])
    .filter((f) => !categoriaFiltro.value || f.categoria === categoriaFiltro.value)
    .filter((f) => !clave || sinTildes(`${f.nombre} ${f.codigoInterno}`).includes(clave) || f.lotes.some((l) => sinTildes(l.numeroLote).includes(clave)))
    .flatMap((f) => f.lotes.filter((l) => color.value === 'sin_fecha' || l.semaforo !== 'sin_fecha').map((l) => ({ ...l, insumo: f })))
    .filter((l) => !color.value || l.semaforo === color.value)
    .sort((a, b) => new Date(a.fechaVence) - new Date(b.fechaVence));
});

/** Grupos por mes de vencimiento; los vencidos van juntos al principio. */
const grupos = computed(() => {
  const mapa = new Map();
  for (const l of lotes.value) {
    const d = new Date(l.fechaVence);
    const clave = l.semaforo === 'vencido' ? 'vencido' : l.semaforo === 'sin_fecha' ? 'sin_fecha' : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave,
        titulo: clave === 'vencido' ? 'Ya vencidos' : clave === 'sin_fecha' ? 'Sin lote ni vencimiento' : `${MESES[d.getUTCMonth()][0].toUpperCase()}${MESES[d.getUTCMonth()].slice(1)} ${d.getUTCFullYear()}`,
        semaforo: l.semaforo,
        lotes: [],
      });
    }
    mapa.get(clave).lotes.push(l);
  }
  return [...mapa.values()].map((g) => ({ ...g, unidades: g.lotes.reduce((s, l) => s + l.cantidad, 0) }));
});

const enlaceImprimir = computed(() => {
  const q = new URLSearchParams({ orden: 'semaforo', ...(color.value ? { color: color.value } : {}), ...(categoriaFiltro.value ? { categoria: categoriaFiltro.value } : {}) });
  return `/imprimir/semaforo?${q}`;
});
</script>

<template>
  <section>
    <header class="b-cabecera">
      <h1 class="b-titulo">Semáforo</h1>
      <div class="b-acciones">
        <RouterLink :to="enlaceImprimir" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> Imprimir semáforo</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <template v-if="datos">
      <div class="semaforo mt-5" role="radiogroup" aria-label="Qué lotes ver">
        <button type="button" role="radio" class="luz todos" :class="{ on: !color }" :aria-checked="!color" @click="color = ''">
          <span class="foco"><Icono nombre="inventario" :tamano="22" /></span>
          <span class="dato"><b>{{ datos.resumen.rojo + datos.resumen.amarillo + datos.resumen.verde + datos.resumen.vencido }}</b><small>Todos</small></span>
        </button>
        <button
          v-for="c in COLORES"
          :key="c.clave"
          type="button"
          role="radio"
          class="luz"
          :class="{ on: color === c.clave }"
          :style="{ '--luz': c.luz, '--tinta': c.tinta, '--fondo': c.fondo }"
          :aria-checked="color === c.clave"
          @click="color = c.clave"
        >
          <span class="foco" />
          <span class="dato"><b>{{ datos.resumen[c.clave] }}</b><small><strong>{{ c.nombre }}</strong> · {{ c.texto }}</small></span>
          <span v-if="color === c.clave" class="marca"><Icono nombre="correcto" :tamano="18" /></span>
        </button>
      </div>
      <div class="aparte mt-3">
        <button v-if="datos.resumen.vencido" type="button" class="luz-chica vencido" :class="{ on: color === 'vencido' }" @click="color = 'vencido'">
          <Icono nombre="alerta" :tamano="18" /> Vencidos <b>{{ datos.resumen.vencido }}</b>
        </button>
        <button v-if="datos.resumen.sinFecha" type="button" class="luz-chica gris" :class="{ on: color === 'sin_fecha' }" @click="color = 'sin_fecha'">
          <Icono nombre="lapiz" :tamano="18" /> Sin lote <b>{{ datos.resumen.sinFecha }}</b>
        </button>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <label class="b-buscar w-full sm:w-[230px]">
          <Icono nombre="buscar" :tamano="20" />
          <input v-model="buscar" type="search" class="b-campo" placeholder="Insumo o lote" aria-label="Buscar insumo o lote" />
        </label>
        <button
          v-for="(c, clave) in CATEGORIA"
          :key="clave"
          type="button"
          class="b-ficha-cat"
          :class="categoriaFiltro === clave ? 'on' : ''"
          :style="estiloCategoria(clave)"
          @click="categoriaFiltro = categoriaFiltro === clave ? '' : clave"
        >
          <span class="ic"><Pictograma :categoria="clave" :grosor="2" /></span>
          {{ c.corto }}
        </button>
      </div>

      <div class="grupos mt-4">
        <section v-for="g in grupos" :key="g.clave" class="grupo" :class="g.semaforo">
          <header class="grupo-cabeza">
            <h2>{{ g.titulo }}</h2>
            <span class="flex items-center gap-3">
              {{ g.lotes.length }} {{ g.lotes.length === 1 ? 'lote' : 'lotes' }} · {{ miles(g.unidades) }} unidades
              <RouterLink v-if="g.clave === 'vencido'" to="/inventario/bajas" class="b-btn peligro chico">Dar de baja</RouterLink>
            </span>
          </header>
          <ul>
            <li v-for="l in g.lotes" :key="l.id">
              <RouterLink :to="`/inventario/lotes/${l.id}`" class="renglon" :style="estiloCategoria(l.insumo.categoria)">
                <span class="cat-mini"><Pictograma :categoria="l.insumo.categoria" :grosor="2" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-semibold text-tinta">{{ l.insumo.nombre }}</span>
                  <span class="font-mono text-[13px] text-apagado">{{ l.numeroLote }}</span>
                </span>
                <span v-if="l.estado !== 'disponible' && l.semaforo !== 'vencido'" class="b-estado" :class="l.estado">{{ l.estado === 'cuarentena' ? 'Cuarentena' : l.estado === 'vencido' ? 'Vencido' : l.estado }}</span>
                <span class="w-[90px] text-right font-bold tabular-nums text-tinta">{{ miles(l.cantidad) }}</span>
                <SelloVence :fecha="l.fechaVence" :semaforo="l.semaforo" />
              </RouterLink>
            </li>
          </ul>
        </section>
        <p v-if="!grupos.length" class="b-vacio">No hay lotes con ese filtro.</p>
      </div>
    </template>
    <p v-else-if="!error" class="b-vacio">Cargando vencimientos…</p>
  </section>
</template>

<style scoped>
.semaforo { display: grid; grid-template-columns: 150px repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1000px) { .semaforo { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.luz { position: relative; display: flex; align-items: center; gap: 14px; min-height: 88px; padding: 14px 16px; border: 2px solid #E2E8F0; border-bottom-width: 5px; border-radius: 20px; background: #fff; text-align: left; cursor: pointer; transition: transform .06s, border-color .12s, background .12s; }
.luz:hover { border-color: var(--luz, #94A3B8); }
.luz:active { transform: translateY(3px); border-bottom-width: 2px; }
.luz .foco { flex-shrink: 0; width: 46px; height: 46px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.65), transparent 45%), var(--luz); box-shadow: inset 0 -4px 0 rgba(0,0,0,.18), 0 0 0 4px #F1F5F9; }
.luz.todos .foco { display: grid; place-items: center; background: #172A5A; color: #fff; }
.luz .dato { display: grid; min-width: 0; }
.luz .dato b { font-size: 30px; font-weight: 900; line-height: 1; color: var(--tinta, #14244A); font-variant-numeric: tabular-nums; }
.luz .dato small { margin-top: 4px; font-size: 13px; font-weight: 700; color: #64748B; }
.luz .dato strong { color: var(--tinta, #14244A); font-weight: 900; }
.luz.on { background: var(--fondo, #EAF3FB); border-color: var(--luz, #4A9BD6); border-bottom-color: var(--tinta, #2F83C4); }
.luz.on .foco { box-shadow: inset 0 -4px 0 rgba(0,0,0,.18), 0 0 0 5px #fff, 0 0 18px var(--luz, transparent); }
.marca { position: absolute; top: 10px; right: 10px; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--tinta); color: #fff; }
.aparte { display: flex; flex-wrap: wrap; gap: 10px; }
.luz-chica { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border: 2px solid #E2E8F0; border-bottom-width: 4px; border-radius: 14px; background: #fff; font-weight: 800; font-size: 15px; color: #334155; transition: transform .06s; }
.luz-chica:active { transform: translateY(2px); border-bottom-width: 2px; }
.luz-chica b { padding: 1px 8px; border-radius: 8px; font-size: 13px; color: #fff; }
.luz-chica.vencido { color: #7F1D1D; } .luz-chica.vencido b { background: #7F1D1D; }
.luz-chica.gris b { background: #94A3B8; }
.luz-chica.on.vencido { background: #FDECEC; border-color: #C03535; border-bottom-color: #7F1D1D; }
.luz-chica.on.gris { background: #F1F5F9; border-color: #94A3B8; border-bottom-color: #64748B; }
.cifra-color.on { background: #fff; box-shadow: inset 0 -4px 0 var(--tinta); }
.grupos { max-height: max(420px, calc(100vh - 380px)); overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 14px; }
.grupo { flex-shrink: 0; border: 2px solid #E2E8F0; border-radius: 14px; overflow: hidden; }
.grupo-cabeza { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; background: #F8FAFC; border-bottom: 2px solid #E2E8F0; }
.grupo-cabeza h2 { font-size: 16px; font-weight: 700; color: #14244A; }
.grupo-cabeza span { font-size: 13px; font-weight: 600; color: #64748B; }
.grupo.vencido .grupo-cabeza { background: #FBE9E9; border-color: #F0C4C4; }
.grupo.vencido .grupo-cabeza h2 { color: #7F1D1D; }
.grupo.rojo .grupo-cabeza { box-shadow: inset 4px 0 0 #D32F2F; }
.grupo.amarillo .grupo-cabeza { box-shadow: inset 4px 0 0 #E8930C; }
.grupo.verde .grupo-cabeza { box-shadow: inset 4px 0 0 #22A06B; }
.renglon { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 14px; border-top: 1px solid #EEF2F6; }
li:first-child .renglon { border-top: none; }
.renglon:hover { background: #F8FAFC; }
.cat-mini { display: grid; place-items: center; flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px; background: var(--cat); color: #fff; }
.cat-mini svg { width: 18px; height: 18px; }
</style>
