const express = require('express');
const cors = require('cors');
const rutas = require('./routes');
const bitacora = require('./middleware/bitacora');
const manejarErrores = require('./middleware/errores');
const { puerto } = require('./config/env');

const app = express();

// Necesario en Render: sin esto req.ip devuelve la IP del proxy y la bitacora
// registraria siempre la misma direccion.
app.set('trust proxy', 1);

app.use(cors());
// Los catalogos llegan como CSV dentro del JSON (el CIE-10 completo pesa unos
// megas); el resto de los cuerpos son pequenos.
app.use(express.json({ limit: '4mb' }));
app.use(bitacora);
app.use('/api/v1', rutas);
app.use(manejarErrores);

if (require.main === module) {
  // Los jobs solo corren en el proceso servidor, no al importar la app en pruebas.
  require('./jobs/recalcularCola').iniciar();
  require('./jobs/refrescarVistas').iniciar();
  require('./jobs/evaluarAlertas').iniciar();

  app.listen(puerto, () => {
    console.log(`Servidor escuchando en el puerto ${puerto}`);
  });
}

module.exports = app;
