# Cursor magnet

Webcam gaze is 100-200 px off, so the cursor often lands between things. While the eyes **fixate**, the real cursor
settles on the clickable element nearest the gaze (a magnet). It glides into the snap (never teleports), passes the raw
gaze through untouched (no extra filter, no lag) whenever nothing is snapped, and releases at once on a saccade. The
page's own hover state is the highlight; no overlay is drawn.

Toggle: Settings "Cursor magnets to clickable things" (`settings.magnet`, default on; a stored settings file without the
key loads as on).

Files: `magnet.ts` pure logic (`MagnetCore`, no Electron, unit-tested), `index.ts` wiring (`Magnet`: candidate list from
the Browse page DOM or the frontmost app's AX tree), `magnet.test.ts`.

## Behaviour (all in `DEFAULT_MAGNET`, tunable)

| Param | Default | Meaning |
|---|---|---|
| fixSpeed | 300 px/s | smoothed gaze speed (computed here from raw points, 100 ms EMA) below this = still |
| saccadeSpeed | 1000 px/s | above this the magnet releases at once |
| fixMs | 200 | still this long before a new snap |
| snapRange | 70 px | snap to the element whose BOX is within this (distance to the box, 0 inside; ties go to the smaller box) |
| releaseRange | 110 px | once snapped, stay until the gaze is farther than this from the box |
| switchMargin | 25 px | switch to another element only if clearly closer |
| inset / centerMax | 6 / 120 px | per axis: box size <= 120 -> its center; larger -> the gaze coordinate clamped at least 6 px inside |
| maxAreaFrac | 0.4 | boxes over 40% of the screen are ignored |
| easeMs | 80 | ~90% of the way in about this long (first step at 30 fps is about half the distance) |
| ttlMs / preFixMs | 1500 / 600 | candidate cache life; a list fetched more than 600 ms before the fixation started is not used (scroll safety) |

Never snaps: nothing in range, paused, magnet off, radial menu open, dragging, typing panel, confirm card, `held` and
hold-cursor windows (those already skip the cursor move), Glance's own non-Browse windows.

## Wiring

- `controller.ts` `ingest()`: `this.input.move(q.x, q.y)` with `q = magnet.adjust(rawGaze, now, ctx)`.
  `controller.gaze` and the gaze history stay RAW, so the model prompt (voice, typed, agent) is unchanged.
- `clickAtGaze()`: if the cursor was snapped just before the wink, the click lands on the snapped point (where the cursor is).
- `index.ts` (main) creates `controller.magnet = new Magnet({ browse })`.
- Candidates refresh only when a fixation has lasted `fixMs` and the list is missing, older than ttl, or from before the
  fixation (`MagnetCore.wantsRefresh`): never per frame. Source: `chooseSource(GLANCE_ELEMENTS, focused)`, same rule as the
  intent path. `Magnet.lastRefreshMs` holds the last refresh cost for tuning.

## Tuning

Too sticky: lower `releaseRange`/`snapRange`. Snaps to wrong things: lower `snapRange`, raise `fixMs`. Never snaps: raise
`fixSpeed` (webcam jitter may exceed 300 px/s; unmeasured). Pass overrides as `new Magnet({ browse }, { snapRange: 50 })`.
