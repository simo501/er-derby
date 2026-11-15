import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../audio.js', import.meta.url), 'utf8');
const fixture = {
  goal: { url: 'assets/goal.mp3?v=goal1', title: 'goal' },
  chants: Object.fromEntries(['roma', 'lazio'].map(club => [club,
    [0, 1, 2].map(index => ({ url: `assets/${club}/${index}.mp3?v=hash${index}`, title: club + index }))
  ]))
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function cacheStorage(entries = new Map()) {
  return {
    entries,
    async open() {
      return {
        async keys() { return [...entries.keys()].map(url => ({ url })); },
        async match(url) { return entries.get(url)?.clone(); },
        async put(url, response) { entries.set(url, response.clone()); },
        async delete(key) { return entries.delete(typeof key === 'string' ? key : key.url); }
      };
    }
  };
}

function harness({ random = () => 0.9, caches = cacheStorage(), fetcher, audioSession } = {}) {
  let now = 0;
  const requests = [];
  const starts = [];
  const contexts = [];
  class MockContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    addEventListener(type, callback) { this.onStateChange = callback; }
    createBuffer() { return { unlock: true }; }
    createGain() {
      return { connect() {}, disconnect() {}, gain: {
        setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}
      } };
    }
    async decodeAudioData(bytes) { return JSON.parse(new TextDecoder().decode(bytes)); }
    createBufferSource() {
      return {
        connect() {}, disconnect() {},
        stop(at) { if (at === undefined) this.stopped = true; else this.scheduledStop = at; },
        start(at, offset, duration) { this.args = { at, offset, duration }; if (!this.buffer.unlock) starts.push(this); }
      };
    }
  }
  const math = Object.create(Math);
  math.random = random;
  const root = createContext({
    document: { baseURI: 'https://example.test/er-derby/index.html', hidden: false },
    AudioContext: MockContext, navigator: { audioSession },
    DERBY_AUDIO: structuredClone(fixture),
    URL, Response, AbortController, setTimeout, clearTimeout,
    Date: { now: () => now }, Math: math, caches,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fetcher) return fetcher(url, options);
      return new Response(JSON.stringify({ duration: url.includes('goal.mp3') ? 2.8 : 80, key: url }));
    }
  });
  runInContext(source, root);
  const statuses = [];
  const audio = new root.StadiumAudio({ onStatus: text => statuses.push(text) });
  const time = value => {
    now = value;
    for (const context of contexts) context.currentTime = value / 1000;
    for (const node of starts) {
      const end = Math.min(node.args.at + node.args.duration, node.scheduledStop ?? Infinity);
      if (!node.stopped && !node.ended && end <= value / 1000) {
        node.ended = true;
        node.onended?.();
      }
    }
  };
  const update = (elapsed, { home = 'roma', slot = 10, events = [{ at: 0, type: 'kickoff' }], finished = elapsed >= 90000 } = {}) => {
    time(elapsed);
    audio.update({ slot, home }, { events, finished, halftime: elapsed >= 43000 && elapsed < 47000 }, elapsed);
  };
  return { root, audio, requests, starts, statuses, time, update, caches };
}

async function enable(h, elapsed = 0, options) {
  h.update(elapsed, options);
  await h.audio.toggle();
  await flush();
}

test('audio catalogue covers every supplied MP3, uses encoded URLs and exact content hashes', () => {
  const root = createContext({});
  runInContext(readFileSync(new URL('../assets/audio-manifest.js', import.meta.url), 'utf8'), root);
  const manifest = root.DERBY_AUDIO;
  for (const club of ['roma', 'lazio']) {
    const supplied = readdirSync(new URL('../assets/tracce ' + club + '/', import.meta.url))
      .filter(name => name.endsWith('.mp3'));
    assert.equal(manifest.chants[club].length, supplied.length);
    assert.deepEqual(Array.from(manifest.chants[club], track => decodeURIComponent(track.url.split('?')[0]).split('/').at(-1)).sort(), supplied.sort());
  }
  for (const track of [manifest.goal, ...manifest.chants.roma, ...manifest.chants.lazio]) {
    const [path, query] = track.url.split('?v=');
    assert.ok(!path.includes(' '));
    const bytes = readFileSync(new URL('../' + path, import.meta.url));
    assert.equal(track.bytes, bytes.length);
    assert.equal(query, createHash('sha256').update(bytes).digest('hex').slice(0, 16));
  }
});

