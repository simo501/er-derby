(function () {
  'use strict';
  const data = window.DERBY_DATA;
  const { CYCLE, LIVE, position, createEngine } = window.DerbyEngine;
  const engine = createEngine(data);
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timeFormat = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
  const clockFormat = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateFormat = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short' });
  const icons = { goal: '⚽', save: '◇', miss: '↗', yellow: '▰', corner: '⚑', defence: '⊘', kickoff: '▶', halftime: 'Ⅱ', fulltime: '■', build: '→', red: '▰', sub: '⇄' };
  const roles = { P: 'Portiere', D: 'Difensore', C: 'Centrocampista', A: 'Attaccante' };
  let match;
  let nextMatch;
  let snapshot;
  let lastEventCount = -1;
  let lastFinished;
  let selectedMarket = 'result';
  let selectedTab = 'cronaca';
  let page = '';
  let rosterKey = '';
  let liveBall;
  const stadiumAudio = new window.StadiumAudio({
    onStatus: message => { $('audio-status').textContent = message; },
    onInterrupted: () => { $('audio-toggle').textContent = '◖ Riprendi audio'; }
  });
  document.body.dataset.lineupView = 'pitch';

  function badge(club) {
    return `<img class="mini-crest ${club}" src="assets/${club}.${club === 'roma' ? 'svg' : 'png'}" alt="" width="28" height="32">`;
  }

  function pairLabel(game) {
    return `<span class="${game.home}-color">${game.home.toUpperCase()} <b>${escape(game[game.home].season)}</b></span><span class="versus">vs</span><span class="${game.away}-color">${game.away.toUpperCase()} <b>${escape(game[game.away].season)}</b></span>`;
  }

  function openDialog(content) {
    $('dialog-content').innerHTML = content;
    $('detail-dialog').showModal();
  }

  function playerRows(players) {
    return players.map(p => `<li><span class="player-role">${p.role}</span><span>${escape(p.name)}</span><span class="player-number">${p.number ?? '—'}</span></li>`).join('');
  }

  function lineupControls() {
    const view = document.body.dataset.lineupView;
    return `<div class="lineup-tools"><div class="lineup-view-switch" role="group" aria-label="Visualizzazione della formazione"><button data-lineup-view="pitch" aria-pressed="${view === 'pitch'}">In campo</button><button data-lineup-view="list" aria-pressed="${view === 'list'}">Elenco</button></div></div>`;
  }

  function formationMarkers(team, half = null, activePlayers = null) {
    const rows = [1, ...team.formation.split('-').map(Number)];
    return rows.flatMap((count, line) => {
      const originalRow = team.starters.filter(player => player.line === line);
      const players = (activePlayers || team.starters).filter(player => player.line === line);
      return players.map(player => {
        const index = originalRow.findIndex(p => p.name === (player.positionName || player.name));
        const x = half === 'bottom' ? (index + 0.5) * 100 / count : 100 - (index + 0.5) * 100 / count;
        const depth = line / (rows.length - 1);
        const y = half === 'top' ? 5 + depth * 38 : half === 'bottom' ? 95 - depth * 38 : 91 - depth * 80;
        const number = player.number ?? player.role;
        return `<div class="formation-player ${team.club}" data-player="${escape(player.name)}" data-club="${team.club}" role="group" aria-label="${escape(player.name)}, ${team.club.toUpperCase()}, ${roles[player.role]}${player.number ? ', numero ' + player.number : ''}" style="--player-x:${x}%;--player-y:${y}%;--player-space:${Math.min(31, 94 / count)}%"><span class="formation-shirt ${line === 0 ? 'keeper' : ''}" aria-hidden="true">${escape(number)}</span><span class="formation-name" title="${escape(player.name)}">${escape(player.label || player.name)}</span></div>`;
      });
    }).join('');
  }

  function fieldLines() {
    return '<div class="formation-boundary" aria-hidden="true"><span class="formation-halfway"></span><span class="formation-circle"></span><span class="formation-area top"></span><span class="formation-area bottom"></span></div>';
  }

  function formationPitch(team) {
    return `<div class="formation-field ${team.club}" role="group" aria-label="${team.club.toUpperCase()} ${team.season}, modulo ${team.formation}">${fieldLines()}<span class="formation-direction" aria-hidden="true">ATTACCO ↑</span>${formationMarkers(team)}</div>`;
  }

  function matchLineups(game, includeBench = true, state = null) {
    const home = game[game.home];
    const away = game[game.away];
    return `<div class="lineup-pitch-view combined-pitch-view"><div class="combined-legend"><span>${badge(game.home)}<b>${game.home.toUpperCase()}</b> <small>${home.formation} · CASA</small></span><span>${badge(game.away)}<b>${game.away.toUpperCase()}</b> <small>${away.formation} · TRASFERTA</small></span></div><div class="formation-field combined-field" role="group" aria-label="Formazioni contrapposte: ${game.home.toUpperCase()} ${home.formation} e ${game.away.toUpperCase()} ${away.formation}, ${state ? state.lineups.roma.length + state.lineups.lazio.length : 22} giocatori sullo stesso campo">${fieldLines()}${formationMarkers(home, 'top', state?.lineups[game.home])}${formationMarkers(away, 'bottom', state?.lineups[game.away])}</div></div><div class="lineup-details">${lineup(home, includeBench, false, state?.lineups[game.home])}${lineup(away, includeBench, false, state?.lineups[game.away])}</div>`;
  }

  function formationNote(team) {
    const info = team.formationInfo;
    if (info.kind === 'reconstruction') {
      return `<p class="formation-note">${escape(info.label)} · ricostruzione storica</p><details class="formation-source"><summary>Come è stato scelto il modulo</summary><p>${escape(info.note)}</p><a href="${escape(info.source)}" target="_blank" rel="noreferrer">Riferimento storico ↗</a></details>`;
    }
    const ranking = Object.entries(info.counts).sort((a, b) => b[1] - a[1]).map(([shape, n]) => `${shape}: ${n}`).join(' · ');
    return `<p class="formation-note">Modulo prevalente: ${info.matches} su ${info.sampleSize} tabellini disponibili</p><details class="formation-source"><summary>I moduli di ${escape(team.coach)}</summary><p>${escape(info.note)} Il conteggio comprende le competizioni ufficiali; gli archivi più vecchi sono parziali. In caso di parità si mantiene l’assetto rappresentativo.</p><p>${escape(ranking)}</p><a href="${escape(info.source)}" target="_blank" rel="noreferrer">Tabellini della stagione ↗</a></details>`;
  }

  function lineup(team, includeBench = true, showPitch = true, activePlayers = null) {
    return `<div class="lineup" data-lineup-team="${team.club}"><div class="lineup-heading">${badge(team.club)}<div><h3>${team.club.toUpperCase()} <span>${team.season}</span></h3><p>${escape(team.coach)}</p></div><strong class="formation-badge">${team.formation}</strong></div>${showPitch ? `<div class="lineup-pitch-view">${formationPitch(team)}</div>` : ''}<div class="lineup-list-view"><ol class="player-list">${playerRows(activePlayers || team.starters)}</ol></div>${formationNote(team)}${includeBench ? `<details class="lineup-bench"><summary>Riserve della rosa · ${team.bench.length}</summary><ol class="player-list bench">${playerRows(team.bench)}</ol></details>` : ''}<button class="text-button" data-team="${team.id}">Le maglie, gli uomini, la storia ↗</button></div>`;
  }

  function showTeam(id) {
    const team = data.teams.find(t => t.id === id);
    if (!team) return;
    openDialog(`<div class="eyebrow ${team.club}-color">ARCHIVIO DELLE CURVE</div><h2 id="dialog-title">${team.club.toUpperCase()} ${team.season}</h2><p class="dialog-story">${escape(team.story)}</p><p>${escape(team.coach)} · ${team.formation}</p><div class="rating-note">Forza del simulatore <b>${team.rating}/100</b><span>Valutazione editoriale, non una statistica storica.</span></div><h3>Undici maglie, una curva alle spalle.</h3>${lineupControls()}<div class="team-formation-detail"><div class="lineup-pitch-view">${formationPitch(team)}</div><div class="lineup-list-view"><ol class="player-list">${playerRows(team.starters)}</ol></div>${formationNote(team)}</div><h3>Rosa documentata · ${team.roster.length} giocatori</h3><p class="small-muted">P portiere · D difensore · C centrocampista · A attaccante. “—” indica un numero non disponibile. La rosa può comprendere trasferimenti durante la stagione.</p><ol class="player-list roster">${playerRows(team.roster)}</ol><a class="source-link" href="${escape(team.source)}" target="_blank" rel="noreferrer">Fonte della rosa: archivio stagionale Wikipedia ↗</a><p class="small-muted">Fonte consultata il 15 novembre 2026. Undici e riserve sono selezioni editoriali; in diretta sono previsti due cambi automatici.</p>`);
  }

  function showArchived(slot) {
    const current = position(Date.now());
    if (slot >= current.slot) return;
    const game = engine.createMatch(slot);
    const final = engine.snapshot(game, LIVE);
    const goals = final.events.filter(e => e.type === 'goal');
    openDialog(`<div class="eyebrow">DERBY VIRTUALE · ${dateFormat.format(game.start)} ${timeFormat.format(game.start)}</div><h2 id="dialog-title">${game.home.toUpperCase()} ${game.score[game.home]} – ${game.score[game.away]} ${game.away.toUpperCase()}</h2><div class="archive-pair">${pairLabel(game)}</div><p>Simulazione conclusa · ${escape(data.version)}</p><h3>I gol</h3>${goals.length ? goals.map(e => `<p class="goal-line ${e.club}-color">${e.minute}′ &nbsp; ${escape(e.player)} <span>· assist ${escape(e.assist)}</span></p>`).join('') : '<p>Nessun gol. Le difese hanno avuto la meglio.</p>'}<h3>Le formazioni</h3>${lineupControls()}<div class="lineups match-lineups">${matchLineups(game, false, final)}</div>${reportMarkup(game)}<h3>Gli episodi</h3><ol class="commentary dialog-commentary">${final.events.filter(e => !['build', 'kickoff'].includes(e.type)).reverse().map(eventRow).join('')}</ol>`);
  }

  function eventRow(event) {
    return `<li class="event ${event.type} ${event.club || ''}"><time>${event.minute}′</time><span class="event-icon">${icons[event.type]}</span><div><strong>${escape(event.title)}</strong><p>${escape(event.text)}</p></div></li>`;
  }

  function archiveCard(game) {
    const row = club => `<div class="result-row">${badge(club)}<span>${club === 'roma' ? 'Roma' : 'Lazio'} <small>${game[club].season}</small></span><strong>${game.score[club]}</strong></div>`;
    return `<button class="result-card" data-archive="${game.slot}" aria-label="Dettaglio ${game.home} ${game[game.home].season} ${game.score[game.home]} a ${game.score[game.away]} ${game.away} ${game[game.away].season}"><div class="result-date">${dateFormat.format(game.start)} · ${timeFormat.format(game.start)} <span>FINALE</span></div>${row(game.home)}${row(game.away)}<span class="result-link">Rivedi la partita <b>↗</b></span></button>`;
  }

  function updateRelated() {
    $('recent').innerHTML = Array.from({ length: 4 }, (_, i) => archiveCard(engine.createMatch(match.slot - 1 - i))).join('');
    if (page === 'archivio') renderArchive();
    if (page === 'classifiche') renderStandings();
    $('schedule').innerHTML = Array.from({ length: 3 }, (_, i) => {
      const future = engine.createMatch(match.slot + i + 2);
      return `<div class="schedule-row"><time>${timeFormat.format(future.start)}</time><div><span>${future.home === 'roma' ? 'Roma' : 'Lazio'} <b>${future[future.home].season}</b></span><span>${future.away === 'roma' ? 'Roma' : 'Lazio'} <b>${future[future.away].season}</b></span></div><span class="schedule-dot">↗</span></div>`;
    }).join('');
    $('next-time').textContent = `${timeFormat.format(nextMatch.start)} · ROMA`;
    $('next-pair').innerHTML = pairLabel(nextMatch);
  }

  function renderArchive() {
    if (!match) return;
    $('archive').innerHTML = Array.from({ length: 24 }, (_, i) => archiveCard(engine.createMatch(match.slot - 1 - i))).join('');
  }

  function renderTeams(club = 'all') {
    $('teams').innerHTML = data.teams.filter(t => club === 'all' || t.club === club).map(team => `<button class="team-card ${team.club}" data-team="${team.id}"><div class="team-card-top"><span>${team.club === 'roma' ? 'MEMORIA DELLA SUD' : 'MEMORIA DELLA NORD'}</span><span class="archive-number">N° ${String(data.teams.indexOf(team) + 1).padStart(2, '0')}</span></div><div class="team-card-art">${badge(team.club)}<div><span>${team.club.toUpperCase()}</span><strong class="team-year">${team.season}</strong></div></div><h2>${escape(team.coach)}</h2><p>${escape(team.story)}</p><div class="team-card-bottom"><span>${team.formation} · ${team.roster.length} GIOCATORI</span><span>Esplora ↗</span></div></button>`).join('');
  }

  function renderOdds() {
    const forNext = snapshot.finished;
    const game = forNext ? nextMatch : match;
    const markets = game.odds;
    const home = game.home;
    const away = game.away;
    $('odds-title').textContent = forNext ? 'Quote del prossimo derby' : 'Le probabilità';
    $('odds-caption').textContent = `${home === 'roma' ? 'Roma' : 'Lazio'} ${game[home].season} × ${away === 'roma' ? 'Roma' : 'Lazio'} ${game[away].season} · prepartita`;
    const cell = (label, p, caption = '') => `<div class="odds-cell"><span>${label}</span><strong>${(1 / p).toFixed(2).replace('.', ',')}</strong><small>${(p * 100).toFixed(1).replace('.', ',')}%${caption ? ' · ' + caption : ''}</small></div>`;
    $('odds').className = `odds-grid ${selectedMarket}`;
    $('odds').dataset.home = home;
    if (selectedMarket === 'result') {
      $('odds').innerHTML = cell(`1 · ${home.toUpperCase()}`, markets[home]) + cell('X · PARI', markets.draw) + cell(`2 · ${away.toUpperCase()}`, markets[away]) + `<div class="market-label">DOPPIA CHANCE</div>` + cell('1X', markets['1X']) + cell('12', markets['12']) + cell('X2', markets['X2']);
    } else if (selectedMarket === 'goals') {
      $('odds').innerHTML = cell('OVER 2,5', markets.over) + cell('UNDER 2,5', markets.under) + cell('GOL', markets.goal) + cell('NO GOL', markets.noGoal);
    } else {
      $('odds').innerHTML = markets.exact.slice(0, 9).map(s => cell(`${s[home]} – ${s[away]}`, s.probability)).join('') + '<p class="exact-note">I nove punteggi più probabili. Il primo numero è della squadra di casa.</p>';
    }
  }


  function reportMarkup(game) {
    const report = engine.report(game);
    const rows = club => report.players.filter(p=>p.club===club).map(p=>`<li><span>${escape(p.name)}<small>${p.minutes}′${p.goals?' · '+p.goals+' gol':''}${p.assists?' · '+p.assists+' assist':''}${p.red?' · ROSSO':''}</small></span><strong class="rating ${p.name===report.mvp.name&&p.club===report.mvp.club?'mvp-rating':''}">${p.rating===null?'s.v.':p.rating.toFixed(1)}</strong></li>`).join('');
    return `<section class="report-card"><div class="eyebrow">DOPO IL FISCHIO</div><h3>Le pagelle del derby</h3><p>${escape(report.summary)}</p><div class="mvp-card">${badge(report.mvp.club)}<div><small>MIGLIORE IN CAMPO</small><strong>${escape(report.mvp.name)}</strong></div><b>${report.mvp.rating.toFixed(1)}</b></div><div class="ratings-grid">${[game.home,game.away].map(club=>`<div><h4 class="${club}-color">${club.toUpperCase()}</h4><ul class="ratings-list">${rows(club)}</ul></div>`).join('')}</div><p class="small-muted">Voti del simulatore dagli eventi della partita. Nessun giudizio sulle prestazioni storiche reali.</p></section>`;
  }

  function renderStandings() {
    const daily = engine.dailyStandings(Date.now());
    $('daily-summary').textContent = `${dateFormat.format(daily.start)} · ${daily.matches} derby conclusi · classifica aggiornata automaticamente`;
    $('daily-teams').innerHTML = `<div class="table-scroll"><table class="standings-table"><thead><tr><th scope="col">#</th><th scope="col">Squadra</th><th scope="col">Pt</th><th scope="col">G</th><th scope="col">V</th><th scope="col">N</th><th scope="col">P</th><th scope="col">GF</th><th scope="col">GS</th></tr></thead><tbody>${daily.teams.map((r,i)=>`<tr><td>${i+1}</td><th scope="row"><button class="table-team" data-team="${r.id}">${badge(r.club)}<span>${r.club==='roma'?'Roma':'Lazio'} ${r.season}</span></button></th><td><strong>${r.points}</strong></td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gf}</td><td>${r.ga}</td></tr>`).join('')}</tbody></table></div><p class="small-muted">3 punti a vittoria, 1 al pareggio. Parità: differenza reti, gol fatti, identificativo della stagione.</p>`;
    $('daily-scorers').innerHTML = daily.scorers.length?`<ol class="scorers-table">${daily.scorers.map((p,i)=>`<li><span>${i+1}</span>${badge(p.club)}<span>${escape(p.name)}</span><strong>${p.goals}</strong></li>`).join('')}</ol>`:'<p class="empty-state">La giornata è appena iniziata. Il primo gol deve ancora arrivare.</p>';
  }

  function renderLiveRoster() {
    $('live-field').innerHTML = `<div class="combined-legend">${[match.home,match.away].map(club=>`<span>${badge(club)}<b>${club.toUpperCase()}</b><small>${snapshot.lineups[club].length} IN CAMPO</small></span>`).join('')}</div><div class="formation-field combined-field animated-field" aria-label="Campo animato della partita in corso">${fieldLines()}${formationMarkers(match[match.home],'top',snapshot.lineups[match.home])}${formationMarkers(match[match.away],'bottom',snapshot.lineups[match.away])}<svg class="pass-trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line id="live-pass" x1="50" y1="50" x2="50" y2="50"/></svg><span id="live-ball" class="live-ball" aria-hidden="true"></span><span id="live-celebration" class="live-celebration" hidden>GOL!</span></div>`;
    for(const node of $('live-field').querySelectorAll('.formation-player')) {node.dataset.baseX=parseFloat(node.style.getPropertyValue('--player-x'));node.dataset.baseY=parseFloat(node.style.getPropertyValue('--player-y'));}
    liveBall=$('live-ball');
    $('lineups').innerHTML=matchLineups(match,true,snapshot);
  }

  function animateField(elapsed) {
    if(!liveBall) return;
    const event=snapshot.events[snapshot.events.length-1];
    const recent=event.club&&!['sub','red','yellow'].includes(event.type)&&!snapshot.finished&&!snapshot.halftime;
    const progress=Math.max(0,Math.min(1,(elapsed-event.at)/1400));
    const nodes=[...$('live-field').querySelectorAll('.formation-player')];
    const positions=new Map();
    for(const node of nodes) {
      const home=node.dataset.club===match.home;
      let x=Number(node.dataset.baseX),y=Number(node.dataset.baseY);
      const involved=recent&&(node.dataset.player===event.player||node.dataset.player===event.assist)&&node.dataset.club===event.club;
      if(recent) {
        const direction=home?1:-1;
        if(node.dataset.club===event.club) y+=direction*(involved?20:6);
        else y+=direction*5;
        if(involved) x=x*0.65+50*0.35;
      }
      x=Math.max(5,Math.min(95,x));y=Math.max(4,Math.min(96,y));
      node.style.setProperty('--player-x',x+'%');node.style.setProperty('--player-y',y+'%');
      node.classList.toggle('player-in-action',Boolean(involved));positions.set(node.dataset.club+':'+node.dataset.player,{x,y});
    }
    const neutral={x:50,y:50};
    const shooter=positions.get(event.club+':'+event.player)||neutral;
    const assist=positions.get(event.club+':'+event.assist)||neutral;
    let from=assist,to=shooter;
    if(['goal','save','miss','corner'].includes(event.type)) {
      from=shooter;to={x:event.type==='miss'?94:50,y:event.club===match.home?97:3};
      if(event.type==='save') to=positions.get((event.club==='roma'?'lazio':'roma')+':'+event.keeper)||to;
    }
    if(!recent) from=to=neutral;
    const x=from.x+(to.x-from.x)*progress,y=from.y+(to.y-from.y)*progress;
    liveBall.style.left=x+'%';liveBall.style.top=y+'%';
    const trail=$('live-pass');trail.setAttribute('x1',from.x);trail.setAttribute('y1',from.y);trail.setAttribute('x2',x);trail.setAttribute('y2',y);trail.style.opacity=recent?'0.8':'0';
    const celebrating=event.type==='goal'&&elapsed-event.at<2300;
    $('live-celebration').hidden=!celebrating;
    $('live-field').querySelector('.animated-field').dataset.goal=String(celebrating);
    $('live-field-state').textContent=snapshot.finished?'FINE PARTITA':snapshot.halftime?'INTERVALLO':event.type==='sub'?'CAMBIO':event.type==='red'?'ESPULSIONE':'IN DIRETTA';
  }

  function renderStats() {
    const r = snapshot.stats.roma;
    const l = snapshot.stats.lazio;
    const metrics = [['Attacchi sviluppati (%)', r.pressure, l.pressure], ['Tiri', r.shots, l.shots], ['Tiri in porta', r.onTarget, l.onTarget], ['Calci d’angolo', r.corners, l.corners], ['Cartellini gialli', r.yellow, l.yellow], ['Espulsioni', r.red, l.red], ['Cambi', r.substitutions, l.substitutions]];
    $('stats').innerHTML = `<div class="stats-clubs"><span class="roma-color">ROMA</span><span class="lazio-color">LAZIO</span></div>` + metrics.map(([name, a, b]) => `<div class="stat-row"><div><strong>${a}</strong><span>${name}</span><strong>${b}</strong></div><div class="stat-track"><span style="width:${a + b ? a / (a + b) * 100 : 50}%"></span></div></div>`).join('') + '<p class="small-muted">Conteggi dagli eventi già avvenuti. Gli attacchi indicano la quota delle azioni costruite, non il possesso palla reale.</p>';
  }

  function updateEvents(elapsed) {
    const events = snapshot.events;
    const last = events[events.length - 1];
    const notable = events.filter(e => e.type !== 'build');
    $('event-count').textContent = notable.length;
    $('commentary').innerHTML = notable.slice().reverse().map(eventRow).join('');
    $('roma-score').textContent = snapshot.stats.roma.goals;
    $('lazio-score').textContent = snapshot.stats.lazio.goals;
    document.querySelector('.score').setAttribute('aria-label', `${match.home} ${snapshot.stats[match.home].goals}, ${match.away} ${snapshot.stats[match.away].goals}`);
    $('scorers').innerHTML = ['roma', 'lazio'].map(club => {
      const goals = events.filter(event => event.club === club && event.type === 'goal');
      return `<ul class="scorer-list ${club}" aria-label="Marcatori ${club}">${goals.length ? goals.map(event => `<li><span class="scorer-name">${escape(event.player)}</span><time>${event.minute}′</time></li>`).join('') : '<li class="no-goals">Nessuna rete</li>'}</ul>`;
    }).join('');
    $('action-icon').textContent = icons[last.type];
    $('action-icon').className = `action-icon ${last.club || ''} ${last.type}`;
    $('action-title').textContent = last.title;
    $('action-text').textContent = last.text;
    $('action-minute').textContent = `${last.minute}′`;
    const pitch = $('pitch');
    pitch.dataset.club = last.club || '';
    pitch.classList.toggle('is-goal', last.type === 'goal' && elapsed - last.at < 2500);
    const ball = $('ball');
    ball.hidden = !last.club;
    if (last.club) {
      ball.style.left = `${last.x}%`;
      ball.style.top = `${last.y}%`;
      $('ball-player').textContent = last.type === 'build' ? last.assist : last.player;
      $('attack-zone').style.left = last.club === 'roma' ? '48%' : '5%';
      $('attack-zone').style.opacity = '1';
      $('pitch-message').hidden = true;
    } else {
      $('attack-zone').style.opacity = '0';
      $('pitch-message').hidden = false;
      $('pitch-message').textContent = last.type === 'fulltime' ? 'FINE PARTITA' : last.type === 'halftime' ? 'INTERVALLO' : 'SI GIOCA';
    }
    $('pitch-phase').textContent = last.type === 'goal' ? 'RETE!' : snapshot.finished ? 'PARTITA CONCLUSA' : snapshot.halftime ? 'INTERVALLO' : last.club ? `${last.club.toUpperCase()} IN AZIONE` : 'PALLONE IN GIOCO';
    renderStats();
  }

  function refresh() {
    const now = Date.now();
    const pos = position(now);
    if (!match || match.slot !== pos.slot) {
      match = engine.createMatch(pos.slot);
      nextMatch = engine.createMatch(pos.slot + 1);
      lastEventCount = -1;
      rosterKey='';
      lastFinished = undefined;
      $('match-id').textContent = `#${match.slot.toString().padStart(6, '0')}`;
      for (const club of ['roma', 'lazio']) {
        $(`${club}-season`).textContent = match[club].season;
        $(`${club}-coach`).textContent = match[club].coach;
      }
      $('lineups').innerHTML = matchLineups(match);
      document.querySelector('.scoreboard').dataset.home = match.home;
      $('scorers').dataset.home = match.home;
      $('roma-venue').textContent = match.home === 'roma' ? 'IN CASA' : 'IN TRASFERTA';
      $('lazio-venue').textContent = match.home === 'lazio' ? 'IN CASA' : 'IN TRASFERTA';
      updateRelated();
    }
    snapshot = engine.snapshot(match, pos.elapsed);
    const nextRosterKey=JSON.stringify(snapshot.lineups);
    if(rosterKey!==nextRosterKey) {renderLiveRoster();rosterKey=nextRosterKey;}
    animateField(pos.elapsed);
    if(!document.hidden) stadiumAudio.update(match,snapshot,pos.elapsed);
    $('wall-clock').textContent = clockFormat.format(now);
    $('wall-clock').dateTime = new Date(now).toISOString();
    const remaining = Math.ceil((pos.next - now) / 1000);
    $('countdown').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    $('match-minute').textContent = snapshot.finished ? 'FINALE' : snapshot.halftime ? 'INTERVALLO' : `${snapshot.minute}′`;
    $('match-state').textContent = snapshot.finished ? 'CONCLUSA' : snapshot.halftime ? 'INTERVALLO' : 'IN DIRETTA';
    $('match-state').classList.toggle('finished', snapshot.finished);
    $('phase-label').textContent = snapshot.finished ? 'PROSSIMO DERBY TRA ' + $('countdown').textContent : snapshot.halftime ? 'SI RIPARTE TRA POCO' : pos.elapsed < 43000 ? 'PRIMO TEMPO' : 'SECONDO TEMPO';
    $('match-progress').style.width = `${Math.min(pos.elapsed / LIVE * 100, 100)}%`;
    if (lastEventCount !== snapshot.events.length) {
      updateEvents(pos.elapsed);
      lastEventCount = snapshot.events.length;
    }
    if (lastFinished !== snapshot.finished) {
      renderOdds();
      lastFinished = snapshot.finished;
      $('match-report').innerHTML=snapshot.finished?reportMarkup(match):'<div class="empty-state">Le pagelle arrivano al triplice fischio. Prima si canta, poi si giudica.</div>';
      if(page==='classifiche') renderStandings();
    }
  }

  function route() {
    const requested = location.hash.slice(1) || 'diretta';
    const nextPage = ['diretta', 'archivio', 'squadre', 'classifiche', 'metodo'].includes(requested) ? requested : 'diretta';
    const changed = page !== nextPage;
    page = nextPage;
    document.querySelectorAll('.page').forEach(node => { node.hidden = node.id !== `page-${page}`; });
    document.querySelectorAll('.topbar nav a').forEach(link => {
      if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (page === 'archivio') renderArchive();
    if (page === 'classifiche') renderStandings();
    if (changed) window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function activateTab(name, focus = false) {
    selectedTab = name;
    document.querySelectorAll('[data-tab]').forEach(button => {
      const active = button.dataset.tab === name;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      $(`panel-${button.dataset.tab}`).hidden = !active;
      if (active && focus) button.focus();
    });
  }

  document.addEventListener('click', event => {
    const lineupView = event.target.closest('button[data-lineup-view]');
    if (lineupView) {
      document.body.dataset.lineupView = lineupView.dataset.lineupView;
      document.querySelectorAll('button[data-lineup-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lineupView === lineupView.dataset.lineupView)));
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) activateTab(tab.dataset.tab);
    const market = event.target.closest('[data-market]');
    if (market) {
      selectedMarket = market.dataset.market;
      document.querySelectorAll('[data-market]').forEach(button => button.setAttribute('aria-pressed', String(button === market)));
      renderOdds();
    }
    const filter = event.target.closest('[data-club]');
    if (filter) {
      document.querySelectorAll('[data-club]').forEach(button => button.setAttribute('aria-pressed', String(button === filter)));
      renderTeams(filter.dataset.club);
    }
    const team = event.target.closest('[data-team]');
    if (team) {
      if ($('detail-dialog').open) $('detail-dialog').close();
      showTeam(team.dataset.team);
    }
    const archive = event.target.closest('[data-archive]');
    if (archive) showArchived(Number(archive.dataset.archive));
  });
  document.querySelector('.tabs').addEventListener('keydown', event => {
    const names = ['cronaca', 'formazioni', 'pagelle', 'statistiche'];
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = names.indexOf(selectedTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? names.length-1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
    activateTab(names[next], true);
  });
  $('dialog-close').addEventListener('click', () => $('detail-dialog').close());
  $('detail-dialog').addEventListener('click', event => {
    if (event.target === $('detail-dialog')) {
      const box = event.target.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close();
    }
  });
  $('odds-info').addEventListener('click', () => openDialog('<div class="eyebrow">LEGGERE LE PROBABILITÀ</div><h2 id="dialog-title">Una quota racconta una possibilità.</h2><p>Una probabilità del 40% corrisponde a una quota teorica di 2,50: 1 ÷ 0,40. Il modello non aggiunge margini commerciali.</p><p>1 indica la vittoria della squadra di casa; X il pareggio; 2 la vittoria della squadra in trasferta. Roma e Lazio si alternano in casa a ogni incontro. Gol significa che segnano entrambe; over 2,5 significa almeno tre reti complessive.</p><p>Le quote sono calcolate prima dell’incontro e restano fisse durante la diretta. A fine partita il pannello passa al prossimo derby. Le percentuali visualizzate sono arrotondate.</p><p>Risultati esatti: vengono mostrati soltanto i nove punteggi più probabili, perciò le percentuali non sommano al 100%.</p><p>Non sono quote per incontri reali. Nessuna scommessa: qui si guarda soltanto il calcio immaginato.</p>'));
  $('audio-toggle').addEventListener('click',async()=>{
    const button=$('audio-toggle');button.disabled=true;
    try {
      const enabled = await stadiumAudio.toggle();
      button.setAttribute('aria-pressed', String(enabled));
      button.textContent = enabled ? '◖ Audio acceso' : '◖ Audio spento';
      if (enabled) refresh();
      else $('audio-status').textContent = 'Atmosfera sonora opzionale';
    }
    catch(error){$('audio-status').textContent=error.message;}
    finally{button.disabled=false;}
  });
  $('audio-volume').addEventListener('input',event=>stadiumAudio.setVolume(Number(event.target.value)/100));
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {stadiumAudio.visibility(document.hidden).catch(()=>{});if (!document.hidden) refresh();});
  window.addEventListener('pageshow', refresh);
  $('lineup-controls').innerHTML = lineupControls();
  $('model-balance').textContent = `Media attesa del simulatore: Roma ${(engine.target.roma * 100).toFixed(1).replace('.', ',')}% · X ${(engine.target.draw * 100).toFixed(1).replace('.', ',')}% · Lazio ${(engine.target.lazio * 100).toFixed(1).replace('.', ',')}%.`;
  renderTeams();
  refresh();
  route();
  setInterval(refresh, 250);
})();
