# Cross-platform LAN nearby multiplayer

## Players and transport

- Windows + Android, Windows + Windows, and Android + Android over the **same Wi-Fi / LAN**.
- No cloud server or account. The host opens TCP port 47832; room discovery uses UDP broadcast/response on port 47831. Both adapters send bounded newline-delimited JSON frames with a byte payload in Base64.
- Host/scan/pairing/connected/packet/disconnected/lock/stop mirror the existing `NearbyTransport` port. The authoritative `NearbyRace`, checkpoint/progress packets, transfer validation, replay and race state machines are unchanged.
- Android users choose **LOCAL WI-FI** to join a Windows PC; the original **ANDROID NEARBY** remains the default for Bluetooth/Wi-Fi Direct. Windows offers only LAN. Switch modes only before joining/hosting, never mid-race.
- The LAN wire protocol is `TF_LAN_1`; neither discovery nor TCP frames contain trusted track data. Bound packets to 16003 decoded bytes and frames to 24000 bytes, and validate on the existing track/race application boundary.
- Advertisements contain room name only (`Room ####` or `Track ####`). Discovery replies carry the host IP and fixed TCP port. Android acquires a scoped Wi-Fi `MulticastLock` while hosting to receive broadcast discovery requests, releasing it on exit.
- **JOIN BY IP** is available in the LAN scanner on Windows and Android: enter the host device’s private IPv4 address (displayed in the host room, when detectable) to establish direct TCP without discovery packets. It works even if Wi-Fi broadcast is filtered, but not if TCP 47832 is blocked or the router isolates devices.
- If no rooms appear: confirm **LOCAL WI-FI** on Android (not ANDROID NEARBY); check host IP/subnet, and Windows Defender Firewall *Private network* permission for the current `TrackForge.exe`. Hosting uses incoming UDP 47831 for discovery and incoming TCP 47832 for racing; do not port-forward these to the internet. Some routers isolate wireless clients on guest networks.
- TCP uses `TCP_NODELAY` for small pose packets. This initial implementation favors reliable ordering and can still exhibit head-of-line stalls on congested Wi-Fi. Follow up with measured packet/latency/loss traces before considering best-effort UDP poses. No transport claims determinism in live radio conditions.

## Behavior and lifecycle

The host accepts up to seven guests. A two-sided pairing handshake must complete before data traffic. Local acceptance is marked after the ACK is written under the outbound TCP write lock (both Android and Windows). The reader synchronizes with an in-flight acceptance before interpreting early data. Windows explicitly puts each accepted TCP socket in blocking mode, independent of the nonblocking listener. Both native diagnostic reports preserve a bounded, 64-entry handshake trace of frame directions, acceptance, and sanitized disconnect reasons across stop; a new host/scan clears it. No payload, endpoint ID or room name is added to that trace. A host acceptance skipped or failed because its peer disappeared is recorded as such, not as success. A guest leaving during host auto-accept is recorded as a per-peer drop, never a fatal room failure; actual rejection, malformed frames, disconnects and race exit close the affected socket. `lock` stops admitting peers once a race starts, while established connections survive cup rounds and rematches. Android plugin registration is additive; Android Nearby is untouched. Android currently targets SDK 36, so Android 17's new local-network runtime permission is not required for this release. **When raising targetSdk to 37+, explicitly add and request ACCESS_LOCAL_NETWORK** or LAN discovery/TCP will be blocked. Native LAN code must remain compatible with minSdk 24. Tauri `io.trackforge.desktop` identity and browser storage persist without migration.

Both native hosts bind all local IPv4 interfaces; their listening port is not exposed publicly by TrackForge. This transport is intended only for trusted local networks. Do **not** forward TCP port 47832 to the internet; authentication/encryption would be required for internet play.

## Remote car presentation

Both transports share a receiver-local interpolation buffer. Start at 100 ms,
then adapt between 50 and 150 ms using smoothed actual arrival gaps and jitter.
Grow quickly when updates are irregular, shrink gradually on a healthy stream,
and never rewind the presentation clock when the buffer grows. Existing recovery
cuts, bounded extrapolation and two-second expiry remain unchanged. Verify on
matched device captures; synthetic timing tests are not radio latency evidence.

## Validation

CI: JavaScript transport-selection/component regression tests, TypeScript/lint, Android native unit/compile, Windows Rust release compile and executable upload. A manual end-to-end acceptance matrix is needed to confirm radio discovery, firewall prompts and real race feel:

1. Windows host → Android join, and Android host → Windows join, on the same Wi-Fi. Verify automatic discovery, then deliberately block UDP broadcasts and use JOIN BY IP to connect via TCP 47832. Check missing host address guidance and invalid/public IP rejection.
2. Race and rematch with accurate checkpoint progress and visible rival cars; export network diagnostics from both.
3. Share a track PC → Android and Android → PC. Test a multi-track nearby cup and three-player room.
4. Disconnect Wi-Fi during lobby and during race; ensure clean peer teardown and responsive Back. Reopen a room immediately without lingering port binding. Verify the Android Wi-Fi discovery lock is released after closing the host.
5. Android **ANDROID NEARBY** mode must still race with a second Android device without shared Wi-Fi.
6. Restart/replace the EXE; saves and profiles survive. Verify layout fills a widescreen desktop and keyboard input works.

The LAN transport is local-only; it is *not* an internet multiplayer server. Rollback removes the native LAN adapters and connection selector while preserving the prior Android Nearby plugin and desktop offline game.
