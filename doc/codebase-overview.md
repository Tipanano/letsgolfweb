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
