"""Build the offline dataset from the checked-in source extracts. No network required."""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# club, year, coach, formation, editorial strength, story, XI in formation order.
# Groups separated by / follow the formation from defence to attack, after the GK.
SELECTION = [
('roma',1941,'Alfréd Schaffer','2-3-5',88,'Il primo scudetto, con Amadei al centro dell’attacco.','Masetti/Brunella,Andreoli/Donati,Mornese,Bonomi/Krieziu,Cappellini,Amadei,Coscia,Pantó'),
('roma',1960,'Alfredo Foni','3-2-5',83,'La stagione della Coppa delle Fiere, conclusa nell’autunno 1961 con Carniglia.','Cudicini/Fontana,Losi,Corsini/Guarnacci,Pestrin/Ghiggia,Lojacono,Manfredini,Schiaffino,Selmosson'),
('roma',1979,'Nils Liedholm','4-4-2',80,'La Coppa Italia e l’inizio del ciclo di Liedholm.','Tancredi/Peccenini,Santarini,Turone,Spinosi/Bruno Conti,Benetti,Di Bartolomei,Maggiora/Ancelotti,Pruzzo'),
('roma',1982,'Nils Liedholm','4-4-2',93,'Falcão, il gol di Pruzzo a Marassi e il secondo scudetto.','Tancredi/Nappi,Vierchowod,Di Bartolomei,Maldera/Bruno Conti,Falcão,Prohaska,Ancelotti/Iorio,Pruzzo'),
('roma',1983,'Nils Liedholm','4-4-2',91,'La finale di Coppa dei Campioni all’Olimpico e la Coppa Italia.','Tancredi/Nappi,Righetti,Di Bartolomei,Nela/Bruno Conti,Cerezo,Falcão,Ancelotti/Graziani,Pruzzo'),
('roma',1990,'Ottavio Bianchi','4-4-2',82,'La Coppa Italia e la finale di Coppa UEFA, con Giannini e Völler.','Cervone/Berthold,Aldair,Nela,Carboni/Gerolin,Desideri,Giannini,Di Mauro/Rizzitelli,Völler'),
('roma',2000,'Fabio Capello','3-4-1-2',95,'Totti, Batistuta e il terzo scudetto.','Antonioli/Zebina,Samuel,Zago/Cafu,Tommasi,Emerson,Candela/Totti/Batistuta,Montella'),
('roma',2003,'Fabio Capello','3-4-1-2',89,'La coppia Totti–Cassano e il secondo posto in campionato.','Pelizzoli/Panucci,Samuel,Chivu/Mancini,Emerson,Dacourt,Candela/Totti/Cassano,Montella'),
('roma',2007,'Luciano Spalletti','4-2-3-1',90,'La Coppa Italia e il calcio del capitano falso nove.','Doni/Panucci,Mexès,Juan,Tonetto/De Rossi,Pizarro/Taddei,Perrotta,Mancini/Totti'),
('roma',2009,'Claudio Ranieri','4-2-3-1',88,'Una rincorsa allo scudetto rimasta nella memoria.','Júlio Sérgio/Cassetti,Burdisso,Juan,Riise/De Rossi,Pizarro/Taddei,Perrotta,Vučinić/Totti'),
('roma',2016,'Luciano Spalletti','4-2-3-1',90,'Gli 87 punti, i gol di Džeko e Salah, il saluto a Totti.','Szczęsny/Bruno Peres,Manōlas,Fazio,Emerson Palmieri/De Rossi,Strootman/Salah,Nainggolan,Perotti/Džeko'),
('roma',2021,'José Mourinho','3-4-2-1',85,'A Tirana arriva la Conference League.','Rui Patrício/Mancini,Smalling,Ibañez/Karsdorp,Cristante,Oliveira,Zalewski/Pellegrini,Zaniolo/Abraham'),
('lazio',1957,'Fulvio Bernardini','3-2-5',80,'Il percorso verso la prima Coppa Italia, vinta nel settembre 1958.','Lovati/Molino,Lo Buono,Eufemi/Carradori,Fuin/Muccinelli,Burini,Tozzi,Selmosson,Vivolo'),
('lazio',1973,'Tommaso Maestrelli','4-3-3',93,'Chinaglia e i ragazzi di Maestrelli: il primo scudetto.','Pulici/Petrelli,Wilson,Oddi,Martini/Nanni,Frustalupi,Re Cecconi/Garlaschelli,Chinaglia,D’Amico'),
('lazio',1992,'Dino Zoff','4-4-2',83,'Signori capocannoniere, Gascoigne e il ritorno in Europa.','Fiori/Bacci,Cravero,Gregucci,Favalli/Fuser,Winter,Gascoigne,Doll/Riedle,Signori'),
('lazio',1994,'Zdeněk Zeman','4-3-3',88,'Il calcio offensivo di Zeman e il secondo posto.','Marchegiani/Negro,Bergodi,Chamot,Favalli/Fuser,Di Matteo,Winter/Bokšić,Casiraghi,Signori'),
('lazio',1997,'Sven-Göran Eriksson','4-4-2',89,'La Coppa Italia e quattro derby vinti nella stessa stagione.','Marchegiani/Negro,Nesta,Chamot,Favalli/Fuser,Almeyda,Jugović,Nedvěd/Mancini,Bokšić'),
('lazio',1998,'Sven-Göran Eriksson','4-4-2',93,'La Coppa delle Coppe e la corsa al titolo con Vieri e Salas.','Marchegiani/Negro,Nesta,Mihajlović,Pancaro/Conceição,Almeyda,Stanković,Nedvěd/Vieri,Salas'),
('lazio',1999,'Sven-Göran Eriksson','4-4-2',96,'Scudetto, Coppa Italia e Supercoppa UEFA nell’anno del centenario.','Marchegiani/Negro,Nesta,Mihajlović,Pancaro/Conceição,Simeone,Verón,Nedvěd/Mancini,Salas'),
('lazio',2003,'Roberto Mancini','4-4-2',85,'La Coppa Italia del gruppo di Mancini.','Peruzzi/Oddo,Stam,Couto,Favalli/Fiore,Albertini,Giannichedda,César/Corradi,López'),
('lazio',2008,'Delio Rossi','4-3-1-2',82,'La Coppa Italia ai rigori e il talento di Zárate.','Muslera/Lichtsteiner,Siviglia,Cribari,Kolarov/Brocchi,Ledesma,Matuzalém/Foggia/Zárate,Pandev'),
('lazio',2012,'Vladimir Petković','4-1-4-1',86,'Il derby di finale deciso da Lulić il 26 maggio.','Marchetti/Konko,Biava,Dias,Radu/Ledesma/Candreva,Hernanes,Mauri,Lulić/Klose'),
('lazio',2018,'Simone Inzaghi','3-5-2',86,'La Coppa Italia con Milinković-Savić e Correa in finale.','Strakosha/Luiz Felipe,Acerbi,Radu/Marušić,Parolo,Lucas Leiva,Milinković-Savić,Lulić/Correa,Immobile'),
('lazio',2019,'Simone Inzaghi','3-5-2',90,'La Supercoppa e i 36 gol in campionato di Immobile.','Strakosha/Patric,Acerbi,Radu/Lazzari,Milinković-Savić,Lucas Leiva,Luis Alberto,Lulić/Correa,Immobile'),
]

