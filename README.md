# TrackForge

## Engineering documentation

Start with [docs/README.md](docs/README.md) for architecture, engineering principles, testing strategy (unit > integration > UI), change/review workflow, and the current repo audit. Coding agents should also read [AGENTS.md](AGENTS.md). Historical design documents remain under `docs/superpowers/`.

TrackForge is a local-first 2D track editor and racing game built with Phaser 4,
strict TypeScript 7, Vite, and modular HTML/CSS UI.

## Run locally

Install dependencies once:

```powershell
npm install
```

Start the development server:

```powershell
npm run dev
```

Open the URL printed by Vite, normally <http://localhost:5173>.

## Controls

- First launch: choose a local player display name (2–24 characters); edit it in **Options → Profile**. A one-time startup migration credits existing user tracks to your profile while built-in starter and official tracks remain system-owned and unshareable. Name changes preserve track geometry and race records.
- Home: choose **Track Editor** or **Race**.
- Editor: use the tool rail, mouse/touch canvas, undo/redo, and surface buttons.
  Open **Editor menu** to rename, share, save, save as new, race, or change the environment and route type. The map title is read-only; global Options are available from home and race menus.
- Tap a circuit preview to open Race Setup, then choose a car and race mode.
  The flyover uses the selected car and lighting. Open **Options** for race
  length, lighting, difficulty, and driving style.
- Use the track's share icon and choose Nearby or Export. Both carry a signed,
  importable track file and the same available ghost. On browsers without file
  sharing, Export downloads a copy.
- A share can include your saved recovery-free ghost for the selected car and
  lap count. Import it from the Race picker to see the target time, car and lap
  rule in Race Setup. The creator replay stays separate from your private best.
  After finishing an imported challenge, **SEND BACK MY TIME** shares that
  completed replay through the same private file share flow. Explicit Nearby
  track sharing preserves the verified original file; Nearby race staging
  sends geometry without replay metadata.
- Race: steer with `A`/`D` or `ArrowLeft`/`ArrowRight` and brake with `S`, `ArrowDown`,
  or `Space`. On touchscreens, place a finger on the steering pad or canvas,
  then slide left or right from that starting point to steer. Hold the separate
  **Brake** button with another finger to brake while steering. Arcade accelerates
  automatically. Use **Brake** to slow down for corners. In Simulation, hold
  **Gas**, `W`, or `ArrowUp` to accelerate and release it to coast. Gas and Brake
  can be held independently while steering.
  When a pedal has keyboard focus, hold `Space` or `Enter` to use it.
- During an active race, tap **Recover** or press `R` to return your car to the
  road. Recovery keeps your lap progress, damage, and elapsed race time.
- Use the race menu to pause, resume, or return home.
- Android runs in immersive fullscreen. Swipe from a screen edge to temporarily
  reveal the system navigation bars.

## Verification

```powershell
npm run verify
```

Individual gates are also available:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run preview
```

The original single-file game is preserved in Git history at commit `fde57030fd9a481ce1d8bdac7c200b851675c8ab` (`trackforge.html`).
It is not part of the maintained Vite application; use `git show fde57030fd9a481ce1d8bdac7c200b851675c8ab:trackforge.html`
if historical implementation details are needed.

Run `npm run qa:lanes` for fast, deterministic AI path checks without graphics.
Open `qa/results/lanes/report.html` for dot trails and failure locations. See
[AI lane checker](docs/ai-lane-checker.md) for custom tracks and larger batches.

## Windows PC — portable EXE

Download [TrackForge.exe](https://github.com/Unschoolers/track-forge/releases/latest/download/TrackForge.exe) from the latest release and run it directly on Windows 10/11 (x64). No installer, ZIP extraction, browser tab, Node.js or separate game server is needed. The game is bundled for offline racing and track editing.

Windows Options → Updates provides release checks, What's New, and a Download New EXE action. Because Windows locks a running executable, close TrackForge before replacing your old EXE. No background self-modification occurs.

Windows uses the system **Microsoft Edge WebView2 Runtime** (preinstalled on most supported Windows systems); it must be installed for the EXE to start. The executable is currently unsigned and may trigger a Windows SmartScreen warning. The maximized game window can be closed normally; saved tracks and progress remain in the app's Windows user profile when replacing the EXE with an update.

**Nearby Races:** Windows and Android can race together over the same local Wi-Fi. Choose **LOCAL WI-FI** in Android Nearby Race; Windows uses LAN automatically. Android's original Nearby mode is still offered for wireless play without a common Wi-Fi network. See [LAN multiplayer](docs/lan-multiplayer.md). Building from source, smoke checks and the release contract are described in [Windows desktop packaging](docs/windows-desktop.md).

## Android APK

Android builds bundle the production web assets for offline use at
`https://trackforge.local`, preserving the prior app's storage origin and
application ID `io.trackforge.app`. Install with `adb install -r <apk>`; Android
requires the installed app and update to have the same signing certificate and
an equal or higher version code. Back up local data before changing certificates:
uninstalling the old app removes its local data.

