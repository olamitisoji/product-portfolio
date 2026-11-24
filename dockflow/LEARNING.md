# Understanding Sortward

Start with one row in the destination heatmap. It represents a trailer and shows where its packages are going. Compare its reported preassignment with the door review, then select the trailer to inspect the decision.

## Read the heatmap

The three destination cells count packages on that trailer. A darker cell means that destination accounts for a larger share of the packages in the same row. Choosing a single size, such as bulky, changes both the counts and the shading. A dash means the manifest lacks that detail. A zero is a supplied count. The two deadline counts always apply to the full trailer.

A trailer can be at a door, in the yard, expected or completed. Completing an unload moves the trailer into the completed group. The row retains its original manifest for inspection.

Look up a chute such as B015 to see which active trailers have packages scheduled for that destination. A count of zero means no packages in the available routes name that chute. Packages headed for the sorter with missing destination details stay in the unmapped total. Crossdock freight goes directly to transfer and appears in the bypass total. Arrival at a chute would require a scan, which this simulation does not record.

## Choose a pickup window

The pickup board answers which freight is due and whether it has arrived. Selecting the next window uses that window’s package counts. The view groups current backlog into docked, yard and expected work. The order changes as time runs short. The source for this fictional policy is [shift-priorities.ts](lib/shift-priorities.ts).

Open **Sort floor** to see which zones can absorb the next hour’s forecast. A zone with enough crew can still run short of staffed processing positions. Reallocate a position or a crew member and compare the forecast shortfall in both zones. Physical chute locations stay fixed. The calculation lives in [sort-floor.ts](lib/sort-floor.ts).

## Review a door decision

A preassigned door is an advisory from the scenario. It can disagree with the local recommendation. The simulator checks handling, destination mix, enabled doors and occupancy. It also checks the trailer’s arrival, hold and profile age.

A **proposed** door can be reviewed for a yard trailer. A **planning target** can help an operator prepare for an incoming load or a future opening. It never acquires the door. A **current door** records physical occupancy, including a trailer that is on hold or in the wrong location. When the profile is missing or stale, the row says what needs review.

## Change the shift

Approving an assignment rechecks the door and records a local action. Completing an unload releases the door. Changing a hold, advancing the clock or adjusting a door changes the same scenario. React redraws the views from that current state.

Undo retains up to 30 previous snapshots in the current page session. Reloading restores the saved scenario and action history in the same browser. JSON export creates a snapshot for later import. Older version 1 imports may have destination counts and no package-size breakdown. The parser preserves that distinction.

## Explore the code

[**dock-types.ts**](lib/dock-types.ts) defines the fields used throughout the simulator. [**dock-engine.ts**](lib/dock-engine.ts) validates imported data, computes feasible doors and rechecks assignments at approval. The [tests](tests) exercise the kinds of cases a shift lead runs into, including occupied doors, missing manifests and a trailer due before it can arrive.

Try loading the disruption preset. Inspect a docked trailer with an incompatible handling assignment, then a yard trailer with an older profile. Notice that both require attention for different reasons and the occupied door stays occupied.