# Counts come from the represented coach's available official season match logs.
# Older archives lack enough tactical records: retain an explicit reconstruction.
FORMATION_XI = {
 'roma-1941': ('2-3-2-3','Masetti/Brunella,Andreoli/Donati,Mornese,Bonomi/Cappellini,Coscia/Krieziu,Amadei,Pantó'),
 'roma-1960': ('3-2-2-3','Cudicini/Fontana,Losi,Corsini/Guarnacci,Pestrin/Lojacono,Schiaffino/Ghiggia,Manfredini,Selmosson'),
 'roma-1979': ('4-3-3','Tancredi/Peccenini,Santarini,Turone,Spinosi/Benetti,Di Bartolomei,Ancelotti/Bruno Conti,Pruzzo,Scarnecchia'),
 'roma-1983': ('4-3-3','Tancredi/Nappi,Righetti,Di Bartolomei,Nela/Cerezo,Falcão,Ancelotti/Bruno Conti,Pruzzo,Graziani'),
 'roma-1990': ('5-3-2','Cervone/Berthold,Aldair,Nela,Tempestilli,Carboni/Desideri,Giannini,Di Mauro/Rizzitelli,Völler'),
 'roma-2003': ('4-4-2','Pelizzoli/Panucci,Zebina,Samuel,Chivu/Mancini,Emerson,Dacourt,Lima/Totti,Cassano'),
 'roma-2009': ('4-4-2','Júlio Sérgio/Cassetti,Burdisso,Juan,Riise/Taddei,De Rossi,Pizarro,Perrotta/Totti,Vučinić'),
 'roma-2021': ('4-2-3-1',"Rui Patrício/Karsdorp,Mancini,Smalling,Viña/Cristante,Veretout/Zaniolo,Pellegrini,Mkhit/Abraham"),
 'lazio-1957': ('3-2-2-3','Lovati/Molino,Lo Buono,Eufemi/Carradori,Fuin/Burini,Vivolo/Muccinelli,Tozzi,Selmosson'),
}
HISTORICAL_FORMATIONS = {
 'roma-1941': ('Metodo', 'https://it.wikipedia.org/wiki/Serie_A_1941-1942'),
 'roma-1960': ('Sistema WM', 'https://it.wikipedia.org/wiki/Associazione_Sportiva_Roma_1960-1961'),
 'lazio-1957': ('WM elastico', 'https://www.treccani.it/enciclopedia/fulvio-bernardini_(Enciclopedia-dello-Sport)/'),
 'lazio-1973': ('4-3-3 di Maestrelli', 'https://www.polesinesport.it/campionato-pi-bello-del-mondo-dvd-story-gazzetta-sport-vince-lazio-1973-74-di-mr-maistrelli-e-chinaglia/'),
}