test('four adaptive windows alternate evenly, include recording tails and stop at full time', async () => {
  const h = harness();
  h.update(0);
  assert.equal(h.requests.length, 0);
  await h.audio.toggle();
  await flush();
  assert.equal(h.audio.source.index, 0);
  assert.equal(h.audio.windows[0].club, 'roma');
  assert.equal(h.audio.windows[0].track.title, 'roma2');
  assert.equal(h.audio.source.node.args.offset, 72);
  assert.equal(h.audio.source.node.loop, true);
  assert.equal(h.requests.length, 3, 'only goal, current and next chant');
  assert.ok(h.requests.every(r => r.options.cache === 'force-cache'));
  const first = h.audio.source.node;
  h.update(18000);
  assert.equal(h.audio.boundaries[1], 22500);
  assert.equal(first.scheduledStop, 22.5, 'retime the audio clock without restarting');
  for (const elapsed of [22500, 45000, 67500]) {
    h.update(elapsed);
    await flush();
  }
  assert.deepEqual(Array.from(h.audio.windows, entry => entry.club), ['roma', 'lazio', 'roma', 'lazio']);
  assert.notEqual(h.audio.windows[0].track.url, h.audio.windows[2].track.url);
  assert.notEqual(h.audio.windows[1].track.url, h.audio.windows[3].track.url);
  assert.equal(h.starts.length, 4);
  assert.equal(h.requests.length, 5);
  const fourth = h.audio.source.node;
  h.update(90000);
  assert.ok(fourth.stopped || fourth.ended);
  assert.equal(h.audio.source, null);
  h.update(300000);
  await flush();
  assert.equal(h.starts.length, 4);
  h.update(0, { slot: 11, home: 'lazio' });
  await flush();
  assert.equal(h.audio.windows[0].club, 'lazio');
});

test('different local draws choose different chants and late joining uses only the remaining window', async () => {
  const a = harness({ random: () => 0.1 });
  const b = harness({ random: () => 0.8 });
  await enable(a, 70000);
  await enable(b, 70000);
  assert.equal(a.audio.source.index, 3);
  assert.equal(a.audio.windows[3].club, 'lazio');
  assert.notEqual(a.audio.windows[3].track.url, b.audio.windows[3].track.url);
  assert.equal(a.audio.source.node.args.duration, 20);
  assert.equal(a.audio.source.node.args.offset, 10.5, '8-second random offset + 2.5 seconds into the window');
  assert.equal(a.audio.windows[0], undefined, 'no loading of an already elapsed chant');
});

test('goal interrupts immediately, resumes the same excerpt and cannot outlast full time', async () => {
  const h = harness();
  await enable(h);
  const chorus = h.audio.source.node;
  const entry = h.audio.windows[0];
  h.update(5000, { events: [{ at: 5000, type: 'goal' }] });
  assert.equal(chorus.stopped, true, 'stop chant before waiting for goal decode');
  await flush();
  assert.equal(h.audio.source.kind, 'goal');
  assert.equal(h.audio.source.node.args.duration, 2.8);
  const goal = h.audio.source.node;
  h.update(5250, { events: [{ at: 5000, type: 'goal' }] });
  assert.equal(h.audio.source.node, goal, 'one playback per goal');
  h.time(7800);
  await flush();
  assert.equal(h.audio.source.kind, 'chant');
  assert.equal(h.audio.windows[0], entry, 'no extra random selection after a goal');
  assert.ok(Math.abs(h.audio.source.node.args.offset - 79.8) < 1e-8);
  assert.equal(h.audio.source.node.args.duration, 19.2);
  h.update(89000, { events: [{ at: 89000, type: 'goal' }] });
  await flush();
  assert.equal(h.audio.source.kind, 'goal');
  assert.equal(h.audio.source.node.args.duration, 1, 'goal sound is clipped to the match end');
  const finalGoal = h.audio.source.node;
  h.update(90000);
  assert.ok(finalGoal.stopped || finalGoal.ended);
  assert.equal(h.audio.source, null);
});

test('joining after an old goal does not replay it; mute and hidden tabs stop all playback', async () => {
  const h = harness();
  await enable(h, 10000, { events: [{ at: 5000, type: 'goal' }] });
  assert.equal(h.audio.source.kind, 'chant');
  const first = h.audio.source.node;
  await h.audio.visibility(true);
  assert.equal(first.stopped, true);
  assert.equal(h.audio.context.state, 'suspended');
  h.time(95000);
  await h.audio.visibility(false);
  h.update(95000);
  await flush();
  assert.equal(h.audio.source, null, 'returning after the final whistle stays silent');
  h.update(0, { slot: 11, home: 'lazio' });
  await flush();
  const next = h.audio.source.node;
  await h.audio.toggle();
  assert.equal(next.stopped, true);
  assert.equal(h.audio.enabled, false);
});

test('late downloads cannot resurrect a muted chant or replace a priority goal', async () => {
  let release;
  const h = harness({ fetcher: url => {
    if (url.includes('/roma/')) return new Promise(resolve => { release = resolve; });
    return new Response(JSON.stringify({ duration: url.includes('goal.mp3') ? 2.8 : 80 }));
  } });
  await enable(h);
  assert.equal(h.audio.source, undefined);
  h.update(5000, { events: [{ at: 5000, type: 'goal' }] });
  await flush();
  assert.equal(h.audio.source.kind, 'goal');
  release(new Response(JSON.stringify({ duration: 80 })));
  await flush();
  assert.equal(h.audio.source.kind, 'goal');
  await h.audio.toggle();
  await flush();
  assert.equal(h.audio.source, null);
});

