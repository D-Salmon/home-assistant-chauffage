"""Bundle both cards in the only folder downloaded by HACS."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components/ma_maison_chauffage"
assets = COMPONENT / "assets"
assets.mkdir(exist_ok=True)
for source in (ROOT / "configuration/chauffage-planning-card.js", ROOT / "www/ma-maison-chauffage-card.js"):
    shutil.copyfile(source, assets / source.name)
version = json.loads((COMPONENT / "manifest.json").read_text(encoding="utf-8"))["version"]
bootstrap = (f'import "./chauffage-planning-card.js?v={version}";\n'
             f'import "./ma-maison-chauffage-card.js?v={version}";\n')
for name in ("bootstrap.js", "bootstrap-v3.js"):
    (assets / name).write_text(bootstrap, encoding="utf-8")
print("Cartes embarquées avec des URL stables.")