def normalized(s):
    return s.casefold().replace('’', "'").strip()

def roster_from_evidence(text):
    roster = []
    section = text.split('## Rosa')[1]
    # Roma 1960-61 lists autumn 1961 additions separately; exclude those additions.
    section = section.split('Acquisti nella sessione estiva del 1961')[0]
    for line in section.splitlines():
        match = re.match(r'^(?:(\d+) )?([PDCA]) (.+)$', line)
        if not match:
            continue
        number, role, name = match.groups()
        name = re.sub(r'\s*\([^)]*\)', '', name).strip()
        roster.append({'name': name, 'role': role, 'number': int(number) if number else None})
    assert len(roster) >= 16
    return roster

teams = []
for club, year, coach, formation, rating, story, selection in SELECTION:
    team_id = f'{club}-{year}'
    evidence_path = ROOT / f'data/evidence/formations-{team_id}.json'
    evidence = json.loads(evidence_path.read_text())
    if team_id in FORMATION_XI:
        formation, selection = FORMATION_XI[team_id]
    if team_id in HISTORICAL_FORMATIONS:
        label, source = HISTORICAL_FORMATIONS[team_id]
        formation_info = dict(kind='reconstruction', label=label, source=source,
                              note='Ricostruzione storica: non esiste un conteggio stagionale sufficiente dei moduli.')
    else:
        assert evidence['formation'] == formation, (team_id, evidence['formation'], formation)
        formation_info = dict(kind='counted', source=evidence['source'], counts=evidence['counts'],
                              sampleSize=evidence['sampleSize'], matches=evidence['counts'][formation],
                              note='Modulo più frequente nei tabellini disponibili di questo allenatore nella stagione. Le varianti con la stessa struttura numerica sono accorpate.')
    text = (ROOT / f'data/evidence/{club}-{year}.txt').read_text()
    roster = roster_from_evidence(text)
    starters = []
    groups = selection.split('/')
    assert [len(g.split(',')) for g in groups[1:]] == list(map(int, formation.split('-')))
    for group_index, group in enumerate(groups):
        for query in group.split(','):
            candidates = [p for p in roster if normalized(query) in normalized(p['name'])]
            assert len(candidates) == 1, (club, year, query, candidates)
            player = dict(candidates[0])
            player['line'] = group_index
            player['label'] = {'Mkhit': 'Mkhitaryan'}.get(query, query)
            starters.append(player)
    assert len(starters) == 11 and len({p['name'] for p in starters}) == 11
    assert starters[0]['role'] == 'P'
    remaining = [p for p in roster if p['name'] not in {s['name'] for s in starters}]
    bench = []
    for role in ['P','D','C','A']:
        candidate = next((p for p in remaining if p['role'] == role), None)
        if candidate:
            bench.append(candidate)
            remaining.remove(candidate)
    bench += remaining[:5-len(bench)]
    teams.append(dict(id=f'{club}-{year}', club=club, year=year, season=f'{year}–{str(year+1)[-2:]}',
                      coach=coach, formation=formation, formationInfo=formation_info, rating=rating, story=story,
                      starters=starters, bench=bench, roster=roster,
                      source=text.splitlines()[0].removeprefix('Fonte: ')))

