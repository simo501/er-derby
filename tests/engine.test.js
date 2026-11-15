import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import '../engine.js';

const data = JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url)));
const { createEngine, position, CYCLE, LIVE, EPOCH } = globalThis.DerbyEngine;
const engine = createEngine(data);

test('balanced, sourced rosters and valid historical sample', () => {
  assert.equal(data.teams.filter(t => t.club === 'roma').length, 12);
  assert.equal(data.teams.filter(t => t.club === 'lazio').length, 12);
  for (const team of data.teams) {
    assert.equal(team.starters.length, 11);
    assert.equal(team.bench.length, 5);
    assert.equal(new Set([...team.starters, ...team.bench].map(p => p.name)).size, 16);
    assert.equal(team.starters[0].role, 'P');
    const rows = [1, ...team.formation.split('-').map(Number)];
    assert.equal(rows.reduce((sum, n) => sum + n, 0), 11);
    for (let line = 0; line < rows.length; line++) assert.equal(team.starters.filter(p => p.line === line).length, rows[line]);
    if (team.formationInfo.kind === 'counted') {
      const info = team.formationInfo;
      assert.equal(info.counts[team.formation], Math.max(...Object.values(info.counts)));
      assert.equal(Object.values(info.counts).reduce((a,b) => a+b, 0), info.sampleSize);
    } else assert.equal(team.formationInfo.kind, 'reconstruction');
    assert.ok(team.source.startsWith('https://it.wikipedia.org/wiki/'));
    for (const player of [...team.starters, ...team.bench]) assert.ok(team.roster.some(p => p.name === player.name));
  }
  const counted = { roma: 0, draw: 0, lazio: 0 };
  for (const game of data.history.matches) {
    assert.ok(game.date <= data.cutoff);
    assert.notEqual(game.date, '1969-09-07');
    counted[game.roma > game.lazio ? 'roma' : game.roma < game.lazio ? 'lazio' : 'draw']++;
  }
  assert.equal(data.history.matches.length, 184);
  assert.deepEqual(counted, data.history.counts);
});

test('clock boundaries, interval and arbitrary suspended-tab jumps', () => {
  const base = EPOCH + 100 * CYCLE;
  assert.deepEqual(position(base), { slot: 100, elapsed: 0, live: true, next: base + CYCLE });
  assert.equal(position(base + LIVE - 1).live, true);
  assert.equal(position(base + LIVE).live, false);
  assert.equal(position(base + CYCLE).slot, 101);
  assert.equal(position(base + 27 * CYCLE + 32000).slot, 127);
  assert.equal(position(base + 27 * CYCLE + 32000).elapsed, 32000);
  const match = engine.createMatch(100);
  assert.equal(engine.snapshot(match, 43000).halftime, true);
  assert.equal(engine.snapshot(match, 47000).halftime, false);
  assert.equal(engine.snapshot(match, 47000).minute, 45);
  assert.equal(engine.snapshot(match, 90000).minute, 90);
});

test('separate browser runtimes reconstruct identical matches and late joins', () => {
  const context = createContext({});
  runInContext(readFileSync(new URL('../engine.js', import.meta.url), 'utf8'), context);
  const other = context.DerbyEngine.createEngine(data);
  for (const slot of [0, 143, 144, 196725, 9000001, -1]) {
    const a = engine.createMatch(slot);
    const b = other.createMatch(slot);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    for (const elapsed of [0, 32000, 43000, 47000, 65000, 90000, 299999]) {
      assert.equal(JSON.stringify(engine.snapshot(a, elapsed)), JSON.stringify(other.snapshot(b, elapsed)));
    }
  }
});

test('every block visits all 144 pairings exactly once', () => {
  for (const block of [0, 714, 1300]) {
    const pairs = new Set();
    for (let i = 0; i < 144; i++) {
      const pair = engine.pairing(block * 144 + i);
      pairs.add(pair.roma.id + ':' + pair.lazio.id);
    }
    assert.equal(pairs.size, 144);
  }
});

