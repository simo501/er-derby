/* Pure simulation engine: no DOM, timers, network or browser randomness. */
(function (root) {
  'use strict';
  const CYCLE = 300000;
  const LIVE = 90000;
  const EPOCH = Date.UTC(2025, 0, 1);

  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) {
      value = Math.imul(value ^ text.charCodeAt(index), 16777619);
    }
    return value >>> 0;
  }

  function randomFrom(seed) {
    let state = hash(String(seed));
    return function () {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function pick(items, random, weight = () => 1) {
    let remaining = random() * items.reduce((total, item) => total + weight(item), 0);
    for (const item of items) {
      remaining -= weight(item);
      if (remaining < 0) return item;
    }
    return items[items.length - 1];
  }

  function outcome(roma, lazio) {
    return roma > lazio ? 'roma' : roma < lazio ? 'lazio' : 'draw';
  }

  function position(now) {
    const slot = Math.floor((now - EPOCH) / CYCLE);
    const elapsed = now - (EPOCH + slot * CYCLE);
    return { slot, elapsed, live: elapsed < LIVE, next: EPOCH + (slot + 1) * CYCLE };
  }

  function minuteAt(elapsed) {
    if (elapsed < 43000) return Math.min(45, elapsed / 43000 * 45);
    if (elapsed < 47000) return 45;
    return Math.min(90, 45 + (elapsed - 47000) / 43000 * 45);
  }

  function timeAt(minute) {
    return minute <= 45 ? minute / 45 * 43000 : 47000 + (minute - 45) / 45 * 43000;
  }

  function createEngine(data) {
    const roma = data.teams.filter(team => team.club === 'roma');
    const lazio = data.teams.filter(team => team.club === 'lazio');
    if (roma.length !== lazio.length || !roma.length) throw new Error('Dataset sbilanciato');
    const total = Object.values(data.history.counts).reduce((a, b) => a + b, 0);
    const target = Object.fromEntries(Object.entries(data.history.counts).map(([key, n]) => [key, n / total]));
    const pairs = roma.flatMap(r => lazio.map(l => ({ roma: r, lazio: l })));
    const biases = { roma: 1, draw: 1, lazio: 1 };

    function probabilities(pair) {
      // Editorial season strength has a bounded effect. Intercepts below restore
      // the historical frequencies across the equally likely 144 pairings.
      const delta = (pair.roma.rating - pair.lazio.rating) * 0.025;
      const weights = { roma: target.roma * Math.exp(delta) * biases.roma,
        draw: target.draw * biases.draw, lazio: target.lazio * Math.exp(-delta) * biases.lazio };
      const sum = weights.roma + weights.draw + weights.lazio;
      return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / sum]));
    }

    for (let iteration = 0; iteration < 300; iteration++) {
      const mean = { roma: 0, draw: 0, lazio: 0 };
      for (const pair of pairs) {
        const p = probabilities(pair);
        for (const key of Object.keys(mean)) mean[key] += p[key] / pairs.length;
      }
      if (Object.keys(mean).every(key => Math.abs(mean[key] - target[key]) < 1e-13)) break;
      for (const key of Object.keys(mean)) biases[key] *= target[key] / mean[key];
    }

    let scheduleBlock;
    let schedule;
    function pairing(slot) {
      const block = Math.floor(slot / pairs.length);
      if (block !== scheduleBlock) {
        scheduleBlock = block;
        schedule = pairs.slice();
        const random = randomFrom(`${data.version}:schedule:${block}`);
        for (let i = schedule.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [schedule[i], schedule[j]] = [schedule[j], schedule[i]];
        }
      }
      return schedule[((slot % pairs.length) + pairs.length) % pairs.length];
    }

    function distribution(pair) {
      const probabilitiesForPair = probabilities(pair);
      return data.history.scores.map(score => {
        const result = outcome(score.roma, score.lazio);
        return { ...score, probability: probabilitiesForPair[result] * score.count / data.history.counts[result] };
      });
    }

    function markets(pair) {
      const cells = distribution(pair);
      const sum = predicate => cells.filter(predicate).reduce((value, cell) => value + cell.probability, 0);
      const p = probabilities(pair);
      return { ...p, '1X': p.roma + p.draw, 'X2': p.draw + p.lazio, '12': p.roma + p.lazio,
        over: sum(s => s.roma + s.lazio >= 3), under: sum(s => s.roma + s.lazio < 3),
        goal: sum(s => s.roma > 0 && s.lazio > 0), noGoal: sum(s => !s.roma || !s.lazio),
        exact: [...cells].sort((a, b) => b.probability - a.probability) };
    }

    function createMatch(slot) {
      const pair = pairing(slot);
      const random = randomFrom(`${data.version}:match:${slot}`);
      const score = pick(distribution(pair), random, cell => cell.probability);
      const events = [{ at: 0, minute: 0, type: 'kickoff', title: 'Il derby comincia.', text: 'Due epoche, un solo Olimpico. Si parte!' },
        { at: 43000, minute: 45, type: 'halftime', title: 'Intervallo', text: 'Quattro secondi per riprendere fiato. Poi si torna in campo.' },
        { at: 47000, minute: 45, type: 'kickoff', title: 'Comincia il secondo tempo', text: 'Altri quarantacinque minuti per scrivere questo derby.' },
        { at: LIVE, minute: 90, type: 'fulltime', title: 'Triplice fischio', text: 'Il derby entra nell’archivio. La prossima sfida è già pronta.' }];
      const slots = Array.from({ length: 25 }, (_, i) => i);
      const goals = new Map();
      for (const club of ['roma', 'lazio']) {
        for (let i = 0; i < score[club]; i++) {
          const index = Math.floor(random() * slots.length);
          goals.set(slots.splice(index, 1)[0], club);
        }
      }
      const booked = new Set();
      for (let index = 0; index < 25; index++) {
        const club = goals.get(index) || (random() < 0.51 ? 'roma' : 'lazio');
        const team = pair[club];
        const opponent = pair[club === 'roma' ? 'lazio' : 'roma'];
        const outfield = team.starters.slice(1);
        const shooter = pick(outfield, random, p => p.role === 'A' ? 7 : p.role === 'C' ? 3 : 1);
        const assist = pick(outfield.filter(p => p.name !== shooter.name), random, p => p.role === 'C' ? 3 : 1);
        const defender = pick(opponent.starters.slice(1), random, p => p.role === 'D' ? 4 : 1);
        const minute = 2 + index * 3.5 + random() * 1.6;
        const at = minute <= 45 ? Math.min(42999, Math.round(timeAt(minute))) : Math.round(timeAt(minute));
        const roll = random();
        let type = goals.has(index) ? 'goal' : roll < 0.35 ? 'save' : roll < 0.60 ? 'miss' : roll < 0.76 ? 'corner' : roll < 0.88 ? 'yellow' : 'defence';
        if (type === 'yellow' && booked.has(shooter.name)) type = 'defence';
        if (type === 'yellow') booked.add(shooter.name);
        const common = { club, player: shooter.name, assist: assist.name, minute: Math.floor(minute), at,
          x: club === 'roma' ? 72 + random() * 17 : 11 + random() * 17, y: 22 + random() * 56 };
        const attackAt = at >= 47000 ? Math.max(47000, at - 1900) : at - 1900;
        const attack = { ...common, at: attackAt, minute: Math.floor(minuteAt(attackAt)), type: 'build', title: `${assist.label} cerca ${shooter.label}`,
          text: `${assist.name} porta avanti il pallone e serve ${shooter.name}.`, x: club === 'roma' ? 57 : 43 };
        const variants = {
          goal: [`Gol di ${shooter.label}!`, `${assist.name} trova ${shooter.name}: conclusione vincente, ${opponent.starters[0].label} è battuto!`],
          save: [`${opponent.starters[0].label} dice no`, `${shooter.name} calcia su invito di ${assist.name}. ${opponent.starters[0].name} para e tiene il risultato.`],
          miss: [`${shooter.label}, di poco fuori`, `${assist.name} apre lo spazio. Il tiro di ${shooter.name} finisce oltre il palo.`],
          corner: ['Calcio d’angolo', `${defender.name} chiude il cross di ${shooter.name}. Il pallone termina in angolo.`],
          yellow: [`Ammonito ${shooter.label}`, `${shooter.name} ferma fallosamente ${defender.name}. L’arbitro estrae il giallo.`],
          defence: [`${defender.label} chiude tutto`, `${shooter.name} cerca il varco, ma ${defender.name} intercetta e allontana.`]
        };
        if (type !== 'yellow') events.push(attack);
        events.push({ ...common, type, title: variants[type][0], text: variants[type][1] });
      }
      events.sort((a, b) => a.at - b.at);
      return { slot, start: EPOCH + slot * CYCLE, ...pair, score: { roma: score.roma, lazio: score.lazio },
        odds: markets(pair), events };
    }

    function snapshot(match, elapsed) {
      const visible = match.events.filter(event => event.at <= elapsed);
      const stats = { roma: { goals: 0, shots: 0, onTarget: 0, corners: 0, yellow: 0, attacks: 0 },
        lazio: { goals: 0, shots: 0, onTarget: 0, corners: 0, yellow: 0, attacks: 0 } };
      for (const event of visible) {
        if (!event.club) continue;
        const s = stats[event.club];
        if (event.type === 'build') s.attacks++;
        if (['goal', 'save', 'miss'].includes(event.type)) s.shots++;
        if (['goal', 'save'].includes(event.type)) s.onTarget++;
        if (event.type === 'goal') s.goals++;
        if (event.type === 'corner') s.corners++;
        if (event.type === 'yellow') s.yellow++;
      }
      const attacks = stats.roma.attacks + stats.lazio.attacks;
      stats.roma.pressure = attacks ? Math.round(stats.roma.attacks / attacks * 100) : 50;
      stats.lazio.pressure = 100 - stats.roma.pressure;
      return { events: visible, stats, minute: Math.floor(minuteAt(elapsed)),
        halftime: elapsed >= 43000 && elapsed < 47000, finished: elapsed >= LIVE };
    }

    return { pairing, probabilities, distribution, markets, createMatch, snapshot, target, pairs };
  }

  root.DerbyEngine = { CYCLE, LIVE, EPOCH, position, minuteAt, timeAt, randomFrom, createEngine };
})(globalThis);
