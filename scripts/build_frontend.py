"""Bundle both cards in the only folder downloaded by HACS."""
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components/ma_maison_chauffage"
VERSION = json.loads((COMPONENT / "manifest.json").read_text(encoding="utf-8"))["version"]
assets = COMPONENT / "assets"
assets.mkdir(exist_ok=True)
for source in (ROOT / "configuration/chauffage-planning-card.js", ROOT / "www/ma-maison-chauffage-card.js"):
    shutil.copyfile(source, assets / source.name)
(assets / "bootstrap.js").write_text(
    f'import "./chauffage-planning-card.js?v={VERSION}";\n'
    f'import "./ma-maison-chauffage-card.js?v={VERSION}";\n', encoding="utf-8")
print(f"Cartes embarquées dans l’intégration {VERSION}.")
