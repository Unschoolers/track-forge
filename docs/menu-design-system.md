# Menu design system

## Art direction — precision motorsport
Inspired by [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), [Apple's Liquid Glass design overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) and [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/), not an imitation of iOS. The rejected PR #386 merely rounded existing boxes. The new direction changes the hierarchy:
- Cinematic content (cars, circuit artwork, environment) owns the screen; navigation and functional controls float in a distinct layer.
- Graphite, warm white and restrained orange; environment and vehicle colors belong to content. One decisive primary action, not orange borders everywhere.
- Editorial headlines, readable sentence-case control labels and title-case section headings, tabular numerals for timings. No nested panels for decoration. Circular icon buttons and capsule actions; concentric radii on grouped controls.
- Motion communicates interaction, not ornament. No idle animated glass or device-motion effects.

## Architecture and boundaries
Application state, commands, persistence and navigation remain authoritative in appState/appController. Screen composition belongs to ui/screens and ui/modals. Shared DOM primitives in ui/menu use ui/dom and stable data-action attributes. styles/menu-system.css owns the shared scoped tokens, layout and material rules. Retain DialogController's focus/scroll restoration and existing modal semantics when migrating dialogs; the shell is not a new router or modal manager. No new framework, library, global state or gameplay dependency.

The layout is a full-bleed media layer, semantic header, scrollable main content and action dock. Grid reserves real space for actions and safe areas. Wide viewports reflow instead of scaling up phone controls. Avoid absolute content placement and nested scroll areas. Each screen owns content composition; no giant configurable screen component.

## Material contract
Use one material per grouped dock, not per child. Content stays opaque or directly on art with a scrim. Regular glass prioritizes readability; clear glass is reserved for intentionally composed static art. Default to opaque with live/unknown backdrops. CSS feature detection, reduced transparency and increased contrast restore readable opaque surfaces. No live canvas sampling, WebGL context, full-screen backdrop filters or JS frame loops. Respect reduced motion; controls retain visible focus and 44px minimum targets (48px primary).
Menu glass keeps a translucent tint and edge lighting as its fallback. On Home, Track Library and Options, medium/high graphics quality may add cached SVG edge refraction over visible static artwork; low quality and reduced-transparency/high-contrast preferences keep the opaque fallback. The effect uses bounded normal maps rebuilt only when a surface resizes, never samples the live race canvas, and does not run an animation loop. Android WebView fidelity and frame pacing still require device review.

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
- **Search:** if needed in the library, use semantic search and verify keyboard
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
