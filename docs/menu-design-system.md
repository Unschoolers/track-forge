# Menu design system

## Art direction — precision motorsport
Inspired by [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), [Apple's Liquid Glass design overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) and [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/), not an imitation of iOS. The rejected PR #386 merely rounded existing boxes. The new direction changes the hierarchy:
- Cinematic content (cars, circuit artwork, environment) owns the screen; navigation and functional controls float in a distinct layer.
- Graphite, warm white and restrained orange; environment and vehicle colors belong to content. One decisive primary action, not orange borders everywhere.
- Editorial headlines, readable sentence-case control labels and title-case section headings, tabular numerals for timings. No nested panels for decoration. Circular icon buttons and capsule actions; concentric radii on grouped controls.
- Motion communicates interaction, not ornament. No idle animated glass or device-motion effects.

## Architecture and boundaries
Application state, commands, persistence and navigation remain authoritative in appState/appController. Screen composition belongs to ui/screens and ui/modals. Shared DOM primitives in ui/menu use ui/dom and stable data-action attributes. styles/app.css defines the production cascade. styles/tokens.css owns reusable design tokens; styles/menu-system.css loads the shared shell, glass and painted controls. Each screen stylesheet owns its layout and content. Retain DialogController's focus/scroll restoration and existing modal semantics when migrating dialogs; the shell is not a new router or modal manager. No new framework, library, global state or gameplay dependency.

The layout is a full-bleed media layer, semantic header, scrollable main content and action dock. Grid reserves real space for actions and safe areas. Wide viewports reflow instead of scaling up phone controls. Avoid absolute content placement and nested scroll areas. Each screen owns content composition; no giant configurable screen component.

## Material contract
Use one optical material per grouped dock, or independent optical buttons on an unfiltered action group; never nest backdrop filters. Content stays opaque or directly on art with a scrim. Regular glass prioritizes readability; clear glass is reserved for intentionally composed static art. Default to opaque with unknown backdrops. The editor chrome is an explicitly approved live-canvas exception using bounded Chromium backdrop lenses. CSS feature detection, reduced transparency and increased contrast restore readable opaque surfaces. No canvas readback/copy, additional WebGL context, full-screen backdrop filters or JS frame loops. Respect reduced motion; controls retain visible focus and 44px minimum targets (48px primary).
Menu glass uses LiquidGlass.dev's upstream SVG refraction of aligned copies of static artwork in Home, Track Library, Race Setup and Options. All independent actions use the shared clear tint and rim geometry; primary actions use the orange tint for readable dark labels. Grouped navigation gets one lens, never one per tab. Selectable Track Library tiles use one static-art lens per visible card, capped at eight simultaneous card lenses; offscreen tiles retain translucent paint. Favorite/overflow icons remain unfiltered with 44px hit areas. Options' native sliders, toggles and grouped settings retain paint-only selection feedback. Low quality and reduced transparency/high contrast use opaque surfaces. No live canvas sampling, WebGL or idle animation. Race Setup's single Day/Night toggle is the exception to static artwork: it uses the same vendored optical engine in content mode over two crossfading sprite frames. A tap changes race state immediately, then plays a 1.5-second transition with at most three optical map settings; no optical layer wraps the label. Low quality, reduced transparency/high contrast and unsupported filters keep the native painted toggle; reduced motion shows the endpoint without animation. The material adapter cancels the transition and destroys the lens on rebuild or navigation. The Track Forge material adapter shares a circular lens profile with a broad curved shoulder across actions, groups and lighting artwork. A separate paint-only reflection follows sky illumination continuously and casts a local glow without rebuilding displacement maps each frame. A delegated pointer adapter supplies contact-position illumination to every native button, preserving simultaneous racing pointers, native hit areas and click behavior. Decorative optical surfaces compress and rebound without moving labels. Reduced motion disables deformation. Android WebView visual fidelity and frame pacing still require device review.

## Shared control defaults

menu-glass.css owns optical material and its static-art fallback; menu-controls.css owns painted controls; menu-dialogs.css owns base dialog layout, field geometry and minimum touch sizes. Options, Track Library, Race Setup, Results and the player topper picker have focused stylesheets. An unclassified new
dialog must already look like Track Forge, not the retired angular theme.
Use the existing button and setup-choice classes; selectable buttons expose
aria-pressed and the matching active class. Specialized pickers (including
topper icons/colors) may set layout, glyph size and swatches, not create their
own borders, selection bars or typography. Keep 44px touch targets and wrap
choices rather than shrinking them. Static optical surfaces may enhance these
defaults; live editor tools use optical backdrop material on supported medium/high quality, with the same opaque rounded fallback.
Do not introduce square action styles, clipped corners or a new optical layer
for a settings choice.

Static artwork capability is declared once in menuGlass.ts. All ordinary
button, tf-menu-action and modal-close actions on those screens automatically
use the shared paint and optical layer, independent of whether they appear
in the body, footer or a form. CSS uses the data-menu-material capability
rather than repeating a screen/action allowlist. Other content cards and cup rows
stay unfiltered, grouped settings choices stay paint-only, and closed
diagnostics do not mount lenses. Race setup retains its existing optical
mode/lighting choices. Screen CSS may arrange controls but must not duplicate
their optical paint, geometry or low-quality fallback.

Options defines the visual reference: soft rounded geometry, sans-serif
labels, orange selection, a subtle illuminated rim and readable graphite.
Repeated content actions and editor chrome share material tokens in tokens.css; do not mount a lens per cup row or per child of an editor group. Tools and View disclosures are mutually exclusive. Keep their
layout and editing commands separate from shared paint.

## Adoption review gates

The Apple adoption guide is the design reference, not a native SDK dependency.
Our DOM controls do not automatically inherit SwiftUI/UIKit behavior. For every
migration, review the following alongside the existing interaction contracts:

- **Controls:** use native button/input semantics with shared styling; reserve
  glass for functional groups. Use shared spacing, generous row heights and
  concentric geometry. Add fluid selected-state transitions only when they
  communicate state, preserve keyboard focus and respect reduced motion.
- **Navigation:** use a bottom dock on compact screens when useful, a rail or
  split layout on wide screens when it improves the task. Keep content and
  navigation distinct. Extend decorative media behind chrome; never obscure
  interactive content or require a tab bar on a screen without destinations.
- **Scroll edges:** if content can scroll behind fixed chrome, fade or obscure
  that content near the edge to protect legibility. The default shell reserves
  space for controls; do not add a blur merely to imitate the effect.
- **Toolbars:** group actions by purpose, not just availability. Use consistent
  icons and accessible names for icon-only actions. Remove hidden actions from
  layout and focus order; if swipe actions exist, keep contextual actions
  consistent. Add reusable primitives when their first screen needs them.
- **Sheets and menus:** compact tasks may use inset sheets; expanded tasks use
  opaque surfaces. Anchor contextual menus to their initiating control and
  restore focus on dismissal. Preserve existing modal behavior for destructive
  confirmations, nearby consent and pause; do not imitate nonmodal Apple
  action sheets at the cost of application safety.
- **Organization:** use readable title-case section headings, grouped rows
  and consistent padding instead of all-caps boxed panels. Settings use forms
  and native semantics rather than making every row an optical effect.
- **Search:** library browsing comes first: a compact icon opens search on demand; closing clears the query, and returning from race setup restores the previous view. Use semantic search and verify keyboard
  resizing, safe areas and clear/dismiss behavior. Placement follows available
  space and task; no separate search tab unless search is a true destination.
- **Platform verification:** test Android WebView, desktop, touch and keyboard.
  Verify contrast on the actual artwork (including the brightest background),
  selected/disabled/focus states, text scaling and supported accessibility
  preferences. Add a documented opaque fallback where a browser does not support
  backdrop effects; do not assume CSS accessibility media queries map to every
  Android accessibility setting. Profile grouped effects before enabling lensing.

App icon variants and Apple-specific SDK APIs are outside this menu migration.
Visual parity with native Liquid Glass and adaptive optics remain unverified.

## Reference implementation: Landmarks

Apple's [Landmarks sample](https://developer.apple.com/documentation/swiftui/landmarks-building-an-app-with-liquid-glass) is the reference for composition, not a dependency or a mandate to copy its appearance.

- Background extension: keep decorative media separate from interactive content. Extend the image behind navigation; keep its headline and actions in their own safe, legible layout. Use existing artwork and static derivatives, not stretched text or live canvas copies.
- Adaptive navigation: on a wide track library or race setup, a rail/list and detail pane may coexist. On compact displays the same selection opens a detail view using the existing application navigation. Preserve selection, back behavior and scroll restoration; do not duplicate state.
- Horizontal browsing: allow circuit/vehicle artwork to extend to the visual edge when useful. Reserve leading and trailing scroll insets so the first and last interactive items can be fully visible and focused. If content passes behind navigation, add a protective scroll-edge treatment and verify pointer access.
- Functional toolbar groups: separate sharing from collection/favorite actions and detail controls with real spacing. One optical surface per group; avoid one large indiscriminate pill or a glass border on every icon. Reference: [Landmarks toolbar grouping](https://developer.apple.com/documentation/swiftui/landmarks-refining-the-system-provided-glass-effect-in-toolbars).
- Coordinated custom effects: Apple groups and identifies custom badge shapes for transitions. For Track Forge, keep stable control identities across state changes, share material geometry where practical, and reserve badge/medal animations for meaningful achievement states. Honor reduced motion and cancel transitions on navigation. Morphing is an optical-phase experiment, not a foundation feature.

Each page review must show the compact and expanded compositions, actual artwork behind controls, and relevant interaction states. Do not add a native SwiftUI layer or change app icon packaging for this redesign.

## Delivery
One production design, no theme switch, experiment flag or parallel UI. All migrated menus use the shared material for every player. Remove superseded per-screen paint rather than stacking overrides. Preserve screen-specific layout, HUD styling, accessibility fallbacks and old track/save compatibility.

| Slice | Deliverable |
| --- | --- |
| Foundation | Shared shell, material, controls, reference lab; no production page change |
| Optical material | Static-art lensing spike; compare fidelity and frame pacing; fallback required |
| Home | Artwork-led entry, one prominent Race action, compact navigation, Race Again and update access |
| Race setup | Large vehicle showcase, track flyover, concise readable configuration |
| Track library | Full-screen circuit browsing with fixed header/footer, two-column results and filtering that never changes shell size; preserve shared/read-only semantics |
| Options | Calm grouped settings and floating category navigation; fixed full available height across tabs, with only the settings body scrolling |
| Nearby and cup | Connection, consent and round state prioritized |
| Pause and results | Compact interruption and result-led celebration; no live-canvas filter |

Editor chrome uses LiquidGlass.dev native backdrop refraction on Chromium; in-race HUD remains a separate gameplay interface without live lenses. Each screen gets its own PR, component contracts, portrait/landscape/desktop review and real browser screenshots before approval. Check 320px narrow, 360x780, 780x360 and 1440x900 CSS pixels, enlarged text, safe areas, keyboard, touch, disabled/selected states, scroll/focus restoration and reduced motion/contrast. For optical changes compare Android warm/cold frame pacing per race-performance.md. Do not loosen existing checks.

The reference lab is a developer-only route: run npm run dev and open /qa/menu-design/. It uses the real shared primitives and existing car artwork. It is not an approved screen or packaged production route. No production imports until the first screen migration. Rollback is independent per screen.


## LiquidGlass.dev migration (phases 1–2)

The shared `attachMenuGlass` adapter mounts upstream `lg-panel` only on explicitly approved static-art menus. Standard body/footer/form actions on Home, race setup, library, Options, Cup and Nearby use independent lenses; race setup choices retain independent lenses; library toolbar and Options categories use one lens per group. Native buttons, tabs, inputs, commands and focus behavior remain authoritative. Track Library tiles are the bounded visible-card exception; no nested lenses inside track cards, or lenses on car cards, flyovers, live gameplay or editor; the editor has its own live-backdrop adapter. The source is the screen artwork with its scrim in the same CSS background. The library is vendored unchanged from gentpan/liquidglass commit `d5db099ef00828496aa2733e4f35542c05a0b1f8`, with attribution in src/vendor/liquidglass. Lazy-load only on medium/high quality; remove panels on navigation and accessibility preference changes. The former custom edgeRefraction engine has no remaining consumers and is removed. CSS paint-only fallbacks remain available when optics are unavailable. Phase 2 implementation proceeds on the user's request after phase 1 mobile/build verification; production merge still requires CI and Android device visual/frame-pacing review.

Cup and Nearby navigation use the same static harbor artwork for their action lenses; the live flyover is never sampled. Pause and results use painted opaque surfaces without backdrop filters over the race canvas. Physical Android visual and frame-pacing verification remains required before merging optical changes.

Options reconciles newly inserted or hidden action controls while open; download polling preserves existing button identity and does not recreate lenses for unchanged progress controls. Release notes and progress retain native semantics.

## Remaining compact dialogs
Editor menu and Share track now use independent SVG action lenses (including icon actions), and editor settings selects have a single lens around the native field. Their own opaque gradient card is the static source, never the live editor canvas. Low and accessibility fallback preserve painted controls. Unsaved changes, track naming/renaming and player-name onboarding retain the shared 18px geometry and painted material. Android's system Back exit confirmation is a native dialog, not a DOM modal: its rounded panel, warm primary and graphite secondary native ripple drawables match the menu palette without adding a WebView bridge or live backdrop capture. Preserve native Back/Stay/Exit behavior and accessible scalable text. The native dialog remains opaque independently of graphics quality.

## Race setup length and ghost discovery

Circuit race length is selected in Race Setup (1, 2 or 3 laps), not Options. Point-to-point routes stay single-run. The existing saved lap preference and ghost storage format are unchanged. Car indicators identify cars with a replay at any supported length; lap indicators identify lengths with a replay for the selected car. Creator challenges keep their existing cross-car and target-lap behavior. Indicators are informational, not separate actions, and reuse the same accessible choice controls.
Nearby hosts choose circuit laps before preparing a race or cup; the existing prepare message carries the chosen length. Point-to-point rounds still use a single run.

## Live editor chrome

The editor screenshot review supersedes the former paint-only decision for editor chrome, not the racing HUD. Editor menu and Share track use separate static card-backed lenses. `attachEditorGlass` uses the vendored `createGlass(..., { mode: 'backdrop', fit: true })` engine directly on native controls and contextual surfaces; Chromium/WebView composites the existing Phaser canvas behind them. Independent navigation, undo/redo, disclosure triggers and track actions have small lenses. An expanded Tools/View drawer, contextual dock or selection/diagnostic panel has a single lens and unfiltered native child controls. No canvas readback, canvas copy, extra WebGL context, fullscreen filter or idle JS render loop. Medium uses a 0.75 map scale and High uses 1, with no chromatic multipass or blur on either. Existing geometry, safe areas, pointer capture, accessibility names, editor history and preview semantics remain unchanged. Low graphics, unsupported backdrop filters/engines and accessibility preferences keep the existing opaque paint. Destroy all lenses on screen replacement, navigation or preference change; closed drawers do not retain a lens. Browser verification must check real SVG backdrop filter references, not just CSS appearance. Physical Android contrast, refraction and frame pacing are still required; this change does not claim those measurements. Rollback removes the editor adapter and its live styling without touching the static menus or game rendering.

Race Setup cycles laps (1 → 2 → 3 → 1) and only valid race modes using single native buttons. Unavailable ghosts are explained by the existing status text; available ghost lap counts remain visible. Same-track preference changes update the mounted modal, car selection, lighting artwork and flyover canvas rather than rebuilding its DOM and SVG lenses. Navigation and quality changes retain full teardown.
