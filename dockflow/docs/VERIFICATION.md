# Sortward verification

Reviewed November 23, 2026. The simulator uses fictional trailers, manifests, shift counts and capacity assumptions.

## Automated checks

Run `npm test` and `npm run typecheck` from the app directory. The November 23 run passed the automated suite, the TypeScript check and lint.

| Decision | Cases covered |
| --- | --- |
| What needs to move before pickup? | Current and next windows, deadlines at the phase boundaries, due units versus total load, location, late arrivals, holds and stable ordering. |
| Where can this load go? | Package counts reconcile with a known manifest. Missing size measurements remain distinguishable from zero. Actual occupancy, reported preassignment, immediate proposals and conditional targets have distinct behavior. Approval rechecks eligibility. |
| Which destinations will receive these packages? | Chute totals reconcile to each trailer and zone. Missing routes, zero volume, inbound status filters and contributing trailers are exercised against synthetic manifests. |
| Can the sort floor absorb the load? | Known demand, excluded freight, partial hours and legacy inputs. A transfer preserves the number of processing assignments or crew members and changes the capacity at both ends. |
| What actually happened this shift? | The report uses the latest available observation at or before the clock. First-pass yield requires a valid denominator. Moving resources in a forecast leaves recorded counts intact. |
| Will a saved shift reopen safely? | Import validation, legacy snapshots, repeatable fixtures, CSV escaping, queue modes and uniform door constraints across multiple scenarios. |

The analyst endpoint tests use a mocked provider and the quota migration in SQLite. They check concurrent requests against the shared budget, its rollover at midnight UTC, and a database failure that prevents a provider call. They also cover missing citations, all three generated presets and rejection of unsupported identities. [Passing release run with 75 tests, type checking and a production build](https://github.com/olamitisoji/product-portfolio/actions/runs/45324160422)

## Reproduce a decision

In the standard shift with seed 42, inspect TR-103. Its preassigned door A-01 is occupied. The simulator offers A-02. Accept it and check physical occupancy, then use Undo. Change the pickup window and compare the work due. On the sort floor, move one processing assignment from North to Central. For the weekly plan of 600,000 packages, the simulated total shortfall falls from 276 to 216 packages and crew becomes the limiting resource in Central.

The desktop check covered selecting from the matrix, opening the properties panel, zoom, and reviewing a door. The mobile check covered the 600,000-package example, Undo to restore an earlier snapshot, section navigation, and a capacity transfer. The trailer detail view was also checked at phone width, where the manifest scrolls inside its panel.

## Trace a chute

The balanced example with seed 42 has 5,903 active packages. Its floor map shows 5,014 assigned to individual chutes, 551 bypassing the sorter as transfer freight and 338 with missing routing data. Select A121 to see 180 assigned packages. TR-103 contributes 127 and TR-111 contributes 53. Select TR-106 in the trailer filter to see a transfer that bypasses the floor, or TR-107 for a missing manifest. These values describe inbound manifest destinations. Individual arrival scans are unavailable.

The mobile check covered a zone's last bank, an empty chute and expected-only arrivals. The shared chute example uses tab storage, so exploring it preserves the browser's ordinary saved shift.

## Product review

On the published demo, we filtered the balanced shift to expected arrivals at 10:00 and asked the live analyst to compare B090 and B091. It identified TR-109 as the source of all 107 and 76 packages respectively. A follow-up referring to “both of those chutes” returned the same trailer and the difference of 31 packages.

On the sort floor, the live analyst identified a North-to-Central staffing move that reduced the projected shortfall for mapped freight by 60 packages. The panel flagged 829 packages with missing or outdated destination profiles. The operator could inspect the cited records before changing the plan. [Published analyst screenshot](../../portfolio/images/sortward-shift-analyst.jpg)

At 11:00, 4,410 packages have stale profiles and 338 have missing routing data. The next-hour forecast cannot give a shortfall until usable profiles return. On the overview, Central has 2,078 sorter-directed packages against a capacity of 2,500. The 375 Central packages on the crossdock trailer bypass the sorter.

## Scope of the evidence

The simulator tracks active inbound freight until the operator records the trailer as unloaded. Downstream work awaiting sort and scan-confirmed arrivals are outside the current model. The simulator keeps assignments and history in the visitor's browser. Its results cannot establish real shifts' throughput, staffing needs, operating savings or a causal improvement in first-pass yield.
