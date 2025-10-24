# Codebase Overview

<!-- NOTE: This file should be updated as we work on the project to reflect changes and new files -->

## Purpose
This document provides a high-level overview of what each file in the codebase does. This is not meant to document individual functions, but rather to give a general understanding of the structure and purpose of each file.

## Files

### src/gameLogic/state.js
Central state management for the golf game. Handles game state tracking (ready, backswing, downswing, etc.), shot types (full/chip/putt), club selection, swing mechanics and timing, environmental conditions (temperature, wind), direction/aiming, and animation frame tracking. Provides setters/getters and reset functions for all state variables.

### src/gameLogic/persistentGameState.js
Manages persistent game state for play-hole mode using localStorage. Stores ball position, lie (TEE, FAIRWAY, ROUGH, GREEN, BUNKER, WATER), stroke counts (per hole and total round), current hole index, and hole layout data. Provides save/load/clear/update functions for the persistent state.
