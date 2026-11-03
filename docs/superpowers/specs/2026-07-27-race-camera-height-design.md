# Race Camera Height Design

## Goal

Bring the race camera closer so cars remain readable at speed while preserving
smooth following, road-aligned rotation, curve emphasis, and mobile controls.

## Root Cause

The race camera starts at `1.02` zoom and converges to `0.965` on a fast
straight. Its entire allowed range is `0.95–1.08`, so the vehicle is rendered
at approximately one screen pixel per world pixel. Tall viewports consequently
show a large amount of track and make the car feel distant.

## Approach

Keep the current speed/curve interpolation and asymmetric smoothing, but move
the camera targets into an exported typed `RACE_CAMERA_TUNING` record:

- initial zoom: `1.2`;
- normal straight zoom: `1.2`;
- fastest straight zoom: `1.16`;
- corner zoom: `1.28`;
- fixed zoom: `1.18`;
- clamp range: `1.14–1.3`.

Position following and road-aligned rotation remain unchanged. Explicit targets
are preferred over a global multiplier because each camera state remains
independently understandable and tunable. Viewport-dependent zoom is rejected
because it would make handling composition change unpredictably between
devices.

## Testing

The pure camera suite will assert:

- fixed mode converges to `1.18`;
- a sustained maximum-speed straight never falls below `1.15`;
- corners remain closer than straights;
- position and heading smoothing remain intact.

The full strict TypeScript, lint, and production-build gate must remain green.
