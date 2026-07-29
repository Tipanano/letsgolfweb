# Career Mode Design

<!-- Living document for the career-mode branch. Update as decisions land. -->

## Vision

A single-player career arc built on the real-course library: you earn your
way onto the course with the **Green Card**, build a **handicap** by playing
rounds, climb a **course ladder** as your index drops, collect **milestones**
along the way, and eventually compete in **tours** where the goal shifts from
lowering your handicap to winning events.

Career data is **local-first**: guests get a full career in localStorage;
registered users additionally sync to the server (endpoints to be added to
`golf-game-server-requirements.md` in a later phase). The handicap math runs
entirely client-side so no feature depends on server availability.

## Phases

1. **Foundation** *(building now)* — permanent round record + WHS-lite
   handicap engine + derived course rating/slope. Hooked into course-round
   completion in `playHole.js`.
2. **Career profile UI** — career tab: index + trend, round history with
   scorecards, stats (FIR/GIR/putts/scoring distribution), per-course bests.
   Server sync for registered users.
3. **Green Card** — skill-drill certification that doubles as the tutorial
   and the career on-ramp (see below).
4. **Course ladder** — courses tiered by derived difficulty; harder courses
   unlock as the index drops. Unlocks are one-way (a rising handicap never
   re-locks a course).
5. **Milestones & achievements** — event listeners on the round record:
   first birdie, break 90/80/par, course records, streaks.
6. **Tours & seasons** — scheduled events with entry requirements and
   standings. Needs the multiplayer server; own design pass when closer.

## Handicap engine (WHS-lite)

Modeled on the World Handicap System so the number means something to
golfers, with deliberate game-friendly deviations:

- **Score differential** per round: `(adjusted gross − course rating) × 113 / slope`.
- **Adjusted gross**: each hole capped at net double bogey
  (par + 2 + strokes received). Before an index is established, the WHS
  new-player cap of par + 5 applies instead.
- **Index**: WHS best-8-of-20 table over the most recent 20 differentials —
  extended downward so a **provisional index is issued after the first
  round** (lowest differential − 2.0), instead of WHS's 54-hole minimum.
- **9-hole rounds count**: two 9-hole differentials pair up chronologically
  into one 18-hole differential. A lone unpaired 9 is held until its partner
  is played.
- **Maximum index 54.0.**
- **Abandoned rounds never post** — only a round that reaches the final
  hole-out is recorded. (Known trade-off: bad rounds can be abandoned to
  protect the index. Revisit if abused; the WHS answer is net par for
  unplayed holes.)
- Strokes received are allocated per hole by length rank (longest holes
  first) as a stand-in for a real stroke index. Plus-handicap (negative)
  netting is not modelled yet.

### Course rating & slope

Real ratings come from on-site assessment; we only have imported geometry.
`courseRating.js` derives both heuristically from total length, bunker count
and water count (an upgrade of the `difficultyStars` heuristic). The formulas
are intentionally simple and **tunable** — calibrate against how the physics
actually scores once real rounds accumulate.

## Green Card ("grønt kort")

In Norway you needed a green card before you were allowed on a course. Here
it is the career on-ramp **and** the tutorial: a series of skill drills that
teach every part of the game. Completing it grants the starting handicap
(54.0 provisional... or simply enables posting) and unlocks the starter
courses.

Drill set (thresholds tunable; each drill teaches one mechanic):

| Drill | Task | Teaches |
| --- | --- | --- |
| Driving | Hit X fairways from the tee | full swing, aim |
| Approach | Hit X greens from par-3 range distances | club selection |
| Chipping | From 5–10 m off the green at varied ranges/lies, land and stop it on the green | chip mechanic |
| Bunker | Get out of a greenside bunker onto the green | sand play |
| Lag putting | Long putts finishing within 2–3 m | rhythm putt, pace |
| Holing out | Hole X putts from 1–3 m | short putts |

Implementation can reuse existing modes: range (driving/approach), practice
green (chip/putt drills), CTF-style target scoring. Drill progress persists
in the career store.

## Tours & seasons (last phase)

- Tiered tours, each with a **handicap ceiling** for entry (you must be
  below X to join). The ladder of ceilings is the long-term career spine.
- Inside a tour the goal is **winning events**, not lowering the index —
  the index keeps adjusting from posted rounds as normal, but standings are
  about finishes/points.
- Events likely use net or division scoring early, gross at the top tier.
- Meets the multiplayer server and (eventually) Nano prizes.

## Course library needs

Twelve championship-level courses is the *top* of the ladder; the bottom is
missing. Needed:

- **Many more easy/basic courses** — short members' courses, 9-hole courses,
  par-3 / pitch-and-putt layouts for the first career tiers.
- Sources: `tools/osm-import.mjs` for real modest courses (OSM has plenty of
  small clubs), plus hand-authored beginner layouts via the Hole Tuner.
- The rating/slope heuristic tiers them automatically once imported.
