/**
 * Revisa que las pantallas se vean bien en la tablet de preconsulta
 * (iPad Pro 13, 1032 × 1376, táctil) sin tener que mirarlas una por una.
 *
 * En cada pantalla busca:
 *  - texto cortado: un campo, una lista o un botón cuyo texto no cabe
 *    («Todas las comuni…»);
 *  - algo que se sale de su caja o del ancho de la pantalla;
 *  - botones y campos demasiado chicos para el dedo (menos de 44 de alto);
 *  - letra demasiado chica para leer (menos de 15).
 * Las medidas son las que se ven en la pantalla de la tablet.
 * Guarda una captura de cada pantalla y marca en rojo lo que encontró.
 *
 *   node scripts/revisarPantallas.mjs [http://127.0.0.1:3300] [carpeta de capturas]
 *
 * Usa el servidor de demostración (documentacion/mockups/demo/servir_demo.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../documentacion/mockups/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const BASE = process.argv[2] ?? 'http://127.0.0.1:3300';
const SALIDA = process.argv[3] ?? path.resolve('revision-pantallas');
fs.mkdirSync(SALIDA, { recursive: true });

const PANTALLAS = [
  ['inicio', '/panel/preconsulta'],
  ['fila', '/cola'],
  ['pacientes', '/pacientes'],
  ['registrar', '/pacientes/nuevo'],
  ['expediente', '/pacientes/{id}'],
  ['ficha', '/pacientes/{id}/ficha'],
  // También abiertas: lo que se ve después de tocar.
  ['ficha-abierta', '/pacientes/{id}/ficha', '#identificacion button.cabeza'],
  ['pacientes-filtros', '/pacientes', '.boton-filtrar'],
  ['signos', '/preconsulta/nueva?paciente={id}'],
];

const cache = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const carpeta = fs.readdirSync(cache).find((d) => /^chromium-\d/.test(d));
const nav = await chromium.launch({ executablePath: path.join(cache, carpeta, 'chrome-win64', 'chrome.exe') });
const ctx = await nav.newContext({ viewport: { width: 1032, height: 1376 }, screen: { width: 1032, height: 1376 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
// El navegador de prueba no siempre dice «pantalla táctil»: se le obliga.
await ctx.addInitScript(() => {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (q) => (q.includes('pointer: coarse') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : original(q));
});
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));

// Las reglas de tablet dependen de «pointer: coarse»: se activan a la fuerza.
const forzarTablet = () => p.evaluate(() => {
  for (const hoja of document.styleSheets) {
    let reglas;
    try { reglas = hoja.cssRules; } catch { continue; }
    for (const r of reglas) if (r.media && r.media.mediaText.includes('pointer: coarse')) r.media.mediaText = '(min-width: 600px)';
  }
});

/** Lo que está mal en la pantalla abierta. Se ejecuta dentro de la página. */
function revisar() {
  const hallazgos = [];
  const anchoPantalla = document.documentElement.clientWidth;
  // En la tablet la página se agranda para caber en la pantalla: lo que se
  // mide aquí se multiplica por eso para saber cuánto se ve de verdad.
  const escala = window.screen.width / anchoPantalla;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const nombre = (el) => (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.value || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
  const marcar = (el, tipo, detalle) => {
    el.style.outline = '4px solid #E11D48';
    el.style.outlineOffset = '2px';
    hallazgos.push({ tipo, que: nombre(el), detalle });
  };

  // Pantalla en blanco: algo dejó todo oculto.
  const principal = document.querySelector('main');
  if (!principal || !visible(principal) || principal.innerText.trim().length < 20) {
    hallazgos.push({ tipo: 'pantalla en blanco', que: location.pathname, detalle: 'no se ve el contenido' });
    return hallazgos;
  }
  // Texto que no cabe en su campo o lista desplegable.
  for (const el of document.querySelectorAll('select, input:not([type=checkbox]):not([type=radio]):not([type=date]):not([type=file])')) {
    if (!visible(el)) continue;
    const texto = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text ?? '' : el.value || el.placeholder;
    if (!texto) continue;
    const s = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const espacio = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - (el.tagName === 'SELECT' ? 18 : 0);
    if (c.measureText(texto).width > espacio + 1) marcar(el, 'texto cortado', `«${texto}» no cabe`);
  }
  // Botones y textos con puntos suspensivos o cortados.
  for (const el of document.querySelectorAll('button, a, label, span, p, b, h1, h2, h3')) {
    if (!visible(el) || el.children.length > 3) continue;
    const s = getComputedStyle(el);
    if (s.overflow === 'visible' && s.textOverflow !== 'ellipsis') continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && (s.whiteSpace === 'nowrap' || s.textOverflow === 'ellipsis')) {
      marcar(el, 'texto cortado', 'no cabe en su espacio');
    }
  }
  // Algo que se sale del ancho de la pantalla.
  for (const el of document.querySelectorAll('main *, header *, nav *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > anchoPantalla + 2 && getComputedStyle(el).position !== 'fixed') {
      marcar(el, 'se sale de la pantalla', `llega a ${Math.round(r.right)} de ${anchoPantalla}`);
      break;
    }
  }
  // Para el dedo: botones, enlaces y campos de al menos 44 px de alto.
  for (const el of document.querySelectorAll('main button, main a, main input, main select, nav a, header button')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const alto = r.height * escala;
    // Una casilla de marcar dentro de su renglón cuenta con el renglón entero.
    const casilla = el.type === 'checkbox' || el.type === 'radio' ? el.closest('label') : null;
    const altoReal = casilla ? casilla.getBoundingClientRect().height * escala : alto;
    if (altoReal < 44 && !el.closest('.no-revisar')) marcar(el, 'muy chico para el dedo', `${Math.round(r.width * escala)}×${Math.round(altoReal)} en pantalla`);
  }
  // Letra que no se lee.
  for (const el of document.querySelectorAll('main *')) {
    if (!visible(el) || !el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const t = parseFloat(getComputedStyle(el).fontSize) * escala;
    if (t < 15) marcar(el, 'letra muy chica', `${Math.round(t)} en pantalla`);
  }
  return hallazgos;
}

await p.goto(`${BASE}/login`);
await p.getByLabel('Usuario').fill('preconsulta');
await p.getByLabel('Contraseña', { exact: true }).fill('Camotan2026!');
await p.getByRole('button', { name: 'Ingresar' }).click();
await p.waitForURL((u) => !u.pathname.startsWith('/login'));

// Un paciente cualquiera para el expediente, la ficha y los signos.
const id = await p.evaluate(async () => {
  const r = await fetch('/api/v1/pacientes?limite=1', { headers: { Authorization: `Bearer ${localStorage.getItem('camotan_token')}` } });
  return (await r.json()).pacientes?.[0]?.id;
});

let total = 0;
for (const [clave, ruta, tocar] of PANTALLAS) {
  await p.goto(`${BASE}${ruta.replace('{id}', id)}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await forzarTablet();
  await p.waitForTimeout(200);
  if (tocar) {
    await p.locator(tocar).first().click({ timeout: 5000 }).catch(() => console.log(`  ! no se pudo tocar ${tocar}`));
    await p.waitForTimeout(600);
    await forzarTablet();
  }
  const hallazgos = await p.evaluate(revisar);
  await p.screenshot({ path: path.join(SALIDA, `${clave}.png`), fullPage: true });
  total += hallazgos.length;
  console.log(`\n${clave} (${ruta}): ${hallazgos.length ? `${hallazgos.length} por revisar` : 'bien'}`);
  for (const h of hallazgos.slice(0, 25)) console.log(`  - ${h.tipo}: ${h.que} (${h.detalle})`);
  if (hallazgos.length > 25) console.log(`  … y ${hallazgos.length - 25} más`);
}
if (errores.length) console.log('\nErrores de la página:', errores);
console.log(`\nTotal: ${total}. Capturas en ${SALIDA}`);
await nav.close();
