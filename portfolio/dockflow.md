# Dockflow

## Inbound shift planning

[Try the public demo](https://dockflow-inbound-lab-olami-1110.boileditem.chatgpt.site) · [View the source](https://github.com/olamitisoji/product-portfolio/tree/main/dockflow) · [View automated checks](https://github.com/olamitisoji/product-portfolio/actions/workflows/dockflow.yml)

**My role** · Product design and AI-assisted implementation of the public simulator

### The operational question

During my Amazon operations internship, I worked on sorter first-pass yield, the share of packages that reach their intended destination on their first pass. A package that misses a chute takes up belt capacity again. The first question at the dock was which freight was due for the next pickup. The next was where that freight would go once we unloaded it.

### What I built on site

I completed a consolidated inbound heatmap that brought trailer status, pickup deadlines and package destinations together. Shift leads could compare what was at the doors with what was in the yard and what was still coming. They could see when an incoming trailer would feed an area already carrying a heavy workload. The door suggestion feature went into pilot.

### What I rebuilt

I used fictional manifests, an original facility layout and independent operating rules to recreate those decisions in Dockflow. A shift lead can drill from a pickup window to an individual trailer, see the mix going to each destination, and compare possible doors with the existing door plan and physical occupancy.

I gave a shift lead two ways to read the floor. A timestamped fictional shift record shows how much work has been counted against the target at that point in the shift. The capacity view looks ahead. It compares forecast demand with the current crew and chute allocation, then recalculates the shortfall if the lead moves resources between areas. Approval and undo are features I added for the public demo so visitors can try an assignment and inspect the change in the plan.

I built **Ask Dockflow** to answer questions about a sample shift using the current manifest, pickup window and capacity forecast, with citations a shift lead can inspect before making a decision.

### Walk through a shift

1. Choose a pickup window and compare packages assigned to that pickup with the total packages inside those trailers.
2. Select a trailer in the heatmap. Inspect the destinations it serves and compare an available door with the planned door or an occupied alternative.
3. Check the timestamp on the shift record and compare counted progress with its target. Then compare forecast demand with baseline capacity. Try moving staff or chutes and see which area becomes constrained.
4. Approve an eligible assignment, check the new physical occupancy, then undo it.

### How I would evaluate it

I would compare first-pass yield across shifts with a similar freight mix and record why operators accepted or overrode each suggestion. That would help distinguish an improvement in sorting from a shift that happened to receive easier freight.

### Technical documentation

- [Design decisions](../dockflow/docs/DESIGN.md)
- [Verification record](../dockflow/docs/VERIFICATION.md)
- [Setup and learning guide](../dockflow/README.md)

[Back to portfolio](README.md)
