You are an expert technical artist and Blender Python (bpy) developer. Improve the attached Blender 5.2 script `blender/make_assets.py`, which builds an Apollo-style lunar module and exports `lander.glb`. Keep every contract node name, the material names, the coordinate frame (Z up, front facing -Y, footpad bottoms at z = 0), the allowed operators and the five exporter arguments unchanged. Only this file changes.

# Problems found in the first run

Technical
1. Cycles could not load the textures: "Image file /game/assets/models/crinkle_normal.png does not exist". Build every image path with os.path.abspath(out_dir) before setting filepath_raw and saving, so the render and the exporter both find them.
2. The three texture PNGs are only 20 KB each, so they are nearly uniform. Fix the generation: normalise each height field to the range -1..1 before taking gradients, choose the normal strength so normals tilt up to about 30 degrees, set the pixels before saving, and print min, max and standard deviation of each map. A correct 1024 x 1024 crinkle normal map is about 2 MB as PNG.
3. The model has only 8,708 triangles, the descent stage 428: bevels and the foil displacement were not effectively applied. Target 60,000 to 120,000 triangles in total.

Shape (compared with the real Apollo LM)
4. Ascent stage: rebuild it. It must be squat and angular, never rounded: overall envelope about 4.3 m wide (X), 4.0 m deep (Y) and 2.8 m tall (z = 3.1 to 5.9 m). Build it from flat faceted panels: a flat front face slanting back about 10 degrees, with the two triangular windows (about 0.7 m per side, tilted down and outward, in recessed frames) at its upper corners and the square forward hatch (0.8 m) centred below them; two large faceted side bulges (cheeks) at mid height on the left and right, each extending about 0.6 m beyond the cabin, housing the propellant tanks; a boxy aft equipment bay behind the cabin, about 1.2 m deep and 1.5 m tall, set slightly higher. Docking tunnel on top from z = 5.9 to 6.6 m with the drogue ring, overhead docking window on the cabin roof in front of it. Keep antennas and RCS quads attached to the new shape.
5. RCS quads: make them prominent, on short outriggers at the four upper corners: a housing about 0.35 m wide with four bell nozzles (0.25 m long) pointing up, down, left and right, plus the plume deflector plates.
6. Descent stage: a cut-corner octagon, 4.2 m across the flats, z = 1.4 to 3.1 m. The four main faces (front, back, left, right) in GoldKapton, the four cut-corner bays in BlackFoil or SilverMylar alternately, the lower 0.35 m skirt and the underside in BlackFoil. Subdivide each panel (subdivision level 3) and add the Clouds Displace modifier at 0.015 m so the crinkles show in the silhouette and highlights; add visible panel seams.
7. Footpads: replace the cylinders with shallow dishes, 0.94 m rim diameter, 0.3 m tall, built by revolving a profile: a rounded bottom about 0.5 m across curving up to the rim, an open top with a cross brace and a ball-joint fitting where the strut meets it. Print the horizontal radius of each footpad centre and keep it at 4.5 m.
8. Colours: GoldKapton should read as warm amber gold in sunlight; keep metallic 1.0 and base colour (0.83, 0.58, 0.22) and rely on the environment (point 9) for the reflections. Ascent panels: mostly AscentPanel grey, AscentDark around the windows and on the lower front, SilverMylar on the aft bay and the top of the cabin.

Previews
9. World: a horizon gradient instead of black, matching the game: black above the horizon, regolith grey 0.10 below it, strength 1.0. The metals then reflect the ground as they will in the game.
10. Put the sun behind and to the left of each preview camera, so every preview shows a lit side: move the sun lamp before each render.
11. Add a third preview, `lander_preview_hover.png`: the lander lifted 2.5 m above the ground plane (parent offset only for the render, after the export), camera low at the front left, so the contact probes, footpads and engine bell are visible.

# Working method
Do not estimate triangle counts in your reasoning: the script prints the evaluated count at the end, and we will adjust from that number. The triangle range in point 3 is a soft guide. Spend your reasoning on the ascent stage shape (point 4) and the texture fix (point 2), then write the complete file once.
