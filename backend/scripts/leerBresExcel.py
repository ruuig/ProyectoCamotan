"""Lee el BRES impreso (18 hojas No.N) y saca B..M de cada renglon, calculando K, L, M con su formula."""
import sys, json, openpyxl

ruta, salida = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(ruta, read_only=True, data_only=False)
filas = []
for ws in wb.worksheets:
    for r in ws.iter_rows(min_row=10, max_row=86, max_col=13, values_only=True):
        nombre = r[0]
        if not isinstance(nombre, str) or not nombre.strip():
            continue
        vals = {}
        ok = True
        for i, col in enumerate('BCDEFGHIJ', start=1):
            v = r[i]
            if isinstance(v, str) and v.startswith('='):
                ok = False
            vals[col] = v
        if not ok or not isinstance(vals['B'], (int, float)):
            continue
        H, I, J = vals['H'], vals['I'], vals['J']
        # Formulas del libro: K = H/J, L = J*4, M = L-I
        vals['K'] = (H / J) if J else None
        vals['L'] = J * 4 if J is not None else None
        vals['M'] = (vals['L'] - I) if vals['L'] is not None and I is not None else None
        filas.append({'hoja': ws.title, 'nombre': nombre.strip(), **vals})
json.dump(filas, open(salida, 'w', encoding='utf-8'), ensure_ascii=False)
print(len(filas), 'renglones')
