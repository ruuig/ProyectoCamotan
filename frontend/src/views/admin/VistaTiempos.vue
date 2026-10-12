<script setup>
import { ref, onMounted } from 'vue';
import http from '../../services/http';

/**
 * Tiempo de registro y de consulta de fichas. No está en el menú: se entra
 * escribiendo /tiempos. Las mediciones se toman solas en las pantallas.
 */
const datos = ref(null);
const error = ref('');

const fechaHora = (v) => new Date(v).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
const seg = (v) => (v == null ? '—' : `${v} s`);
const TIPOS = [['registro', 'Registro de paciente'], ['consulta', 'Consulta de ficha']];

async function cargar() {
  try {
    datos.value = await http.get('/indicadores/mediciones');
  } catch (fallo) {
    error.value = fallo.message;
  }
}

onMounted(cargar);
</script>

<template>
  <section class="mx-auto max-w-[1100px] space-y-5">
    <header class="flex items-end justify-between gap-3">
      <h1 class="titulo-pagina">Tiempos de registro y consulta</h1>
      <button type="button" class="boton-secundario" @click="cargar">Actualizar</button>
    </header>

    <p v-if="error" role="alert" class="aviso aviso-urgente">{{ error }}</p>

    <template v-if="datos">
      <p class="text-sm text-apagado">
        Registro: desde la primera tecla en nombre, apellido o CUI hasta que el paciente queda guardado.
        Consulta: desde la primera tecla en la búsqueda hasta abrir la ficha.
        No se cuentan las mayores de {{ datos.limiteSeg / 60 }} minutos (pantalla olvidada abierta).
      </p>

      <div class="grid gap-4 md:grid-cols-2">
        <article v-for="[k, t] in TIPOS" :key="k" class="tarjeta">
          <h2>{{ t }}</h2>
          <p class="grande">{{ seg(datos[k].medianaSeg) }}<small> mediana</small></p>
          <dl>
            <div><dt>Promedio</dt><dd>{{ seg(datos[k].promedioSeg) }}</dd></div>
            <div><dt>Más rápido</dt><dd>{{ seg(datos[k].minimoSeg) }}</dd></div>
            <div><dt>Más lento</dt><dd>{{ seg(datos[k].maximoSeg) }}</dd></div>
            <div><dt>Mediciones</dt><dd>{{ datos[k].validas }}<template v-if="datos[k].descartadas"> (+{{ datos[k].descartadas }} descartadas)</template></dd></div>
          </dl>
        </article>
      </div>

      <article class="tarjeta">
        <h2>Por día</h2>
        <table class="tabla">
          <thead><tr><th>Día</th><th class="n">Registros</th><th class="n">Mediana registro</th><th class="n">Consultas</th><th class="n">Mediana consulta</th></tr></thead>
          <tbody>
            <tr v-for="d in datos.dias" :key="d.dia">
              <td>{{ d.dia }}</td>
              <td class="n">{{ d.registro.validas }}</td><td class="n">{{ seg(d.registro.medianaSeg) }}</td>
              <td class="n">{{ d.consulta.validas }}</td><td class="n">{{ seg(d.consulta.medianaSeg) }}</td>
            </tr>
            <tr v-if="!datos.dias.length"><td colspan="5" class="vacio">Todavía no hay mediciones.</td></tr>
          </tbody>
        </table>
      </article>

      <article class="tarjeta">
        <h2>Últimas mediciones</h2>
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Pantalla</th><th class="n">Tiempo</th><th>Usuario</th><th>Expediente</th></tr></thead>
          <tbody>
            <tr v-for="m in datos.ultimas" :key="m.id" :class="m.valida ? '' : 'descartada'">
              <td>{{ fechaHora(m.registradaEn) }}</td>
              <td>{{ m.tipo === 'registro' ? 'Registro' : 'Consulta' }}</td>
              <td>{{ m.pantalla }}</td>
              <td class="n">{{ m.segundos }} s</td>
              <td>{{ m.usuario }}</td>
              <td>{{ m.expediente ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </template>
  </section>
</template>

<style scoped>
.tarjeta { padding: 18px 20px; border: 2px solid #E2E8F0; border-radius: 16px; background: #fff; }
.tarjeta h2 { font-size: 13px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #64748B; }
.grande { margin: 6px 0 10px; font-size: 40px; font-weight: 800; color: #14244A; font-variant-numeric: tabular-nums; }
.grande small { font-size: 15px; font-weight: 600; color: #64748B; }
dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
dt { font-size: 12px; font-weight: 700; color: #64748B; }
dd { font-size: 17px; font-weight: 700; color: #14244A; }
.tabla { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 14px; }
.tabla th { padding: 6px 8px; text-align: left; font-size: 12px; color: #64748B; border-bottom: 2px solid #E2E8F0; }
.tabla td { padding: 6px 8px; border-bottom: 1px solid #EEF2F6; }
.tabla .n { text-align: right; font-variant-numeric: tabular-nums; }
.descartada td { color: #94A3B8; text-decoration: line-through; }
.vacio { padding: 16px; text-align: center; color: #94A3B8; }
</style>
