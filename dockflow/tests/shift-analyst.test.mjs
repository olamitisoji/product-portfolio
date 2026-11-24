import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleShiftAnalyst } from '../worker/shift-analyst.ts';
import { createScenario } from '../lib/dock-fixtures.ts';
import { usesSampleIdentities } from '../lib/analyst-eligibility.ts';
import { BASE_FLOOR_PLAN, getBaselineFloorPlan, moveFloorResource } from '../lib/sort-floor.ts';
import { advanceClock } from '../lib/dock-engine.ts';

const endpoint = 'https://sortward.example/api/shift-analyst';
const post = (value) => new Request(endpoint, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});
const query = () => ({ question: 'What should I review next?', scenario: createScenario() });
const completed = (value) => Response.json({
  status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
});
const success = (id) => completed({ kind: 'answered', answer: 'Review the shift totals.', evidenceIds: [id] });

function harness(t, respond) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../drizzle/0000_analyst_quota.sql', import.meta.url), 'utf8'));
  const context = { calls: [], now: new Date('2026-04-22T23:59:55Z') };
  const env = { OPENAI_API_KEY: 'test-only', DB: { prepare: (sql) => ({
    bind: (...args) => ({ first: async () => db.prepare(sql).get(...args) ?? null }),
  }) } };
  const fetcher = async (url, options) => {
    const payload = JSON.parse(options.body);
    const parsed = JSON.parse(payload.input[0].content[0].text);
    context.calls.push({ url, options, payload, parsed });
    return respond ? respond(parsed) : success(parsed.evidence[0].id);
  };
  return {
    context, env,
    requests: (day = '2026-04-22') => db.prepare('SELECT requests FROM analyst_quota WHERE day = ?').get(day)?.requests ?? 0,
    send: (request, bindings = env) => handleShiftAnalyst(request, bindings, { fetcher, now: () => context.now }),
  };
}

test('worker sends only a question and calculated shift records, and resolves references on the server', async (t) => {
  const h = harness(t);
  const q = query();
  q.mode = 'arrival';
  q.pickup = 'next';
  q.floorPlan = moveFloorResource(getBaselineFloorPlan(q.scenario), 'crew', 'A', 'B');
  q.scenario = advanceClock(q.scenario, 30);
  q.scenario.privateNotes = 'CUSTOMER_EMAIL_NOT_FOR_ANALYSIS';
  const r = await h.send(post(q));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const [call] = h.context.calls;
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.redirect, 'manual');
  assert.ok(call.options.signal);
  assert.equal(call.payload.model, 'gpt-4.1-mini');
  assert.equal(call.payload.store, false);
  assert.equal(call.payload.text.format.type, 'json_schema');
  assert.equal(call.payload.text.format.strict, true);
  assert.ok(call.payload.max_output_tokens <= 650);
  assert.equal(call.payload.tools, undefined);
  assert.deepEqual(Object.keys(call.parsed).sort(), ['evidence', 'priorEvidenceIds', 'priorQuestions', 'question']);
  assert.doesNotMatch(JSON.stringify(call.payload), /CUSTOMER_EMAIL_NOT_FOR_ANALYSIS|Juniper Freight|profileUpdatedMinute/);
  const json = await r.json();
  assert.equal(json.answer, 'Review the shift totals.');
  assert.equal(json.citations.length, 1);
  assert.deepEqual(call.parsed.evidence[0], { id: json.citations[0].id, label: json.citations[0].label, text: json.citations[0].text });
  assert.equal(h.requests(), 1);
});

