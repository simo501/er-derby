/* Local spectator audio. Its randomness never enters the match engine. */
(function (root) {
  'use strict';
  const WINDOW_MS = 22500;
  const MIN_CHANT_MS = 18000;
  const MAX_CHANT_MS = 27000;
  const DOMINANT_LEAD = 2;
  const MATCH_MS = 90000;

  class AudioClipStore {
    constructor(context, manifest) {
      this.context = context;
      this.buffers = new Map();
      this.pending = new Map();
      this.goalUrl = manifest.goal.url;
      this.cachePromise = null;
      this.tracks = [manifest.goal, ...manifest.chants.roma, ...manifest.chants.lazio];
    }

    url(track) { return new URL(track.url, root.document.baseURI).href; }

    cache() {
      if (!this.cachePromise) {
        this.cachePromise = (async () => {
          try {
            const path = new URL('.', root.document.baseURI).pathname;
            const cache = await root.caches.open('er-derby-audio-v1:' + path);
            const allowed = new Set(this.tracks.map(track => this.url(track)));
            // Remove obsolete hashes, keeping storage bounded to the current catalogue.
            for (const key of await cache.keys()) {
              if (!allowed.has(key.url)) await cache.delete(key);
            }
            return cache;
          } catch {
            // Private browsing / unavailable storage: the HTTP cache still works.
            return null;
          }
        })();
      }
      return this.cachePromise;
    }

    async load(track) {
      const key = track.url;
      if (this.buffers.has(key)) {
        const buffer = this.buffers.get(key);
        this.buffers.delete(key);
        this.buffers.set(key, buffer);
        return buffer;
      }
      if (this.pending.has(key)) return this.pending.get(key);
      const loading = this.read(track);
      this.pending.set(key, loading);
      try { return await loading; }
      finally { this.pending.delete(key); }
    }

    async read(track) {
      const url = this.url(track);
      const cache = await this.cache();
      let response;
      try { response = cache && await cache.match(url); } catch { /* Fetch below. */ }
      if (response) {
        try {
          const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
          return this.remember(track, buffer);
        } catch {
          try { await cache.delete(url); } catch { /* Fall back to the network. */ }
        }
      }
      const controller = new AbortController();
      const timeout = root.setTimeout(() => controller.abort(), 12000);
      try {
        // A content hash changes the URL only when the MP3 actually changes.
        response = await root.fetch(url, { cache: 'force-cache', signal: controller.signal });
        if (response.status !== 200) throw new Error('Audio HTTP ' + response.status);
        const saved = cache ? response.clone() : null;
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        // Store complete, valid files without blocking playback on disk I/O.
        if (cache) void cache.put(url, saved).catch(() => {});
        return this.remember(track, buffer);
      } finally { root.clearTimeout(timeout); }
    }

    remember(track, buffer) {
      this.buffers.set(track.url, buffer);
      // At most three decoded chants plus the always-ready goal effect.
      while (this.buffers.size > 4) {
        const oldest = [...this.buffers.keys()].find(key => key !== this.goalUrl);
        this.buffers.delete(oldest);
      }
      return buffer;
    }
  }

  class StadiumAudio {
    constructor({ manifest = root.DERBY_AUDIO, onStatus = () => {}, onInterrupted = () => {} } = {}) {
      this.manifest = manifest;
      this.onStatus = onStatus;
      this.onInterrupted = onInterrupted;
      this.enabled = false;
      this.hidden = Boolean(root.document.hidden);
      this.volume = 0.35;
      this.windows = [];
      this.boundaries = [0, null, null, null, MATCH_MS];
      this.lastTracks = {};
      this.generation = 0;
      this.lastEvent = '';
      this.retryAt = 0;
    }

    async toggle() {
      if (this.enabled && this.context.state === 'running') {
        this.enabled = false;
        this.stop();
        await this.context.suspend();
        this.setSessionType('auto');
        return false;
      }
      const Context = root.AudioContext || root.webkitAudioContext;
      if (!Context) throw new Error('Audio non supportato da questo browser.');
      if (!this.manifest) throw new Error('Catalogo dei cori non disponibile.');
      if (!/^https?:$/.test(new URL(root.document.baseURI).protocol)) {
        throw new Error('Per ascoltare i cori apri il sito dal suo indirizzo web.');
      }
      this.setSessionType('playback');
      if (!this.context) {
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination);
        this.store = new AudioClipStore(this.context, this.manifest);
        this.context.addEventListener('statechange', () => {
          if (!this.enabled || this.hidden) return;
          if (this.context.state === 'running') this.ensureChant();
          else if (['interrupted', 'suspended'].includes(this.context.state)) {
            this.stop();
            this.onStatus('Audio interrotto. Tocca Riprendi audio.');
            this.onInterrupted();
          }
        });
      }
      // Unlock Web Audio synchronously in the tap, before any fetch or await.
      const unlock = this.context.createBufferSource();
      unlock.buffer = this.context.createBuffer(1, 1, 22050);
      unlock.connect(this.master);
      unlock.onended = () => unlock.disconnect();
      unlock.start(0);
      await this.context.resume();
      if (this.context.state !== 'running') throw new Error('Audio bloccato. Tocca di nuovo per riprovare.');
      this.enabled = true;
      this.onStatus('Caricamento dei cori…');
      void this.store.load(this.manifest.goal).catch(() => {});
      this.ensureChant();
      return true;
    }

    setSessionType(type) {
      try {
        if (root.navigator?.audioSession) root.navigator.audioSession.type = type;
      } catch { /* Older Safari and other browsers can use normal Web Audio. */ }
    }

    setVolume(value) {
      this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      if (this.master) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.03);
    }

    elapsed() {
      return this.state ? this.state.elapsed + Math.max(0, Date.now() - this.state.receivedAt) : MATCH_MS;
    }

    canPlay() {
      return this.enabled && !this.hidden && this.state && !this.state.finished &&
        this.elapsed() < MATCH_MS && this.context.state === 'running';
    }

    stopSource() {
      if (!this.source) return;
      const { node, gain } = this.source;
      this.source = null;
      node.onended = null;
      node.stop();
      node.disconnect();
      gain.disconnect();
    }

    stop() {
      this.generation++;
      this.starting = null;
      this.pendingGoal = false;
      this.stopSource();
    }

    boundaryRange(index) {
      const start = this.boundaries[index - 1];
      const remaining = 4 - index;
      return {
        min: Math.max(index * WINDOW_MS - 4500, start + MIN_CHANT_MS, MATCH_MS - remaining * MAX_CHANT_MS),
        max: Math.min(index * WINDOW_MS + 4500, start + MAX_CHANT_MS, MATCH_MS - remaining * MIN_CHANT_MS)
      };
    }

    scoreAt(elapsed) {
      const goals = { roma: 0, lazio: 0 };
      for (const event of this.state.events) {
        if (event.at <= elapsed && event.type === 'goal' && event.club in goals) goals[event.club]++;
      }
      return goals;
    }

    clubAt(index) {
      const first = this.state.home;
      if (index === 0) return first;
      if (index === 1) return first === 'roma' ? 'lazio' : 'roma';
      // A prefetched choice is provisional; lock it using the score at its actual start.
      const start = this.boundaries[index] ?? this.state.elapsed;
      const goals = this.scoreAt(Math.min(start, this.state.elapsed));
      const difference = goals.roma - goals.lazio;
      if (Math.abs(difference) >= DOMINANT_LEAD) return difference > 0 ? 'roma' : 'lazio';
      const previous = this.clubAt(index - 1);
      return previous === 'roma' ? 'lazio' : 'roma';
    }

    syncBoundaries() {
      for (let index = 1; index < 4; index++) {
        const decisionAt = index * WINDOW_MS - 4500;
        if (this.boundaries[index] !== null || this.state.elapsed < decisionAt) continue;
        const club = this.clubAt(index - 1);
        const other = club === 'roma' ? 'lazio' : 'roma';
        const goals = this.scoreAt(decisionAt);
        let momentum = Math.max(-2, Math.min(2, goals[club] - goals[other])) * 0.5;
        const weights = { goal: 3, save: 1, miss: 0.7, corner: 0.7, build: 0.2 };
        for (const event of this.state.events) {
          if (event.at > decisionAt || event.at < decisionAt - 10000) continue;
          const weight = weights[event.type] || 0;
          if (event.club === club) momentum += weight;
          if (event.club === other) momentum -= weight;
        }
        const range = this.boundaryRange(index);
        const adjustment = Math.max(-4500, Math.min(4500, momentum * 1500));
        this.boundaries[index] = Math.max(range.min, Math.min(range.max, index * WINDOW_MS + adjustment));
      }
    }

    windowEnd(index) {
      return this.boundaries[index + 1] ?? this.boundaryRange(index + 1).max;
    }

    windowIndex(elapsed = this.elapsed()) {
      for (let index = 0; index < 4; index++) {
        if (elapsed < this.windowEnd(index)) return index;
      }
      return 3;
    }

    prepareWindow(index) {
      const club = this.clubAt(index);
      if (this.windows[index]?.club === club) return this.windows[index];
      const tracks = this.manifest.chants[club];
      const choices = tracks.filter(track => track.url !== this.lastTracks[club]);
      const pool = choices.length ? choices : tracks;
      const track = pool[Math.floor(Math.random() * pool.length)];
      if (!track) throw new Error('Nessun coro disponibile per ' + club);
      this.lastTracks[club] = track.url;
      const entry = { club, track, offset: null };
      this.windows[index] = entry;
      return entry;
    }

    async windowBuffer(entry) {
      const buffer = await this.store.load(entry.track);
      // A circular excerpt can include the end even of a 98-second recording.
      if (entry.offset === null) entry.offset = Math.random() * buffer.duration;
      return buffer;
    }

    ensureChant() {
      if (!this.canPlay() || this.pendingGoal || this.source?.kind === 'goal' || Date.now() < this.retryAt) return;
      const index = this.windowIndex();
      if (this.source?.index === index) {
        // Lock the adaptive cut on the audio clock without restarting the recording.
        const end = this.windowEnd(index);
        if (this.source.end !== end) {
          const remaining = (end - this.elapsed()) / 1000;
          const now = this.context.currentTime;
          if (remaining > 0) {
            this.source.node.stop(now + remaining);
            this.source.gain.gain.cancelScheduledValues(now);
            this.source.gain.gain.setValueAtTime(1, now);
            this.source.gain.gain.setValueAtTime(1, now + Math.max(0, remaining - 0.1));
            this.source.gain.gain.linearRampToValueAtTime(0, now + remaining);
            this.source.end = end;
          }
        }
        return;
      }
      if (this.starting?.index === index) return;
      this.stopSource();
      const ticket = { index, generation: this.generation };
      this.starting = ticket;
      const entry = this.prepareWindow(index);
      void this.windowBuffer(entry).then(buffer => {
        if (this.starting !== ticket || ticket.generation !== this.generation || !this.canPlay() ||
            this.pendingGoal || this.windowIndex() !== index || entry.club !== this.clubAt(index)) return;
        const elapsed = this.elapsed();
        const offset = (entry.offset + (elapsed - this.boundaries[index]) / 1000) % buffer.duration;
        const seconds = (this.windowEnd(index) - elapsed) / 1000;
        if (seconds <= 0) return;
        this.play(buffer, { kind: 'chant', index, offset, seconds, loop: true });
        this.onStatus('Coro ' + (entry.club === 'roma' ? 'Roma' : 'Lazio') + ' · ' + entry.track.title);
        // Only the next window is prefetched, never the entire catalogue.
        if (index < 3) void this.windowBuffer(this.prepareWindow(index + 1)).catch(() => {});
      }).catch(() => {
        if (ticket.generation !== this.generation) return;
        this.retryAt = Date.now() + 5000;
        this.onStatus('Coro non disponibile. Nuovo tentativo tra poco.');
      }).finally(() => {
        if (this.starting === ticket) this.starting = null;
      });
    }

    play(buffer, { kind, index = null, offset = 0, seconds, loop = false }) {
      this.stopSource();
      const node = this.context.createBufferSource();
      const gain = this.context.createGain();
      const now = this.context.currentTime;
      node.buffer = buffer;
      node.loop = loop;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + Math.min(0.025, seconds / 4));
      gain.gain.setValueAtTime(1, now + Math.max(seconds / 2, seconds - 0.1));
      gain.gain.linearRampToValueAtTime(0, now + seconds);
      node.connect(gain);
      gain.connect(this.master);
      const source = { kind, index, node, gain, end: kind === 'chant' ? this.windowEnd(index) : MATCH_MS };
      this.source = source;
      node.onended = () => {
        node.disconnect();
        gain.disconnect();
        if (this.source === source) {
          this.source = null;
          this.ensureChant();
        }
      };
      // The audio clock cuts off at the window/match end even between UI ticks.
      node.start(now, offset, seconds);
    }

    playGoal() {
      this.stop();
      this.pendingGoal = true;
      const generation = this.generation;
      const deadline = Date.now() + 1500;
      this.onStatus('GOL!');
      void this.store.load(this.manifest.goal).then(buffer => {
        if (generation !== this.generation || !this.canPlay() || Date.now() > deadline) return;
        const seconds = Math.min(buffer.duration, (MATCH_MS - this.elapsed()) / 1000);
        if (seconds <= 0) return;
        this.play(buffer, { kind: 'goal', seconds });
      }).catch(() => {
        if (generation === this.generation) this.onStatus('Effetto gol non disponibile.');
      }).finally(() => {
        if (generation === this.generation) {
          this.pendingGoal = false;
          this.ensureChant();
        }
      });
    }

    update(match, state, elapsed) {
      const changed = this.state?.slot !== match.slot;
      const justFinished = state.finished && !this.state?.finished;
      if (changed || justFinished) this.stop();
      if (changed) {
        this.windows = [];
        this.boundaries = [0, null, null, null, MATCH_MS];
      }
      this.state = { slot: match.slot, home: match.home, finished: state.finished, events: state.events, elapsed, receivedAt: Date.now() };
      this.syncBoundaries();
      if (!this.canPlay()) {
        if (this.enabled && state.finished) this.onStatus('Fischio finale. Cori al prossimo derby.');
        return;
      }
      const event = state.events.at(-1);
      if (event) {
        const id = match.slot + ':' + event.at + ':' + event.type;
        if (id !== this.lastEvent) {
          this.lastEvent = id;
          // Never replay goals that happened before joining or returning to the tab.
          if (event.type === 'goal' && elapsed - event.at >= 0 && elapsed - event.at < 850) {
            this.playGoal();
            return;
          }
        }
      }
      this.ensureChant();
    }

    async visibility(hidden) {
      this.hidden = hidden;
      this.stop();
      if (!this.enabled || !this.context) return;
      if (hidden) await this.context.suspend();
      else await this.context.resume();
      // The app refreshes the match clock before restarting any sound.
    }
  }

  root.StadiumAudio = StadiumAudio;
  root.DerbyAudioClipStore = AudioClipStore;
})(globalThis);
