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
  const icons = { goal: '⚽', save: '◇', miss: '↗', yellow: '▰', corner: '⚑', defence: '⊘', kickoff: '▶', halftime: 'Ⅱ', fulltime: '■', build: '→' };
  const roles = { P: 'Portiere', D: 'Difensore', C: 'Centrocampista', A: 'Attaccante' };
  let match;
  let nextMatch;
  let snapshot;
  let lastEventCount = -1;
  let lastFinished;
  let selectedMarket = 'result';
  let selectedTab = 'cronaca';
  let page = '';

  function badge(club) {
    return `<img class="mini-crest ${club}" src="assets/${club}.${club === 'roma' ? 'svg' : 'png'}" alt="" width="28" height="32">`;
  }

  function pairLabel(game) {
    return `<span class="roma-color">ROMA <b>${escape(game.roma.season)}</b></span><span class="versus">vs</span><span class="lazio-color">LAZIO <b>${escape(game.lazio.season)}</b></span>`;
  }

  function openDialog(content) {
    $('dialog-content').innerHTML = content;
    $('detail-dialog').showModal();
  }

  function playerRows(players) {
    return players.map(p => `<li><span class="player-role">${p.role}</span><span>${escape(p.name)}</span><span class="player-number">${p.number ?? '—'}</span></li>`).join('');
  }

  function lineup(team, includeBench = true) {
    return `<div class="lineup"><div class="lineup-heading">${badge(team.club)}<div><h3>${team.club.toUpperCase()} <span>${team.season}</span></h3><p>${escape(team.coach)} · ${team.formation}</p></div></div><ol class="player-list">${playerRows(team.starters)}</ol>${includeBench ? `<h4>RISERVE DELLA STAGIONE</h4><ol class="player-list bench">${playerRows(team.bench)}</ol>` : ''}<button class="text-button" data-team="${team.id}">Storia e rosa completa ↗</button></div>`;
  }

  function showTeam(id) {
    const team = data.teams.find(t => t.id === id);
    if (!team) return;
    openDialog(`<div class="eyebrow ${team.club}-color">ARCHIVIO DELLE SQUADRE</div><h2 id="dialog-title">${team.club.toUpperCase()} ${team.season}</h2><p class="dialog-story">${escape(team.story)}</p><p>${escape(team.coach)} · Modulo rappresentativo ${team.formation}</p><div class="rating-note">Forza del simulatore <b>${team.rating}/100</b><span>Valutazione editoriale, non una statistica storica.</span></div><h3>Undici rappresentativo</h3><ol class="player-list">${playerRows(team.starters)}</ol><h3>Rosa documentata · ${team.roster.length} giocatori</h3><p class="small-muted">P portiere · D difensore · C centrocampista · A attaccante. “—” indica un numero non disponibile. La rosa può comprendere trasferimenti durante la stagione.</p><ol class="player-list roster">${playerRows(team.roster)}</ol><a class="source-link" href="${escape(team.source)}" target="_blank" rel="noreferrer">Fonte della rosa: archivio stagionale Wikipedia ↗</a><p class="small-muted">Fonte consultata il 15 novembre 2026. Undici e riserve sono selezioni editoriali; non si effettuano sostituzioni.</p>`);
  }

  function showArchived(slot) {
    const current = position(Date.now());
    if (slot >= current.slot) return;
    const game = engine.createMatch(slot);
    const final = engine.snapshot(game, LIVE);
    const goals = final.events.filter(e => e.type === 'goal');
    openDialog(`<div class="eyebrow">DERBY VIRTUALE · ${dateFormat.format(game.start)} ${timeFormat.format(game.start)}</div><h2 id="dialog-title">Roma ${game.score.roma} – ${game.score.lazio} Lazio</h2><div class="archive-pair">${pairLabel(game)}</div><p>Simulazione conclusa · ${escape(data.version)}</p><h3>I gol</h3>${goals.length ? goals.map(e => `<p class="goal-line ${e.club}-color">${e.minute}′ &nbsp; ${escape(e.player)} <span>· assist ${escape(e.assist)}</span></p>`).join('') : '<p>Nessun gol. Le difese hanno avuto la meglio.</p>'}<h3>Le formazioni</h3><div class="lineups">${lineup(game.roma, false)}${lineup(game.lazio, false)}</div><h3>Gli episodi</h3><ol class="commentary dialog-commentary">${final.events.filter(e => !['build', 'kickoff'].includes(e.type)).reverse().map(eventRow).join('')}</ol>`);
  }

  function eventRow(event) {
    return `<li class="event ${event.type} ${event.club || ''}"><time>${event.minute}′</time><span class="event-icon">${icons[event.type]}</span><div><strong>${escape(event.title)}</strong><p>${escape(event.text)}</p></div></li>`;
  }

  function archiveCard(game) {
    return `<button class="result-card" data-archive="${game.slot}" aria-label="Dettaglio Roma ${game.roma.season} ${game.score.roma} a ${game.score.lazio} Lazio ${game.lazio.season}"><div class="result-date">${dateFormat.format(game.start)} · ${timeFormat.format(game.start)} <span>FINALE</span></div><div class="result-row">${badge('roma')}<span>Roma <small>${game.roma.season}</small></span><strong>${game.score.roma}</strong></div><div class="result-row">${badge('lazio')}<span>Lazio <small>${game.lazio.season}</small></span><strong>${game.score.lazio}</strong></div><span class="result-link">Rivedi la partita <b>↗</b></span></button>`;
  }

  function updateRelated() {
    $('recent').innerHTML = Array.from({ length: 4 }, (_, i) => archiveCard(engine.createMatch(match.slot - 1 - i))).join('');
    if (page === 'archivio') renderArchive();
    $('schedule').innerHTML = Array.from({ length: 3 }, (_, i) => {
      const future = engine.createMatch(match.slot + i + 2);
      return `<div class="schedule-row"><time>${timeFormat.format(future.start)}</time><div><span>Roma <b>${future.roma.season}</b></span><span>Lazio <b>${future.lazio.season}</b></span></div><span class="schedule-dot">↗</span></div>`;
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
    $('odds-title').textContent = forNext ? 'Quote del prossimo derby' : 'Le probabilità';
    $('odds-caption').textContent = `${game.roma.season} × ${game.lazio.season} · quote prepartita`;
    const cell = (label, p, caption = '') => `<div class="odds-cell"><span>${label}</span><strong>${(1 / p).toFixed(2).replace('.', ',')}</strong><small>${(p * 100).toFixed(1).replace('.', ',')}%${caption ? ' · ' + caption : ''}</small></div>`;
    $('odds').className = `odds-grid ${selectedMarket}`;
    if (selectedMarket === 'result') {
      $('odds').innerHTML = cell('1 · ROMA', markets.roma) + cell('X · PARI', markets.draw) + cell('2 · LAZIO', markets.lazio) + `<div class="market-label">DOPPIA CHANCE</div>` + cell('1X', markets['1X']) + cell('12', markets['12']) + cell('X2', markets['X2']);
    } else if (selectedMarket === 'goals') {
      $('odds').innerHTML = cell('OVER 2,5', markets.over) + cell('UNDER 2,5', markets.under) + cell('GOL', markets.goal) + cell('NO GOL', markets.noGoal);
    } else {
      $('odds').innerHTML = markets.exact.slice(0, 9).map(s => cell(`${s.roma} – ${s.lazio}`, s.probability)).join('') + '<p class="exact-note">I nove punteggi più probabili. Il primo numero è sempre della Roma.</p>';
    }
  }

  function renderStats() {
    const r = snapshot.stats.roma;
    const l = snapshot.stats.lazio;
    const metrics = [['Attacchi sviluppati (%)', r.pressure, l.pressure], ['Tiri', r.shots, l.shots], ['Tiri in porta', r.onTarget, l.onTarget], ['Calci d’angolo', r.corners, l.corners], ['Cartellini gialli', r.yellow, l.yellow]];
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
      lastFinished = undefined;
      $('match-id').textContent = `#${match.slot.toString().padStart(6, '0')}`;
      for (const club of ['roma', 'lazio']) {
        $(`${club}-season`).textContent = match[club].season;
        $(`${club}-coach`).textContent = match[club].coach;
      }
      $('lineups').innerHTML = lineup(match.roma) + lineup(match.lazio);
      updateRelated();
    }
    snapshot = engine.snapshot(match, pos.elapsed);
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
    }
  }

  function route() {
    const requested = location.hash.slice(1) || 'diretta';
    const nextPage = ['diretta', 'archivio', 'squadre', 'metodo'].includes(requested) ? requested : 'diretta';
    const changed = page !== nextPage;
    page = nextPage;
    document.querySelectorAll('.page').forEach(node => { node.hidden = node.id !== `page-${page}`; });
    document.querySelectorAll('.topbar nav a').forEach(link => {
      if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (page === 'archivio') renderArchive();
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
    const names = ['cronaca', 'formazioni', 'statistiche'];
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = names.indexOf(selectedTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
    activateTab(names[next], true);
  });
  $('dialog-close').addEventListener('click', () => $('detail-dialog').close());
  $('detail-dialog').addEventListener('click', event => {
    if (event.target === $('detail-dialog')) {
      const box = event.target.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close();
    }
  });
  $('odds-info').addEventListener('click', () => openDialog('<div class="eyebrow">LEGGERE LE PROBABILITÀ</div><h2 id="dialog-title">Una quota racconta una possibilità.</h2><p>Una probabilità del 40% corrisponde a una quota teorica di 2,50: 1 ÷ 0,40. Il modello non aggiunge margini commerciali.</p><p>1 indica la vittoria della Roma; X il pareggio; 2 la vittoria della Lazio. Gol significa che segnano entrambe; over 2,5 significa almeno tre reti complessive.</p><p>Le quote sono calcolate prima dell’incontro e restano fisse durante la diretta. A fine partita il pannello passa al prossimo derby. Le percentuali visualizzate sono arrotondate.</p><p>Risultati esatti: vengono mostrati soltanto i nove punteggi più probabili, perciò le percentuali non sommano al 100%.</p><p>Non sono quote per incontri reali. Nessuna scommessa: qui si guarda soltanto il calcio immaginato.</p>'));
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pageshow', refresh);
  renderTeams();
  refresh();
  route();
  setInterval(refresh, 250);
})();