test('persistent cache survives a new player, hashes invalidate old files and decoded memory stays bounded', async () => {
  const shared = cacheStorage();
  const a = harness({ caches: shared });
  await enable(a);
  assert.equal(a.requests.length, 3);
  const b = harness({ caches: shared });
  await enable(b);
  assert.equal(b.requests.length, 0, 'second visit reads cached MP3s without a network fetch');
  const obsolete = 'https://example.test/er-derby/assets/goal.mp3?v=old';
  shared.entries.set(obsolete, new Response('obsolete'));
  const c = harness({ caches: shared });
  c.root.DERBY_AUDIO.goal.url = 'assets/goal.mp3?v=goal2';
  await enable(c);
  assert.equal(shared.entries.has(obsolete), false);
  assert.equal(shared.entries.has('https://example.test/er-derby/assets/goal.mp3?v=goal1'), false);
  assert.ok(c.requests.some(r => r.url.endsWith('goal.mp3?v=goal2')));
  for (const club of ['roma', 'lazio']) {
    await Promise.all(c.root.DERBY_AUDIO.chants[club].map(track => c.audio.store.load(track)));
  }
  assert.ok(c.audio.store.buffers.size <= 4);
  assert.ok(c.audio.store.buffers.has('assets/goal.mp3?v=goal2'));
});

test('storage denial falls back to HTTP; duplicate loads share a request and partial/error responses are not cached', async () => {
  const h = harness({ caches: { async open() { throw new Error('Storage denied'); } } });
  await enable(h);
  assert.equal(h.audio.source.kind, 'chant');
  const track = h.root.DERBY_AUDIO.chants.roma[0];
  const before = h.requests.length;
  await Promise.all([h.audio.store.load(track), h.audio.store.load(track)]);
  assert.equal(h.requests.length, before + 1);
  const broken = harness({ fetcher: () => new Response('partial', { status: 206 }) });
  await enable(broken);
  assert.equal(broken.audio.source, undefined);
  assert.equal(broken.caches.entries.size, 0);
  const count = broken.requests.length;
  broken.update(1000);
  await flush();
  assert.equal(broken.requests.length, count, 'failed tracks use backoff instead of a fetch every UI tick');
  await broken.audio.toggle();
});


test('two-goal domination permits 3:1 for either club, one-goal leads stay balanced', async () => {
  for (const club of ['roma', 'lazio']) {
    for (const goals of [1, 2]) {
      const h = harness();
      await enable(h);
      const events = Array.from({ length: goals }, (_, i) => ({ at: 1000 + i * 1000, type: 'goal', club }));
      for (let elapsed = 250; elapsed < 90000; elapsed += 250) {
        h.update(elapsed, { events: events.filter(event => event.at <= elapsed) });
        await flush();
      }
      const clubs = Array.from(h.audio.windows, entry => entry.club);
      assert.equal(clubs.length, 4);
      assert.equal(clubs.filter(value => value === club).length, goals === 2 ? 3 : 2);
      assert.equal(new Set(clubs).size, 2, 'both curves are always heard');
      for (let i = 0; i < 4; i++) {
        const duration = h.audio.boundaries[i + 1] - h.audio.boundaries[i];
        assert.ok(duration >= 18000 && duration <= 27000);
      }
    }
  }
});

test('recent attacks change durations; late joining reconstructs the same decisions without future events', async () => {
  const events = [{ at: 12000, type: 'miss', club: 'roma' }, { at: 16000, type: 'corner', club: 'roma' },
    { at: 35000, type: 'goal', club: 'lazio' }, { at: 37000, type: 'goal', club: 'lazio' },
    { at: 61000, type: 'miss', club: 'lazio' }];
  const live = harness();
  await enable(live);
  for (let elapsed = 250; elapsed <= 70000; elapsed += 250) {
    live.update(elapsed, { events: events.filter(event => event.at <= elapsed) });
    await flush();
  }
  const late = harness();
  await enable(late, 70000, { events });
  assert.deepEqual(Array.from(late.audio.boundaries), Array.from(live.audio.boundaries));
  assert.ok(live.audio.boundaries[1] > 22500, 'Roma pressure prolongs the opening chant');
  assert.equal(late.audio.windows[3].club, live.audio.windows[3].club);
  const old = live.audio.boundaries[1];
  live.update(71000, { events: [...events, { at: 70500, type: 'goal', club: 'roma' }] });
  assert.equal(live.audio.boundaries[1], old, 'later goals never rewrite earlier decisions');
});

test('Safari playback session is requested on the tap and an interrupted context resumes in one tap', async () => {
  const session = { type: 'auto' };
  const h = harness({ audioSession: session });
  await enable(h);
  assert.equal(session.type, 'playback');
  let interrupted = false;
  h.audio.onInterrupted = () => { interrupted = true; };
  h.audio.context.state = 'interrupted';
  h.audio.context.onStateChange();
  assert.equal(interrupted, true);
  assert.equal(h.audio.source, null);
  await h.audio.toggle();
  await flush();
  assert.equal(h.audio.context.state, 'running');
  assert.equal(h.audio.enabled, true);
  assert.equal(h.audio.source.kind, 'chant');
  await h.audio.toggle();
  assert.equal(session.type, 'auto');
});
