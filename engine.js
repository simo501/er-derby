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
    const historical = Object.fromEntries(Object.entries(data.history.counts).map(([key, n]) => [key, n / total]));
    const settings = data.model;
    const historyWeight = settings.historyWeight;
    const exploratoryWeight = settings.exploratoryWeight;
    // Mix the real score sample with its mirror: preserve draws, soften the
    // historical club advantage without modifying the archived real results.
    const historicalScores = new Map(data.history.scores.map(s => [`${s.roma}:${s.lazio}`, s.count]));
    const effectiveCounts = { roma: 0, draw: 0, lazio: 0 };
    const scoreWeights = [];
    let meanRoma = 0;
    let meanLazio = 0;
    const originalWeight = (1 + historyWeight) / 2;
    for (let r = 0; r <= settings.maxGoals; r++) {
      for (let l = 0; l <= settings.maxGoals; l++) {
        const count = originalWeight * (historicalScores.get(`${r}:${l}`) || 0)
          + (1 - originalWeight) * (historicalScores.get(`${l}:${r}`) || 0);
        effectiveCounts[outcome(r, l)] += count;
        meanRoma += r * count / total;
        meanLazio += l * count / total;
        scoreWeights.push({ roma: r, lazio: l, count });
      }
    }
    const target = Object.fromEntries(Object.entries(effectiveCounts).map(([key, n]) => [key, n / total]));
    const poisson = (goals, mean) => {
      let value = Math.exp(-mean);
      for (let i = 1; i <= goals; i++) value *= mean / i;
      return value;
    };
    const exploratoryTotals = { roma: 0, draw: 0, lazio: 0 };
    for (const cell of scoreWeights) {
      cell.exploratory = poisson(cell.roma, meanRoma) * poisson(cell.lazio, meanLazio);
      exploratoryTotals[outcome(cell.roma, cell.lazio)] += cell.exploratory;
    }
    const pairs = roma.flatMap(r => lazio.map(l => ({ roma: r, lazio: l })));
    const biases = { roma: 1, draw: 1, lazio: 1 };

    function baselineProbabilities(pair) {
      // Editorial season strength has a bounded effect. Intercepts below restore
      // the softened historical frequencies across the 144 equally likely pairs.
      const delta = (pair.roma.rating - pair.lazio.rating) * settings.strengthWeight;
      const weights = { roma: baselineTarget.roma * Math.exp(delta) * biases.roma,
        draw: baselineTarget.draw * biases.draw, lazio: baselineTarget.lazio * Math.exp(-delta) * biases.lazio };
      const sum = weights.roma + weights.draw + weights.lazio;
      return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / sum]));
    }

    const categories = ['roma', 'draw', 'lazio'];
    const scenarios = [{ club: null, minute: 90, weight: 1 - settings.disciplineRate }];
    for (const club of ['roma', 'lazio']) for (const minute of [30, 55, 70]) {
      scenarios.push({ club, minute, weight: settings.disciplineRate / 6 });
    }
    const maxScore = settings.maxGoals + 3;
    const scoreKey = (r, l) => r * (maxScore + 1) + l;
    const finalCells = Array.from({length: (maxScore + 1) ** 2}, (_, i) => ({ roma: Math.floor(i / (maxScore + 1)), lazio: i % (maxScore + 1) }));
    const conditional = Object.fromEntries(categories.map(key => [key, new Float64Array(finalCells.length)]));
    function goalKernel(n, club, scenario) {
      const survival = scenario.club === club ? 1 - ((89 - scenario.minute) / 87) * (1 - settings.redRetention) : 1;
      const weights = Array.from({length: n + 1}, (_, k) => {
        let combinations = 1;
        for (let i = 1; i <= k; i++) combinations *= (n - i + 1) / i;
        return combinations * survival ** k * (1 - survival) ** (n - k);
      });
      const extras = [...settings.freshGoalChances];
      if (scenario.club && scenario.club !== club) extras.push(0.28 * (90 - scenario.minute) / 90);
      for (const chance of extras) {
        weights.push(0);
        for (let k = weights.length - 1; k >= 0; k--) weights[k] = (weights[k] || 0) * (1 - chance) + (k ? weights[k - 1] * chance : 0);
      }
      return weights;
    }
    for (const cell of scoreWeights) {
      const key = outcome(cell.roma, cell.lazio);
      const prior = (1 - exploratoryWeight) * cell.count / effectiveCounts[key] + exploratoryWeight * cell.exploratory / exploratoryTotals[key];
      for (const scenario of scenarios) {
        const r = goalKernel(cell.roma, 'roma', scenario);
        const l = goalKernel(cell.lazio, 'lazio', scenario);
        for (let i = 0; i < r.length; i++) for (let j = 0; j < l.length; j++) conditional[key][scoreKey(i,j)] += prior * scenario.weight * r[i] * l[j];
      }
    }
    const response = Object.fromEntries(categories.map(key => [key, {roma:0, draw:0, lazio:0}]));
    for (const key of categories) finalCells.forEach((cell, i) => { response[key][outcome(cell.roma, cell.lazio)] += conditional[key][i]; });
    // Correct the starting weights for the exact marginal effects of cards and
    // fresh substitutes, so quoted odds and long-run club balance remain aligned.
    const baselineTarget = {...target};
    for (let i = 0; i < 200; i++) {
      const actual = Object.fromEntries(categories.map(key => [key, categories.reduce((sum, from) => sum + baselineTarget[from] * response[from][key], 0)]));
      if (categories.every(key => Math.abs(actual[key] - target[key]) < 1e-13)) break;
      for (const key of categories) baselineTarget[key] += target[key] - actual[key];
    }
    for (let iteration = 0; iteration < 300; iteration++) {
      const mean = { roma: 0, draw: 0, lazio: 0 };
      for (const pair of pairs) {
        const p = baselineProbabilities(pair);
        for (const key of categories) mean[key] += p[key] / pairs.length;
      }
      if (categories.every(key => Math.abs(mean[key] - baselineTarget[key]) < 1e-13)) break;
      for (const key of categories) biases[key] *= baselineTarget[key] / mean[key];
    }
    function probabilities(pair) {
      const p = baselineProbabilities(pair);
      return Object.fromEntries(categories.map(key => [key, categories.reduce((sum, from) => sum + p[from] * response[from][key], 0)]));
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
      const pair = schedule[((slot % pairs.length) + pairs.length) % pairs.length];
      const home = slot % 2 === 0 ? 'roma' : 'lazio';
      return { ...pair, home, away: home === 'roma' ? 'lazio' : 'roma' };
    }

    const distributionCache = new Map();
    function distribution(pair) {
      const key = `${pair.roma.id}:${pair.lazio.id}`;
      if (!distributionCache.has(key)) {
        const p = baselineProbabilities(pair);
        distributionCache.set(key, finalCells.map((cell,i) => ({...cell, probability: categories.reduce((sum, from) => sum + p[from] * conditional[from][i], 0)})));
      }
      return distributionCache.get(key);
    }

    function markets(pair) {
      const cells = distribution(pair);
      const sum = predicate => cells.filter(predicate).reduce((value, cell) => value + cell.probability, 0);
      const p = probabilities(pair);
      const home = pair.home || 'roma';
      const away = home === 'roma' ? 'lazio' : 'roma';
      return { ...p, '1X': p[home] + p.draw, 'X2': p.draw + p[away], '12': p.roma + p.lazio,
        over: sum(s => s.roma + s.lazio >= 3), under: sum(s => s.roma + s.lazio < 3),
        goal: sum(s => s.roma > 0 && s.lazio > 0), noGoal: sum(s => !s.roma || !s.lazio),
        exact: [...cells].sort((a, b) => b.probability - a.probability) };
    }

    function createMatch(slot, overrides = {}) {
      const pair = pairing(slot);
      const random = randomFrom(`${data.version}:match:${slot}`);
      const p = baselineProbabilities(pair);
      const baseCells = scoreWeights.map(cell => {
        const key = outcome(cell.roma, cell.lazio);
        return {...cell, probability: p[key] * ((1 - exploratoryWeight) * cell.count / effectiveCounts[key] + exploratoryWeight * cell.exploratory / exploratoryTotals[key])};
      });
      const baseline = pick(baseCells, random, cell => cell.probability);
      const scenario = overrides.discipline === 'none' ? scenarios[0] : pick(scenarios, randomFrom(`${data.version}:discipline:${slot}`), s => s.weight);
      const active = {roma: pair.roma.starters.map(p => ({...p})), lazio: pair.lazio.starters.map(p => ({...p}))};
      const unused = {roma: pair.roma.bench.filter(p => p.role !== 'P').map(p => ({...p})), lazio: pair.lazio.bench.filter(p => p.role !== 'P').map(p => ({...p}))};
      const score = {roma:0, lazio:0};
      const drafts = [];
      const events = [
        {at:0, minute:0, type:'kickoff', title:'Il derby comincia.', text:'Le curve si alzano. Ventidue in campo, una città divisa.'},
        {at:43000, minute:45, type:'halftime', title:'Intervallo', text:'Fiato corto, sciarpe alte. La partita non è finita.'},
        {at:47000, minute:45, type:'kickoff', title:'Comincia il secondo tempo', text:'Si riparte. Nessuno abbassa la voce.'},
        {at:LIVE, minute:90, type:'fulltime', title:'Triplice fischio', text:'Il risultato resta. Le curve non si fermano.'}
      ];
      const atMinute = minute => minute <= 45 ? Math.min(42999,Math.round(timeAt(minute))) : Math.round(timeAt(minute));
      for (const club of ['roma','lazio']) {
        for (let i=0; i<baseline[club]; i++) {
          const roll = randomFrom(`${data.version}:goal:${slot}:${club}:${i}`);
          const minute = 2 + roll() * 87;
          if (scenario.club === club && minute > scenario.minute && roll() > settings.redRetention) continue;
          drafts.push({type:'goal', club, minute, at:atMinute(minute)});
        }
        for (const [i,minute] of [55,70].entries()) {
          drafts.push({type:'sub', club, minute, at:atMinute(minute)});
          const fresh = randomFrom(`${data.version}:fresh:${slot}:${club}:${i}`);
          if (overrides.substitutions !== false && fresh() < settings.freshGoalChances[i]) {
            const goalMinute = minute + 1 + fresh() * (88-minute);
            drafts.push({type:'goal', club, minute:goalMinute, at:atMinute(goalMinute)});
          }
        }
        if (scenario.club && scenario.club !== club) {
          const advantage = randomFrom(`${data.version}:advantage:${slot}:${club}`);
          if (advantage() < 0.28 * (90-scenario.minute)/90) {
            const minute = scenario.minute + 1 + advantage() * (88-scenario.minute);
            drafts.push({type:'goal', club, minute, at:atMinute(minute)});
          }
        }
      }
      if (scenario.club) drafts.push({type:'red', club:scenario.club, minute:scenario.minute, at:atMinute(scenario.minute)});
      for (let i=0; i<22; i++) {
        const roll = randomFrom(`${data.version}:chance:${slot}:${i}`);
        const minute = 2 + i * 3.9 + roll()*1.1;
        drafts.push({type:'chance', club:roll()<0.5?'roma':'lazio', minute, at:atMinute(minute)});
      }
      const priority = {sub:0,red:1,chance:2,goal:3};
      drafts.sort((a,b) => a.at-b.at || priority[a.type]-priority[b.type] || (a.club<b.club?-1:a.club>b.club?1:0));
      const booked = new Set();
      let lastChange = 0;
      for (const [index,draft] of drafts.entries()) {
        const {club,at} = draft;
        const other = club==='roma'?'lazio':'roma';
        const roll = randomFrom(`${data.version}:actors:${slot}:${index}`);
        const outfield = active[club].filter(p => p.role!=='P');
        if (draft.type === 'sub') {
          if (overrides.substitutions === false || !unused[club].length) continue;
          const incoming = unused[club].pop();
          const sameRole = outfield.filter(p => p.role===incoming.role);
          const outgoing = pick(sameRole.length?sameRole:outfield,roll);
          const positionIndex = active[club].findIndex(p => p.name===outgoing.name);
          incoming.line = outgoing.line;
          incoming.positionName = outgoing.positionName || outgoing.name;
          active[club][positionIndex] = incoming;
          events.push({...draft, minute:Math.floor(draft.minute), player:incoming.name, incoming:{...incoming}, outgoing:{...outgoing}, title:`Entra ${incoming.name}`, text:`${pair[club].coach} cambia: esce ${outgoing.name}, entra ${incoming.name}. Gambe fresche per il finale.`});
          lastChange=at;
          continue;
        }
        const player = pick(outfield,roll,p => p.role==='A'?7:p.role==='C'?3:1);
        if (draft.type==='red') {
          active[club] = active[club].filter(p => p.name!==player.name);
          events.push({...draft, minute:Math.floor(draft.minute), player:player.name, title:`Espulso ${player.label || player.name}`, text:`${player.name} lascia il campo: ${club.toUpperCase()} in dieci. ${booked.has(club+player.name)?'Seconda ammonizione.':'Rosso diretto.'}`});
          lastChange=at;
          continue;
        }
        const assist = pick(outfield.filter(p => p.name!==player.name),roll);
        const defender = pick(active[other].filter(p => p.role!=='P'),roll,p=>p.role==='D'?4:1);
        const keeper = active[other].find(p=>p.role==='P');
        const value = roll();
        let type = draft.type==='goal'?'goal':value<0.34?'save':value<0.59?'miss':value<0.75?'corner':value<0.86?'yellow':'defence';
        if(type==='yellow' && booked.has(club+player.name)) type='defence';
        if(type==='yellow') booked.add(club+player.name);
        const common = {club,player:player.name,assist:assist.name,defender:defender.name,keeper:keeper.name,minute:Math.floor(draft.minute),at,x:club===pair.home?75:25,y:25+roll()*50};
        if(type!=='yellow') {
          // Build-ups never cross a possible roster change, including in the
          // counterfactual run without a card. Earlier visible action is fixed.
          const barrier = [30,55,70].map(atMinute).filter(change=>change<=at).reduce((latest,change)=>Math.max(latest,change),0);
          const attackAt = Math.max(at-1600,lastChange+1,barrier+1,at>=47000?47000:0);
          events.push({...common,at:Math.min(attackAt,at),minute:Math.floor(minuteAt(Math.min(attackAt,at))),type:'build',title:`${assist.label || assist.name} cerca ${player.label || player.name}`,text:`${assist.name} avanza e serve ${player.name}.`,x:club===pair.home?56:44});
        }
        const variants = {
          goal:[`Gol di ${player.label || player.name}!`,`${assist.name} trova ${player.name}: conclusione vincente, ${keeper.name} è battuto!`],
          save:[`${keeper.label || keeper.name} dice no`,`${player.name} calcia: ${keeper.name} para e tiene il risultato.`],
          miss:[`${player.label || player.name}, di poco fuori`,`${assist.name} apre lo spazio. Il tiro di ${player.name} finisce oltre il palo.`],
          corner:['Calcio d’angolo',`${defender.name} chiude il cross di ${player.name}. Pallone in angolo.`],
          yellow:[`Ammonito ${player.label || player.name}`,`${player.name} ferma fallosamente ${defender.name}. L’arbitro estrae il giallo.`],
          defence:[`${defender.label || defender.name} chiude tutto`,`${player.name} cerca il varco, ${defender.name} intercetta e allontana.`]
        };
        if(type==='goal') score[club]++;
        events.push({...common,type,title:variants[type][0],text:variants[type][1]});
      }
      events.sort((a,b)=>a.at-b.at);
      return {slot,start:EPOCH+slot*CYCLE,...pair,score,odds:markets(pair),events};
    }

    function snapshot(match,elapsed) {
      const visible = match.events.filter(event=>event.at<=elapsed);
      const lineups = {roma:match.roma.starters.map(p=>({...p})),lazio:match.lazio.starters.map(p=>({...p}))};
      const stats = {roma:{goals:0,shots:0,onTarget:0,corners:0,yellow:0,red:0,substitutions:0,attacks:0},lazio:{goals:0,shots:0,onTarget:0,corners:0,yellow:0,red:0,substitutions:0,attacks:0}};
      for(const event of visible) {
        if(!event.club) continue;
        const s=stats[event.club];
        if(event.type==='sub') {
          const index=lineups[event.club].findIndex(p=>p.name===event.outgoing.name);
          if(index>=0) lineups[event.club][index]={...event.incoming};
          s.substitutions++;
        }
        if(event.type==='red') {lineups[event.club]=lineups[event.club].filter(p=>p.name!==event.player);s.red++;}
        if(event.type==='build') s.attacks++;
        if(['goal','save','miss'].includes(event.type)) s.shots++;
        if(['goal','save'].includes(event.type)) s.onTarget++;
        if(event.type==='goal') s.goals++;
        if(event.type==='corner') s.corners++;
        if(event.type==='yellow') s.yellow++;
      }
      const attacks=stats.roma.attacks+stats.lazio.attacks;
      stats.roma.pressure=attacks?Math.round(stats.roma.attacks/attacks*100):50;
      stats.lazio.pressure=100-stats.roma.pressure;
      return {events:visible,stats,lineups,minute:Math.floor(minuteAt(elapsed)),halftime:elapsed>=43000&&elapsed<47000,finished:elapsed>=LIVE};
    }

    function report(match) {
      const players=[];
      const key=(club,name)=>club+':'+name;
      const indexed=new Map();
      for(const club of ['roma','lazio']) for(const p of match[club].starters) {
        const entry={...p,club,goals:0,assists:0,saves:0,points:6,entered:0,exited:90,red:false};
        players.push(entry);indexed.set(key(club,p.name),entry);
      }
      for(const event of match.events) {
        if(!event.club) continue;
        const club=event.club;
        if(event.type==='sub') {
          indexed.get(key(club,event.outgoing.name)).exited=event.minute;
          const entry={...event.incoming,club,goals:0,assists:0,saves:0,points:6,entered:event.minute,exited:90,red:false};
          players.push(entry);indexed.set(key(club,entry.name),entry);
          continue;
        }
        const player=indexed.get(key(club,event.player));
        const opposite=club==='roma'?'lazio':'roma';
        if(event.type==='goal') {player.goals++;player.points+=1.05;const assist=indexed.get(key(club,event.assist));assist.assists++;assist.points+=0.45;indexed.get(key(opposite,event.keeper)).points-=0.3;}
        if(event.type==='save') {const keeper=indexed.get(key(opposite,event.keeper));keeper.saves++;keeper.points+=0.18;player.points+=0.03;}
        if(event.type==='miss') player.points-=0.06;
        if(event.type==='defence') indexed.get(key(opposite,event.defender)).points+=0.12;
        if(event.type==='yellow') player.points-=0.25;
        if(event.type==='red') {player.red=true;player.points-=1.4;player.exited=event.minute;}
      }
      for(const player of players) {player.minutes=player.exited-player.entered;player.rating=player.minutes<10&&!player.goals&&!player.assists&&!player.red?null:Math.round(Math.max(3,Math.min(10,player.points))*10)/10;delete player.points;}
      const ranked=players.filter(p=>p.rating!==null).sort((a,b)=>b.rating-a.rating||b.goals-a.goals||b.assists-a.assists||(a.name<b.name?-1:a.name>b.name?1:0));
      const mvp=ranked[0];
      const winner=outcome(match.score.roma,match.score.lazio);
      const text=winner==='draw'?'Nessuna curva si prende la città: finisce in parità.':`${winner.toUpperCase()} si prende il derby. L’altra curva aspetta la rivincita.`;
      return {players,mvp,summary:`${text} ${mvp.name} è il migliore in campo con ${mvp.rating.toFixed(1)}.`};
    }

    let standingsCache;
    function dailyStandings(now) {
      const dateParts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
      const get=type=>Number(dateParts.find(p=>p.type===type).value);
      const midnight=Date.UTC(get('year'),get('month')-1,get('day'));
      const romeHour=stamp=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',hourCycle:'h23'}).format(stamp));
      const start=midnight-romeHour(midnight)*3600000;
      const nextMidnight=midnight+86400000;
      const end=nextMidnight-romeHour(nextMidnight)*3600000;
      const first=Math.ceil((start-EPOCH)/CYCLE);
      const last=Math.floor((Math.min(now,end)-LIVE-EPOCH)/CYCLE);
      const cacheKey=`${start}:${last}`;
      if(standingsCache?.key===cacheKey) return standingsCache.value;
      const rows=data.teams.map(team=>({id:team.id,club:team.club,season:team.season,played:0,points:0,won:0,drawn:0,lost:0,gf:0,ga:0}));
      const byId=new Map(rows.map(row=>[row.id,row]));
      const scorerMap=new Map();
      for(let slot=first;slot<=last;slot++) {
        const game=createMatch(slot);
        for(const club of ['roma','lazio']) {
          const row=byId.get(game[club].id);const opponent=club==='roma'?'lazio':'roma';row.played++;row.gf+=game.score[club];row.ga+=game.score[opponent];
          if(game.score[club]>game.score[opponent]) {row.won++;row.points+=3;} else if(game.score[club]===game.score[opponent]) {row.drawn++;row.points++;} else row.lost++;
        }
        for(const event of game.events.filter(e=>e.type==='goal')) {
          const key=event.club+':'+event.player;
          if(!scorerMap.has(key)) scorerMap.set(key,{club:event.club,name:event.player,goals:0});
          scorerMap.get(key).goals++;
        }
      }
      rows.sort((a,b)=>b.points-a.points||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf||(a.id<b.id?-1:a.id>b.id?1:0));
      const scorers=[...scorerMap.values()].sort((a,b)=>b.goals-a.goals||(a.name<b.name?-1:a.name>b.name?1:0));
      const value={start,end,matches:Math.max(0,last-first+1),teams:rows,scorers};
      standingsCache={key:cacheKey,value};return value;
    }

    return { pairing, probabilities, distribution, markets, createMatch, snapshot, target, historical, pairs, report, dailyStandings };
  }

  root.DerbyEngine = { CYCLE, LIVE, EPOCH, position, minuteAt, timeAt, randomFrom, createEngine };
})(globalThis);
