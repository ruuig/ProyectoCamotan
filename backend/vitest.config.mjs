import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config();

// Las pruebas corren contra una base propia, nunca contra la de trabajo.
// Sin esto, cualquier paciente dejado a mano en la cola hace fallar pruebas
// que suponen la cola vacia, y las pruebas ensucian los datos reales.
const urlPruebas = process.env.DATABASE_URL_TEST;

if (!urlPruebas) {
  throw new Error(
    'Falta DATABASE_URL_TEST en backend/.env. Cree la base con los scripts de bd/ y siembrela ' +
      'antes de correr las pruebas. Ver bd/README.md.',
  );
}

export default defineConfig({
  test: {
    // Comparten una sola base y una sola cola de atencion: en paralelo, las
    // atenciones de un archivo aparecen en la cola que otro esta comprobando.
    fileParallelism: false,
    testTimeout: 20000,
    env: { DATABASE_URL: urlPruebas },
  },
});
