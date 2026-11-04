# TrackForge

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

- Home: choose **Track Editor** or **Race**.
- Editor: use the tool rail, mouse/touch canvas, undo/redo, and surface buttons.
- Race: steer with `A`/`D` or the arrow keys and brake with `S`, `ArrowDown`,
  or `Space`. Touching the canvas steers toward the touched side.
- Use the race menu to pause, resume, or return home.

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

The original `trackforge.html` remains as a migration reference and is not loaded
by the Vite application.

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
version code is 3; set `TRACKFORGE_VERSION_CODE` to a higher integer when needed.
The build uses Android's default debug keystore unless `TRACKFORGE_DEBUG_KEYSTORE`
points to a keystore with alias `androiddebugkey` and store/key passwords
`android`. Use the original signing key to update an existing installation.
Never commit or share private keys.

The Android workflow runs on pushes to any branch, pull requests, and manual dispatch.
After verification it publishes a signed debug APK for 30 days, linked from the
workflow run summary. CI uses a version code of the run number plus 2. Configure
the optional repository secret `TRACKFORGE_DEBUG_KEYSTORE_BASE64` with the
base64-encoded original debug keystore to preserve its signing identity. Without
that secret, CI caches a generated debug keystore: its first certificate will
normally differ from existing installations, and cache loss or separate cache
scopes can change it again. Such builds cannot update an app signed with another
key. Debug APKs are for testing, not release distribution.
