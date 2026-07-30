# Graphics & Assets Review

<!-- Review of the render stack: what to improve visually without costing frame time. -->

Scope: everything under `src/visuals/`, `src/surfaces.js`, `src/obstacleConfig.js`,
`assets/textures/`, and the course JSON as it feeds the renderer.

The guiding constraint throughout: **no change may cost meaningful frame time.**
Most of what follows is either free or a net performance *win* — the scene is
currently spending its budget in the wrong places, and reclaiming that budget is
what pays for the things that actually look better.

---

## 1. Current state, measured

### Draw calls (Augusta hole 1, a representative worst case)

| Source | Count |
| --- | --- |
| Surface polygons (fairway, 3 greens, 4 bunkers, 2 rough, tee, background) | ~12 |
| Trees & bushes (`137` obstacles × 2 meshes each, one `Group` per obstacle) | **~274** |
| Instanced grass | 1–4 |
| OOB stakes | 1 |
| Sky, treeline, earth plane, ball, flag pole, flag cloth, cup | 7 |
| **Total** | **~300** |

**~90% of the draw calls in the scene are trees.** Each tree also allocates two
fresh `BufferGeometry` objects and two fresh `MeshLambertMaterial` objects
(`src/visuals/obstacles.js:6-43`). Valderrama and Winged Foot carry 1680 and
1113 obstacles across their 18 holes respectively; Augusta peaks at 140 on a
single hole.

### Texture payload

| File | Dimensions | Size |
| --- | --- | --- |
| `bunker.png` | 1024² | **2.58 MB** |
| `rough23.png` | 1024² | 0.94 MB (unreferenced — no code loads it) |
| `green.png` | 512² | 0.80 MB |
| `rough.png` | 512² | 0.77 MB |
| `fairway.png` | 512² | 0.72 MB |
| `golf_ball.jpg` | 1024² | 0.15 MB |
| **Total** | | **~5.9 MB** |

Five PNGs carrying photographic grass/sand detail. As JPEG q82 or WebP these are
roughly 120–250 KB each — a **~90% download reduction** with no visible
difference on a tiling ground texture.

### VRAM

`renderPolygonWithHeights` calls `textureLoader.load(...)` **once per polygon**
(`src/visuals/holeRenderer.js:276`). `THREE.Cache` is never enabled and there is
no texture registry, so four bunkers on one hole produce four independent
`THREE.Texture` objects wrapping four independent `Source` objects — four
separate GPU uploads of the same 1024² image (≈5.3 MB each with mipmaps, ~21 MB
for the bunkers alone on that hole).

Worse: `clearHoleLayout()` disposes geometry and material but **never disposes
`material.map`** (`src/visuals/holeView.js:33-37`). `removeRangeVisuals()` in
`src/visuals/range.js:145-160` does it correctly — the hole path doesn't. Playing
18 holes leaks the full texture set 18 times over.

---

## 2. Tier 1 — free wins (zero or negative frame cost)

These are the highest value-per-risk items. Several are net performance gains.

### 2.1 Textures are being decoded in the wrong color space ⚠️

Nothing anywhere in `src/` sets `texture.colorSpace`. In three r163 a
`TextureLoader` texture defaults to `NoColorSpace`, meaning three does **not**
apply the sRGB→linear decode. Combined with `outputColorSpace` defaulting to
sRGB and `ACESFilmicToneMapping` at exposure 1.15 (`src/visuals/core.js:284-285`),
every ground texture is being lit as though its sRGB bytes were linear values.
The result is the washed-out, milky, low-saturation grass the scene currently has.

```js
texture.colorSpace = THREE.SRGBColorSpace;
```

One line, applied where textures are created. This is the single biggest
look-quality change available and it costs nothing.

Caveat worth planning for: the fix makes everything **darker and more
saturated**, so the lighting rig needs a re-tune afterwards — likely
`toneMappingExposure` back toward ~1.0 and ambient down from 0.28. Budget an hour
of eyeballing, not five minutes.

