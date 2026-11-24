# Multiplayer ready lobby

Every new race, retry, changed circuit and Cup round is proposed by the host. The existing room stays connected. Track transfer validates the course before a guest enters the lobby; downloading the track is not consent. Each player chooses a car (duplicates allowed), sees the standard car specifications and explicitly readies up. Previous cars persist, consent resets per round. All players cancel their consent before changing a committed car; guests additionally wait for host acknowledgement. the host locks the lineup atomically when all current participants have accepted. The existing scene-ready handshake remains independent of consent.

Protocol v4: ready messages carry accepted and a monotonically increasing choice counter per round; host roster messages carry a revision. Older clients fail the existing version gate. Pose/progress packet formats do not change. Only the host proposes a course, owns roster membership and stages the lineup. Stale round/revision packets must not unlock or start a race.

Validation: multiplayer component/in-memory network tests, control decoder, application navigation, mobile UI and full CI. Real Android and Windows device pairing and multi-round readiness remain device QA requirements.

Lobby navigation: Close, Back and Escape use the same controller-owned leave confirmation for connected races, including rematches and Cup rounds. Stay (or dismiss the confirmation) retains the connection, selected car and consent; only explicit Leave disconnects. Hosting warns that leaving closes the room for everyone. An incoming race start or disconnect supersedes the confirmation rather than trapping the player in a stale dialog.

Presentation: portrait uses a single column; at 640 CSS pixels and wider the car picker and compact eight-player roster sit side by side. The footer remains visible while the body scrolls. Ready is shown in green only after host confirmation, with explicit confirming/updating/choosing/loading states. The selected car remains highlighted while locked. Course metadata includes lighting, laps and Cup round. No new wire fields or physics changes.
