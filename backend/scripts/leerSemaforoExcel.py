"""Lotes de las hojas Rojo/Amarillo/Verde del semaforo: (color, nombre, cantidad, lote, vence)."""
import sys, json, datetime, openpyxl

wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=False)
salida = []
for color in ('Rojo', 'Amarillo', 'Verde'):
    for r in wb[color].iter_rows(min_row=2, max_col=12, values_only=True):
        nombre = r[1]
        if not isinstance(nombre, str) or not nombre.strip():
            continue
        for c, l, v in ((2, 3, 4), (5, 6, 7), (8, 9, 10)):
            cant, lote, vence = r[c], r[l], r[v]
            if lote in (None, '') or not isinstance(cant, (int, float)) or cant <= 0:
                continue
            salida.append({
                'color': color.lower(), 'nombre': nombre.strip(), 'cantidad': cant, 'lote': str(lote).strip(),
                'vence': vence.date().isoformat() if isinstance(vence, datetime.datetime) else None,
            })
json.dump(salida, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(len(salida), 'lotes')