test('unknown, malformed and oversized inputs never consume quota or call the model', async (t) => {
  const h = harness(t);
  const baseline = getBaselineFloorPlan(createScenario());
  const badFloor = (key, values) => ({ ...baseline, [key]: values });
  for (const patch of [
    { question: '' }, { question: 'x'.repeat(601) }, { scenario: {} },
    { mode: 'invent' }, { pickup: 'all' }, { floorPlan: null }, { evidence: [] },
    { floorPlan: badFloor('crew', { A: 0, B: 1, C: 0 }) },
    { floorPlan: badFloor('chutes', { A: 5.5, B: 1.5, C: 3 }) },
    { floorPlan: badFloor('crew', { A: -1, B: 9, C: 1 }) },
    { floorPlan: badFloor('crew', { A: 3, B: 3, C: 3, D: 4 }) },
  ]) {
    const r = await h.send(post({ ...query(), ...patch }));
    assert.equal(r.status, 400);
    assert.equal(typeof (await r.json()).error, 'string');
  }
  for (const edit of [
    s => { s.name = 'Private warehouse'; }, s => { s.zones[0].name = 'Secret'; },
    s => { s.trailers[3].carrier = 'Private carrier'; }, s => { s.trailers[3].id = 'PRIVATE-123'; },
    s => { s.doors.push({ ...s.doors[0], id: 'CONFIDENTIAL' }); },
  ]) {
    const q = query();
    edit(q.scenario);
    assert.equal((await h.send(post(q))).status, 422);
  }
  assert.equal((await h.send(new Request(endpoint))).status, 405);
  assert.equal((await h.send(new Request(endpoint, { method: 'POST', body: '{}' }))).status, 415);
  const jsonHeaders = { 'Content-Type': 'application/json' };
  assert.equal((await h.send(new Request(endpoint, { method: 'POST', headers: jsonHeaders, body: '{' }))).status, 400);
  assert.equal((await h.send(new Request(endpoint, { method: 'POST', headers: jsonHeaders, body: 'x'.repeat(100_000) }))).status, 413);
  assert.equal(h.requests(), 0);
  assert.equal(h.context.calls.length, 0);
});

test('the worker retrieves the requested physical chute without sending the manifest array', async (t) => {
  const h = harness(t, () => success('chute-A199'));
  const q = query();
  q.question = 'Which trailers list chute A199?';
  const r = await h.send(post(q));
  assert.equal(r.status, 200);
  const { citations } = await r.json();
  assert.equal(citations[0].id, 'chute-A199');
  const records = h.context.calls[0].parsed.evidence;
  assert.ok(records.filter(row => row.id.startsWith('chute-')).length <= 7);
  assert.doesNotMatch(JSON.stringify(records), /chuteRoutes/);
});

test('the analyst accepts allocations only from the resource pool of the submitted snapshot', async (t) => {
  const h = harness(t);
  const current = query();
  const legacy = query();
  delete legacy.scenario.volumePlan;
  const currentFloor = getBaselineFloorPlan(current.scenario);
  assert.equal((await h.send(post({ ...current, floorPlan: BASE_FLOOR_PLAN }))).status, 400);
  assert.equal((await h.send(post({ ...legacy, floorPlan: currentFloor }))).status, 400);
  assert.equal(h.requests(), 0);
  assert.equal((await h.send(post({ ...legacy, floorPlan: BASE_FLOOR_PLAN }))).status, 200);
  assert.equal((await h.send(post({ ...current, floorPlan: currentFloor }))).status, 200);
  assert.equal(h.requests(), 2);
});

test('all three preset identities are recognized across seeds by both browser and worker', async (t) => {
  const h = harness(t);
  for (const preset of ['balanced', 'surge', 'disruption']) {
    for (const seed of [0, 123, 0xffffffff]) {
      const scenario = createScenario(preset, seed);
      assert.equal(usesSampleIdentities(scenario), true);
      const r = await h.send(post({ question: 'Which door is open?', scenario }));
      assert.equal(r.status, 200);
    }
  }
  const custom = createScenario();
  custom.trailers[0].carrier = 'Non-demo carrier';
  assert.equal(usesSampleIdentities(custom), false);
});

