"""Build the lunar module model for the game and export game/assets/models/lander.glb.

Run with Blender 4.2 or newer (tested with 5.0):
    blender -b -P blender/make_lander.py -- --out game/assets/models --previews blender/previews
or with the bpy Python module:
    python blender/make_lander.py --out game/assets/models --previews blender/previews

Options: --no-render skips the preview renders, --samples sets Cycles samples, --res W H the preview size.

Model contract (see prompts/contract.md): glTF, Y up, metres. The lander faces +Z (Blender -Y) and its left
side is +X. Origin on the vertical axis at the footpad bottoms. Node names: Lander, DescentStage, AscentStage,
EngineBell, Leg_Front/Back/Left/Right, FootpadContact_*, ProbeTip_Back/Left/Right, NozzleExit, CockpitEye,
RCS_Quad_1..4. DescentStage holds only the descent stage body and porch (the game uses its bounding box as
the hull), the legs are separate.

Textures are generated with numpy and written with a small PNG writer: Blender's own image saving produced
blank files for generated images in Blender 5.0.
"""
import argparse
import math
import os
import struct
import sys
import zlib

import bpy
import numpy as np
from mathutils import Vector

RNG = np.random.default_rng(20261105)
TAU = 2.0 * math.pi


# ---------------------------------------------------------------------------------------------------------
# arguments
# ---------------------------------------------------------------------------------------------------------
def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=os.path.normpath(os.path.join(here, "..", "game", "assets", "models")))
    p.add_argument("--previews", default=os.path.join(here, "previews"))
    p.add_argument("--no-render", action="store_true")
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--res", type=int, nargs=2, default=[1280, 720])
    return p.parse_args(argv)


# ---------------------------------------------------------------------------------------------------------
# textures
# ---------------------------------------------------------------------------------------------------------
def write_png(path, arr):
    arr = np.ascontiguousarray(arr, dtype=np.uint8)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    h, w, c = arr.shape
    ctype = {1: 0, 2: 4, 3: 2, 4: 6}[c]
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def band_noise(n, f0, width):
    """Periodic noise with energy around f0 cycles per image, normalised to unit variance."""
    f = np.fft.fft2(RNG.standard_normal((n, n)))
    kx = np.fft.fftfreq(n)[:, None] * n
    ky = np.fft.fftfreq(n)[None, :] * n
    k = np.sqrt(kx * kx + ky * ky)
    f *= np.exp(-((k - f0) / width) ** 2)
    out = np.real(np.fft.ifft2(f))
    return (out - out.mean()) / (out.std() + 1e-9)


def facet_slopes(n, cells, max_tilt_deg):
    """Jittered-grid Voronoi cells, each a flat facet with a random tilt: the look of crumpled foil."""
    cs = n / cells
    jitter = RNG.random((cells, cells, 2))
    grid = np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing="ij"), -1)
    seeds = (grid + 0.15 + 0.7 * jitter) * cs
    tilt = np.radians(max_tilt_deg) * np.sqrt(RNG.random((cells, cells)))
    az = RNG.random((cells, cells)) * TAU
    sx_c = np.tan(tilt) * np.cos(az)
    sy_c = np.tan(tilt) * np.sin(az)
    rows = np.arange(n)[:, None] + 0.5
    cols = np.arange(n)[None, :] + 0.5
    ci = np.floor(rows / cs).astype(int)
    cj = np.floor(cols / cs).astype(int)
    best = np.full((n, n), np.inf)
    bi = np.zeros((n, n), int)
    bj = np.zeros((n, n), int)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ii = ci + di
            jj = cj + dj
            iw = ii % cells
            jw = jj % cells
            sr = seeds[iw, jw, 0] + (ii - iw) * cs
            sc = seeds[iw, jw, 1] + (jj - jw) * cs
            d = (rows - sr) ** 2 + (cols - sc) ** 2
            m = d < best
            best = np.where(m, d, best)
            bi = np.where(m, iw, bi)
            bj = np.where(m, jw, bj)
    return sx_c[bi, bj], sy_c[bi, bj]


def slopes_to_normal_png(sx, sy):
    """OpenGL convention (glTF and Blender): +X right, +Y up the image."""
    nz = 1.0 / np.sqrt(1.0 + sx * sx + sy * sy)
    rgb = np.stack([-sx * nz, -sy * nz, nz], -1) * 0.5 + 0.5
    return (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)


def height_slopes(h):
    gy, gx = np.gradient(h)  # gy along rows (down the image), gx along columns
    return gx, -gy


def make_crinkle(n):
    """Kapton and Mylar blankets: soft wrinkles with sharp creases, a few flat facets, fine crumple."""
    sx1, sy1 = facet_slopes(n, 9, 13)
    sx2, sy2 = facet_slopes(n, 22, 7)
    h = np.zeros((n, n))
    for f0, w, a in ((4, 2, 1.0), (10, 4, 0.6), (26, 10, 0.3), (70, 25, 0.12)):
        h += a * (1.0 - np.abs(band_noise(n, f0, w)))  # ridges where the noise crosses zero: creases
    soft = band_noise(n, 3, 2)  # broad undulation of the sheet
    cx, cy = height_slopes(h)
    sx_, sy_ = height_slopes(soft)
    k = 0.30 / (np.sqrt((cx * cx + cy * cy).mean()) + 1e-9)
    k2 = 0.08 / (np.sqrt((sx_ * sx_ + sy_ * sy_).mean()) + 1e-9)
    return slopes_to_normal_png(0.7 * sx1 + 0.5 * sx2 + k * cx + k2 * sx_, 0.7 * sy1 + 0.5 * sy2 + k * cy + k2 * sy_)


