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
  return [
    { clave: 'vencido', texto: 'Vencidos', tinta: '#7F1D1D' },
    { clave: 'rojo', texto: `Menos de ${r.rojo} meses`, tinta: '#D32F2F' },
    { clave: 'amarillo', texto: `${r.rojo} a ${r.amarillo} meses`, tinta: '#B7710A' },
    { clave: 'verde', texto: `Más de ${r.amarillo} meses`, tinta: '#16794F' },
  ];
});

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const lotes = computed(() => {
  const clave = sinTildes(buscar.value.trim());
  return (datos.value?.filas ?? [])
    .filter((f) => !categoriaFiltro.value || f.categoria === categoriaFiltro.value)
    .filter((f) => !clave || sinTildes(`${f.nombre} ${f.codigoInterno}`).includes(clave) || f.lotes.some((l) => sinTildes(l.numeroLote).includes(clave)))
    .flatMap((f) => f.lotes.filter((l) => l.semaforo !== 'sin_fecha').map((l) => ({ ...l, insumo: f })))
    .filter((l) => !color.value || l.semaforo === color.value)
    .sort((a, b) => new Date(a.fechaVence) - new Date(b.fechaVence));
});

/** Grupos por mes de vencimiento; los vencidos van juntos al principio. */
const grupos = computed(() => {
  const mapa = new Map();
  for (const l of lotes.value) {
    const d = new Date(l.fechaVence);
    const clave = l.semaforo === 'vencido' ? 'vencido' : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave,
        titulo: clave === 'vencido' ? 'Ya vencidos' : `${MESES[d.getUTCMonth()][0].toUpperCase()}${MESES[d.getUTCMonth()].slice(1)} ${d.getUTCFullYear()}`,
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
      <h1 class="b-titulo">Vencimientos</h1>
      <div class="b-acciones">
        <RouterLink :to="enlaceImprimir" target="_blank" class="b-btn secundario"><Icono nombre="imprimir" :tamano="20" /> Imprimir semáforo</RouterLink>
      </div>
    </header>

    <p v-if="error" role="alert" class="b-aviso error mt-4">{{ error }}</p>

    <template v-if="datos">
      <div class="b-franja mt-5">
        <button
          v-for="c in COLORES"
          :key="c.clave"
          type="button"
          class="b-cifra cifra-color"
          :class="color === c.clave ? 'on' : ''"
          :style="{ '--tinta': c.tinta }"
          :aria-pressed="color === c.clave"
          @click="color = color === c.clave ? '' : c.clave"
        >
          <span class="n" :style="{ color: c.tinta }">{{ datos.resumen[c.clave] }}</span>
          <span class="e">{{ c.texto }}</span>
        </button>
        <div v-if="datos.resumen.sinFecha" class="b-cifra">
          <span class="n text-[#94A3B8]">{{ datos.resumen.sinFecha }}</span><span class="e">Sin lote</span>
        </div>
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
