# Cross-platform LAN nearby multiplayer

## Players and transport

- Windows + Android, Windows + Windows, and Android + Android over the **same Wi-Fi / LAN**.
- No cloud server or account. The host opens TCP port 47832; room discovery uses UDP broadcast/response on port 47831. Both adapters send bounded newline-delimited JSON frames with a byte payload in Base64.
- Host/scan/pairing/connected/packet/disconnected/lock/stop mirror the existing `NearbyTransport` port. The authoritative `NearbyRace`, checkpoint/progress packets, transfer validation, replay and race state machines are unchanged.
- Android users choose **LOCAL WI-FI** to join a Windows PC; the original **ANDROID NEARBY** remains the default for Bluetooth/Wi-Fi Direct. Windows offers only LAN. Switch modes only before joining/hosting, never mid-race.
- The LAN wire protocol is `TF_LAN_1`; neither discovery nor TCP frames contain trusted track data. Bound packets to 16003 decoded bytes and frames to 24000 bytes, and validate on the existing track/race application boundary.
- Advertisements are room name only (`Room ####` or `Track ####`). Discovery responses reflect the hosting device IP and fixed TCP port. Local firewall and router client isolation can block discovery even on the same SSID; check both devices use the same subnet and Windows allows TrackForge.
- TCP uses `TCP_NODELAY` for small pose packets. This initial implementation favors reliable ordering and can still exhibit head-of-line stalls on congested Wi-Fi. Follow up with measured packet/latency/loss traces before considering best-effort UDP poses. No transport claims determinism in live radio conditions.

## Behavior and lifecycle

The host accepts up to seven guests. A two-sided pairing handshake must complete before data traffic; rejection, malformed frames, disconnects, and race exit tear down the socket. `lock` stops admitting peers once a race starts, while established connections survive cup rounds and rematches. Android plugin registration is additive; Android Nearby is untouched. Android currently targets SDK 36, so Android 17's new local-network runtime permission is not required for this release. **When raising targetSdk to 37+, explicitly add and request ACCESS_LOCAL_NETWORK** or LAN discovery/TCP will be blocked. Native LAN code must remain compatible with minSdk 24. Tauri `io.trackforge.desktop` identity and browser storage persist without migration.

Both native hosts bind all local IPv4 interfaces; their listening port is not exposed publicly by TrackForge. This transport is intended only for trusted local networks. Do **not** forward TCP port 47832 to the internet; authentication/encryption would be required for internet play.

## Validation

CI: JavaScript transport-selection/component regression tests, TypeScript/lint, Android native unit/compile, Windows Rust release compile and executable upload. A manual end-to-end acceptance matrix is needed to confirm radio discovery, firewall prompts and real race feel:

1. Windows host → Android join, and Android host → Windows join, on the same Wi-Fi. Verify both devices find the room and enter the lobby.
2. Race and rematch with accurate checkpoint progress and visible rival cars; export network diagnostics from both.
3. Share a track PC → Android and Android → PC. Test a multi-track nearby cup and three-player room.
4. Disconnect Wi-Fi during lobby and during race; ensure clean peer teardown and responsive Back. Reopen a room immediately without lingering port binding.
5. Android **ANDROID NEARBY** mode must still race with a second Android device without shared Wi-Fi.
6. Restart/replace the EXE; saves and profiles survive. Verify layout fills a widescreen desktop and keyboard input works.

The LAN transport is local-only; it is *not* an internet multiplayer server. Rollback removes the native LAN adapters and connection selector while preserving the prior Android Nearby plugin and desktop offline game.
