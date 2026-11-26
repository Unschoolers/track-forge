# Cup mode — track lists and multiplayer rounds

## Player contract

- The Home menu has one **CUP** entry. It opens a builder, not a race.
- Add any race-ready saved/official track, move entries up/down, or remove them. Repeats are allowed.
- A lineup has 0–12 entries while editing; starting requires 1–12 valid tracks.
- The builder offers an explicit **Load Curated Cup** preset: Playroom Clover for tight turns,
  Harbor Grid for speed and braking, and the official point-to-point Rally finale. Loading the
  preset replaces the editable lineup while an unfinished Cup keeps its frozen original lineup.
- A point-to-point Cup round is a single run, as in other race modes; circuit rounds keep their
  existing single-lap Cup format. The four legacy official circuits remain the default lineup.
- The **last built lineup** is remembered on this device. There is no Cup save-preset library.
- **Start new Cup** uses the current lineup. An unfinished **Resume Cup** continues with the
  original lineup, even if the player has edited the builder after starting.
- Each solo Cup race retains existing 10/6/4/2 placement scoring; Cup checkpoints and best placement
  are saved. The original four official tracks remain the default/legacy sequence.

Solo Cup rounds open on the real starting grid. The countdown identifies the
round and track, and the curated stages describe the section to watch for.
When dynamic zoom is enabled, the camera starts wider and settles before GO.
Reduced-motion mode uses the regular race framing.

## Nearby Cup

- From **Nearby Race → Host Cup** or the Cup builder, the host opens one Nearby room
  using the current ordered lineup. Guests find/join it the usual way.
- Entering from Nearby makes **Host Nearby Cup** the primary action; entering
  from Home keeps **Start New Cup** primary. Adding or cancelling a track
  preserves the entry context, including the Back destination. Solo resume
  and start remain available as secondary actions when hosting.
- The host starts round one once guests join. After all participants finish, **Next Cup Race**
  sends the next track to everyone via the existing reliable prepare/track-transfer lifecycle;
  the room is not dropped between rounds.
- Each participating slot earns 10/6/4/2 points per finish place, with DNF/left earning no points.
  Cumulative standings appear in the results view on each device; the final round ends the Cup
  and does not offer another rematch. Single-race Nearby mode remains available.
- The reliable `prepare` message optionally carries bounded `cupIndex` and `cupTotal`; absent
  fields identify existing single-race rooms. Each peer calculates scores from received finish
  events. All-round state is transient and cleared when leaving/disconnecting. No online Cup
  history or synchronized Cup preset is stored.

## Storage and compatibility

`trackforge-cup-v1` keeps the `version: 1` envelope with an optional `lineup` array.
The solo checkpoint may contain frozen `trackIds`; older checkpoints without `trackIds`
resolve to the original four official tracks. Malformed or oversized stored lineups reset to the
default; an intentionally empty lineup is preserved. A removed/invalid track prevents starting
or resuming that Cup until the lineup is corrected (or a new Cup is built).

## Regression checks

- `tests/domain/circuitCup.test.ts`: custom sequence, scoring and bounds.
- `tests/infrastructure/cupRepository.test.ts`: last built lineup, empty lineup and legacy migration.
- `tests/ui/cupModal.test.ts`: edit actions and disabled start for empty lineups.
- `tests/application/nearbyRace.test.ts`: two rounds in one room, cumulative points, final cutoff.
- `tests/application/nearbyControlProtocol.test.ts`: bounded metadata.
- `qa/browser/cup-progress.spec.mjs`: reload/resume and final standings in a mobile viewport.
