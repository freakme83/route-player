# Playback and camera ownership

The application remains a standalone `index.html` using MapLibre GL JS 5.6.1. No application build or runtime dependencies were added.

## Root causes

- `let speed=1` shadowed the browser's named `#speed` element. Calling `speed.addEventListener` threw, so the speed, mode, orientation, scrubber and navigation listeners below it never registered.
- Follow wrote fixed zoom and rounded slider pitch/bearing on each frame. Those values competed with the real camera, and the unwired mode selector left playback in North Up.
- `jumpTo` calls `stop` in MapLibre 5.6.1, which also stops gesture handlers. Center-only calls must therefore yield to active input, too.
- The clock discarded elapsed time beyond 100 ms per frame; low frame rates changed effective speed. Scrubbing always stopped playback.
- The marker and camera snapped between whole GPX points. The progress line also started ahead of the marker.
- Mode changes started eases which subsequent playback frames interrupted. Loading lacked style-readiness and out-of-order file-read guards.

## Ownership after the change

`playback` owns normalized progress, rate, playing state, last timestamp and the single playback RAF. `advance` integrates elapsed time; rate changes settle the old rate first. `start` and `stop` only control playback. `renderProgress` updates the marker, progress line and labels. Scrubbing rebases the clock and preserves the playing/paused state, except seeking to the finish stops playback. Zero speed pauses; restoring speed requires Play. Hiding the tab pauses explicitly.

The real MapLibre camera owns orientation and zoom. UI events write it, and map movement reads it back into the controls; display rounding is never sent back to the map by playback.

| Mode | Automatic camera ownership |
| --- | --- |
| North Up | Center and bearing 0; preserves pitch/zoom |
| Heading Up | Center and interpolated route heading; preserves pitch/zoom |
| Manual Follow | Center only |
| Free | None |
| Overview | One fit on entry, then a locked camera snapshot |

`applyCamera` performs direct follow updates only when no gesture/animation is active. The public `transformCameraUpdate` hook applies the moving follow target during MapLibre's own rotation/zoom updates without stopping the handler. Pan temporarily yields follow, including inertia, then recenters over 250 ms using center interpolation rather than overlapping eases. Free Camera is the choice for a persistent pan offset. User rotation (including a bearing slider edit) visibly selects Manual Follow from automatic-bearing modes. Overview disables map gestures and camera sliders until another mode is selected.

Route loading is versioned; the latest file wins. Parsed GPX waits only for style initialization, not visible tiles. Replacement removes old layers/sources/marker, resets playback and updates bounds/elevation. An invalid replacement retains the previous valid route, paused. `trkpt`, `rtept`, namespaced GPX, and absent elevation are supported. Source providers, route styling, terrain exaggeration and attribution are retained. No tile prefetching was added.

## Files and key functions

- `index.html`: explicit `ui` references; `playback`; `advance`, `anim`, `start`, `stop`, `renderProgress`; `sampleRoute`, `feat`, `headingAt`; `followOptions`, `applyCamera`, `writeCamera`, `setMode`, `syncCameraUI`; `replaceRoute`, `clearRouteLayers`, `updateMeta`; file/input/map event listeners. The existing parser received only namespace and missing-elevation handling changes. Zoom controls and a scrollable panel keep the controls accessible.
- `tests/playback-camera.test.cjs`: dependency-free regression tests executing the actual inline script with a MapLibre behavioral double and controlled clock.
- `tests/browser.cjs`: Playwright tests using real MapLibre 5.6.1, browser DOMParser and native mouse/wheel interaction with a local style and optional flat-DEM fixture.
- `QA.md`: design, root causes, test instructions and remaining boundaries.

## Run checks

```sh
node --test tests/playback-camera.test.cjs
```

For browser checks, install Playwright in your development environment and its Chromium browser, then run:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser.cjs
```

Optional environment variables: `CHROMIUM_PATH` selects an existing Chromium executable; `MAPLIBRE_JS` and `MAPLIBRE_CSS` select local copies of the **5.6.1** assets. `TEST_TERRAIN=1` enables the terrain rendering pass for hardware-backed browser testing. Otherwise the test disables terrain/hillshade after initialization because the software WebGL terrain-picking pass stalls in this execution environment. The application itself is unchanged. Otherwise the asset loader fetches the assets from unpkg. All page requests for the map/DEM are intercepted with fixtures. The fixture uses a low rendering pixel ratio to keep software WebGL affordable; production rendering is unchanged.

## Coverage and boundaries

The state tests cover all ten requested sequences, exact 25/50/100% ratios across frame intervals, speed changes between frames, one RAF, interpolation endpoints, camera ownership, UI synchronization, completion, loading while tiles are pending, reload cleanup, early style loading and file-read races.

The browser suite covers GPX upload, speed steps, pause/orientation/resume, native rotation/pitch while following, wheel zoom, native panning and reacquisition in Manual Follow, navigation zoom/compass, panning in Free, mode switches, both scrubbing states, zero/restored speed, camera sliders, locked Overview, and a second namespaced `rtept` file without elevation.

**Validation result:** 19 state tests and the real MapLibre Chromium interaction suite passed. Terrain-enabled interaction could not be completed in the software WebGL environment; the passing browser suite has terrain rendering disabled in the harness.

Hardware-specific multitouch/trackpad gestures and Safari/Firefox require device testing. Flat DEM fixtures cannot prove visual behavior on steep live terrain. MapLibre may independently adjust camera pitch/zoom to avoid terrain collision. Live provider availability is outside the offline regression tests.

Progress remains normalized over GPX point order (52 seconds at 100%), with continuous interpolation between points; it does not reconstruct GPS timestamps or guarantee constant ground speed for unevenly spaced samples. Existing multi-segment concatenation and antimeridian route handling were not redesigned. Very large tracks still rebuild the progress GeoJSON, so rendering throughput can lag even though elapsed-time progress remains correct.