test('home club alternates every match and double chances follow home/away', () => {
  for (let slot = -2; slot < 300; slot++) {
    const pair = engine.pairing(slot);
    const next = engine.pairing(slot + 1);
    assert.notEqual(pair.home, next.home);
    assert.notEqual(pair.home, pair.away);
    const market = engine.markets(pair);
    assert.ok(Math.abs(market['1X'] - market[pair.home] - market.draw) < 1e-12);
    assert.ok(Math.abs(market['X2'] - market[pair.away] - market.draw) < 1e-12);
    const match = engine.createMatch(slot);
    assert.equal(match.home, pair.home);
    assert.equal(match.away, pair.away);
  }
});

test('calibration preserves softened targets; all markets agree with score distribution', () => {
  const mean = { roma: 0, draw: 0, lazio: 0 };
  for (const pair of engine.pairs) {
    const p = engine.probabilities(pair);
    for (const key of Object.keys(mean)) mean[key] += p[key] / 144;
    const market = engine.markets(pair);
    const cells = engine.distribution(pair);
    const sum = filter => cells.filter(filter).reduce((a, c) => a + c.probability, 0);
    assert.ok(Math.abs(sum(() => true) - 1) < 1e-12);
    assert.ok(Math.abs(market.roma - sum(c => c.roma > c.lazio)) < 1e-12);
    assert.ok(Math.abs(market.over - sum(c => c.roma + c.lazio >= 3)) < 1e-12);
    assert.ok(Math.abs(market.goal - sum(c => c.roma > 0 && c.lazio > 0)) < 1e-12);
    assert.ok(Math.abs(market.over + market.under - 1) < 1e-12);
    assert.ok(Math.abs(market.goal + market.noGoal - 1) < 1e-12);
  }
  for (const key of Object.keys(mean)) assert.ok(Math.abs(mean[key] - engine.target[key]) < 1e-10);
});

test('historical edge is softened, draw frequency stays intact and new scorelines are possible', () => {
  const historicalGap = engine.historical.roma - engine.historical.lazio;
  const newGap = engine.target.roma - engine.target.lazio;
  assert.ok(newGap > 0 && newGap < historicalGap);
  assert.ok(Math.abs(newGap - historicalGap * data.model.historyWeight) < 1e-12);
  assert.ok(Math.abs(engine.target.draw - engine.historical.draw) < 1e-12);
  const historicalScores = new Set(data.history.scores.map(s => `${s.roma}:${s.lazio}`));
  for (const pair of engine.pairs) {
    const cells = engine.distribution(pair);
    assert.equal(cells.length, 144);
    assert.ok(cells.every(s => s.probability >= 0 && Number.isFinite(s.probability)));
    const novel = cells.filter(s => !historicalScores.has(`${s.roma}:${s.lazio}`));
    assert.ok(novel.reduce((sum, s) => sum + s.probability, 0) > 0);
    assert.ok(cells.find(s => s.roma === 8 && s.lazio === 8).probability < 1e-8);
  }
});

test('5000 matches: goal chronology, named players, half-time and stats are coherent', () => {
  const results = { roma: 0, draw: 0, lazio: 0 };
  for (let slot = 0; slot < 5000; slot++) {
    const match = engine.createMatch(slot);
    const final = engine.snapshot(match, LIVE);
    const yellow = new Set();
    const active={roma:new Set(match.roma.starters.map(p=>p.name)),lazio:new Set(match.lazio.starters.map(p=>p.name))};
    for (let i = 0; i < match.events.length; i++) {
      const event = match.events[i];
      if (i) assert.ok(event.at >= match.events[i - 1].at);
      if (!event.club) continue;
      assert.ok(event.at > 0 && event.at < LIVE);
      assert.ok(event.at < 43000 || event.at >= 47000, 'no actions during interval');
      if(event.type==='sub') {
        assert.ok(active[event.club].has(event.outgoing.name));
        assert.ok(!active[event.club].has(event.incoming.name));
        assert.ok(match[event.club].bench.some(p=>p.name===event.incoming.name));
        active[event.club].delete(event.outgoing.name);active[event.club].add(event.incoming.name);
      }
      assert.ok(active[event.club].has(event.player),event.type+': '+event.player);
      if(event.type==='red')active[event.club].delete(event.player);
      if(event.assist)assert.ok(active[event.club].has(event.assist));
      assert.notEqual(event.player, event.assist);
      if (event.type === 'yellow') {
        assert.ok(!yellow.has(event.club+event.player));
        yellow.add(event.club+event.player);
      }
    }
    for (const club of ['roma', 'lazio']) {
      assert.equal(final.stats[club].goals, match.score[club]);
      assert.ok(final.stats[club].shots >= final.stats[club].onTarget);
      assert.ok(final.stats[club].onTarget >= final.stats[club].goals);
    }
    results[match.score.roma > match.score.lazio ? 'roma' : match.score.roma < match.score.lazio ? 'lazio' : 'draw']++;
  }
  for (const key of Object.keys(results)) assert.ok(Math.abs(results[key] / 5000 - engine.target[key]) < 0.025);
  console.log('5000 matches:', results);
});