MONTHS = 'January February March April May June July August September October November December'.split()
matches = []
competition = ''
for line in (ROOT / 'data/evidence/derbies.txt').read_text().splitlines():
    m = re.search(r'(\d{1,2}) ('+'|'.join(MONTHS)+r') (\d{4}) (Roma|Lazio) (\d+)–(\d+) (Roma|Lazio)', line)
    if not m:
        continue
    day, month, year, home, hg, ag, away = m.groups()
    date = f'{year}-{MONTHS.index(month)+1:02d}-{int(day):02d}'
    prefix = line[:m.start()]
    if 'Coppa Italia' in prefix:
        competition = 'Coppa Italia'
    elif 'Serie A-B' in prefix:
        competition = 'Divisione Nazionale'
    elif 'Serie A' in prefix:
        competition = 'Serie A'
    if date > '2025-06-30' or date == '1969-09-07':
        continue  # Exclude the awarded 0-2: not a played match.
    roma, lazio = (int(hg), int(ag)) if home == 'Roma' else (int(ag), int(hg))
    matches.append(dict(date=date, competition=competition, home=home.lower(), roma=roma, lazio=lazio))
assert len(matches) == 184, len(matches)
assert len({m['date'] for m in matches}) == len(matches)
counts = Counter('roma' if m['roma']>m['lazio'] else 'lazio' if m['lazio']>m['roma'] else 'draw' for m in matches)
histogram = Counter((m['roma'],m['lazio']) for m in matches)
dataset = dict(version='capitale-v2', cutoff='2025-06-30', retrieved='2026-11-15', teams=teams,
               model=dict(historyWeight=0.35, exploratoryWeight=0.15, strengthWeight=0.018, maxGoals=8),
               history=dict(source='https://en.wikipedia.org/wiki/Derby_della_Capitale', matches=matches,
                            counts=dict(counts), scores=[dict(roma=r,lazio=l,count=n) for (r,l),n in sorted(histogram.items())]))
(ROOT / 'data/dataset.json').write_text(json.dumps(dataset, ensure_ascii=False, indent=2)+'\n')
# Classic script also works when index.html is opened directly through file://.
(ROOT / 'data/dataset.js').write_text('/* Generated by scripts/build_data.py. See data/SOURCES.md. */\nwindow.DERBY_DATA = '+json.dumps(dataset,ensure_ascii=False,separators=(',',':'))+';\n')
print(f'{len(teams)} teams, {sum(len(t["roster"]) for t in teams)} roster entries, {len(matches)} derbies; {dict(counts)}')
