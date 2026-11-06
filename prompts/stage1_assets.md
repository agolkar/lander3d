You are an expert technical artist and Blender Python (bpy) developer. You build production-quality hard-surface models entirely in code.

# Task

Write one Blender Python script, `blender/make_assets.py`, that builds a photorealistic lunar module (LM) in the style of the Apollo LM from scratch, with no external files, and exports it as a binary glTF file (GLB) for a three.js game. The script also renders two preview images so the model can be approved before the game is built.

The script runs headless, from the project root:

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/make_assets.py -- --out game/assets/models
```

Optional arguments after `--`: `--out DIR` (default `game/assets/models`), `--no-render` (skip the previews), `--samples N` (preview samples, default 96).

## Output format

Return the file in exactly this format, with nothing after it:

### FILE: blender/make_assets.py
```python
(complete file)
```

Write the complete file. Never abbreviate with placeholders such as "rest unchanged" or "...". Keep your reasoning short: plan in a few lines, then write the code once, directly in the answer.

## Environment and robustness rules

- Blender 5.2 on Apple Silicon, run in background mode. numpy is bundled with Blender; use no other third-party package.
- Start from an empty scene: `bpy.ops.wm.read_factory_settings(use_empty=True)`.
- Build meshes with `bmesh` (`bmesh.ops.create_cube`, `create_cone` with `radius1`/`radius2`/`depth`, `create_circle`, `create_uvsphere`, extrude, inset) or with `bpy.data.meshes.new` plus `from_pydata`. Avoid operators that need a user interface context. The only operators allowed are `bpy.ops.wm.read_factory_settings`, `bpy.ops.export_scene.gltf`, `bpy.ops.wm.save_as_mainfile` and `bpy.ops.render.render`.
- Write version-tolerant code for APIs that changed across Blender 4.x and 5.x:
  - Materials: `mat = bpy.data.materials.new(name)`, then `if hasattr(mat, "use_nodes"): mat.use_nodes = True`. Find the Principled BSDF node by `node.type == "BSDF_PRINCIPLED"` and create one if missing.
  - Set Principled inputs through a helper that tries several names and skips missing ones, for example `set_input(bsdf, ("Base Color",), value)`, `("Specular IOR Level", "Specular")`, `("Coat Weight", "Clearcoat")`, `("Emission Color", "Emission")`.
  - Smooth shading: set `polygon.use_smooth` on the mesh polygons (`foreach_set`). Never use `mesh.use_auto_smooth` (removed in 4.1).
  - Wrap optional features (denoising, AgX view transform, weighted-normal modifier) in try/except so a missing option never stops the script.
- Call the glTF exporter with only these keyword arguments, since other option names vary between versions: `filepath`, `export_format="GLB"`, `use_selection=True`, `export_apply=True`, `export_yup=True`.
- Total budget: under 150,000 triangles. Use Bevel modifiers (small widths, 2 segments, angle limit) on hard edges for realistic highlights; they are applied at export.
- Print a short progress line per step, and exit with a non-zero code (`sys.exit(1)`) and a clear message if a required node is missing before export.

## Coordinate frame and scale

- Units are metres. Model in Blender coordinates: Z up, the front of the vehicle (ladder, hatch, windows) facing -Y. Left is +X, right is -X. The exporter converts this to glTF Y up with the front facing +Z.
- Origin: on the vertical axis of the vehicle, at the height of the footpad bottoms (footpad bottoms touch z = 0).

## Reference geometry (approximate Apollo LM, landing configuration)

Descent stage
- Octagonal body (a square with cut corners), 4.2 m across the flats, spanning z = 1.4 m to 3.1 m. Panels wrapped in crinkled gold Kapton foil, with black foil on the lower skirt and underside.
- Descent engine bell: throat inside the body, exit plane at z = 1.05 m, exit diameter 1.5 m, smooth bell profile (revolve a curve), outer surface dark niobium grey, inner surface near-black.
- Four landing legs on the four sides: Front (-Y), Back (+Y), Left (+X), Right (-X). Footpad centres at a horizontal radius of 4.5 m. Each leg: a primary strut from the body (attached near z = 2.9 m at radius 2.1 m) down to the footpad, two secondary struts from the lower body corners to the lower part of the primary strut, and a deployment truss. Aluminium struts with gold foil wrapping on the upper half of the primary struts.
- Footpads: shallow dish, 0.94 m diameter, 0.3 m tall, silver foil, bottom at z = 0.
- Contact probes: thin rods, 1.5 m long, hanging below the Back, Left and Right footpads, slightly angled outward. No probe on the Front leg.
- A ladder on the Front primary strut, and a small porch platform in front of the forward hatch at z = 3.1 m.

Ascent stage (z = 3.1 m to about 6.6 m)
- Faceted, angular cabin shape (flat panels, never a plain cylinder). Front face with two inward-tilted triangular windows and a square forward hatch below them. Aft equipment bay as a box behind the cabin.
- Docking tunnel on top: cylinder 0.85 m diameter up to z = 7.0 m, with a small overhead docking window on the cabin roof.
- Rendezvous radar dish (0.6 m) on a short mast at the top front right; steerable S-band dish (0.66 m) on a boom at the right; two small VHF antennas.
- Four reaction control system (RCS) thruster quads at the four upper corners of the ascent stage, each a small housing with four nozzles pointing up, down, left and right, with a plume deflector plate under each lower nozzle.
- Panels mostly grey and charcoal anodised aluminium, with some black panels and silver foil areas at the aft bay.

## Materials (names are part of the contract; keep them exactly)

| Name | Base colour (linear) | Metallic | Roughness | Normal detail |
|---|---|---|---|---|
| GoldKapton | (0.83, 0.58, 0.22) | 1.0 | 0.28 | crinkle map, strong |
| SilverMylar | (0.93, 0.93, 0.94) | 1.0 | 0.18 | crinkle map, strong |
| BlackFoil | (0.03, 0.03, 0.035) | 0.3 | 0.35 | crinkle map, medium |
| AscentPanel | (0.35, 0.36, 0.37) | 0.0 | 0.55 | panel map, subtle |
| AscentDark | (0.06, 0.06, 0.07) | 0.0 | 0.50 | panel map, subtle |
| EngineNiobium | (0.25, 0.24, 0.23) | 0.9 | 0.45 | none |
| EngineInterior | (0.02, 0.02, 0.02) | 0.0 | 0.80 | none |
| WindowGlass | (0.02, 0.02, 0.025) | 0.0 | 0.05 | none |
| StrutAluminum | (0.75, 0.76, 0.78) | 1.0 | 0.35 | none |

Procedural textures, generated with numpy and saved as PNG next to the GLB (the exporter embeds them):
- `crinkle_normal.png` (1024 x 1024, tileable): height field = 0.6 x large bulges (white noise filtered in the frequency domain with a 1/f^1.6 spectrum, which makes it tile seamlessly) + 0.4 x creases (1 - |band-pass noise|, sharpened). Convert to a tangent-space normal map in the OpenGL convention (green = +Y) using periodic finite differences (`np.roll`). Colour space Non-Color.
- `panel_normal.png` (1024 x 1024): faint panel seams on a 0.5 m grid plus very low noise, OpenGL convention, Non-Color.
- `foil_roughness.png` (1024 x 1024): roughness variation around the material value, plus or minus 0.08, Non-Color.
- Image from numpy: `bpy.data.images.new(name, width, height, alpha=True, float_buffer=False)`, `img.pixels.foreach_set(rgba.astype(np.float32).ravel())`, set the colour space in try/except, then `filepath_raw`, `file_format = "PNG"`, `save()`.
- Material wiring: Image Texture (Non-Color) into a Normal Map node into the BSDF Normal input; roughness image into Roughness. Foil normal strength 1.0, panel 0.4.

UV mapping: write UVs yourself with a box projection, which needs no operator context. For each face, pick the axis with the largest absolute normal component, take the other two object-space coordinates and divide by the tile size (1.0 m for foil, 2.0 m for panels).

## Node naming contract (the game reads these names; keep them exactly)

All parts are parented, directly or through groups, to one Empty named `Lander` at the origin.

- Meshes or groups: `DescentStage`, `AscentStage`, `EngineBell`, `Leg_Front`, `Leg_Back`, `Leg_Left`, `Leg_Right`.
- Empties (exported as glTF nodes):
  - `FootpadContact_Front`, `FootpadContact_Back`, `FootpadContact_Left`, `FootpadContact_Right`: bottom centre of each footpad (z = 0).
  - `ProbeTip_Back`, `ProbeTip_Left`, `ProbeTip_Right`: lower tip of each contact probe.
  - `NozzleExit`: centre of the engine exit plane.
  - `CockpitEye`: the commander's eye point, behind the left window, about 0.9 m behind the front face, at z = 4.9 m.
  - `RCS_Quad_1` to `RCS_Quad_4`: centre of each RCS quad housing.

## Steps the script performs

1. Parse arguments, create the output folder.
2. Generate the three textures, create the materials.
3. Build descent stage, engine bell, legs, footpads, probes, ladder, porch, ascent stage, antennas, RCS quads, with bevels and smooth shading where surfaces are curved. Add a subtle Displace modifier (procedural Clouds texture, strength 0.008 m, after a light subdivision) to the foil-wrapped descent panels so their silhouette shows the crinkles.
4. Create the empties, parent everything under `Lander`, validate that every contract name exists.
5. Select `Lander` and all its descendants, export `lander.glb`, and save `lander.blend` in the output folder for manual editing.
6. Unless `--no-render`: add a 60 x 60 m ground plane (grey regolith, base colour 0.12, roughness 1.0, a fine noise bump), a Sun lamp (strength 5, angle 0.0093 rad, elevation 15 degrees, from behind and left of the camera), a black world with strength 0.02 for faint fill, Cycles on the CPU with denoising, view transform AgX, 1600 x 1000 pixels. Render `lander_preview_front.png` (camera 35 mm lens at about (-11, -13, 2.2), aimed at (0, 0, 2.6)) and `lander_preview_back.png` (camera at about (12, 11, 3.0)). These helpers are created after the export, so they never end up in the GLB.
7. Print a summary: triangles per top-level part, total triangles, file sizes, and the list of contract names found.

## Self-check before you answer

- Every name in the contract is created and parented under `Lander`.
- No operator other than the four allowed ones is called; no `use_auto_smooth`.
- The exporter call uses only the five allowed keyword arguments.
- The script runs top to bottom with no user interface, and every optional feature is guarded.