test('explicit cross-site submissions are rejected before body parsing and quota reservation', async (t) => {
  const h = harness(t);
  for (const headers of [
    { Origin: 'https://other.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://sortward.example', 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const r = await h.send(new Request(endpoint, { method: 'POST', headers, body: 'invalid' }));
    assert.equal(r.status, 403);
  }
  assert.equal(h.requests(), 0);
  const sameSite = post(query());
  sameSite.headers.set('Origin', 'https://sortward.example');
  sameSite.headers.set('Sec-Fetch-Site', 'same-origin');
  assert.equal((await h.send(sameSite)).status, 200);
});

test('parallel submissions share a hard daily cap with a new bucket at UTC midnight', async (t) => {
  const h = harness(t);
  const results = await Promise.all(Array.from({ length: 36 }, () => h.send(post(query()))));
  assert.equal(results.filter(r => r.status === 200).length, 30);
  assert.equal(results.filter(r => r.status === 429).length, 6);
  assert.equal(results.find(r => r.status === 429).headers.get('Retry-After'), '5');
  assert.equal(h.context.calls.length, 30);
  assert.equal(h.requests(), 30);
  h.context.now = new Date('2026-04-23T00:00:01Z');
  assert.equal((await h.send(post(query()))).status, 200);
  assert.equal(h.requests('2026-04-23'), 1);
});

test('missing bindings and quota database failures never call the provider', async (t) => {
  const h = harness(t);
  for (const env of [
    { DB: h.env.DB }, { OPENAI_API_KEY: 'test-only' },
    { ...h.env, DB: { prepare() { throw new Error('private database details'); } } },
  ]) {
    const r = await h.send(post(query()), env);
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /private database details/);
  }
  assert.equal(h.context.calls.length, 0);
  assert.equal(h.requests(), 0);
});

test('unavailable provider, incomplete responses, refusal and fabricated citations cannot look successful', async (t) => {
  for (const respond of [
    () => { throw new Error('private diagnostic'); },
    () => Response.json({ error: 'private diagnostic' }, { status: 429 }),
    () => Response.json({ status: 'incomplete' }),
    () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }),
    () => success('imaginary-record'),
    () => completed({ kind: 'answered', answer: 'Unsupported claim.', evidenceIds: [] }),
    ({ evidence }) => completed({ kind: 'answered', answer: 'Duplicate citations.', evidenceIds: [evidence[0].id, evidence[0].id] }),
    ({ evidence }) => completed({ kind: 'answered', answer: 'Claim.', evidenceIds: [evidence[0].id], action: 'assign' }),
  ]) {
    const h = harness(t, respond);
    const r = await h.send(post(query()));
    assert.ok(r.status >= 500);
    assert.doesNotMatch(await r.text(), /private diagnostic|Unsupported claim|Duplicate citations/);
    assert.equal(h.requests(), 1);
  }
});

test('questions outside shift evidence get a consistent abstention without invented evidence', async (t) => {
  const h = harness(t, () => completed({ kind: 'unsupported', answer: 'arbitrary model prose', evidenceIds: [] }));
  const r = await h.send(post(query()));
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.deepEqual(result.citations, []);
  assert.doesNotMatch(result.answer, /arbitrary model prose/);
  assert.match(result.answer, /shift/i);
});

test('worker restores current source records for follow-ups and consumes no quota on malformed context', async t => {
  const h = harness(t, () => success('chute-A121'));
  const base = query();
  const context = { view: 'overview', selectedTrailerId: 'TR-103', chute: { trailerId: 'TR-103', zoneId: 'A', chuteId: 'A121' } };
  for (const fields of [
    { context: { ...context, selectedTrailerId: 'custom' } },
    { context: { view: 'overview', chute: { statuses: ['expected','expected'] } } },
    { context: { view: 'floor', chute: { trailerId: 'TR-101', statuses: [] } } },
    { context: { view: 'floor', chute: { zoneId:'B', chuteId:'A121' } } },
    { context: { view:'queue', queue:{trailerIds:['TR-103'],search:'free-form query'} } },
    { context: { view:'queue', queue:{trailerIds:['UNKNOWN']} } },
    { context: { view:'priorities', pickupStage:'not-a-location' } },
    { priorQuestions: [{ role:'assistant', content:'free text' }] },
    { priorQuestions: Array(4).fill('too many') }, { priorEvidenceIds: Array(13).fill('shift') },
  ]) assert.equal((await h.send(post({ ...base, ...fields }))).status, 400);
  assert.equal(h.requests(), 0);
  const priorQuestions = ['Compare B007 and A122', 'Which is larger?'];
  const r = await h.send(post({ ...base, context, priorQuestions, priorEvidenceIds: ['chute-C015','obsolete'], question: 'What is feeding the selected chute?' }));
  assert.equal(r.status, 200);
  const payload = h.context.calls[0].parsed;
  assert.deepEqual(payload.priorQuestions, priorQuestions);
  assert.deepEqual(payload.priorEvidenceIds, ['chute-C015']);
  assert.ok(payload.evidence.some(row => row.id === 'chute-C015'));
  assert.ok(payload.evidence.some(row => row.id === 'chute-A121' && /127 packages/.test(row.text)));
  assert.doesNotMatch(JSON.stringify(payload), /obsolete|chuteRoutes|Copperline Cargo/);
  assert.equal((await r.json()).citations[0].id, 'chute-A121');
});
