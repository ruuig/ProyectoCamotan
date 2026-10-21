<script setup>
import { reactive, ref, computed, watch } from 'vue';
import servicio from '../../services/inventario';
import Icono from '../comunes/Icono.vue';
import { CATEGORIA } from './diseno/PiezasBodega';

/**
 * Crear un producto nuevo sin salir de la requisición: lo justo y con
 * ejemplos, para quien no sabe qué poner. El nombre va como en la caja pero
 * sin la marca (Amoxicilina), la concentración aparte (500 mg) y la unidad en
 * que se cuenta y se entrega (cápsula, frasco…). Lo demás se completa después
 * en la ficha del producto, si hace falta.
 */
const props = defineProps({ nombreInicial: { type: String, default: '' } });
const emit = defineEmits(['creado', 'cerrar']);

const FORMAS = ['Tableta', 'Cápsula', 'Jarabe', 'Suspensión', 'Ampolla', 'Vial', 'Crema', 'Gotas', 'Sobre', 'Otra'];
const UNIDADES = ['Tableta', 'Cápsula', 'Frasco', 'Ampolla', 'Vial', 'Sobre', 'Tubo', 'Unidad', 'Caja'];
// Cómo se entrega según la forma: un jarabe se entrega por frasco.
const ENTREGA_DE = { Tableta: 'Tableta', Cápsula: 'Cápsula', Jarabe: 'Frasco', Suspensión: 'Frasco', Ampolla: 'Ampolla', Vial: 'Vial', Crema: 'Tubo', Gotas: 'Frasco', Sobre: 'Sobre' };

const f = reactive({ nombre: props.nombreInicial, concentracion: '', forma: '', formaOtra: '', unidad: '', categoria: 'medicamentos', donde: '' });
const error = ref('');
const guardando = ref(false);
watch(() => f.forma, (forma) => { if (ENTREGA_DE[forma]) f.unidad = ENTREGA_DE[forma]; });

const forma = computed(() => (f.forma === 'Otra' ? f.formaOtra.trim() : f.forma));
const previa = computed(() => [f.nombre.trim() || 'Nombre', f.concentracion.trim(), forma.value.toLowerCase()].filter(Boolean).join(' '));
const listo = computed(() => f.nombre.trim().length >= 3 && forma.value && f.unidad && f.categoria);

async function guardar() {
  error.value = '';
  guardando.value = true;
  try {
    const r = await servicio.crearInsumo({
      nombreGenerico: f.nombre.trim(),
      concentracion: f.concentracion.trim() || null,
      formaFarmaceutica: forma.value,
      presentacion: forma.value,
      unidadMedida: f.unidad.toLowerCase(),
      unidadEntrega: f.unidad.toLowerCase(),
      categoria: f.categoria,
      ubicacionFisica: f.donde.trim() || null,
    });
    emit('creado', r.insumo);
  } catch (fallo) {
    error.value = fallo.message;
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <div class="velo" role="dialog" aria-modal="true" aria-labelledby="titulo-nuevo" @click.self="emit('cerrar')">
    <form class="ventana" @submit.prevent="guardar">
      <header class="cabeza">
        <h2 id="titulo-nuevo">Producto nuevo</h2>
        <button type="button" class="cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" :tamano="20" /></button>
      </header>

      <div class="cuerpo">
        <div>
          <label for="np-nombre" class="b-etiqueta">Nombre genérico</label>
          <input id="np-nombre" v-model="f.nombre" required maxlength="160" class="b-campo" placeholder="Ej.: Amoxicilina" />
          <small class="ayuda">Como dice la caja, <b>sin la marca</b>.</small>
        </div>
        <div>
          <label for="np-conc" class="b-etiqueta">Concentración <span class="b-opcional">si tiene</span></label>
          <input id="np-conc" v-model="f.concentracion" maxlength="40" class="b-campo" placeholder="Ej.: 500 mg · 250 mg/5 ml" />
        </div>
        <div>
          <span class="b-etiqueta">Forma</span>
          <div class="chips">
            <button v-for="x in FORMAS" :key="x" type="button" :class="{ on: f.forma === x }" @click="f.forma = x">{{ x }}</button>
          </div>
          <input v-if="f.forma === 'Otra'" v-model="f.formaOtra" maxlength="40" class="b-campo mt-2" placeholder="Escriba la forma" />
        </div>
        <div>
          <span class="b-etiqueta">Se cuenta y se entrega por</span>
          <div class="chips">
            <button v-for="x in UNIDADES" :key="x" type="button" :class="{ on: f.unidad === x }" @click="f.unidad = x">{{ x }}</button>
          </div>
        </div>
        <div class="dos">
          <div>
            <label for="np-cat" class="b-etiqueta">Categoría</label>
            <select id="np-cat" v-model="f.categoria" class="b-campo">
              <option v-for="(c, clave) in CATEGORIA" :key="clave" :value="clave">{{ c.nombre }}</option>
            </select>
          </div>
          <div>
            <label for="np-donde" class="b-etiqueta">Dónde está <span class="b-opcional">opcional</span></label>
            <input id="np-donde" v-model="f.donde" maxlength="80" class="b-campo" placeholder="Ej.: Estante 3, repisa B" />
          </div>
        </div>

        <p class="previa">Se verá así: <b>{{ previa }}</b><template v-if="f.unidad"> · se entrega por {{ f.unidad.toLowerCase() }}</template></p>
        <p v-if="error" role="alert" class="b-aviso error">{{ error }}</p>
      </div>

      <footer class="pie">
        <button type="button" class="b-btn secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="b-btn primario" :disabled="guardando || !listo"><Icono nombre="guardar" :tamano="18" /> {{ guardando ? 'Guardando…' : 'Crear y agregar' }}</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.velo { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15, 23, 42, .45); }
.ventana { display: grid; width: min(560px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; border: 2px solid #172A5A; border-bottom-width: 5px; border-radius: 20px; background: #fff; }
.cabeza { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 2px solid #E2E8F0; }
.cabeza h2 { font-size: 20px; font-weight: 900; color: #14244A; }
.cerrar { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; color: #64748B; }
.cuerpo { display: grid; gap: 14px; padding: 16px 18px; }
.ayuda { display: block; margin-top: 3px; font-size: 13px; color: #64748B; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button { height: 40px; padding: 0 14px; border: 2px solid #E2E8F0; border-bottom-width: 3px; border-radius: 12px; background: #fff; font-size: 14.5px; font-weight: 800; color: #334155; }
.chips button.on { border-color: #2F83C4; background: #EAF3FB; color: #174E80; }
.dos { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 520px) { .dos { grid-template-columns: 1fr; } }
.previa { padding: 10px 12px; border-radius: 12px; background: #F1F5F9; font-size: 14.5px; color: #334155; }
.previa b { color: #14244A; }
.pie { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px 16px; border-top: 2px solid #E2E8F0; }
</style>
