# Memory Galaxy (desktop)

Read-only visualization of persisted `memory_items` and `memory_links` in the Geistr desktop app.

## Data API

`getMemoryGraph(db, options?)` in `@geistr/core` returns:

- `nodes` — active and cold memories (deleted excluded)
- `links` — edges where both endpoints are in the node set
- `stats` — totals for memories and links

Desktop bridge: `window.geistr.getMemoryGraph()` via IPC `geistr:get-memory-graph`.

## UI

- Sidebar **Memory** opens the galaxy view.
- The detail inspector is hidden until a memory is selected. On wide screens it slides in beside the graph; on smaller screens it overlays the graph so the galaxy keeps enough visible space.
- Renderer filters (search, type, status, min importance/strength) are presentation-only; shaping helpers live in `apps/desktop/src/renderer/memory/memory-graph-model.ts`.
- 3D graph uses `react-force-graph-3d` and `three` for orbit/zoom/pan, soft glowing nodes, and a fixed pool of small custom motes that continuously travel from node to node through visible memory links. Motes render through the transparent nodes and ease through each node before choosing the next connected path.
- Styling uses global tokens in `apps/desktop/src/renderer/tokens.css` (`--memory-type-*`, `--memory-link-*`, `--memory-canvas-bg`, etc.). The canvas reads computed tokens via `memory-theme.ts` when theme mode changes.

## Non-goals (this slice)

- No editing, deleting, or reinforcing memories from this page.
- No changes to the memory indexing loop.

## Performance follow-up

Large graphs (thousands of nodes) may need caps, level-of-detail, or 2D fallback. Core `maxNodes` defaults to 2500.