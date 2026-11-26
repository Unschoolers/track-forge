# Menu materials

Track Forge adopts the layering principle of Liquid Glass, not Apple's native
material implementation. The dark harbor palette, racing typography and orange
primary actions remain the identity. Apply the shared menu glass tokens to
navigation, secondary buttons, dialog chrome and compact floating controls.
Keep track artwork, car art and content panels readable and largely opaque.

- Home, shared dialogs, Options tabs, race setup and track library use
  lightweight gradients, highlights and rounded edges.
- No new backdrop filters, displacement shaders, animation loops or dependencies.
  Remove the previous full-screen dialog blur: a menu may cover a live canvas.
- Do not change race HUD or editor tools in this slice. Preserve existing
  DOM hierarchy, event bindings, responsive grids, touch targets and safe areas.
- Use visible focus and active states; orange primary actions remain solid.
  Respect reduced transparency, increased contrast and reduced motion.

Verification: compare home, options, race setup, track library and pause dialogs
on a narrow portrait viewport, short landscape viewport and desktop. Check
contrast, focus, scrolling, touch targets, overflow menus and safe areas.
Confirm Android responsiveness while the race flyover or paused canvas is visible.
Existing component and mobile smoke checks protect the interaction contracts;
physical visual and frame-pacing review remains necessary.
