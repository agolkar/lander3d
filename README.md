# Lunar Lander 3D

A photorealistic lunar module landing game that runs in the browser.

**Play:** https://agolkar.github.io/lander3d/

Fly the lunar module down to the surface and touch down slowly and upright. Three views help: a chase camera, a landing camera standing on the ground near the touchdown point, and the commander's window.

## Controls

| Key or mouse | Action |
|---|---|
| Space | Start descent |
| Left button, or Up / Down | Throttle |
| X | Engine cut-off |
| W / S, A / D, Q / E | Pitch, roll, yaw |
| C | Next view: chase, landing camera, window |
| Wheel, pinch, - and = | Zoom |
| Right drag, or Option + drag | Look around |
| 0 | Reset view |
| P, R, Shift+R | Pause, restart, restart with new terrain |
| H | All controls |

## How it was built

The first version was written fully on-premise by DeepSeek V4.1 Flash, quantised to 2 bits and running on a Mac Studio M3 Ultra with 256 GB of memory through antirez's ds4 engine and llama-swap. It was built in stages: lander model, game core, then effects and audio. The prompts are in `prompts/`.

Claude Opus 5.5 by Anthropic then fixed the bugs the local model could not resolve, rebuilt the camera and mouse controls, and rebuilt the lunar module with a Blender Python script (`blender/make_lander.py`). Every change was tested with automated flights in headless Chrome.

The game uses three.js r187, loaded from jsDelivr, with no build step.

## Run locally

From the repository folder run `python3 -m http.server 8000`, then open http://localhost:8000/game/ in the browser. An internet connection is needed to load three.js.

## Credits and licences

- Code: see `LICENSE`.
- three.js: MIT licence.
- Rocks and regolith textures: Poly Haven, CC0.
- Earth (Blue Marble) and star map: NASA, public domain.
