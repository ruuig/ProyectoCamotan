import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LayoutPrincipal from '../layouts/LayoutPrincipal.vue';
import Login from '../views/auth/Login.vue';
import PanelPreconsulta from '../views/paneles/PanelPreconsulta.vue';
import PanelMedico from '../views/paneles/PanelMedico.vue';
import PanelFarmacia from '../views/paneles/PanelFarmacia.vue';
import PanelAdmin from '../views/paneles/PanelAdmin.vue';
import PanelBodega from '../views/paneles/PanelBodega.vue';
import ListaPacientes from '../views/pacientes/ListaPacientes.vue';
import NuevoPaciente from '../views/pacientes/NuevoPaciente.vue';
import DetallePaciente from '../views/pacientes/DetallePaciente.vue';
// Las vistas de impresión se cargan solo cuando se piden: no pesan en el
// arranque y solo se usan al imprimir.
const CompletarFicha = () => import('../views/pacientes/CompletarFicha.vue');
const FichaClinica = () => import('../views/impresion/FichaClinica.vue');
const ResumenExpediente = () => import('../views/impresion/ResumenExpediente.vue');
const BoletaReferencia = () => import('../views/impresion/BoletaReferencia.vue');
const FormularioReferencia = () => import('../views/consulta/FormularioReferencia.vue');
const TarjetaControl = () => import('../views/impresion/TarjetaControl.vue');
const HojaBres = () => import('../views/impresion/HojaBres.vue');
const OficioBajaImpreso = () => import('../views/impresion/OficioBaja.vue');

// Pantallas de logistica: se cargan al entrar a inventario, no en el arranque.
const DetalleLote = () => import('../views/inventario/DetalleLote.vue');
const InventarioCierre = () => import('../views/inventario/InventarioCierre.vue');
const VistaBres = () => import('../views/inventario/VistaBres.vue');
const VistaBajas = () => import('../views/inventario/VistaBajas.vue');
const VistaRetiros = () => import('../views/inventario/VistaRetiros.vue');
import MarcoBodega from '../components/bodega/MarcoBodega.vue';
const VistaTrazabilidad = () => import('../views/inventario/VistaTrazabilidad.vue');
const VistaInformes = () => import('../views/inventario/VistaInformes.vue');
const VistaSemaforo = () => import('../views/inventario/VistaSemaforo.vue');
const HojaBalance = () => import('../views/impresion/HojaBalance.vue');
const HojaInventarioCierre = () => import('../views/impresion/HojaInventarioCierre.vue');
const HojaSigsa3cs = () => import('../views/impresion/HojaSigsa3cs.vue');
const VistaSigsa = () => import('../views/sigsa/VistaSigsa.vue');
const HojaSigsa4 = () => import('../views/impresion/HojaSigsa4.vue');
const HojaSemaforo = () => import('../views/impresion/HojaSemaforo.vue');
const ComprobanteTraslado = () => import('../views/impresion/ComprobanteTraslado.vue');
const RecetaPaciente = () => import('../views/impresion/RecetaPaciente.vue');
const HojaRequisicion = () => import('../views/impresion/HojaRequisicion.vue');
const HojaKardex = () => import('../views/impresion/HojaKardex.vue');
const HojaInventarioFarmacia = () => import('../views/impresion/HojaInventarioFarmacia.vue');
const VistaRequisiciones = () => import('../views/inventario/VistaRequisiciones.vue');
const VistaKardex = () => import('../views/inventario/VistaKardex.vue');
const VistaRecibir = () => import('../views/inventario/VistaRecibir.vue');

import FormularioPreconsulta from '../views/preconsulta/FormularioPreconsulta.vue';
import VistaCola from '../views/cola/VistaCola.vue';
import VistaConsulta from '../views/consulta/VistaConsulta.vue';
const VistaBodegaInicio = () => import('../views/inventario/VistaBodegaInicio.vue');
import VistaInventario from '../views/inventario/VistaInventario.vue';
import NuevoInsumo from '../views/inventario/NuevoInsumo.vue';
import DetalleInsumo from '../views/inventario/DetalleInsumo.vue';
import VistaDispensacion from '../views/inventario/VistaDispensacion.vue';
import VistaControlFarmacia from '../views/inventario/VistaControlFarmacia.vue';
import VistaConsolidado from '../views/admin/VistaConsolidado.vue';
const VistaTiempos = () => import('../views/admin/VistaTiempos.vue');
import VistaAdministracion from '../views/admin/VistaAdministracion.vue';

