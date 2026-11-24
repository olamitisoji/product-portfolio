# Sortward shift workflow

The shift lead starts with a trailer’s package mix, identifies the time-sensitive work, checks the proposed door, then looks downstream at the sort floor. All views read the same fictional facility and trailer state. Sortward uses independent rules for its public demonstration.

## Facility plan and active trailers

New examples use a 600,000-package weekly planning target. Seven operating days and two 12-hour shifts per day are scenario assumptions. The same plan supplies the average shift target and the hourly pace. The manifests represent the active trailer decisions at one point in time. Forecast demand uses its own one-hour horizon and eligibility rules. The timestamped shift report describes counted fictional progress against the facility plan.

Older snapshots can lack a facility plan. They retain their saved counts and resources. The overview offers a current example that can be undone.

## Manifest and destination heatmap

The initial presets contain twelve trailers, three destinations, six ordinary doors and a dedicated transfer door. Each trailer has its handling category, total volume, two disjoint deadline buckets, status, arrival time, destination profile and any preassigned or physical door.

A known destination profile must allocate the full load across the three zones. New seeded manifests also include compact, standard and bulky counts for each destination. Choosing a size in the heatmap changes the counts displayed in the destination columns. Cell intensity represents the selected destination’s share of the selected size on that trailer. The adjacent deadline counts always refer to all sizes.

The optional size matrix is compatible with existing version 1 snapshots. Every supplied size count must be a nonnegative integer and the three values for a destination must sum to its destination count. Absent size data stays absent. Unmapped destination profiles carry zero allocated units and no size breakdown or profile timestamp. A newly generated scenario provides fictional manifest detail; refreshing a timestamp does not supply missing measurements.

The heatmap groups trailers by physical state. An expected trailer can have a preassignment without occupying the door. Completed loads retain their manifest rows and drop out of active work totals. An occupied door remains occupied even if the load is held, has a handling mismatch or shares a reported location with another load.

Each of the three fictional zones has 200 fixed destination chutes. Generated sorter manifests allocate each known zone total to particular chutes. A chute’s share uses the selected package volume headed for the sorter, including packages missing chute detail. Crossdock transfers bypass the sorter. Adding routed, unmapped and bypassed packages recovers the total manifest volume. An older manifest can identify a zone without specifying any chutes. Manifest allocations describe intended destinations. The simulator has no arrival scans at individual chutes.

## Pickup priorities

The operator can inspect the current or next pickup window. Its package backlog is split between docked trailers, the yard and expected arrivals. Held and blocked work stays visible in the backlog. An expected load arriving at or after cutoff carries a timing warning.

The independent demo policy ranks onsite work before unarrived work. While the selected pickup is open, higher due-unit counts come first. In the final 45 minutes the share of each load due in the window takes precedence. Once overdue, arrival order leads within onsite work. Arrival time, volume and stable trailer IDs resolve ties according to the selected phase. Expected loads are ordered by expected arrival. The simulated clock advances within a single day and moves arrivals into the yard when due.

Pickup review and door dispatch use separate policies. The dispatch queue can be compared under deadline priority or arrival order. Under deadline priority, current-bucket freight is considered first, then next-bucket and other positive-volume work. Completed and empty loads do not generate proposals.

## Door review

Ordinary placements require both a compatible handling category and one of the trailer’s largest destination zones. Tied zones can both qualify. Crossdock freight requires an enabled transfer door. New executable proposals require a yard trailer with positive freight, a profile at most 60 simulated minutes old, a completed arrival and no planning hold.

The allocator checks real occupancy in the scenario before ranking feasible doors. It ranks by destination share, projected zone workload and door ID. The workload ratio divides packages already physically at ordinary doors in that zone, earlier proposed load volumes and the arriving trailer’s full volume by the configured zone capacity. Primary proposals are unique in a given queue. Alternatives exclude every final primary door.

In the heatmap, **preassigned** is the incoming advisory plan. **Proposed** identifies an available placement for a yard trailer. **Planning target** identifies a compatible door to revisit on arrival or after another load clears. Multiple future loads can refer to the same conditional target. Conditional rows never reserve or authorize a move. **Current door** is the trailer’s observed physical location. The board flags disagreement with an advisory plan and recorded handling, destination or physical-location conflicts.

Operator approval rechecks current feasibility. An alternative door requires an explanation. Approving or marking a load unloaded creates a local audit event. A planning hold excludes new assignments and leaves physical occupancy intact. Undo restores the previous scenario.

## Sort floor

Floor planning considers the next hour, bounded by the end of the simulated day. For each destination it adds eligible onsite freight and expected freight that can arrive within that horizon. Held loads, transfer freight, stale and unmapped profiles are tracked as exclusions. Known package sizes and volume without size detail are shown separately.

The weekly facility scenario allocates 25 staffed processing positions and 22 crew across the three floor zones. For the selected horizon each pool produces a package limit based on its own hourly rate. The smaller limit determines zone capacity. Unserved demand is the positive difference between forecast package count and capacity. Reallocating one staffed position or crew member preserves the size of each resource pool. The 600 physical destination chutes have fixed identities independent of these allocations.

## Shift analyst

The server rebuilds the facts for the active screen from the fictional manifest, map filters, pickup and proposed staffing. The OpenAI Responses API receives the operator’s question, recent questions and verified record references. It returns an answer and citation IDs using a structured response. The server resolves each citation to its underlying fact. The model can explain choices and constraints. The operator approves changes.

For destination questions, the server provides active manifest coverage, crossdock bypass volume and the highest known chute volume in each zone. An exact chute ID in the question adds a record for that destination. Each chute record names up to three contributing trailers and reports its share of active sorter volume.

The worker reserves each model call with a single conditional D1 write before contacting the provider. Concurrent requests share the same daily budget, including failed provider attempts. D1 stores the date and count. The Responses request sets `store: false`. Sortward keeps the conversation in browser memory and accepts only sample facility and trailer identities for analysis.

## Implementation

- [Manifest, door and scenario types](../lib/dock-types.ts)
- [Seeded scenarios](../lib/dock-fixtures.ts)
- [Physical chute routing and trailer contributions](../lib/chute-routing.ts)
- [Validation, queue evaluation, door review and simulated actions](../lib/dock-engine.ts)
- [Pickup window review](../lib/shift-priorities.ts)
- [Sort-floor demand and capacity](../lib/sort-floor.ts)
- [Dashboard entry point](../components/dock-dashboard.tsx)

Scenario JSON accepts up to 100 trailers and 30 doors in three named zones. Numeric counts are validated, known profiles reconcile to trailer volume, and references must point to known doors. The parser rejects invalid input before replacing the current browser state. CSV and JSON export provide shareable synthetic snapshots.

The [verification record](VERIFICATION.md) documents exercised workflows and their limits. The public simulator models local actions with fictional data. Measured operating outcomes would require independent evidence from the operation being evaluated.