def make_panels(n):
    """Riveted skin panels of uneven sizes for the ascent stage. One tile is 3 m by 3 m."""
    rows = np.arange(n)[:, None].astype(float)
    cols = np.arange(n)[None, :].astype(float)
    h = 0.05 * band_noise(n, 4, 2)  # slight oil-canning
    edges = np.sort(np.concatenate([[0], RNG.choice(np.arange(n // 10, n - n // 10, 8), size=3, replace=False)]))
    widths = np.diff(np.concatenate([edges, [n]]))
    dcol = np.min(np.abs(((cols[:, :, None] - edges[None, None, :]) + n / 2) % n - n / 2), axis=2)
    seam = np.exp(-(dcol / 1.1) ** 2)
    rivet = np.exp(-((dcol - 5) ** 2 + ((rows % 14) - 7) ** 2) / 2.2)
    for k, (e, w) in enumerate(zip(edges, widths)):
        cuts = np.sort(RNG.choice(np.arange(n // 10, n - n // 10, 8), size=RNG.integers(1, 4), replace=False))
        cuts = np.concatenate([[0], cuts])
        drow = np.min(np.abs(((rows[:, :, None] - cuts[None, None, :]) + n / 2) % n - n / 2), axis=2)
        mask = (cols >= e) & (cols < e + w)
        seam = np.where(mask, np.maximum(seam, np.exp(-(drow / 1.1) ** 2)), seam)
        rivet = np.where(mask, np.maximum(rivet, np.exp(-((drow - 5) ** 2 + ((cols % 14) - 7) ** 2) / 2.2)), rivet)
    h = h - seam + 0.45 * rivet
    sx, sy = height_slopes(h)
    return slopes_to_normal_png(0.9 * sx, 0.9 * sy)


def make_foil_mr(n):
    """metallicRoughness for the metallic foils: G = roughness, B = metallic (1)."""
    # fairly rough on purpose: seen from a distance the crinkles average out in the texture's mipmaps, and the
    # roughness has to stand in for them or the foil turns into a mirror that flashes the sun
    r = 0.56 + 0.06 * band_noise(n, 6, 4) + 0.03 * band_noise(n, 30, 12)
    r = np.clip(r, 0.42, 0.7)
    img = np.zeros((n, n, 3), np.uint8)
    img[:, :, 1] = (r * 255 + 0.5).astype(np.uint8)
    img[:, :, 2] = 255
    return img


def generate_textures(tex_dir):
    os.makedirs(tex_dir, exist_ok=True)
    out = {}
    for name, fn, n in (("lm_crinkle_normal", make_crinkle, 1024), ("lm_panel_normal", make_panels, 1024),
                        ("lm_foil_mr", make_foil_mr, 512)):
        arr = fn(n)
        path = os.path.join(tex_dir, name + ".png")
        write_png(path, arr)
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = "Non-Color"
        img.pack()
        std = float(arr.astype(float).std())
        print("  %s: %dx%d, std %.1f" % (name, n, n, std))
        if std < 2:
            raise SystemExit("texture %s came out flat" % name)
        out[name] = img
    return out


# ---------------------------------------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------------------------------------
def make_material(name, color, metallic, roughness, normal=None, normal_strength=1.0, mr=None, double_sided=False):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if normal is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = normal
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if mr is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = mr
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    mat.use_backface_culling = not double_sided
    mat.diffuse_color = (color[0], color[1], color[2], 1.0)
    return mat


def create_materials(tex):
    c, p, mr = tex["lm_crinkle_normal"], tex["lm_panel_normal"], tex["lm_foil_mr"]
    return {
        "GoldKapton": make_material("GoldKapton", (0.80, 0.52, 0.16), 1.0, 0.28, c, 0.9, mr),
        "SilverMylar": make_material("SilverMylar", (0.84, 0.84, 0.86), 1.0, 0.22, c, 0.7, mr),
        "BlackFoil": make_material("BlackFoil", (0.022, 0.022, 0.026), 0.25, 0.4, c, 0.6),
        "AscentPanel": make_material("AscentPanel", (0.46, 0.47, 0.48), 0.3, 0.52, p, 0.7),
        "AscentDark": make_material("AscentDark", (0.035, 0.035, 0.04), 0.1, 0.45, p, 0.5),
        "WindowGlass": make_material("WindowGlass", (0.015, 0.02, 0.028), 0.0, 0.04),
        "BareMetal": make_material("BareMetal", (0.72, 0.72, 0.74), 1.0, 0.42),
        "EngineBell": make_material("EngineBell", (0.10, 0.10, 0.11), 0.8, 0.42),
        "EngineInner": make_material("EngineInner", (0.05, 0.05, 0.055), 0.5, 0.6),
        "DishWhite": make_material("DishWhite", (0.80, 0.80, 0.78), 0.0, 0.55),
    }


# ---------------------------------------------------------------------------------------------------------
# mesh helpers (Blender space: Z up, front of the lander = -Y, left = +X)
# ---------------------------------------------------------------------------------------------------------
def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def new_mesh(name, verts, faces, mats, face_mats=None, smooth=False, uv=None, uv_scale=1.0, sharp=None):
    """uv: None for box projection, or a list (one per face) of per-corner (u, v) pairs."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    me.update()
    for m in mats:
        me.materials.append(m)
    nf = len(me.polygons)
    if face_mats is not None:
        me.polygons.foreach_set("material_index", [int(i) for i in face_mats])
    flags = [bool(smooth)] * nf if isinstance(smooth, bool) else [bool(s) for s in smooth]
    me.polygons.foreach_set("use_smooth", flags)
    if sharp:
        key = {tuple(sorted(e.vertices)): e.index for e in me.edges}
        for a, b in sharp:
            i = key.get(tuple(sorted((a, b))))
            if i is not None:
                me.edges[i].use_edge_sharp = True
    layer = me.uv_layers.new(name="UVMap")
    if uv is None:
        box_uv(me, layer, uv_scale)
    else:
        flat = []
        for poly in me.polygons:
            corners = uv[poly.index]
            for k in range(poly.loop_total):
                flat.extend((corners[k][0] * uv_scale, corners[k][1] * uv_scale))
        layer.data.foreach_set("uv", flat)
    me.update()
    return link(bpy.data.objects.new(name, me))


def box_uv(me, layer, scale):
    nv, np_, nl = len(me.vertices), len(me.polygons), len(me.loops)
    co = np.empty(nv * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    nrm = np.empty(np_ * 3)
    me.polygons.foreach_get("normal", nrm)
    nrm = np.abs(nrm.reshape(-1, 3))
    lv = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    tot = np.empty(np_, dtype=np.int32)
    me.polygons.foreach_get("loop_total", tot)
    poly_of_loop = np.repeat(np.arange(np_), tot)
    p = co[lv]
    ax = np.argmax(nrm[poly_of_loop], axis=1)
    u = np.where(ax == 0, p[:, 1], p[:, 0])
    v = np.where(ax == 2, p[:, 1], p[:, 2])
    layer.data.foreach_set("uv", (np.stack([u, v], 1) * scale).ravel())


def add_bevel(obj, width=0.015, segments=2, angle_deg=35):
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle_deg)
    return obj


def frame_of(axis):
    z = Vector(axis).normalized()
    x = z.orthogonal().normalized()
    y = z.cross(x)
    return x, y, z


def cylinder(name, p1, p2, r1, mat, r2=None, segs=16, caps=True, uv_scale=1.0, flip=False):
    """Frustum from p1 (radius r1) to p2 (radius r2), smooth sides, flat caps. flip: normals point inward."""
    p1, p2 = Vector(p1), Vector(p2)
    r2 = r1 if r2 is None else r2
    x, y, z = frame_of(p2 - p1)
    length = (p2 - p1).length
    verts = []
    for k in range(segs):
        a = TAU * k / segs
        verts.append(p1 + (x * math.cos(a) + y * math.sin(a)) * r1)
    for k in range(segs):
        a = TAU * k / segs
        verts.append(p2 + (x * math.cos(a) + y * math.sin(a)) * r2)
    faces, uvs, smooth, sharp = [], [], [], []
    circ = TAU * max(r1, r2)
    for k in range(segs):
        k1 = (k + 1) % segs
        faces.append((k, k1, segs + k1, segs + k))
        u0, u1 = circ * k / segs, circ * (k + 1) / segs
        uvs.append([(u0, 0), (u1, 0), (u1, length), (u0, length)])
        smooth.append(True)
    if caps:
        faces.append(tuple(range(segs - 1, -1, -1)))
        uvs.append([(math.cos(TAU * i / segs) * r1, math.sin(TAU * i / segs) * r1) for i in range(segs - 1, -1, -1)])
        smooth.append(False)
        faces.append(tuple(range(segs, 2 * segs)))
        uvs.append([(math.cos(TAU * i / segs) * r2, math.sin(TAU * i / segs) * r2) for i in range(segs)])
        smooth.append(False)
        for k in range(segs):
            sharp.append((k, (k + 1) % segs))
            sharp.append((segs + k, segs + (k + 1) % segs))
    if flip:
        faces = [tuple(reversed(f)) for f in faces]
        uvs = [list(reversed(u)) for u in uvs]
    return new_mesh(name, verts, faces, [mat], None, smooth, uvs, uv_scale, sharp)


def revolve(name, profile, mats, face_mats=None, segs=48, centre=(0, 0, 0), axis=(0, 0, 1), uv_scale=1.0,
            smooth=True, sharp_rows=()):
    """Revolve a closed or open (r, h) profile around axis through centre. Points with r == 0 are poles.
    face_mats: one material index per profile segment. sharp_rows: profile indices whose rings are sharp."""
    c = Vector(centre)
    x, y, z = frame_of(axis)
    n = len(profile)
    verts, index = [], []
    for i, (r, h) in enumerate(profile):
        if r <= 1e-9:
            index.append([len(verts)] * segs)
            verts.append(c + z * h)
        else:
            row = []
            for k in range(segs):
                a = TAU * k / segs
                row.append(len(verts))
                verts.append(c + (x * math.cos(a) + y * math.sin(a)) * r + z * h)
            index.append(row)
    faces, fm, uvs, sm = [], [], [], []
    arc = [0.0]
    for i in range(1, n):
        arc.append(arc[-1] + math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]))
    rmax = max(r for r, _ in profile)
    for i in range(n - 1):
        a_row, b_row = index[i], index[i + 1]
        for k in range(segs):
            k1 = (k + 1) % segs
            u0, u1 = TAU * rmax * k / segs, TAU * rmax * (k + 1) / segs
            # going up the profile with increasing angle: outward normal for a profile running bottom to top
            quad = [a_row[k], a_row[k1], b_row[k1], b_row[k]]
            uvq = [(u0, arc[i]), (u1, arc[i]), (u1, arc[i + 1]), (u0, arc[i + 1])]
            # drop repeated pole vertices
            keep = [j for j in range(4) if quad[j] not in quad[:j]]
            faces.append([quad[j] for j in keep])
            uvs.append([uvq[j] for j in keep])
            fm.append(face_mats[i] if face_mats else 0)
            sm.append(smooth)
    sharp = []
    for i in sharp_rows:
        row = index[i]
        for k in range(segs):
            sharp.append((row[k], row[(k + 1) % segs]))
    return new_mesh(name, verts, faces, mats, fm, sm, uvs, uv_scale, sharp)


def prism(name, poly, z0, z1, mats, side_mat=0, top_mat=0, bottom_mat=0, uv_scale=1.0, bevel=0.0, top=True,
          bottom=True):
    """Vertical prism from a counter-clockwise (seen from above) polygon of (x, y) points."""
    n = len(poly)
    verts = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    faces, fm = [], []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        fm.append(side_mat)
    if bottom:
        faces.append(tuple(range(n - 1, -1, -1)))
        fm.append(bottom_mat)
    if top:
        faces.append(tuple(range(n, 2 * n)))
        fm.append(top_mat)
    obj = new_mesh(name, verts, faces, mats, fm, False, None, uv_scale)
    if bevel > 0:
        add_bevel(obj, bevel)
    return obj


def tube_y(name, section, y_front, y_back, mats, face_mats=None, cap_mats=(0, 0), uv_scale=1.0, bevel=0.0):
    """Prism along Y. section: counter-clockwise (x, z) points seen from the front (-Y), i.e. looking along +Y.
    y_front(x, z) gives the front face position per vertex (lets the front face be folded)."""
    n = len(section)
    verts = [(x, y_front(x, z), z) for x, z in section] + [(x, y_back, z) for x, z in section]
    faces, fm = [], []
    for i in range(n):
        j = (i + 1) % n
        # front ring i -> j counter-clockwise seen from the front; side faces go front to back
        faces.append((i, n + i, n + j, j))
        fm.append(face_mats[i] if face_mats else 0)
    faces.append(tuple(range(n)))  # front cap: counter-clockwise seen from the front -> normal -Y
    fm.append(cap_mats[0])
    faces.append(tuple(range(2 * n - 1, n - 1, -1)))  # back cap
    fm.append(cap_mats[1])
    obj = new_mesh(name, verts, faces, mats, fm, False, None, uv_scale)
    if bevel > 0:
        add_bevel(obj, bevel)
    return obj


def box(name, lo, hi, mat, uv_scale=1.0, bevel=0.0):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    return prism(name, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, [mat], uv_scale=uv_scale, bevel=bevel)


def foil_panel(name, origin, U, V, mat, nu, nv, pillows=(1, 1), pillow_amp=0.04, crinkle_amp=0.012,
               uv_scale=1.0 / 1.2):
    """A blanket of foil over the rectangle origin + u U + v V: pillowed outward, crumpled, edges fixed."""
    O, U, V = np.array(origin, float), np.array(U, float), np.array(V, float)
    N = np.cross(U, V)
    N /= np.linalg.norm(N)
    lu, lv = np.linalg.norm(U), np.linalg.norm(V)
    us = np.linspace(0, 1, nu + 1)
    vs = np.linspace(0, 1, nv + 1)
    uu, vv = np.meshgrid(us, vs)  # (nv+1, nu+1)
    pil = np.abs(np.sin(np.pi * uu * pillows[0])) * np.abs(np.sin(np.pi * vv * pillows[1]))
    pil = pil ** 0.6
    crumple = np.zeros_like(uu)
    for _ in range(14):
        wl = RNG.uniform(0.12, 0.45)
        ang = RNG.uniform(0, TAU)
        kx, ky = math.cos(ang) * TAU / wl, math.sin(ang) * TAU / wl
        crumple += RNG.uniform(0.4, 1.0) * np.sin(kx * uu * lu + ky * vv * lv + RNG.uniform(0, TAU))
    crumple /= np.abs(crumple).max() + 1e-9
    edge = np.clip(np.minimum.reduce([uu * lu, (1 - uu) * lu, vv * lv, (1 - vv) * lv]) / 0.08, 0, 1)
    disp = pillow_amp * pil + crinkle_amp * crumple * edge * (0.4 + 0.6 * pil)
    P = O[None, None, :] + uu[..., None] * U + vv[..., None] * V + disp[..., None] * N
    verts = P.reshape(-1, 3)
    faces, uvs = [], []
    w = nu + 1
    for j in range(nv):
        for i in range(nu):
            a = j * w + i
            faces.append((a, a + 1, a + w + 1, a + w))
            uvs.append([(us[i] * lu, vs[j] * lv), (us[i + 1] * lu, vs[j] * lv),
                        (us[i + 1] * lu, vs[j + 1] * lv), (us[i] * lu, vs[j + 1] * lv)])
    return new_mesh(name, verts, faces, [mat], None, True, uvs, uv_scale)


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.2
    e.location = loc
    link(e)
    if parent is not None:
        e.parent = parent
    return e


def parent_all(objs, parent):
    for o in objs:
        o.parent = parent


# ---------------------------------------------------------------------------------------------------------
# the lunar module
# ---------------------------------------------------------------------------------------------------------
A = 2.1          # descent stage half width across the flats
CH = 0.85        # corner chamfer
Z_DB, Z_DT = 1.45, 3.1   # descent stage bottom and top
FOOT_R = 4.5     # footpad centre radius
LEG_DIRS = {"Front": (0, -1), "Back": (0, 1), "Left": (1, 0), "Right": (-1, 0)}


def octagon(a, c):
    return [(a - c, -a), (a, -a + c), (a, a - c), (a - c, a), (-a + c, a), (-a, a - c), (-a, -a + c), (-a + c, -a)]


def build_descent_stage(M):
    parts = []
    poly = octagon(A, CH)
    h = Z_DT - Z_DB
    for i in range(8):
        p0 = np.array([*poly[i], Z_DB])
        p1 = np.array([*poly[(i + 1) % 8], Z_DB])
        U = p1 - p0
        main = i % 2 == 1  # faces 1, 3, 5, 7 are the main (flat) faces: +X, +Y, -X, -Y... see octagon()
        # octagon(): edges 0->1, 2->3, 4->5, 6->7 are the corner chamfers; 1->2, 3->4, 5->6, 7->0 the main faces
        if main:
            band = 0.28  # black heat-shield band along the bottom
            parts.append(foil_panel("DS_Band_%d" % i, p0, U, (0, 0, band), M["BlackFoil"], 40, 5, (2, 1), 0.012, 0.006))
            parts.append(foil_panel("DS_Face_%d" % i, p0 + [0, 0, band], U, (0, 0, h - band), M["GoldKapton"], 42, 24,
                                    (2, 1), 0.055, 0.016))
        else:
            parts.append(foil_panel("DS_Bay_%d" % i, p0, U, (0, 0, h * 0.62), M["BlackFoil"], 20, 16, (1, 1), 0.05, 0.014))
            parts.append(foil_panel("DS_BayTop_%d" % i, p0 + [0, 0, h * 0.62], U, (0, 0, h * 0.38), M["GoldKapton"], 20, 10,
                                    (1, 1), 0.035, 0.012))
    # top deck and bottom heat shield
    top = prism("DS_Deck", octagon(A - 0.02, CH - 0.01), Z_DT - 0.06, Z_DT, [M["AscentDark"], M["SilverMylar"]],
                side_mat=1, top_mat=0, bottom=False, uv_scale=0.8)
    parts += [top, octagon_annulus("DS_Bottom", A - 0.02, CH - 0.01, 0.62, Z_DB, M["BlackFoil"])]
    # corner posts hide the panel seams
    for i in range(8):
        x, y = poly[i]
        parts.append(cylinder("DS_Post_%d" % i, (x, y, Z_DB), (x, y, Z_DT), 0.035, M["AscentDark"], segs=8))
    # leg outriggers (upper attachment boxes on the main faces)
    for name, (dx, dy) in LEG_DIRS.items():
        d = Vector((dx, dy, 0))
        p = Vector((-dy, dx, 0))
        c0 = d * (A - 0.05) + Vector((0, 0, 2.86))
        c1 = d * 2.42 + Vector((0, 0, 2.86))
        corners = [c0 + p * 0.17, c1 + p * 0.17, c1 - p * 0.17, c0 - p * 0.17]
        xs = [v.x for v in corners]
        ys = [v.y for v in corners]
        ob = box("DS_Outrigger_" + name, (min(xs), min(ys), 2.72), (max(xs), max(ys), 3.0), M["GoldKapton"],
                 uv_scale=1.4, bevel=0.02)
        parts.append(ob)
    return parts


def octagon_annulus(name, a, c, r_in, z, mat, segs=64):
    """Flat bottom plate: the octagon outline with a round hole for the engine bell, facing down."""
    poly = octagon(a, c)
    verts, faces = [], []
    for k in range(segs):
        t = TAU * k / segs
        dx, dy = math.cos(t), math.sin(t)
        # ray from the centre to the octagon outline
        best = 1e9
        for i in range(8):
            (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % 8]
            ex, ey = x1 - x0, y1 - y0
            den = dx * ey - dy * ex
            if abs(den) < 1e-12:
                continue
            tt = (x0 * ey - y0 * ex) / den
            uu = (x0 * dy - y0 * dx) / den
            if tt > 0 and -1e-9 <= uu <= 1 + 1e-9:
                best = min(best, tt)
        verts.append((dx * r_in, dy * r_in, z))
        verts.append((dx * best, dy * best, z))
    for k in range(segs):
        k1 = (k + 1) % segs
        faces.append((2 * k, 2 * k + 1, 2 * k1 + 1, 2 * k1))  # inner, outer, next outer, next inner: faces down
    return new_mesh(name, verts, faces, [mat], None, False, None, 1.4)


def build_engine_bell(M):
    outer = [(0.75, 1.05), (0.71, 1.22), (0.64, 1.42), (0.55, 1.68), (0.46, 1.98), (0.42, 2.15)]
    inner = [(0.40, 2.15), (0.44, 1.98), (0.53, 1.68), (0.62, 1.42), (0.69, 1.22), (0.73, 1.07)]
    profile = outer + inner + [(0.75, 1.05)]
    # profile runs up the outside and back down the inside: outside faces point out, inside faces point in
    mats = [M["EngineBell"], M["EngineInner"]]
    fm = [0] * (len(outer) - 1) + [1] + [1] * (len(inner) - 1) + [0]
    bell = revolve("EngineBellMesh", profile, mats, fm, segs=64, uv_scale=1.0, sharp_rows=(0, len(outer) - 1, len(outer), len(profile) - 2))
    lip = revolve("EngineBellLip", [(0.735, 1.03), (0.77, 1.03), (0.77, 1.075), (0.735, 1.075), (0.735, 1.03)],
                  [M["BareMetal"]], segs=64, smooth=False)
    return [bell, lip]


def build_leg(name, M):
    dx, dy = LEG_DIRS[name]
    d = Vector((dx, dy, 0))
    p = Vector((-dy, dx, 0))
    up = Vector((0, 0, 1))
    parts = []
    U = d * 2.38 + up * 2.86          # top of the primary strut, at the outrigger
    F = d * FOOT_R + up * 0.40        # ball joint on top of the footpad
    J = U.lerp(F, 0.66)               # where the secondary struts meet the primary
    K = U.lerp(F, 0.36)               # downlock truss attachment
    M_ = U.lerp(F, 0.58)              # end of the outer sleeve
    parts.append(cylinder(name + "_Sleeve", U, M_, 0.105, M["GoldKapton"], segs=20, uv_scale=1.6))
    parts.append(cylinder(name + "_Piston", M_ - (F - U).normalized() * 0.1, F, 0.062, M["BareMetal"], segs=16))
    parts.append(cylinder(name + "_Collar", M_ - (F - U).normalized() * 0.04, M_ + (F - U).normalized() * 0.03,
                          0.125, M["AscentDark"], segs=20))
    for s in (1, -1):
        S = d * (A - 0.05) + p * (0.95 * s) + up * 1.52
        parts.append(cylinder(name + "_Secondary_%d" % (s + 1), S, J, 0.042, M["BareMetal"], segs=12))
        T = d * (A - 0.05) + p * (0.55 * s) + up * 2.45
        parts.append(cylinder(name + "_Truss_%d" % (s + 1), T, K, 0.026, M["BareMetal"], segs=10))
        parts.append(cylinder(name + "_Brace_%d" % (s + 1), S, T, 0.022, M["BareMetal"], segs=8))
    parts.append(cylinder(name + "_JointJ", J - p * 0.12, J + p * 0.12, 0.07, M["AscentDark"], segs=12))
    # footpad: a shallow saucer, closed
    pad = [(0.0, 0.0), (0.22, 0.012), (0.36, 0.05), (0.44, 0.12), (0.475, 0.2), (0.475, 0.245), (0.44, 0.255),
           (0.30, 0.225), (0.12, 0.205), (0.0, 0.2)]
    centre = d * FOOT_R
    parts.append(revolve(name + "_Footpad", pad, [M["SilverMylar"]], segs=48, centre=centre, uv_scale=1.6,
                         sharp_rows=(5,)))
    parts.append(cylinder(name + "_Ball", centre + up * 0.2, F + (F - U).normalized() * -0.02, 0.085,
                          M["BareMetal"], r2=0.07, segs=16))
    probe_tip = None
    if name != "Front":
        top = centre + d * 0.44 + up * 0.14
        probe_tip = centre + d * 0.52 + up * -1.5
        parts.append(cylinder(name + "_Probe", top, probe_tip, 0.013, M["BareMetal"], segs=8))
        parts.append(cylinder(name + "_ProbeHinge", top - p * 0.05, top + p * 0.05, 0.03, M["AscentDark"], segs=8))
    else:
        # ladder on the front leg
        s_dir = (F - U).normalized()
        n_out = (d * -s_dir.z + up * s_dir.to_2d().length).normalized()  # perpendicular to the strut, up and out
        a0 = U.lerp(F, 0.1) + n_out * 0.13
        a1 = U.lerp(F, 0.84) + n_out * 0.13
        for s in (1, -1):
            parts.append(cylinder(name + "_LadderRail_%d" % (s + 1), a0 + p * 0.24 * s, a1 + p * 0.24 * s, 0.018,
                                  M["BareMetal"], segs=8))
        rungs = 9
        for k in range(rungs):
            c = a0.lerp(a1, (k + 0.5) / rungs)
            parts.append(cylinder(name + "_Rung_%d" % k, c - p * 0.24, c + p * 0.24, 0.014, M["BareMetal"], segs=8))
    return parts, centre, probe_tip


def build_porch(M):
    parts = [box("Porch_Deck", (-0.42, -2.58, Z_DT), (0.42, -1.56, Z_DT + 0.05), M["BareMetal"], bevel=0.008)]
    for s in (1, -1):
        parts.append(cylinder("Porch_Post_%d" % (s + 1), (0.42 * s, -2.54, Z_DT + 0.05), (0.42 * s, -2.54, Z_DT + 0.75),
                              0.016, M["BareMetal"], segs=8))
        parts.append(cylinder("Porch_Rail_%d" % (s + 1), (0.42 * s, -2.54, Z_DT + 0.75), (0.42 * s, -1.62, Z_DT + 0.95),
                              0.016, M["BareMetal"], segs=8))
    return parts


# ascent stage geometry
CAB_W, CAB_H, CAB_C, CAB_ZC = 1.17, 1.05, 0.42, 4.4     # cabin half width, half height, chamfer, centre height
CAB_FOLD = 4.3                                          # front face: vertical below, leaning back above
CAB_YF, CAB_YB, CAB_LEAN = -1.55, -0.4, 0.4


def cabin_front_y(x, z):
    if z <= CAB_FOLD + 1e-6:
        return CAB_YF
    return CAB_YF + (z - CAB_FOLD) * CAB_LEAN / (CAB_ZC + CAB_H - CAB_FOLD)


def build_ascent_stage(M):
    parts = []
    W, H, C, ZC = CAB_W, CAB_H, CAB_C, CAB_ZC
    # base between the descent stage deck and the cabin floor
    base = [(-0.75, -1.5), (0.75, -1.5), (1.05, -1.2), (1.05, 1.45), (0.75, 1.75), (-0.75, 1.75), (-1.05, 1.45),
            (-1.05, -1.2)]
    parts.append(prism("AS_Base", base, Z_DT, ZC - H + 0.02, [M["BlackFoil"]], uv_scale=1.4))
    # cabin: octagonal tube with a folded front face; section counter-clockwise seen from the front
    sec = [(-W + C, ZC - H), (W - C, ZC - H), (W, ZC - H + C), (W, CAB_FOLD), (W, ZC + H - C), (W - C, ZC + H),
           (-W + C, ZC + H), (-W, ZC + H - C), (-W, CAB_FOLD), (-W, ZC - H + C)]
    # front cap split along the fold: build the cabin without its front cap, then add the two caps
    cab = tube_y("AS_Cabin", sec, lambda x, z: cabin_front_y(x, z), CAB_YB, [M["AscentPanel"], M["AscentDark"]],
                 face_mats=[1, 0, 0, 0, 0, 0, 0, 0, 0, 0], uv_scale=0.34, bevel=0.025)
    # replace the front cap (not planar) with two planar faces
    me = cab.data
    n = len(sec)
    front_cap = next(pl for pl in me.polygons if len(pl.vertices) == n and all(v < n for v in pl.vertices))
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    bm.faces.remove(bm.faces[front_cap.index])
    v = bm.verts
    lower = bm.faces.new([v[0], v[1], v[2], v[3], v[8], v[9]])
    upper = bm.faces.new([v[3], v[4], v[5], v[6], v[7], v[8]])
    lower.material_index = 0
    upper.material_index = 1
    for f in (lower, upper):
        f.smooth = False
    bm.to_mesh(me)
    bm.free()
    me.update()
    me.uv_layers.remove(me.uv_layers[0])
    box_uv(me, me.uv_layers.new(name="UVMap"), 0.5)
    parts.append(cab)

    # midsection behind the cabin, with the docking tunnel on top
    mid = [(-1.02, 3.38), (1.02, 3.38), (1.02, 4.95), (0.72, 5.25), (-0.72, 5.25), (-1.02, 4.95)]
    parts.append(tube_y("AS_Mid", mid, lambda x, z: CAB_YB, 0.82, [M["AscentPanel"]], uv_scale=0.34, bevel=0.02))
    parts.append(cylinder("AS_Tunnel", (0, -0.35, 5.15), (0, -0.35, 5.86), 0.42, M["BlackFoil"], segs=32, uv_scale=0.9))
    parts.append(revolve("AS_Drogue", [(0.36, 5.86), (0.47, 5.86), (0.47, 5.93), (0.36, 5.93), (0.36, 5.86)],
                         [M["AscentDark"]], segs=32, centre=(0, -0.35, 0), smooth=False))
    # side cheeks (propellant tank fairings)
    for s, nm in ((1, "Left"), (-1, "Right")):
        prof = [(1.0, 3.6), (1.52, 3.6), (1.8, 3.86), (1.8, 4.5), (1.52, 4.78), (1.0, 4.78)]
        if s < 0:
            prof = [(-x, z) for x, z in reversed(prof)]
        parts.append(tube_y("AS_Cheek_" + nm, prof, lambda x, z: -0.42, 0.78, [M["AscentPanel"], M["BlackFoil"]],
                            face_mats=[1 if (s > 0 and i == 0) or (s < 0 and i == 4) else 0 for i in range(6)],
                            uv_scale=0.34, bevel=0.03))
    # aft equipment bay
    aft = [(-1.0, 3.45), (1.0, 3.45), (1.0, 4.98), (-1.0, 4.98)]
    parts.append(tube_y("AS_AftBay", aft, lambda x, z: 0.82, 1.78, [M["AscentDark"]], uv_scale=0.34, bevel=0.02))
    for s in (1, -1):
        parts.append(cylinder("AS_AftTank_%d" % (s + 1), (0.55 * s, 1.85, 3.7), (0.55 * s, 1.85, 4.75), 0.2,
                              M["SilverMylar"], segs=20, uv_scale=0.9))

    # hatch
    yh = CAB_YF
    parts.append(box("AS_HatchFrame", (-0.46, yh - 0.02, 3.38), (0.46, yh + 0.01, 4.26), M["AscentDark"], bevel=0.008))
    parts.append(box("AS_Hatch", (-0.4, yh - 0.05, 3.43), (0.4, yh - 0.02, 4.22), M["AscentPanel"], uv_scale=0.34,
                     bevel=0.01))
    parts.append(cylinder("AS_HatchHandle", (0.25, yh - 0.05, 3.8), (0.25, yh - 0.11, 3.8), 0.025, M["BareMetal"], segs=8))

    # windows: triangles on the leaning upper front face
    top_z = ZC + H
    lean_n = Vector((0, -(top_z - CAB_FOLD), CAB_LEAN)).normalized()  # outward normal of the upper face
    for s, nm in ((1, "Left"), (-1, "Right")):
        tri = [(0.2 * s, 5.25), (0.98 * s, 5.25), (0.3 * s, 4.55)]
        if s < 0:
            tri = [tri[0], tri[2], tri[1]]
        pts = [Vector((x, cabin_front_y(x, z), z)) for x, z in tri]
        cen = (pts[0] + pts[1] + pts[2]) / 3
        frame = [cen + (q - cen) * 1.13 + lean_n * 0.012 for q in pts]
        glass = [cen + (q - cen) * 1.0 + lean_n * 0.02 for q in pts]
        parts.append(new_mesh("AS_WindowFrame_" + nm, frame, [(0, 1, 2) if s > 0 else (0, 1, 2)], [M["BareMetal"]]))
        parts.append(new_mesh("AS_Window_" + nm, glass, [(0, 1, 2)], [M["WindowGlass"]]))
    # check the windows face forward (normal -Y); fix winding if not
    for o in parts:
        if o.name.startswith("AS_Window"):
            nrm = o.data.polygons[0].normal
            if nrm.y > 0:
                o.data.flip_normals()
                o.data.update()

    # rendezvous radar on top front, S-band antenna on the right, VHF whips
    parts.append(cylinder("AS_RRMast", (-0.55, -0.85, 5.3), (-0.55, -1.0, 5.75), 0.05, M["BareMetal"], segs=10))
    rr_axis = Vector((0, -0.75, 0.66)).normalized()
    parts += dish("AS_RRDish", Vector((-0.55, -1.02, 5.78)), rr_axis, 0.3, M)
    parts.append(cylinder("AS_SBandBoom", (-0.9, 0.35, 4.98), (-1.5, 0.55, 5.72), 0.035, M["BareMetal"], segs=10))
    parts += dish("AS_SBandDish", Vector((-1.52, 0.56, 5.76)), Vector((-0.45, 0.15, 0.88)).normalized(), 0.33, M)
    parts.append(cylinder("AS_VHF_1", (0.75, 0.55, 5.2), (1.15, 0.85, 6.05), 0.012, M["BareMetal"], r2=0.006, segs=6))
    parts.append(cylinder("AS_VHF_2", (-0.7, 1.5, 4.98), (-1.05, 1.75, 5.75), 0.012, M["BareMetal"], r2=0.006, segs=6))
    parts.append(cylinder("AS_EVAAnt", (0.4, 0.5, 5.25), (0.4, 0.5, 5.65), 0.01, M["BareMetal"], segs=6))
    return parts


def dish(name, centre, axis, radius, M):
    """A small parabolic antenna dish facing along axis, closed so it renders single-sided."""
    depth = radius * 0.28
    prof = [(0.0, -0.025), (radius * 0.6, -0.025 + depth * 0.36), (radius, depth - 0.02), (radius, depth),
            (radius * 0.6, depth * 0.36), (0.0, 0.0)]
    back = revolve(name, prof, [M["BareMetal"], M["DishWhite"]], [0, 0, 0, 1, 1], segs=32, centre=centre, axis=axis,
                   uv_scale=2.0, sharp_rows=(2, 3))
    feed = cylinder(name + "_Feed", centre, centre + axis * (radius * 0.55), 0.02, M["BareMetal"], segs=8)
    return [back, feed]


def build_rcs_quad(index, pos, anchor, M):
    x, y, z = pos
    sx = 1 if x > 0 else -1
    sy = 1 if y > 0 else -1
    c = Vector(pos)
    parts = []
    parts.append(cylinder("RCS_%d_Strut" % index, anchor, (x - sx * 0.12, y, z - 0.05), 0.045,
                          M["BareMetal"], segs=10))
    parts.append(box("RCS_%d_Housing" % index, (x - 0.15, y - 0.15, z - 0.22), (x + 0.15, y + 0.15, z + 0.2),
                     M["AscentPanel"], uv_scale=0.34, bevel=0.03))
    jets = [Vector((0, 0, 1)), Vector((0, 0, -1)), Vector((sx, 0, 0)), Vector((0, sy, 0))]
    for k, dvec in enumerate(jets):
        base = c + dvec * (0.21 if dvec.z != 0 else 0.15)
        tip = base + dvec * 0.2
        parts.append(cylinder("RCS_%d_Jet_%d" % (index, k), base, tip, 0.032, M["EngineBell"], r2=0.075, segs=14,
                              caps=False))
        parts.append(cylinder("RCS_%d_JetIn_%d" % (index, k), base + dvec * 0.02, tip - dvec * 0.005, 0.028,
                              M["EngineInner"], r2=0.07, segs=14, caps=False, flip=True))
    return parts


def build_lander(M):
    lander = empty("Lander", (0, 0, 0))
    ds = empty("DescentStage", (0, 0, 0), lander)
    as_ = empty("AscentStage", (0, 0, 0), lander)
    eb = empty("EngineBell", (0, 0, 0), lander)

    parent_all(build_descent_stage(M), ds)
    parent_all(build_porch(M), lander)
    parent_all(build_engine_bell(M), eb)
    empty("NozzleExit", (0, 0, 1.05), eb)

    for name in ("Front", "Back", "Left", "Right"):
        g = empty("Leg_" + name, (0, 0, 0), lander)
        parts, centre, probe_tip = build_leg(name, M)
        parent_all(parts, g)
        empty("FootpadContact_" + name, (centre.x, centre.y, 0.0), g)
        if probe_tip is not None:
            empty("ProbeTip_" + name, tuple(probe_tip), g)

    parent_all(build_ascent_stage(M), as_)
    # (position, strut anchor on the structure): back pair on the midsection's back corners, front pair on the cabin
    quads = [((1.82, 1.25, 5.0), (0.95, 0.72, 4.95)), ((-1.82, 1.25, 5.0), (-0.95, 0.72, 4.95)),
             ((1.82, -1.05, 5.05), (1.05, -1.05, 5.0)), ((-1.82, -1.05, 5.05), (-1.05, -1.05, 5.0))]
    for i, (pos, anchor) in enumerate(quads):
        parent_all(build_rcs_quad(i + 1, pos, anchor, M), as_)
        empty("RCS_Quad_%d" % (i + 1), pos, as_)
    empty("CockpitEye", (0.55, -1.0, 4.95), as_)
    return lander


CONTRACT = ["Lander", "DescentStage", "AscentStage", "EngineBell", "Leg_Front", "Leg_Back", "Leg_Left", "Leg_Right",
            "FootpadContact_Front", "FootpadContact_Back", "FootpadContact_Left", "FootpadContact_Right",
            "ProbeTip_Back", "ProbeTip_Left", "ProbeTip_Right", "NozzleExit", "CockpitEye",
            "RCS_Quad_1", "RCS_Quad_2", "RCS_Quad_3", "RCS_Quad_4"]


def validate():
    missing = [n for n in CONTRACT if n not in bpy.data.objects]
    if missing:
        raise SystemExit("missing contract nodes: " + ", ".join(missing))
    # descent stage hull must stay above the engine exit, legs separate
    zs = []
    for o in bpy.data.objects["DescentStage"].children_recursive:
        if o.type == "MESH":
            zs += [(o.matrix_world @ v.co).z for v in o.data.vertices]
    print("  contract OK; descent stage hull from z %.2f to %.2f" % (min(zs), max(zs)))


def descendants(obj):
    return [obj] + list(obj.children_recursive)


def triangle_count(root):
    deps = bpy.context.evaluated_depsgraph_get()
    total = 0
    for o in descendants(root):
        if o.type == "MESH":
            ev = o.evaluated_get(deps)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            total += len(me.loop_triangles)
            ev.to_mesh_clear()
    return total


def export_glb(root, out_dir):
    import addon_utils
    try:
        addon_utils.enable("io_scene_gltf2", default_set=True)
    except Exception:
        pass
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in descendants(root):
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(out_dir, "lander.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True)
    return path


# ---------------------------------------------------------------------------------------------------------
# preview renders (Cycles): lunar lighting, black sky, low sun from behind the camera
# ---------------------------------------------------------------------------------------------------------
def setup_preview_scene(samples, res):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    try:
        sc.view_settings.view_transform = "AgX"
    except Exception:
        pass
    sc.view_settings.exposure = 0.0
    world = bpy.data.worlds.new("Space")
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bg.inputs["Strength"].default_value = 0.0
    # regolith ground with a little relief
    me = bpy.data.meshes.new("Ground")
    n, size = 120, 120.0
    xs = np.linspace(-size / 2, size / 2, n + 1)
    gx, gy = np.meshgrid(xs, xs)
    gz = 0.012 * np.sin(gx * 0.9) * np.cos(gy * 0.7) + 0.008 * np.sin(gx * 2.3 + gy * 1.7)
    gz -= 0.022  # keep it just below the footpads
    verts = np.stack([gx, gy, gz], -1).reshape(-1, 3)
    faces = [(j * (n + 1) + i, j * (n + 1) + i + 1, (j + 1) * (n + 1) + i + 1, (j + 1) * (n + 1) + i)
             for j in range(n) for i in range(n)]
    me.from_pydata(verts.tolist(), [], faces)
    me.update()
    ground = link(bpy.data.objects.new("Ground", me))
    gm = bpy.data.materials.new("Regolith")
    try:
        gm.use_nodes = True
    except Exception:
        pass
    nt = gm.node_tree
    b = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.13, 0.125, 0.115, 1)
    b.inputs["Roughness"].default_value = 0.95
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    me.materials.append(gm)
    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 6.0
    sun_data.angle = math.radians(0.53)
    sun = link(bpy.data.objects.new("Sun", sun_data))
    cam_data = bpy.data.cameras.new("Cam")
    cam = link(bpy.data.objects.new("Cam", cam_data))
    sc.camera = cam
    return sun, cam, ground


def aim(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_previews(out_dir, samples, res, lander):
    os.makedirs(out_dir, exist_ok=True)
    sun, cam, ground = setup_preview_scene(samples, res)
    views = [
        # name, camera position, target, lens, sun azimuth offset (deg, from the camera direction), sun elevation,
        # lander lift (m)
        ("front", (9.5, -13.0, 3.2), (0, 0, 2.9), 40, 60, 14, 0.0),
        ("back", (-11.5, 11.0, 4.0), (0, 0, 2.9), 40, -55, 18, 0.0),
        ("hover", (15.0, -13.0, 1.4), (0, 0, 6.8), 35, 70, 12, 6.0),
        ("close", (3.6, -6.2, 5.2), (0, -1.2, 4.6), 38, 50, 20, 0.0),
    ]
    paths = []
    for name, cpos, target, lens, sun_off, sun_el, lift in views:
        lander.location = (0, 0, lift)
        cam.location = cpos
        cam.data.lens = lens
        aim(cam, target)
        # sun behind the camera, offset sideways, low elevation
        d = Vector(target) - Vector(cpos)
        az = math.atan2(d.y, d.x) + math.radians(sun_off)
        el = math.radians(sun_el)
        light_dir = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), -math.sin(el)))
        sun.rotation_euler = light_dir.to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out_dir, "lander_%s.png" % name)
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
        print("  rendered", path)
    lander.location = (0, 0, 0)
    return paths


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    print("1/5 textures")
    tex = generate_textures(os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures"))
    print("2/5 materials")
    mats = create_materials(tex)
    print("3/5 model")
    lander = build_lander(mats)
    validate()
    print("  triangles: %d" % triangle_count(lander))
    print("4/5 export")
    path = export_glb(lander, args.out)
    print("  wrote %s (%.0f KB)" % (path, os.path.getsize(path) / 1024))
    blend = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lander.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    if args.no_render:
        print("5/5 previews skipped")
    else:
        print("5/5 previews")
        render_previews(args.previews, args.samples, tuple(args.res), lander)
    print("done")


if __name__ == "__main__":
    main()
