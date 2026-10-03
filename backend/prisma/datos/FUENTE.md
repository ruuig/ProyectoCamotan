# Patrones de crecimiento infantil de la OMS

`referencia-oms.json` contiene los parametros LMS de los patrones de
crecimiento infantil de la Organizacion Mundial de la Salud, de 0 a 60 meses,
para ambos sexos.

## Procedencia

Los datos provienen de los archivos oficiales distribuidos por la OMS en el
paquete [`WorldHealthOrganization/anthro`](https://github.com/WorldHealthOrganization/anthro),
directorio `data-raw/growthstandards`:

| Archivo OMS | Indicador en este sistema | Filas |
|---|---|---|
| `weianthro.txt` | `peso_edad` | 122 |
| `lenanthro.txt` | `talla_edad` | 122 |
| `bmianthro.txt` | `imc_edad` | 122 |
| `wflanthro.txt` | `peso_longitud` | 1302 |
| `wfhanthro.txt` | `peso_talla` | 1102 |

Total: 2770 filas.

## Dos decisiones de conversion

**1. La edad se convierte de dias a meses.** Los archivos de la OMS expresan la
edad en dias (0 a 1826). Se muestrea en los dias que corresponden a cada mes
entero usando 30.4375 dias por mes (365.25 / 12), que es el mismo factor con el
que la OMS deriva sus tablas mensuales publicadas. El mes 60 cae en el dia 1826,
el ultimo del archivo.

**2. El peso segun estatura son dos indicadores, no uno.** La OMS publica dos
estandares distintos segun como se mide la estatura:

- `peso_longitud`: nino acostado, 45 a 110 cm. Se usa en menores de 24 meses.
- `peso_talla`: nino de pie, 65 a 120 cm. Se usa desde los 24 meses.

Los dos se traslapan entre 65 y 110 cm, y **sus valores difieren**, porque la
medida acostado da alrededor de 0.7 cm mas que de pie. Usar el estandar
equivocado clasifica mal la desnutricion, por eso se cargan por separado.

La especificacion del sistema nombra un solo indicador "peso para la talla".
Esta separacion es una correccion deliberada para no perder exactitud clinica.

## Verificacion

Valores contrastados contra las tablas publicadas por la OMS:

- Peso para la edad, ninos, mes 0: `L=0.3487, M=3.3464, S=0.14602`. La mediana
  al nacer es 3.3 kg y -2 DE son 2.5 kg.
- Peso para la edad, ninos, mes 12: mediana 9.646 kg (la OMS publica 9.6 kg).
- Longitud para la edad, ninos, mes 0: mediana 49.9 cm.

## Regenerar

```bash
node prisma/datos/generarReferenciaOms.js
```

Descarga los archivos de la OMS y reescribe el JSON. Requiere internet. El
seed no lo necesita: lee el JSON ya generado.
