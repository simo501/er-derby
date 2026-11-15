"""Collect season formation counts for the represented coach; retain compact evidence."""
import concurrent.futures
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]

def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.casefold()) if not unicodedata.combining(c))

def collect(team):
    club_id = 12 if team['club'] == 'roma' else 398
    slug = 'as-rom' if club_id == 12 else 'lazio-rom'
    url = f'https://www.transfermarkt.it/{slug}/spielplan/verein/{club_id}/saison_id/{team["year"]}/plus/1'
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')
    records = []
    for table in soup.select('table'):
        if 'Sistema di gioco' not in table.get_text():
            continue
        for row in table.select('tbody tr'):
            cells = [td.get_text(' ', strip=True) for td in row.find_all('td', recursive=False)]
            if not cells or not re.search(r'\d+:\d+', cells[-1]):
                continue
            for i, cell in enumerate(cells[:-1]):
                formation = re.match(r'^([1-5](?:-[1-5]){1,4})(?:\s|$)', cell)
                if formation and sum(map(int, formation[1].split('-'))) == 10:
                    coach = cells[i+1]
                    if normalize(team['coach'].split()[-1]) in normalize(coach):
                        records.append(dict(date=cells[1], formation=formation[1], coach=coach, result=cells[-1]))
                    break
    counts = Counter(r['formation'] for r in records)
    evidence = dict(source=url, retrieved='2026-11-15', coach=team['coach'], season=team['season'],
                    counts=dict(counts), sampleSize=len(records), records=records)
    if counts:
        maximum = max(counts.values())
        leaders = [f for f,n in counts.items() if n == maximum]
        evidence['formation'] = team['formation'] if team['formation'] in leaders else sorted(leaders)[0]
    path = ROOT / f'data/evidence/formations-{team["id"]}.json'
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2)+'\n')
    print(team['id'], evidence.get('formation','NO DATA'), dict(counts), flush=True)

if __name__ == '__main__':
    teams = json.loads((ROOT/'data/dataset.json').read_text())['teams']
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for result in pool.map(collect, teams):
            pass
