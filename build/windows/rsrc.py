# Genera un .syso (COFF con recursos) con el icono, para que Go lo meta en el .exe. Sin herramientas externas.
# Uso: python3 rsrc.py icono.png salida.syso
import io, struct, sys
from PIL import Image

def icono(png):
    im = Image.open(png).convert('RGBA')
    w, h = im.size; s = max(w, h)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0)); sq.paste(im, ((s - w) // 2, (s - h) // 2))
    imgs = []
    for n in (16, 24, 32, 48, 64, 128, 256):
        b = io.BytesIO(); sq.resize((n, n), Image.LANCZOS).save(b, 'PNG'); imgs.append((n, b.getvalue()))
    return sq, imgs

def syso(imgs, out):
    # datos: iconos (RT_ICON=3, ids 1..n) y grupo (RT_GROUP_ICON=14, id 1)
    grp = struct.pack('<HHH', 0, 1, len(imgs)) + b''.join(struct.pack('<BBBBHHIH', n % 256, n % 256, 0, 0, 1, 32, len(d), i + 1) for i, (n, d) in enumerate(imgs))
    tipos = [(3, [(i + 1, d) for i, (n, d) in enumerate(imgs)]), (14, [(1, grp)])]
    # arbol: raiz -> tipo -> id -> idioma -> data entry
    dirs = bytearray(); fix = []
    def d(n): return struct.pack('<IIHHHH', 0, 0, 0, 0, 0, n)
    # calcular tamanos
    root_sz = 16 + 8 * len(tipos)
    lvl2 = [16 + 8 * len(items) for _, items in tipos]
    nleaf = sum(len(items) for _, items in tipos)
    lvl3_off = root_sz + sum(lvl2)
    entries_off = lvl3_off + nleaf * (16 + 8)
    data_off = entries_off + nleaf * 16
    out_b = bytearray(); out_b += d(len(tipos))
    off2 = root_sz
    for (t, items), sz in zip(tipos, lvl2):
        out_b += struct.pack('<II', t, 0x80000000 | off2); off2 += sz
    leaf = 0; datas = []
    for t, items in tipos:
        out_b += d(len(items))
        for rid, data in items:
            out_b += struct.pack('<II', rid, 0x80000000 | (lvl3_off + leaf * 24)); leaf += 1; datas.append(data)
    for i in range(nleaf):
        out_b += d(1) + struct.pack('<II', 0x0409, entries_off + i * 16)
    pos = data_off; relocs = []
    blob = bytearray()
    for i, data in enumerate(datas):
        relocs.append(entries_off + i * 16)
        out_b += struct.pack('<IIII', pos, len(data), 0, 0)
        blob += data + b'\0' * ((-len(data)) % 8); pos += len(data) + ((-len(data)) % 8)
    assert len(out_b) == data_off
    raw = bytes(out_b + blob)
    hdr = 20; sect = 40
    p_raw = hdr + sect; p_rel = p_raw + len(raw); p_sym = p_rel + 10 * len(relocs)
    f = struct.pack('<HHIIIHH', 0x8664, 1, 0, p_sym, 1, 0, 0)
    f += b'.rsrc\0\0\0' + struct.pack('<IIIIIIHHI', 0, 0, len(raw), p_raw, p_rel, 0, len(relocs), 0, 0x40000040)
    f += raw + b''.join(struct.pack('<IIH', r, 0, 3) for r in relocs)
    f += b'.rsrc\0\0\0' + struct.pack('<IhHBB', 0, 1, 0, 3, 0) + struct.pack('<I', 4)
    open(out, 'wb').write(f)

sq, imgs = icono(sys.argv[1])
syso(imgs, sys.argv[2])
if len(sys.argv) > 3: sq.save(sys.argv[3], format='ICO', sizes=[(n, n) for n, _ in imgs])
