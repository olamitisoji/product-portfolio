# Dockflow verification

Updated November 23, 2026. The simulator uses fictional trailers, manifests, shift counts and capacity assumptions.

## Automated checks

Run `npm test` and `npm run typecheck` from the Dockflow directory. The November 23 run passed all 48 tests and the TypeScript check.

| Decision | Cases covered |
| --- | --- |
| What needs to move before pickup? | Current and next windows, deadlines at the phase boundaries, due units versus total load, location, late arrivals, holds and stable ordering. |
| Where can this load go? | Package counts reconcile with a known manifest. Missing size measurements remain distinguishable from zero. Actual occupancy, reported preassignment, immediate proposals and conditional targets have distinct behavior. Approval rechecks eligibility. |
| Can the sort floor absorb the load? | Known demand, excluded freight, partial hours and legacy inputs. A transfer preserves the number of chutes or crew members and changes the capacity at both ends. |
| What actually happened this shift? | The report uses the latest available observation at or before the clock. First-pass yield requires a valid denominator. Moving resources in a forecast leaves recorded counts intact. |
| Will a saved shift reopen safely? | Import validation, legacy snapshots, repeatable fixtures, CSV escaping, queue modes and uniform door constraints across multiple scenarios. |

The analyst endpoint tests use a mocked provider and the actual quota migration in SQLite. They check that 36 simultaneous requests can trigger at most 30 provider calls, that the budget rolls over at midnight UTC, that an unavailable budget blocks a call, and that a response with a missing citation is suppressed. Tests also compare evidence with the active shift, cover all three generated presets and check rejection of unsupported identities. These automated tests exercise integration behavior separately from the live provider.

## Reproduce a decision

In the standard shift with seed 42, inspect TR-103. Its preassigned door A-01 is occupied. The simulator offers A-02. Accept it and check physical occupancy, then use Undo. Change the pickup window and compare the work due. On the sort floor, move one chute from North to Central. The simulated total shortfall falls from 217 to 127 packages and crew becomes the limiting resource in Central.

These interactions were checked in the browser. The trailer detail view was also checked at phone width, where the manifest scrolls inside its panel.

## Scope of the evidence

The simulator keeps assignments and history in the visitor's browser. Its results cannot establish real shifts' throughput, staffing needs, operating savings or a causal improvement in first-pass yield.
