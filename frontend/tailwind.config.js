import { COLOR, VARIABLES_CSS } from './src/design/tokens.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      screens: {
        // Por debajo de 1100 px el panel deja de caber en filas y se apila.
        // Es el ancho real de las pantallas del centro, no un tamaño teórico.
        panel: '1100px',
      },

      colors: {
        // --- Tokens del sistema visual ---------------------------------
        // Los nombres son los del documento de diseño. Todo color nuevo sale
        // de aquí; no se escriben hexadecimales en los componentes.
        fondo: COLOR.fondo,
        superficie: COLOR.superficie,
        tinta: { DEFAULT: COLOR.tinta, 2: COLOR.tinta2 },
        apagado: COLOR.apagado,
        linea: { DEFAULT: COLOR.linea, suave: COLOR.lineaSuave },
        marino: { DEFAULT: COLOR.marino, apagado: COLOR.marinoApagado },
        mejora: COLOR.mejora,
        empeora: { DEFAULT: COLOR.empeora, claro: COLOR.empeoraClaro },
        advertencia: { DEFAULT: COLOR.advertencia, marca: COLOR.advertenciaMarca },

        // --- Escalas heredadas -----------------------------------------
        // Las pantallas que aún no se han rehecho siguen usando estos
        // nombres. Sus tonos principales apuntan ya a los tokens, para que
        // todo el sistema se mueva junto y no queden dos azules distintos.
        mspas: {
          50: '#F2F4F7',
          100: '#E6EAF2',
          200: '#DFE4EC',
          300: '#A9B4CC',
          400: '#5B6478',
          500: '#3B4760',
          600: '#1F3566',
          700: COLOR.marino,
          800: '#101F44',
          900: '#0C1833',
        },
        celeste: {
          50: '#EEF4FC',
          100: '#DDE9F8',
          200: '#BCD3F0',
          300: '#7FA8DF',
          400: COLOR.mejora,
          500: '#1A55AB',
          600: '#164892',
          700: '#133C78',
        },
        // Lo crítico y lo que empeora comparten el naranja del sistema.
        urgente: {
          50: '#FDF2EC',
          100: '#FAE3D6',
          200: '#F4C7AE',
          300: '#E9A97C',
          400: COLOR.empeoraClaro,
          500: COLOR.empeoraClaro,
          600: '#D1560F',
          700: COLOR.empeora,
          900: '#8A2F08',
        },
        atencion: {
          50: '#FBF5E8',
          100: '#F6E9CB',
          200: '#EDD49B',
          300: COLOR.advertenciaMarca,
          500: COLOR.advertenciaMarca,
          600: '#B06E10',
          700: COLOR.advertencia,
          800: '#7E4A00',
          900: '#5F3800',
        },
        // "Estable" no es una comparación: marca un estado correcto puntual.
        // Se vuelve neutro para no competir con la regla de significado.
        estable: {
          100: '#E6EAF2',
          200: '#DFE4EC',
          300: '#A9B4CC',
          500: COLOR.tinta2,
          600: COLOR.tinta,
          700: COLOR.tinta,
          900: COLOR.tinta,
        },
      },

      fontFamily: {
        // IBM Plex: sobria, muy legible y con cifras tabulares parejas.
        sans: ['IBM Plex Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        titulo: ['IBM Plex Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        // Escala del documento, en píxeles reales sobre una base de 16 px.
        // Nada baja de 12 px: el sistema se usa de pie y a distancia.
        xs: ['0.8125rem', { lineHeight: '1.15rem' }], // 13 px
        sm: ['0.875rem', { lineHeight: '1.25rem' }], // 14 px
        base: ['1rem', { lineHeight: '1.55rem' }], // 16 px
        lg: ['1.125rem', { lineHeight: '1.7rem' }], // 18 px
        xl: ['1.25rem', { lineHeight: '1.7rem' }], // 20 px
        '2xl': ['1.5rem', { lineHeight: '1.9rem' }], // 24 px
        '3xl': ['1.75rem', { lineHeight: '2.1rem' }], // 28 px
        '4xl': ['2.125rem', { lineHeight: '2.4rem' }], // 34 px
        // Tamaños con nombre, para que la intención quede escrita.
        etiqueta: ['0.8125rem', { lineHeight: '1.15rem' }], // 13 px
        'titulo-pagina': ['2.125rem', { lineHeight: '2.4rem' }], // 34 px
        'titulo-seccion': ['1.25rem', { lineHeight: '1.7rem' }], // 20 px
        'cifra-indicador': ['2.25rem', { lineHeight: '1' }], // 36 px
        'cifra-decision': ['3rem', { lineHeight: '1' }], // 48 px
      },

      borderRadius: {
        tarjeta: '1rem', // 16 px en tarjetas y paneles
        control: '0.625rem', // 10 px en botones y campos
      },

      spacing: {
        // Separaciones del documento: 28 px entre bloques, 20 px entre
        // tarjetas de una fila, 24 px de relleno interno.
        bloque: '1.75rem',
        tarjeta: '1.25rem',
        relleno: '1.5rem',
        // Altura mínima de cualquier elemento que se toca o se pulsa.
        tocable: '2.75rem',
      },
    },
  },
  plugins: [
    // Publica los tokens como variables CSS en :root. Así el mismo valor
    // sirve en una clase de Tailwind, en un estilo en línea y en Chart.js.
    ({ addBase }) => addBase({ ':root': VARIABLES_CSS }),
  ],
};