Install Node 22+, Java 21, Android SDK platform 36 and build tools 36.0.0, then:

```sh
npm ci
npm run android:apk
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. The local default
version code is 3 and its version name is `2.0.0-local`. To update an installed
CI build locally, supply its same signing key and set `TRACKFORGE_VERSION_CODE`
above the installed version. `TRACKFORGE_VERSION_NAME` sets the visible version.
The build uses Android's default debug keystore unless `TRACKFORGE_DEBUG_KEYSTORE`
points to a keystore with alias `androiddebugkey` and store/key passwords
`android`. Use the original signing key to update an existing installation.
Never commit or share private keys.

The Android workflow compiles and verifies unsigned APKs on pushes to main,
manual dispatch, and pull requests that may change native build inputs. Web-only
pull requests still run the full JavaScript checks and production web build.
Unsigned artifacts are for QA, not installation.
Successful main-branch pushes and manual main builds sign and publish the APK
itself as a versioned [GitHub Release](https://github.com/Unschoolers/track-forge/releases)
asset. [Download the latest APK directly](https://github.com/Unschoolers/track-forge/releases/latest/download/trackforge-debug.apk).
Release downloads require no Actions ZIP and have no 30-day artifact expiry.
In **Options → Updates**, Android automatically forgets and removes a saved APK download once the installed app is at that release version or newer. Merely opening the installer does not discard the download, so canceled installs remain retryable.
Re-running compilation creates a new version. Re-running only signing/publication
reuses the original verified build identity and is idempotent; it does not label
an old APK as a newer attempt. Older builds cannot replace a newer build as the
latest download. PR builds never receive the permanent signing key.

Create the GitHub environment `android-signing`, restrict its deployment branches
to **main only**, and then add environment secret `TRACKFORGE_DEBUG_KEYSTORE_BASE64`,
containing the base64-encoded **original** `trackforge_debug_signing.keystore`.
Use Settings → Environments → android-signing; do not store this as a repository
secret, where branch workflows could access it. Do not generate a replacement
key or put a keystore in git. The certificate fingerprint in
`android/signing-certificate.sha256` is public and identifies the original key.

The main-only signing job uses an explicit private temporary keystore, verifies
its certificate, signs the verified unsigned artifact without executing Gradle,
and checks the final APK's signer, application id, version code and version name
before publication. Missing or incorrect signing configuration stops publication
rather than distributing another incompatible APK. The compilation job receives
no signing key and disables Gradle's automatic debug signer in CI.

Published builds have version name `2.0.RUN.ATTEMPT` and version code
`1000000 + RUN * 100 + ATTEMPT`. Both new builds and reruns increase the code;
attempts outside 1–99 and codes over Android's limit fail explicitly. For example,
build 117.1 is version `2.0.117.1` with code `1011701`.

Earlier cached-key builds were signed with different certificates. A version bump
cannot make those mutually updateable. Installs signed with the original key can
update directly; other signing identities may require a one-time reinstall.
Preserve locally saved tracks before any reinstall. All future published builds
must retain the pinned original signing identity.
