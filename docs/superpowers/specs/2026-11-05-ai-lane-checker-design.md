# AI lane checker

Build a developer tool to find AI path bugs quickly, without rendering the game.
Use the production `stepRace` at 60 Hz, seeded randomness, normal start placement,
and real collision, road support, progress and recovery behavior. Convert the
player slot to AI so a stationary player does not distort traffic tests.

Approaches considered: a live dots overlay is convenient for one race but still
waits on real time; browser acceleration still initializes the renderer; a Node
batch runner uses the existing pure engine directly. Choose the Node runner and
a self-contained HTML report with SVG dot trails. No additional dependencies.

Run solo or traffic scenarios, forward or reverse, on supplied track JSON or
starter/hairpin/bridge fixtures. Each run records seed, options, per-car metrics,
sampled positions, and exact time/location/road section for findings. Sustained
off-road, excessive target-lane error, reverse motion and lack of progress are
diagnostic warnings; invalid numerical state, invalid planned lane, implausible
route jumps, automatic recovery and failure to finish within the budget are
errors. Report recoveries explicitly in the production event stream so resets
cannot hide failures. Brief deviations and legitimate lane changes are allowed.
Inspect the finishing step and exclude subsequent samples/events from checks.
Fit report maps to actual recorded coordinates, including translated tracks.
Before compiling imported geometry, validate raceability except length and
bound authored controls to 2,000 and estimated curve samples to 10,000. Then
compile and validate actual length. These budgets apply only to this QA tool.

Default run: starter, normal difficulty, both directions, traffic, three seeds,
one lap, at most 60 simulated seconds. Rendering is completely absent; timestep
is never enlarged for speed. Reports are deterministic; wall-clock throughput
is printed separately. JSON and HTML are written to ignored `qa/results/lanes`.
Normal diagnostic runs exit successfully even when AI problems are found;
`--strict` makes error findings fail CI. Invalid input always fails.

The checker diagnoses behavior; it does not retune AI or change gameplay. Solo
tests separate driving faults from traffic behavior. SVG dots are a static path
record rather than an interactive replay or Android debug UI.
