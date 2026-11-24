# Sortward

[Open Sortward](https://dockflow-inbound-lab-olami-1110.boileditem.chatgpt.site) · [Automated checks](https://github.com/olamitisoji/product-portfolio/actions/workflows/dockflow.yml)

A shift lead has several decisions to make before a trailer unloads. Where do its packages need to go? How much is due in the next pickup? Can the suggested door take this freight? Where will the team need more people? Sortward connects these decisions in an independent simulator built with fictional manifests, door rules and staffing assumptions.

## Try a shift

1. Open the destination heatmap. Read across one trailer to see its deadline volumes, package counts by destination, preassigned door and suggested placement. Filter by location or package size to see a different slice of the same manifest.
2. Switch pickup windows to see due packages broken out by trailers on a door, in the yard and still expected. Advance the simulated clock to see arrival and priority changes.
3. Inspect a trailer whose proposed door differs from the preassignment. A waiting trailer can receive an open, compatible door. An expected load or a trailer waiting for a compatible door to clear can have a planning target for later review.
4. Accept a simulated assignment. Its door becomes occupied and the heatmap updates. Mark the trailer unloaded to release the door, or use Undo to return to the previous state.
5. Open **Sort floor** to see where the next hour’s freight exceeds chute or crew capacity. Move a chute or a crew member between destinations and compare the remaining shortfall.

The package-size cells come from synthetic manifests. Older version 1 snapshots still open. When a snapshot lacks size detail, Sortward shows a dash. Loading a newly generated preset supplies a complete example.

## Ask about the shift

Open **Ask Sortward** and ask which yard trailer should unload next, why a preassigned door is occupied, or whether moving a chute would ease the next bottleneck. The analyst sends the question and a bounded set of fictional shift facts to OpenAI. Expand its cited records to check the numbers. It reads the same pickup window and floor allocation you selected. A person approves each simulated move.

The public demo shares 30 provider calls per UTC day. A D1 database atomically reserves each call before it leaves the server. The secret stays on the server. Custom facility and trailer identities stay in the browser.

## How it works

The simulator uses deterministic functions written in TypeScript. One browser-local scenario supplies the heatmap, pickup queues, staffing view and door decisions. Operator approval, undo and the action history are features of the simulation. Every visitor works on their own copy.

- [Data model](lib/dock-types.ts) and [fictional scenarios](lib/dock-fixtures.ts)
- [Assignment rules and manifest validation](lib/dock-engine.ts)
- [Pickup window planning](lib/shift-priorities.ts) and [sort-floor capacity](lib/sort-floor.ts)
- [Decision walkthrough](LEARNING.md), [design](docs/DESIGN.md) and [verification record](docs/VERIFICATION.md)

## Run locally

Install Node.js 22.13 or newer, then run:

```sh
git clone https://github.com/olamitisoji/product-portfolio.git
cd product-portfolio/dockflow
npm ci
npm run dev
```

Open the local URL printed by the server. The default portable preview port is 5173. To run the checks:

```sh
npm test
npm run typecheck
npm run build
```

The simulator uses the Sites/Vinext starter. Its vendor licenses accompany the public source. The simulator runs locally without credentials. The optional analyst needs a server-side `OPENAI_API_KEY`, a D1 binding named `DB`, and [the quota migration](drizzle/0000_analyst_quota.sql). Run `npm run build` first for the local Worker configuration. To enable the analyst in a local preview, set the key in the ignored `.dev.vars` and run the following once for a new local database.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_analyst_quota.sql
npm run start
```

[Evidence retrieval](lib/shift-evidence.ts) calculates the data the model may use. [The analyst endpoint](worker/shift-analyst.ts) calls the Responses API, validates the cited record IDs and returns the matching records to the browser.
