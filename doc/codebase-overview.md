# Codebase Overview

<!-- NOTE: This file should be updated as we work on the project to reflect changes and new files -->

## Purpose
This document provides a high-level overview of what each file in the codebase does. This is not meant to document individual functions, but rather to give a general understanding of the structure and purpose of each file.

## Files

### src/gameLogic/state.js
Central state management for the golf game. Handles game state tracking (ready, backswing, downswing, etc.), shot types (full/chip/putt), club selection, swing mechanics and timing, environmental conditions (temperature, wind), direction/aiming, and animation frame tracking. Provides setters/getters and reset functions for all state variables.

### src/gameLogic/persistentGameState.js
Manages persistent game state for play-hole mode using localStorage. Stores ball position, lie (TEE, FAIRWAY, ROUGH, GREEN, BUNKER, WATER, OOB), stroke counts (per hole and total round), former position/lie (for OOB handling), current hole index, and hole layout data. Provides save/load/clear/update functions for the persistent state.

### src/gameLogic/actions.js
Contains game action functions including swing mechanics (backswing, downswing) and the unified reset system. The `resetSwing()` function handles all reset scenarios across all three game modes:
- **Range mode**: Always returns to tee
- **CTF mode**: Always returns to tee
- **Play Hole mode**: Returns to tee if holed out, otherwise stays at current position. Handles OOB (returns to former position with penalty) and hazards (TODO: drop option).

### src/modes/playHole.js
Play Hole mode implementation. Manages hole-specific state including ball position, lie, scores, and former position/lie for OOB. Provides functions to:
- Initialize/terminate mode
- Handle shot results and hole-outs
- Return to tee after holing out (`returnToTee()`)
- Move to former position for OOB handling (`moveToFormerPosition()`)
- Get current game state (ball position, lie, score, etc.)

### src/surfaces.js
Defines all surface types and their properties (bounce, rollout, friction, etc.). Surface keys are used internally for comparisons (e.g., `'OUT_OF_BOUNDS'`, `'GREEN'`, `'BUNKER'`), while `.name` properties are used for display (e.g., "Out of Bounds", "Green", "Bunker"). Provides:
- `SURFACES` object with all surface definitions
- `getSurfaceProperties(key)` - Get surface properties by key
- `getSurfaceDisplayName(key)` - Convert surface key to display name
- **Important**: Always use uppercase keys with underscores for comparisons (e.g., `lie === 'OUT_OF_BOUNDS'`), not display names.

### src/career/handicap.js
Pure WHS-lite handicap math (no storage/DOM): score differentials, net-double-bogey adjustment, course handicap, stroke allocation by hole length, 9-hole pairing, and the best-8-of-20 index table extended to issue a provisional index after one round. Unit-tested by `tests/unit-handicap.mjs`. Design rationale in `doc/CAREER_MODE_DESIGN.md`.

### src/career/courseRating.js
Heuristic course rating and slope derived from imported geometry (length, bunkers, water). Tunable stand-in for official ratings; feeds the handicap engine and (later) the course-ladder tiers.

### src/career/careerStore.js
Local-first career record in localStorage: completed course rounds with their immutably-stored differentials, and the derived handicap index. `playHole.js` posts rounds here from `endRound()`. Server sync for registered users layers on later.

### src/careerModal.js
Career overview modal opened from the main-menu Career card: handicap index with provisional tag and trend sparkline, scoring stats, per-course bests, and round history with expandable colored scorecards. Reads the local career record via `career/careerStore.js`; verified by `tests/browser-smoke-career.mjs`.

### src/career/greenCard.js
Green Card drill engine: the six-drill certification (driving, approach, chipping, bunker, lag putting, holing out) that doubles as the tutorial and career on-ramp. Pure attempt evaluation, randomized drill spot generation on the practice green, per-drill progress in localStorage, and the active-drill state that `playHole.handleShotResult` scores against. Unit-tested by `tests/unit-greencard.mjs`.

### src/career/drillHoles.js
Generated layouts for the full-swing drills: a wide, friendly par 4 (driving) and a short par 3 with a big green (approach), in the hole-maker export format.

### src/greenCardModal.js
Green Card modal from the main menu: drill checklist with progress bars, launches drills into play-hole practice mode (custom layout/placement, placement panel hidden). Verified by `tests/browser-smoke-greencard.mjs`.

### src/touchControls.js
Touch controls and the entire mobile HUD layout. Zones dispatch synthetic KeyboardEvents through the existing inputHandler paths, so timing windows and shot variety are identical to keyboard. The mobile screen has two phases: SETUP (compact top bar, condensed info text, club/shot/power/stance as a horizontal chip row, practice panel — no swing surfaces) and ADDRESS (thumb zones, aim/camera, distance/wind/lie, rhythm hint — everything else stripped), toggled by a context-aware bottom pill (ADDRESS BALL / NEXT). A shot's result auto-returns to setup. Full swing = hold SWING ('w') / release at top, then drum the beats on either zone — each tap fires the next event of the kinematic chain (hips 'j' → rotation 'a' → arms 'd' → wrists 'i'), so two zones replace five and timing stays the whole skill; rhythm putt/chip = TAP ('w') + STROKE ('i'). Hint wording adapts to input device (rhythmPuttHud.strikeName). Activated on touch-capable devices or ?touch=1. Verified by `tests/browser-smoke-touch.mjs`.


### src/aimAtPoint.js
Point-to-aim shared by touch double-tap and desktop double-click: raycasts the screen point onto the terrain (ray-march + bisection), sets the absolute target line (same math as the h key), confirms with a green ring. CRITICAL GOTCHA: `#golf-canvas` is DISPLAYED horizontally mirrored (`style.css` `transform: scaleX(-1) !important`), so screen-x from pointer events is the mirror of the render-space x that `Raycaster.setFromCamera` needs — every screen->world raycast must negate NDC x when the computed transform has a negative x scale (aimAtPoint reads it live; measurementView.js hardcodes the negation). Symptom if forgotten: taps right of the aim line set the aim equally left. Verified by `tests/browser-smoke-aim.mjs`, which projects the flag through the live camera, mirrors to the VISUAL position, taps there, and requires the h-key angle back — in both the static and fly-over cameras.

### src/ui/rhythmPuttHud.js
Bottom-center hint/readout pill: at-address instructions, live rhythm readout (beat dot, tempo, projected distance), post-shot swing/chip reports. Instruction hints are HIDDEN BY DEFAULT (localStorage gih-swing-hints-shown), toggled by the top-bar Hints button (💡 on touch, wired in ui.js); an active Green Card drill always shows them (drills are the tutorial). Live readouts, the swing report, and the pick-a-club prompt are never muted.

### src/holeLoader.js — auto green contour
processHoleLayout synthesizes a deterministic `greenContour` (gentle tilt 0.6–1.4% + 2–4 crowns/tiers/swales, mulberry32-seeded from the green polygon geometry) for any hole that does not author one. This matters because ball roll physics, the displaced green mesh, and the slope-arrow overlay (visuals/slopeOverlay.js, toggled with g / the ⛰ touch button) ALL read only the analytic contour field (greenContours.js) — without a contour, putts roll dead straight and the slope button shows nothing. Practice green keeps its hand-authored contour.
