"""Package only static runtime files; no dependencies or network needed."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
destination = root / 'dist'
if destination.exists():
    shutil.rmtree(destination)
destination.mkdir(exist_ok=True)
for name in ['index.html', 'style.css', 'engine.js', 'app.js']:
    shutil.copy2(root / name, destination / name)
shutil.copytree(root / 'assets', destination / 'assets', dirs_exist_ok=True)
(destination / 'data').mkdir(exist_ok=True)
for name in ['dataset.js', 'dataset.json', 'SOURCES.md']:
    shutil.copy2(root / 'data' / name, destination / 'data' / name)
print('Static site ready: dist/index.html')
