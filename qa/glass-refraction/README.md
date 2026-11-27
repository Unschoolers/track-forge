# Glass refraction QA

Open `index.html` in an Android WebView or Chromium browser and compare the four panes over the high-contrast track backdrop.

## What this checks

- Tinted chrome is the no-sampling baseline.
- `backdrop-filter: blur()` softens the live backdrop but does not bend it.
- `filter: url(#copied-capsule-lens)` displaces a manually duplicated scene, demonstrating SVG filter rendering without live backdrop sampling.
- `backdrop-filter: url(#capsule-lens)` is the live-backdrop refraction candidate. A generated static PNG displacement map is embedded with `feImage`; its red/green channels encode horizontal/vertical direction, `128,128` is neutral, and smoothly curved capsule-edge normals taper to zero through the center and outside edge. The map is redrawn only when the pane resizes. The SVG filter specifies `color-interpolation-filters="sRGB"`.

The status line reports parser feature exposure only. A positive parser result is not visual proof; the road edge in pane 4 must visibly curve. This workspace had no Android device/emulator available, and local-file navigation was blocked in the hosted browser, so Android/WebView rendering remains unverified.

## Security constraint

Chromium change 8395606, tracked by [Mozilla bug 2085466](https://bugzilla.mozilla.org/show_bug.cgi?id=2085466), disables `feDisplacementMap` from using protected backdrop contents as its displacement-map input (`in2`), because that can expose sampled background pixels through timing. That is distinct from using the backdrop as the image input and an independently generated image as `in2`. Do not attempt to bypass the restriction or claim that every displacement configuration is supported.

This is a static QA comparison only. It does not add filters to race scenes or assert Android support. Profile any menu-only use on representative Android WebView versions and retain a tinted, no-filter fallback for Low quality.
