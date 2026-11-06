"""Bundle both cards in the only folder downloaded by HACS."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components/ma_maison_chauffage"
assets = COMPONENT / "assets"
assets.mkdir(exist_ok=True)
for source in (ROOT / "configuration/chauffage-planning-card.js", ROOT / "www/ma-maison-chauffage-card.js"):
    shutil.copyfile(source, assets / source.name)
(assets / "bootstrap.js").write_text(
    'import "./chauffage-planning-card.js";\n'
    'import "./ma-maison-chauffage-card.js";\n', encoding="utf-8")
print("Cartes embarquées avec des URL stables.")
