<a id="dockflow"></a>

# Sortward

## Inbound shift planning

[Read on my portfolio](https://soji-agboola-portfolio.boileditem.chatgpt.site/work/sortward/) · [Try the public demo](https://dockflow-inbound-lab-olami-1110.boileditem.chatgpt.site/?example=chutes#chute-map) · [View the source](https://github.com/olamitisoji/product-portfolio/tree/main/dockflow) · [View automated checks](https://github.com/olamitisoji/product-portfolio/actions/workflows/dockflow.yml)

**My role** · Product design and AI-assisted implementation of the public simulator

### The operational question

During my Amazon operations internship, I worked on sorter first-pass yield, the share of packages that reach their intended destination on their first pass. A package that misses a chute takes up belt capacity again. The first question at the dock was which freight was due for the next pickup. The next was where that freight would go once we unloaded it.

### What I built on site

I completed a consolidated inbound heatmap that brought trailer status, pickup deadlines and package destinations together. Shift leads could compare what was at the doors with what was in the yard and what was still coming. They could see when an incoming trailer would feed an area already carrying a heavy workload. The door suggestion feature went into pilot.

### What I rebuilt

I used fictional manifests, an original facility layout and independent operating rules to recreate those decisions in Sortward. A shift lead can drill from a pickup window to an individual trailer, see the mix going to each destination, and compare possible doors with the existing door plan and physical occupancy.

The fictional facility plans for about 600,000 packages per week. Across two shifts a day and seven operating days, that works out to about 42,857 packages per shift. The heatmap shows the subset of trailers under review at that moment. A timestamped shift record shows how much work has been counted against the target at that point in the shift. Each zone has 200 fixed destination chutes. Select one to see the packages scheduled for it and which trailers carry them. The capacity forecast shows where a shortfall remains after reassigning crew members or processing positions. Approval and undo are features I added for the public demo so visitors can try an assignment and inspect the change in the plan.

### A decision the analyst can help with

“If I move one staffed position, where would it help most, and what would it cost the zone it came from?” I wanted a shift lead to be able to ask both halves of that question. Sortward calculates the effect of each possible move. The AI uses those comparisons to answer in plain language and cites the records an operator can check.

In the 10:00 sample shift, the analyst suggested moving one staffed position from North to Central. The forecast shortfall for freight with known destinations fell from 276 to 216 packages, and North still had enough capacity for its known load. Another 829 packages had missing or outdated destination profiles. I made that count visible alongside the answer because it could change the staffing decision.

![The live Sortward analyst compares a staffing move from North to Central. The panel flags 829 packages with incomplete routing data.](images/sortward-shift-analyst.jpg)

### Walk through a shift

![Sortward’s shift desk showing package volume by destination chute and a door proposal for the selected trailer.](../website/dist/assets/dockflow.jpg)

1. Choose a pickup window and compare packages assigned to that pickup with the total packages inside those trailers.
2. Select a trailer in the heatmap. Inspect the destinations it serves and compare an available door with the planned door or an occupied alternative.
3. Check the timestamp on the shift record and compare counted progress with its target. Then compare forecast demand with baseline capacity. Try reassigning crew members or processing positions and see which area becomes constrained.
4. Approve an eligible assignment, check the new physical occupancy, then undo it.

For a quick check of the analyst, filter the heatmap to **Expected** and compare chutes B090 and B091. At 10:00, trailer TR-109 accounts for all 107 packages headed to B090 and all 76 headed to B091. Ask “How many more is it sending to the first?” to see it follow the comparison across questions.

### How I would evaluate it

I would compare first-pass yield across shifts with a similar freight mix and record why operators accepted or overrode each suggestion. That would help distinguish an improvement in sorting from a shift that happened to receive easier freight.

### Technical documentation

- [Design decisions](../dockflow/docs/DESIGN.md)
- [Verification record](../dockflow/docs/VERIFICATION.md)
- [Setup and learning guide](../dockflow/README.md)

[Back to portfolio](README.md)
