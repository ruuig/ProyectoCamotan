<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../../services/http';
import HojaImpresion from '../../components/comunes/HojaImpresion.vue';
import FichaOficial from '../../components/comunes/FichaOficial.vue';
import aii016 from '../../dominio/fichasOficiales/aii016';

// Fichas que ya se imprimen sobre su formulario oficial.
const OFICIALES = { adolescente_joven: aii016 };

/**
 * Ficha clínica impresa de una atención.
 *
 * Junta lo que preconsulta pasó de la ficha del paciente, la atención del día
 * y la hoja del médico, en el orden exacto del papel de la ficha de su edad.
 * El servidor arma la ficha; aquí solo se dibuja. Lo que no se registró sale
 * vacío, como en el papel, para poder terminarla a mano.
 */
const route = useRoute();

const ficha = ref(null);
const establecimiento = ref(null);
const error = ref('');

// Modo en blanco: la misma ficha sin datos, para contingencia.
const enBlanco = route.query.blanco === '1';

async function cargar() {
  try {
    const id = route.params.id;
    const [datos, datosEstablecimiento] = await Promise.all([
      http.get(`/fichas/atencion/${id}/impresa${enBlanco ? '?blanco=1' : ''}`),
      http.get('/admin/establecimiento').catch(() => ({ establecimiento: null })),
    ]);
    ficha.value = datos;
    establecimiento.value = datosEstablecimiento.establecimiento;

    // Toda impresión queda registrada: la ficha sale del sistema en papel.
    await http.post('/impresiones', {
      documento: enBlanco ? 'ficha_blanco' : 'ficha_atencion',
      pacienteId: datos.pacienteId,
      atencionId: Number(id),
    });
  } catch (fallo) {
    error.value = fallo.message;
  }
}

const oficial = computed(() => (ficha.value ? OFICIALES[ficha.value.ficha.clave] ?? null : null));
const titulo = computed(() => (ficha.value ? `${ficha.value.ficha.nombre}, ${ficha.value.ficha.rango}` : ''));

/** Filas cortas de a dos por renglón; las largas, las casillas y las firmas aparte. */
function renglones(filas) {
  const salida = [];
  let par = [];
  let subseccion = null;
  const cerrarPar = () => { if (par.length) { salida.push({ tipo: 'par', filas: par }); par = []; } };
  for (const f of filas) {
    if (f.subseccion && f.subseccion !== subseccion) {
      cerrarPar();
      salida.push({ tipo: 'subtitulo', texto: f.subseccion });
    }
    subseccion = f.subseccion ?? subseccion;
    if (f.casillas) { cerrarPar(); salida.push({ tipo: 'casillas', fila: f }); continue; }
    if (f.largo) { cerrarPar(); salida.push({ tipo: 'largo', fila: f }); continue; }
    if (f.firma) { cerrarPar(); salida.push({ tipo: 'firma', fila: f }); continue; }
    par.push(f);
    if (par.length === 2) cerrarPar();
  }
  cerrarPar();
  return salida;
}

const marca = (valor, opcion) => (valor === opcion ? '☒' : '☐');

onMounted(cargar);
</script>

<template>
  <p v-if="error" role="alert" class="aviso aviso-urgente no-imprimir">{{ error }}</p>

  <FichaOficial v-else-if="ficha && oficial" :plantilla="oficial" :datos="ficha.oficial" :establecimiento="establecimiento" />

  <!-- Las firmas van en el cierre, donde las pone el papel; el proveedor es quien cerró la consulta -->
  <HojaImpresion v-else-if="ficha" :titulo="titulo" :establecimiento="establecimiento" :firmas="[]">
    <section class="bloque-impresion mb-3">
      <table>
        <tbody>
          <tr>
            <template v-for="e in ficha.encabezado" :key="e.etiqueta">
              <th>{{ e.etiqueta }}</th>
              <td class="font-bold">{{ e.valor }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </section>

    <section
      v-for="(b, i) in ficha.bloques"
      :key="i"
      class="bloque-impresion"
      :class="b.nivel === 2 ? 'ml-3' : ''"
    >
      <h2 v-if="b.nivel !== 2">{{ b.titulo }}</h2>
      <h3 v-else class="mt-2 text-sm font-bold">
        {{ b.titulo }}<span v-if="b.subtitulo" class="font-normal"> · {{ b.subtitulo }}</span>
      </h3>
      <p v-if="b.nota" class="text-xs">{{ b.nota }}</p>

      <table v-if="b.tabla" class="mt-1">
        <thead>
          <tr><th v-for="c in b.tabla.columnas" :key="c">{{ c }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, j) in b.tabla.filas" :key="j">
            <td v-for="(celda, k) in r" :key="k" :class="k === 1 ? 'w-24 font-mono' : ''">{{ celda }}</td>
          </tr>
        </tbody>
      </table>

      <template v-for="(r, j) in renglones(b.filas ?? [])" :key="j">
        <p v-if="r.tipo === 'subtitulo'" class="mt-1 text-xs font-bold uppercase">{{ r.texto }}</p>

        <table v-else-if="r.tipo === 'par'">
          <tbody>
            <tr>
              <template v-for="f in r.filas" :key="f.etiqueta">
                <th class="w-1/4">{{ f.etiqueta }}</th>
                <td class="w-1/4">{{ f.valor }}</td>
              </template>
              <template v-if="r.filas.length === 1"><th class="w-1/4" /><td class="w-1/4" /></template>
            </tr>
          </tbody>
        </table>

        <div v-else-if="r.tipo === 'largo'" class="mt-1">
          <p class="text-xs font-bold">{{ r.fila.etiqueta }}</p>
          <p class="min-h-[1.2cm] whitespace-pre-line border border-slate-900 p-1 text-sm">{{ r.fila.valor }}</p>
        </div>

        <div v-else-if="r.tipo === 'casillas'" class="mt-1">
          <p class="text-xs font-bold">{{ r.fila.etiqueta }}</p>
          <ul class="grid grid-cols-2 gap-x-6 text-sm">
            <li v-for="c in r.fila.casillas" :key="c.etiqueta" class="flex justify-between gap-2 border-b border-slate-300">
              <span>{{ c.etiqueta }}</span>
              <span v-if="c.valor === 'Registrado'" class="text-xs">Registrado</span>
              <span v-else class="whitespace-nowrap">Sí {{ marca(c.valor, 'Sí') }} No {{ marca(c.valor, 'No') }}</span>
            </li>
          </ul>
        </div>

        <div v-else-if="r.tipo === 'firma'" class="mt-4">
          <p class="border-t border-slate-900 pt-1 text-xs">{{ r.fila.etiqueta }}</p>
        </div>
      </template>
    </section>

    <!-- Tabla de códigos, como en las fichas oficiales -->
    <template #pie>
      <p class="mt-2">
        <strong>Comunidad lingüística:</strong>
        1 Achi' · 2 Akateka · 3 Awakateka · 4 Ch'orti' · 5 Chalchiteka · 6 Chuj ·
        7 Itza' · 8 Ixil · 9 Jakalteka · 10 Kaqchikel · 11 K'iche' · 12 Mam ·
        13 Mopan · 14 Poqomam · 15 Poqomchi' · 16 Q'anjob'al · 17 Q'eqchi' ·
        18 Sakapulteka · 19 Sipakapensa · 20 Tektiteka · 21 Tz'utujil ·
        22 Uspanteka · 23 No indica
      </p>
    </template>
  </HojaImpresion>

  <p v-else class="no-imprimir text-slate-500">Preparando la ficha…</p>
</template>
