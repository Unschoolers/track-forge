# Multiplayer ready lobby

Every new race, retry, changed circuit and Cup round is proposed by the host. The existing room stays connected. Track transfer validates the course before a guest enters the lobby; downloading the track is not consent. Each player chooses a car (duplicates allowed), sees the standard car specifications and explicitly readies up. Previous cars persist, consent resets per round. Guests cancel their consent and wait for the host acknowledgement before changing a committed car; the host locks the lineup atomically when all current participants have accepted. The existing scene-ready handshake remains independent of consent.

Protocol v4: ready messages carry accepted and a monotonically increasing choice counter per round; host roster messages carry a revision. Older clients fail the existing version gate. Pose/progress packet formats do not change. Only the host proposes a course, owns roster membership and stages the lineup. Stale round/revision packets must not unlock or start a race.

Validation: multiplayer component/in-memory network tests, control decoder, application navigation, mobile UI and full CI. Real Android and Windows device pairing and multi-round readiness remain device QA requirements.