test('cards and fresh substitutes change subsequent goals without rewriting earlier action', () => {
  let redChanges=0,subChanges=0,redMatches=0;
  for(let slot=0;slot<1000;slot++) {
    const game=engine.createMatch(slot);
    const red=game.events.find(e=>e.type==='red');
    const noRed=engine.createMatch(slot,{discipline:'none'});
    const noSubs=engine.createMatch(slot,{substitutions:false});
    if(red) {
      redMatches++;
      assert.equal(JSON.stringify(game.events.filter(e=>e.at<red.at)),JSON.stringify(noRed.events.filter(e=>e.at<red.at)));
      const other=red.club==='roma'?'lazio':'roma';
      assert.ok(game.score[red.club]<=noRed.score[red.club]);
      assert.ok(game.score[other]>=noRed.score[other]);
      if(JSON.stringify(game.score)!==JSON.stringify(noRed.score)) redChanges++;
      assert.equal(engine.snapshot(game,red.at).lineups[red.club].length,10);
    }
    assert.equal(game.events.filter(e=>e.type==='sub').length,4);
    for(const club of ['roma','lazio']) assert.ok(game.score[club]>=noSubs.score[club]);
    if(JSON.stringify(game.score)!==JSON.stringify(noSubs.score)) subChanges++;
    const report=engine.report(game);
    assert.equal(report.players.length,26);
    assert.ok(report.players.some(p=>p.name===report.mvp.name&&p.club===report.mvp.club));
    for(const player of report.players) assert.ok(player.rating===null||(player.rating>=3&&player.rating<=10));
  }
  assert.ok(redMatches>100&&redChanges>10);
  assert.ok(subChanges>50);
  console.log('Causal episodes in 1000 matches:',{redMatches,redChanges,subChanges});
});

test('daily standings: Rome midnight, only completed games, points/goals accounting and DST', () => {
  const midnight=Date.UTC(2026,10,14,23); // 15 November, 00:00 in Rome.
  assert.equal(engine.dailyStandings(midnight+LIVE-1).matches,0);
  assert.equal(engine.dailyStandings(midnight+LIVE).matches,1);
  const day=engine.dailyStandings(midnight+6*CYCLE+LIVE);
  assert.equal(day.matches,7);
  assert.equal(day.teams.reduce((sum,t)=>sum+t.played,0),14);
  assert.equal(day.teams.reduce((sum,t)=>sum+t.gf,0),day.scorers.reduce((sum,p)=>sum+p.goals,0));
  assert.equal(day.teams.reduce((sum,t)=>sum+t.gf,0),day.teams.reduce((sum,t)=>sum+t.ga,0));
  for(const t of day.teams){assert.equal(t.points,t.won*3+t.drawn);assert.equal(t.played,t.won+t.drawn+t.lost);}
  const spring=engine.dailyStandings(Date.UTC(2026,2,29,21,59,59));
  assert.equal(spring.end-spring.start,23*3600000);assert.equal(spring.matches,276);
  const autumn=engine.dailyStandings(Date.UTC(2026,9,25,22,59,59));
  assert.equal(autumn.end-autumn.start,25*3600000);assert.equal(autumn.matches,300);
});
