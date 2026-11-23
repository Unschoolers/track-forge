# Windows desktop — portable executable

## Contract

- **One executable:** `TrackForge.exe`, built on `windows-latest` with Tauri 2, no installer or ZIP for the user.
- **One game build:** reuse the verified Vite `dist/` from `web-build`. The Rust/Tauri build embeds those assets inside the EXE; it does **not** launch a local HTTP server or need a browser tab.
- **Offline first:** racing, editing, local tracks and local records work without an internet connection. Online-only services are not made offline by the desktop wrapper.
- **Data survives upgrades:** the stable `io.trackforge.desktop` app identity keeps the WebView2 profile/localStorage separate from Chrome and Android. Replacing/moving the EXE must not clear local saves. Do not change the identifier without an explicit data migration.
- **LAN Nearby Race:** Windows uses the native Tauri TCP/UDP LAN transport on the local Wi-Fi network. Android users select **LOCAL WI-FI** in Nearby Race; Android Nearby remains available as a separate fallback mode. The multiplayer state machine and binary packet protocol are unchanged. See [LAN multiplayer](lan-multiplayer.md).
- **Updates:** The Windows Options → Updates tab checks the same verified GitHub releases and shows the aggregated changelog. A trusted native command opens the exact release EXE in the default browser; no auto-replacement, sidecar, updater service or extra permissions are added. Windows locks the running EXE, so the player closes the game and replaces the portable file manually. Failed checks and browser-launch errors must be shown.
- **Windows runtime:** requires the Microsoft Edge WebView2 Runtime and a supported x64 Windows 10/11 system. The EXE is not code-signed yet; Windows SmartScreen may warn. Do not circumvent security checks.

## Local build (Windows)

Install Node 22+, Rust stable (MSVC target and Visual Studio C++ build tools) and WebView2. From repository root:

```powershell
npm ci
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --release
./src-tauri/target/release/trackforge.exe
```

The executable contains the web assets from the current `dist/` at the moment Rust compiles. The Rust build script watches `../dist` and re-embeds the game after rebuilding Vite assets.

## CD and verification

`.github/workflows/build.yml` keeps the existing Android compilation, signed APK, and release identity. On native-relevant PRs and every main build, the Windows job downloads the same web artifact and compiles a PE executable. Main publication waits for JS verification, Android unit/compile/signing and the Windows job before attaching **both** `trackforge-debug.apk` and `TrackForge.exe` to the **same** release tag.

Windows output is an unsigned quality-gated build artifact on PRs, never published as a GitHub Release from PRs. An existing release is supplemented idempotently if either file is missing. No signing credentials are exposed to the Windows job.

### Manual acceptance before considering desktop release production-ready

1. On a clean Windows 10/11 x64 machine with WebView2, launch the downloaded `TrackForge.exe` directly (not an installer).
2. Disconnect the internet; start a race, finish it, use the editor, save a track, and restart the application.
3. Verify saved tracks, identity, ghosts, settings and race results survive restarts and replacement with a newer EXE.
4. Use keyboard steering, braking and menus; verify audio, window resize, game startup and exit.
5. Confirm that Windows can host and join LAN rooms with an Android phone on the same Wi-Fi (including recovery, cup, track transfer and rematch); the Android-only Nearby mode remains independently usable.
6. Check Windows Options → Updates (latest, newer, offline, missing asset); click Download New EXE and verify browser opens the correct GitHub release, not an Android APK. Close and replace the EXE and confirm tracks survive.
7. Inspect Windows security warnings and runtime behavior on a clean non-developer PC.

Rollback is the small Rust desktop wrapper and Windows job/release-asset changes. Removing the desktop release path must not touch Android signing or delete existing desktop user profiles.
