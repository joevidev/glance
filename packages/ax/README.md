# @glance/ax

Swift CLI (`glance-ax`, compiled with `swiftc`, no dependencies) that turns the macOS Accessibility tree of the frontmost app into the
same element list the DOM extractor produces (`packages/contracts/schema/element.schema.json`): `id` 0..n-1 in reading order, `role`
(extractor vocabulary: button, link, textbox, searchbox, checkbox, switch, radio, tab, menuitem, combobox, slider, row), `name`
(cleaned, quotes replaced, <= 80 chars), `box` in **global screen points** (same space as the gaze, the overlay and `packages/input`).
Cap 80, only visible (clipped to the window, scroll areas and displays), enabled, named, actionable elements.

```
pnpm --filter @glance/ax build        # swiftc -O -> packages/ax/bin/glance-ax (skips quietly without swiftc / off macOS)
glance-ax elements [--pid N] [--budget MS] [--max N] [--bare]   # JSON {ok,trusted,app,pid,window,count,nodes,ms,truncated,elements[]}
glance-ax frontmost                                              # app, pid, window frame
glance-ax press <id|x,y>                                         # AXPress an element (re-walks for ids)
glance-ax verify                                                 # hit-tests every element centre: does the element under it match?
glance-ax trusted [--prompt]
glance-ax normalize < {"clip":{..},"nodes":[RawNode]}            # pure mapping, used by the tests (no GUI)
```

**Permission.** Without Accessibility trust for the launching process (Electron / your terminal) every command prints
`{"ok":false,"trusted":false,"error":"Accessibility permission is missing ..."}` and exits 2. The desktop app shows that as a toast.

**Speed.** Breadth-first, one batched IPC per node (`AXUIElementCopyMultipleAttributeValues`), 0.25 s per-call timeout, budget 450 ms,
max 2500 nodes / depth 28 / 450 candidates, tables use `AXVisibleChildren`, rows are not descended (their text names them).
Measured: 50 to 250 ms warm on Finder, System Settings, Safari, Notes.

**Chromium/Electron apps** expose no tree until asked: if fewer than 3 elements come back, `AXManualAccessibility` is set on the app and the walk retried.

## Tests

`pnpm --filter @glance/ax test` builds then runs `test/normalize.test.mjs` (role mapping, names, filtering, order, schema shape; needs no
window or permission) and `test/gui.test.mjs` (only with `GLANCE_AX_GUI=1`). Without a binary the tests skip. `GLANCE_AX_STRICT=1`
makes a swiftc failure fatal (default: warn and exit 0 so the turbo graph stays green).

## Known gaps

- Occlusion by other windows is not modelled (only the focused window is read, but a window covering part of it is not subtracted).
- Menu bar and open menus/popovers (children of the app, not the window) are not included.
- Web content in Chrome/Electron only appears after AX is enabled and depends on the page; Safari web content works.
- Canvas / custom-drawn UIs (games, Figma canvas) have no tree.
- Row names are title + preview text and are cut at 80 characters.
