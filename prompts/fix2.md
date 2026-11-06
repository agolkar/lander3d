You are a senior three.js engineer maintaining a browser lunar landing game (three.js r187, ES modules through an import map, no build step).

# Problem

The game stops at startup with:

TypeError: Cannot read properties of undefined (reading 'color')
    at createSky (src/sky.js:28:13)
    at init (src/main.js:56:23)

A configuration block that sky.js reads is probably missing from config.js. Other modules may have the same problem. Below is the complete list of CONFIG references found in all modules of the game.

# What to change

1. Make config.js complete: every reference in the list must exist in CONFIG with a sensible value, consistent with how the modules use it (numbers, colours, objects). Keep every existing value.
2. Fix sky.js line 28 and any other place in sky.js or main.js where a missing value would break.
3. Change nothing else. Think briefly, then write the complete changed files once.

# CONFIG references used across all modules
```
   1 CONFIG.AUDIO
   1 CONFIG.EXPOSURE
   1 CONFIG.FUEL_START
   1 CONFIG.QUALITY
   2 CONFIG.SEED
```