// Farmacia no entra al expediente clinico.
const CLINICOS = ['admin', 'preconsulta', 'medico'];
const REGISTRO = ['admin', 'preconsulta'];
// Bodega maneja el inventario; farmacia dispensa a los pacientes.
const BODEGA = ['admin', 'bodega'];
const FARMACIA = ['admin', 'farmacia'];

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: Login, meta: { publica: true } },
    {
      path: '/panel',
      component: LayoutPrincipal,
      children: [
        { path: 'preconsulta', name: 'panel-preconsulta', component: PanelPreconsulta, meta: { roles: ['preconsulta'] } },
        { path: 'medico', name: 'panel-medico', component: PanelMedico, meta: { roles: ['medico'] } },
        { path: 'farmacia', name: 'panel-farmacia', component: PanelFarmacia, meta: { roles: ['farmacia'] } },
        { path: 'bodega', name: 'panel-bodega', component: PanelBodega, meta: { roles: ['bodega'] } },
        { path: 'admin', name: 'panel-admin', component: PanelAdmin, meta: { roles: ['admin'] } },
      ],
    },
    {
      path: '/pacientes',
      component: LayoutPrincipal,
      children: [
        { path: '', name: 'pacientes', component: ListaPacientes, meta: { roles: CLINICOS } },
        { path: 'nuevo', name: 'paciente-nuevo', component: NuevoPaciente, meta: { roles: REGISTRO } },
        { path: ':id', name: 'paciente-detalle', component: DetallePaciente, meta: { roles: CLINICOS } },
        {
          path: ':id/ficha',
          name: 'paciente-ficha',
          component: CompletarFicha,
          meta: { roles: CLINICOS },
        },
      ],
    },
    {
      path: '/cola',
      component: LayoutPrincipal,
      children: [{ path: '', name: 'cola', component: VistaCola, meta: { roles: CLINICOS } }],
    },
    {
      path: '/consulta',
      component: LayoutPrincipal,
      children: [
        {
          path: ':id',
          name: 'consulta',
          component: VistaConsulta,
          meta: { roles: ['admin', 'medico'] },
        },
        {
          path: ':id/referencia',
          name: 'consulta-referencia',
          component: FormularioReferencia,
          meta: { roles: ['admin', 'medico'] },
        },
      ],
    },
    {
      path: '/inventario',
      component: LayoutPrincipal,
      children: [
        {
          path: '',
          component: MarcoBodega,
          children: [
            { path: '', name: 'bodega-inicio', component: VistaBodegaInicio, meta: { roles: BODEGA } },
            { path: 'productos', name: 'inventario', component: VistaInventario, meta: { roles: BODEGA } },
            { path: 'nuevo', name: 'insumo-nuevo', component: NuevoInsumo, meta: { roles: BODEGA } },
            // Las rutas fijas van antes que ':id', o este se las traga.
            { path: 'cierre', name: 'inventario-cierre', component: InventarioCierre, meta: { roles: BODEGA } },
            { path: 'bres', name: 'bres', component: VistaBres, meta: { roles: BODEGA } },
            // El traslado es la requisicion: el enlace viejo lleva a ella.
            { path: 'traslados', redirect: '/inventario/requisiciones' },
            // Farmacia pide a bodega con requisición, como los demás servicios.
            { path: 'requisiciones', name: 'requisiciones', component: VistaRequisiciones, meta: { roles: BODEGA } },
            { path: 'kardex', name: 'kardex', component: VistaKardex, meta: { roles: BODEGA } },
            // El inicio reemplaza a "Hoy": el enlace viejo lleva a él.
            { path: 'hoy', redirect: '/inventario' },
            { path: 'recibir', name: 'recibir', component: VistaRecibir, meta: { roles: BODEGA } },
            { path: 'trazabilidad', name: 'trazabilidad', component: VistaTrazabilidad, meta: { roles: BODEGA } },
            { path: 'informes', name: 'informes-servicios', component: VistaInformes, meta: { roles: BODEGA } },
            // El balance quedo dentro del BRES como "Detalle por servicio".
            { path: 'balance', redirect: '/inventario/bres' },
            { path: 'semaforo', name: 'semaforo', component: VistaSemaforo, meta: { roles: BODEGA } },
            { path: 'bajas', name: 'bajas', component: VistaBajas, meta: { roles: BODEGA } },
            { path: 'retiros', name: 'retiros', component: VistaRetiros, meta: { roles: BODEGA } },
            { path: 'retiros/:id', name: 'retiro-detalle', component: VistaRetiros, meta: { roles: BODEGA } },
            { path: 'lotes/:id', name: 'lote-detalle', component: DetalleLote, meta: { roles: BODEGA } },
            { path: ':id', name: 'insumo-detalle', component: DetalleInsumo, meta: { roles: BODEGA } },
            // Recibir un producto suelto lleva a la recepción con documento.
            { path: ':id/recibir', name: 'recibir-lote', redirect: (to) => ({ path: '/inventario/recibir', query: { insumo: to.params.id } }) },
          ],
        },
      ],
    },
    {
      path: '/sigsa',
      component: LayoutPrincipal,
      children: [
        { path: '', name: 'sigsa', component: VistaSigsa, meta: { roles: ['admin', 'medico'] } },
      ],
    },
    {
      path: '/dispensacion',
      component: LayoutPrincipal,
      children: [
        { path: '', name: 'dispensacion', component: VistaDispensacion, meta: { roles: FARMACIA } },
        { path: 'control', name: 'control-farmacia', component: VistaControlFarmacia, meta: { roles: FARMACIA } },
      ],
    },
    {
      path: '/consolidado',
      component: LayoutPrincipal,
      children: [
        { path: '', name: 'consolidado', component: VistaConsolidado, meta: { roles: ['admin'] } },
      ],
    },
    // Tiempos de registro y consulta: no esta en el menu, se entra por la direccion.
    {
      path: '/tiempos',
      component: LayoutPrincipal,
      children: [{ path: '', name: 'tiempos', component: VistaTiempos, meta: { roles: ['admin'] } }],
    },
    {
      path: '/administracion',
      component: LayoutPrincipal,
      children: [
        { path: '', name: 'administracion', component: VistaAdministracion, meta: { roles: ['admin'] } },
      ],
    },
    {
      path: '/preconsulta',
      component: LayoutPrincipal,
      children: [
        {
          path: ':id',
          name: 'preconsulta',
          component: FormularioPreconsulta,
          meta: { roles: REGISTRO },
        },
      ],
    },
    // Impresión: sin el marco de la aplicación, para que la hoja salga limpia.
    {
      path: '/imprimir',
      children: [
        {
          path: 'ficha/:id',
          name: 'imprimir-ficha',
          component: FichaClinica,
          meta: { roles: CLINICOS },
        },
        {
          path: 'expediente/:id',
          name: 'imprimir-expediente',
          component: ResumenExpediente,
          meta: { roles: CLINICOS },
        },
        {
          path: 'referencia/:id',
          name: 'imprimir-referencia',
          component: BoletaReferencia,
          meta: { roles: CLINICOS },
        },
        {
          path: 'tarjeta-control/:id',
          name: 'imprimir-tarjeta-control',
          component: TarjetaControl,
          meta: { roles: BODEGA },
        },
        {
          path: 'bres/:periodo',
          name: 'imprimir-bres',
          component: HojaBres,
          meta: { roles: BODEGA },
        },
        {
          path: 'oficio-baja/:id',
          name: 'imprimir-oficio-baja',
          component: OficioBajaImpreso,
          meta: { roles: BODEGA },
        },
        { path: 'balance/:periodo', name: 'imprimir-balance', component: HojaBalance, meta: { roles: BODEGA } },
        { path: 'cierre/:periodo', name: 'imprimir-cierre', component: HojaInventarioCierre, meta: { roles: BODEGA } },
        { path: 'sigsa3cs', name: 'imprimir-sigsa3cs', component: HojaSigsa3cs, meta: { roles: ['admin', 'medico'] } },
        { path: 'sigsa4/:periodo', name: 'imprimir-sigsa4', component: HojaSigsa4, meta: { roles: FARMACIA } },
        { path: 'semaforo', name: 'imprimir-semaforo', component: HojaSemaforo, meta: { roles: BODEGA } },
        { path: 'traslado/:id', name: 'imprimir-traslado', component: ComprobanteTraslado, meta: { roles: BODEGA } },
        { path: 'requisicion/recepcion/:id', name: 'imprimir-requisicion-recepcion', component: HojaRequisicion, meta: { roles: BODEGA } },
        { path: 'receta/:id', name: 'imprimir-receta', component: RecetaPaciente, meta: { roles: FARMACIA } },
        { path: 'requisicion/:id', name: 'imprimir-requisicion', component: HojaRequisicion, meta: { roles: [...BODEGA, 'farmacia'] } },
        { path: 'kardex', name: 'imprimir-kardex', component: HojaKardex, meta: { roles: BODEGA } },
        { path: 'inventario-farmacia', name: 'imprimir-inventario-farmacia', component: HojaInventarioFarmacia, meta: { roles: FARMACIA } },
      ],
    },
    // Cualquier otra ruta cae al guard, que envia al panel del rol o al login.
    { path: '/:ruta(.*)*', redirect: '/panel' },
  ],
});

router.beforeEach((destino) => {
  const auth = useAuthStore();

  if (destino.meta.publica) {
    // Un usuario ya autenticado no necesita ver el login.
    return auth.autenticado ? auth.rutaPanel : true;
  }

  if (!auth.autenticado) {
    return { name: 'login', query: { redirigir: destino.fullPath } };
  }

  // Sin rol permitido para esa ruta se devuelve al panel propio, no al login:
  // la sesion es valida, solo falta permiso.
  if (destino.meta.roles && !destino.meta.roles.includes(auth.rol)) {
    return auth.rutaPanel;
  }

  // /panel sin hijo: se resuelve al panel que corresponde al rol.
  if (destino.path === '/panel' || destino.path === '/panel/') {
    return auth.rutaPanel;
  }

  return true;
});

export default router;