It's also plausible this is *why* the hillshade is baked into vertex colors at
5× exaggeration (`src/visuals/holeRenderer.js:17`, "the scene's high ambient
light washes out real shading"). With correct color space and a re-tuned rig,
that exaggeration can probably come down, which will make contours read more
naturally.

### 2.2 No anisotropic filtering

Ground textures are viewed almost entirely at grazing angles — the worst case for
trilinear filtering. Everything past ~20 m in front of the ball is a smeared mush.

```js
texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
```

Anisotropic filtering is a fixed-function sampler feature. On any GPU from the
last decade the cost is unmeasurable, and the improvement to fairway/green
legibility at distance is dramatic. Pair with `texture.generateMipmaps = true`
(the default) and confirm mipmaps are actually being built.

### 2.3 Texture tiling scale is inconsistent between polygons

`createGeometryFromTriangulation` (`src/visuals/holeRenderer.js:160-174`)
normalizes UVs across each polygon's **bounding box**, then `texture.repeat` is
set to a fixed count per surface type. So a 300 m rough polygon at 10 repeats
gets 30 m per grass tile; a 15 m bunker at 8 repeats gets ~2 m per sand tile.
The same surface type visibly changes scale between polygons, and large polygons
show obvious stretching.

Fix: world-space UVs.

```js
// Instead of bbox-normalized UVs + repeat
const TILE_METERS = { GREEN: 4, FAIRWAY: 6, ROUGH: 5, BUNKER: 3 };
uvs[i * 2]     = x / tileMeters;
uvs[i * 2 + 1] = z / tileMeters;
// texture.repeat stays (1, 1); wrapS/wrapT already RepeatWrapping
```

Identical cost, consistent real-world grass scale everywhere, and it makes
distance perception across the hole much more reliable.

### 2.4 Mowing stripes on greens and fairways — the biggest "looks like golf" win

Real golf reads as golf largely because of mow patterns. The vertex-color
attribute already exists on these meshes and is already being written per-vertex
in the same loop (`src/visuals/holeRenderer.js:230-248`). Adding a stripe term is
**literally free** — no new attribute, no new draw call, no shader change:

```js
// Alternating mow bands, direction per surface (greens often cross-cut)
const STRIPE_M = 5.0;
const band = Math.floor((x * cosA + z * sinA) / STRIPE_M);
factor *= (band & 1) ? 1.06 : 0.94;
```

Do it for `Green` and `Fairway` only. Vary the angle per hole (seed off the hole
number) so all 18 don't look identical. This costs nothing and will change the
perceived production value of the game more than any other single item on this
list.

### 2.5 Unclamped device pixel ratio

`src/visuals/core.js:281` and `:367`:

```js
renderer.setPixelRatio(window.devicePixelRatio);
```

On a 3× DPR phone that's **9× the fragment work**. Clamp it:

```js
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

On mobile, 1.5 is defensible and nearly indistinguishable. Given the touch
controls work that just landed, this is probably the largest mobile frame-rate
win available, and it's one line in two places. `antialias: true` is already on,
so edge quality doesn't depend on the extra density.

### 2.6 Shadows re-render every frame for a static scene

`renderer.shadowMap.enabled = true` with no `autoUpdate` control. The scene is
static except for the ball. With ~280 tree meshes the shadow pass is effectively a
second full scene traversal, every frame, producing an identical result.

```js
renderer.shadowMap.autoUpdate = false;
// after drawHoleLayout(), and whenever anything casting a shadow moves:
renderer.shadowMap.needsUpdate = true;
```

The ball is the only moving caster; refresh on ball-position change during flight
(or just accept a static shadow map and give the ball a cheap blob shadow —
see 3.4). This roughly **halves** the per-frame cost of a tree-heavy hole.

### 2.7 Shadow map resolution is being wasted

`src/visuals/core.js:300-307`: a 1024² map spread over a 200 m × 200 m ortho
frustum = **19.5 cm per texel**. Every shadow in the game is a blurry blob.

Tighten the frustum to the play area instead of raising resolution — fit it to
~±60 m around the ball and update on ball rest:

```js
directionalLight.shadow.camera.left = -60;  // etc.
```

Same 1024² map, **6 cm per texel** — a 3× sharpness gain for free. If you want
more, 2048² on desktop only (`renderer.capabilities` / a quality setting) gets
you to 3 cm.

### 2.8 The trajectory line's `linewidth` does nothing

`src/visuals/core.js:939` sets `linewidth: 3` on a `LineBasicMaterial`. The WebGL
renderer ignores `linewidth` on every platform — the ball flight path is drawn as
a 1-pixel hairline, which is why it reads as thin and hard to follow, especially
on mobile. (`src/visuals/measurementView.js:225` already has a comment
acknowledging this.)

Fix with `Line2`/`LineMaterial` from three's examples (screen-space-width lines,
one draw call, negligible cost), or build a thin `TubeGeometry` along the
trajectory. Either gives a proper 3–4 px arc with an outline. Small change, very
visible.

### 2.9 Shared textures and materials

Introduce a module-level registry keyed by URL:

```js
const textureCache = new Map();
function getSurfaceTexture(url, tileMeters) { /* load once, reuse */ }
```

and share materials per surface type rather than allocating one per polygon
(`src/visuals/holeRenderer.js:283-303`). Benefits: one GPU upload per texture
instead of N, fewer shader program permutations, fewer state changes, and it
makes the disposal story tractable.

### 2.10 Fix the texture leak in `clearHoleLayout`

`src/visuals/holeView.js:33-37` should dispose maps the way
`src/visuals/range.js:145-160` already does — or, once 2.9 lands, deliberately
*not* dispose the shared cache and dispose only the per-hole geometry. Either is
fine; the current state (leak everything, every hole) is not.

### 2.11 Backface culling on ground

Every surface uses `side: THREE.DoubleSide`. Ground is only ever seen from above.
Switching to `FrontSide` removes half the rasterization work and, more
importantly, makes the shadow pass correct.

**Caution:** earcut preserves input winding, so some course polygons are likely
wound clockwise and would vanish (and are probably lit from below today, with
`DoubleSide` masking it via three's backface normal flip). Normalize winding at
triangulation time first — compute the signed area, reverse the ring if negative —
*then* switch to `FrontSide`. Worth doing: it may also explain some of the flat
terrain lighting that the 5× hillshade exaggeration is compensating for.

### 2.12 Small cleanups

- `src/visuals/core.js:481-483` — an empty `if (Math.random() < 0.001) {}` block
  in the per-frame render loop. Dead code; delete.
- `renderPolygonWithHeights` creates `new THREE.Mesh(geometry)` with no material
  (`:255`), so three assigns a default white `MeshBasicMaterial` until the async
  texture resolves — a visible white flash on every hole load. Assign the
  color-only fallback material immediately and swap in the texture on load.
- `assets/textures/rough23.png` (0.94 MB) is referenced by nothing. Delete it.

---

## 3. Tier 2 — cheap wins (small, bounded cost; large visual return)

### 3.1 Instance the trees — the single biggest structural change

Currently: 137 obstacles → 274 meshes, 274 geometries, 274 materials, 274 draw
calls, per hole. There are exactly **6 distinct obstacle variants** (tree/bush ×
small/medium/large, `src/obstacleConfig.js:14-76`).

Rebuild `src/visuals/obstacles.js` around `InstancedMesh`, one per variant part:

```
6 variants × (trunk + foliage) = 12 InstancedMesh → 12 draw calls
```

**274 → 12 draw calls.** That is a ~95% reduction in the dominant cost of the
scene, and it's the budget that pays for everything in this section.

With that headroom, the trees themselves can get much better at no net cost:

- **3 stacked, slightly offset cones** instead of one — reads as a conifer
  silhouette rather than a traffic cone. 3× the triangles on a shape that's
  currently ~48 tris; irrelevant next to the draw-call saving.
- **Per-instance color variation** via `setColorAt()` — free, and it removes the
  "clone army" flatness of 140 identical `0x2d5016` cones.
- **Per-instance random Y rotation and ±15% non-uniform scale** — free, breaks up
  repetition.
- **`castShadow = true`** — trees currently cast no shadow at all
  (`src/visuals/obstacles.js` never sets it), which is why they look pasted onto
  the ground rather than standing in it. With 2.6 (static shadow map) and 2.7
  (tight frustum), this is affordable.

Trunk geometry can drop from 8 to 6 radial segments; nobody will see it.

### 3.2 Grass wind

`src/visuals/grass.js` builds up to 14 000 tufts per surface type in one
`InstancedMesh` — good architecture already. It's completely static, which is the
main thing that makes it read as scenery rather than grass.

Add wind in the vertex shader via `material.onBeforeCompile`, displacing by the
vertex's local Y (so roots stay planted and tips sway):

```js
mat.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = timeUniform;
  // offset transformed.xz by sin(time + worldX*k) * position.y * amp
};
```

One shared uniform updated once per frame. GPU cost is a couple of ALU ops per
vertex on geometry that's already being transformed. Effectively free, and it is
a large perceptual change.

While in there: add a distance fade (scale instances to zero past ~80 m in the
same vertex shader). Still one draw call, fewer covered pixels, and it removes
the hard "carpet edge" where the tuft field stops.

Also `mesh.receiveShadow = true` on the grass (`:145`) costs a shadow-map sample
per fragment across thousands of tiny triangles for almost no visible return on
0.1–0.4 m blades. Consider turning it off.

### 3.3 The flagstick is the weakest model in the game

`src/visuals/holeView.js:102-135`:

- The cloth is a **static `PlaneGeometry` offset only in +X**. From roughly half
  the compass it is viewed edge-on and disappears entirely.
- It uses `MeshBasicMaterial` — unlit, so it never responds to the sun and reads
  as a flat red rectangle stuck in the air.
- It does not connect to the pole (0.25 m offset with a gap).
- The pole is a plain white cylinder — real flagsticks have banded stripes, which
  is a genuine distance-perception cue for the player, not just decoration.

All of this is a handful of triangles. Proposed:

- Billboard the cloth around the pole's Y axis (or better, a 4-segment plane with
  the same wind uniform from 3.2 — a waving flag at ~24 triangles).
- `MeshLambertMaterial`, `DoubleSide`, attached flush to the pole.
- Stripe the pole via 3–4 alternating cylinder segments, or a 4-pixel-tall
  repeating texture.
- Add a small ferrule/finial at the top.

Cost: under 100 triangles and one extra draw call. This is the object the player
stares at on every single shot.

### 3.4 The hole cup

`src/visuals/holeView.js:138-158` is a black `MeshBasicMaterial` cylinder with
`renderOrder = 1`. It reads as a black sticker on the green, not a hole.

- Add a white cup liner ring at the rim (a thin `RingGeometry` or a slightly
  wider white cylinder just under the lip).
- Make the interior a dark `MeshLambertMaterial` with a very dark floor disc so
  there's an actual sense of depth.
- The `renderOrder` hack is fragile against the layer-height scheme; a proper
  rim ring at green layer height + 1 mm removes the need for it.

~40 triangles.

### 3.5 A contact shadow for the ball

At 19.5 cm per shadow texel (or 6 cm after 2.7) the ball's real shadow is smaller
than a texel. The existing halo ring (`src/visuals/core.js:724-763`) does the
locating job but reads as UI, not lighting.

Add a soft dark radial-gradient blob under the ball — one small textured quad,
one draw call, tinted by surface. It grounds the ball far better than the shadow
map ever will at these resolutions, and it works identically on mobile.

The same trick applied at tree bases (baked into the ground vertex colors at
build time, since tree positions are known when the hole loads) gives cheap
ambient occlusion contact for free.

### 3.6 Water

`src/visuals/holeRenderer.js:419-433` uses a `MeshPhongMaterial` with a specular
glint — reasonable, but completely static. Two cheap upgrades:

- A scrolling normal map (one small tiling texture, two UV offsets moving at
  different speeds) — this is the standard cheap-water trick and costs one extra
  texture fetch per water fragment. Water covers a small fraction of screen area.
- Or a vertex-shader ripple via `onBeforeCompile`, essentially free.

Either makes water read as water instead of a blue sheet. Real reflections
(`CubeCamera`, planar reflection) are **not** worth it — that's a second scene
render per frame and directly violates the perf constraint.

### 3.7 Bunker definition

Bunkers currently have no lip. Real bunkers read from distance almost entirely
via the darker grass rim and the shadowed lip. Since bunker bowls are already
carved analytically in `src/greenContours.js`, the rim position is known — darken
a 0.5 m band of the surrounding grass in vertex color at build time. Free, and it
makes bunkers pop from the tee.

Note the existing deliberate exclusion of `Bunker` from hillshade
(`src/visuals/holeRenderer.js:240`) — a grass-side rim band is the right way to
get the definition back without turning the sand into a pit.

---

## 4. Tier 3 — larger investments (worth scoping, not urgent)

- **Ball dimples.** A procedurally generated normal map (256², built once in a
  canvas) would replace the 1024² `golf_ball.jpg` photo and give real dimple
  shading in close-up putt views. Also drops 150 KB. The current 32×32-segment
  sphere (2048 tris) can drop to 24×16 with a normal map doing the work.
- **Render-on-demand.** `animate()` (`src/visuals/core.js:378`) renders
  unconditionally at 60 fps even when the scene is completely static — which is
  most of the time in a golf game. Rendering only on state change (aim, camera,
  ball motion, wind animation) would be a very large battery/thermal win on
  mobile. Interacts with 3.2's wind animation, so it needs a "something is
  animating" flag rather than a naive dirty bit.
- **Distant tree impostors.** Once instanced, trees past ~150 m could swap to
  billboard quads. Probably unnecessary after 3.1 — mentioned for completeness.
- **Cloud layer.** The sky dome (`src/visuals/core.js:176-201`) is a clean
  vertex-colored gradient with no sun disc and no clouds. A single large
  scrolling alpha-mapped plane near the top of the dome is one draw call and adds
  a lot of atmosphere. Low priority, decent return.
- **Asset pipeline.** Convert the five ground PNGs to WebP with JPEG fallback
  (~5.9 MB → ~0.6 MB). This is load time, not frame time, but it's the difference
  between a fast first hole and a slow one on mobile data.

---

## 5. Explicitly not recommended

Things that would look better but violate the "no significant slowdown"
constraint:

- **SSAO / any post-processing chain** — a full-screen pass plus depth prepass.
  The vertex-color AO in 3.5 gets most of the benefit for none of the cost.
- **Planar or cubemap water reflections** — a second scene render per frame.
- **Real-time cascaded shadow maps** — the tight-frustum fix in 2.7 gets the
  sharpness without the multi-pass cost.
- **Per-blade grass geometry / grass shells** — the instanced tuft approach is
  already the right call.
- **Raising `MAX_TUFTS_PER_TYPE`** above 14 000 — the wind and distance fade in
  3.2 will make the existing density look denser than raising the count would.

---

## 6. Suggested order

Sequenced by return-per-risk. Everything in phase 1 is small and independent.

| # | Item | Effort | Look | Perf |
| --- | --- | --- | --- | --- |
| 1 | `colorSpace = SRGBColorSpace` + lighting re-tune (2.1) | S | ★★★★★ | — |
| 2 | Clamp pixel ratio (2.5) | XS | — | ★★★★★ |
| 3 | Anisotropy (2.2) | XS | ★★★★ | — |
| 4 | Mow stripes in vertex color (2.4) | S | ★★★★★ | — |
| 5 | World-space UVs (2.3) | S | ★★★ | — |
| 6 | Static shadow map + tight frustum (2.6, 2.7) | S | ★★★ | ★★★★ |
| 7 | Texture registry + fix the leak (2.9, 2.10) | M | — | ★★★★ |
| 8 | Instanced trees, better tree model, tree shadows (3.1) | M | ★★★★ | ★★★★★ |
| 9 | Flagstick + cup rebuild (3.3, 3.4) | M | ★★★★ | — |
| 10 | Grass wind + distance fade (3.2) | M | ★★★★ | ★ |
| 11 | Ball contact shadow + tree-base AO (3.5) | S | ★★★ | — |
| 12 | Thick trajectory line (2.8) | S | ★★★ | — |
| 13 | Water motion (3.6), bunker rims (3.7) | S | ★★ | — |
| 14 | Texture format conversion (Tier 3) | S | — | ★★★ (load) |

Phase 1 (items 1–6) is roughly a day and is where most of the visual gain lives.
Phase 2 (7–9) is the structural work that reclaims the frame budget. Phase 3
(10–14) is polish.

Net expected result after phases 1–2: **~300 draw calls → ~40**, shadow pass
removed from the steady-state frame, mobile fragment load cut by up to 4×,
alongside correctly-lit, correctly-filtered, properly-scaled ground textures with
mow patterns — i.e. materially better looking *and* materially faster.
