You are an expert technical artist and Blender Python (bpy) developer. Improve the attached Blender 5.2 script `blender/make_assets.py`, which builds an Apollo-style lunar module and exports `lander.glb`. Keep every contract node name, the material names, the coordinate frame (Z up, front facing -Y, footpad bottoms at z = 0), the allowed operators and the five exporter arguments unchanged. Only this file changes.

# Problems to fix in this round
1. Cycles could not load the textures: "Image file /game/assets/models/crinkle_normal.png does not exist". Build every image path with os.path.abspath(out_dir) before setting filepath_raw and saving.
2. The three texture PNGs are only 20 KB each, so they are nearly uniform. Normalise each height field to -1..1 before taking gradients, choose the normal strength so normals tilt up to about 30 degrees, set the pixels before saving, and print min, max and standard deviation of each map.
3. World for the previews: a horizon gradient, black above the horizon, regolith grey 0.10 below, strength 1.0.
4. Move the sun lamp before each render so it sits behind and to the left of that preview's camera.
5. Add a third preview, lander_preview_hover.png: the lander lifted 2.5 m (only for the render, after the export), camera low at the front left.

Change nothing else in the model. Think briefly, then write the complete file once.
