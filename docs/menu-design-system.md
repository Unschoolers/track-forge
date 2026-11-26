# Menu design system

## Art direction — precision motorsport
Inspired by [Apple's Liquid Glass design overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) and [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/), not an imitation of iOS. The rejected PR #386 merely rounded existing boxes. The new direction changes the hierarchy:
- Cinematic content (cars, circuit artwork, environment) owns the screen; navigation and functional controls float in a distinct layer.
- Graphite, warm white and restrained orange; environment and vehicle colors belong to content. One decisive primary action, not orange borders everywhere.
- Editorial headlines, readable sentence-case labels, tabular numerals for timings. No nested panels for decoration. Circular icon buttons and capsule actions; concentric radii on grouped controls.
- Motion communicates interaction, not ornament. No idle animated glass or device-motion effects.

## Architecture and boundaries
Application state, commands, persistence and navigation remain authoritative in appState/appController. Screen composition belongs to ui/screens and ui/modals. Shared DOM primitives in ui/menu use ui/dom and stable data-action attributes. styles/menu-system.css owns the shared scoped tokens, layout and material rules. Retain DialogController's focus/scroll restoration and existing modal semantics when migrating dialogs; the shell is not a new router or modal manager. No new framework, library, global state or gameplay dependency.

The layout is a full-bleed media layer, semantic header, scrollable main content and action dock. Grid reserves real space for actions and safe areas. Wide viewports reflow instead of scaling up phone controls. Avoid absolute content placement and nested scroll areas. Each screen owns content composition; no giant configurable screen component.

## Material contract
Use one material per grouped dock, not per child. Content stays opaque or directly on art with a scrim. Regular glass prioritizes readability; clear glass is reserved for intentionally composed static art. Default to opaque with live/unknown backdrops. CSS feature detection, reduced transparency and increased contrast restore readable opaque surfaces. No live canvas sampling, WebGL context, full-screen backdrop filters or JS frame loops. Respect reduced motion; controls retain visible focus and 44px minimum targets (48px primary).
The foundation implements CSS tint, edge lighting and bounded static blur, not physical refraction. A subsequent isolated optical spike should test cached SVG displacement maps against this fallback on Android WebView before enabling them. No assertion of GPU performance or native fidelity until measured.

## Delivery
One production design, no theme switch, experiment flag or parallel UI. Each merged screen replaces its old layout for every player; unmigrated screens retain their current implementation until their turn. Remove legacy rules once their last consumer is migrated.

| Slice | Deliverable |
| --- | --- |
| Foundation | Shared shell, material, controls, reference lab; no production page change |
| Optical material | Static-art lensing spike; compare fidelity and frame pacing; fallback required |
| Home | Artwork-led entry, one prominent Race action, compact navigation, Race Again and update access |
| Race setup | Large vehicle showcase, track flyover, concise readable configuration |
| Track library | Circuit-led browsing, filtering, favorites and contextual actions; preserve shared/read-only semantics |
| Options | Calm grouped settings and floating category navigation |
| Nearby and cup | Connection, consent and round state prioritized |
| Pause and results | Compact interruption and result-led celebration; no live-canvas filter |

Editor tools and in-race HUD are out of scope until separately reviewed. Each screen gets its own PR, component contracts, portrait/landscape/desktop review and real browser screenshots before approval. Check 320px narrow, 360x780, 780x360 and 1440x900 CSS pixels, enlarged text, safe areas, keyboard, touch, disabled/selected states, scroll/focus restoration and reduced motion/contrast. For optical changes compare Android warm/cold frame pacing per race-performance.md. Do not loosen existing checks.

The reference lab is a developer-only route: run npm run dev and open /qa/menu-design/. It uses the real shared primitives and existing car artwork. It is not an approved screen or packaged production route. No production imports until the first screen migration. Rollback is independent per screen.
