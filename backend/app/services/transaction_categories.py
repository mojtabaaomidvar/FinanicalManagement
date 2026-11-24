"""Display-independent IDs shared with the TypeScript financial domain."""
import json
from pathlib import Path

BY_TYPE = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
CATEGORY_TYPES = {category: kind for kind, categories in BY_TYPE.items() for category in categories}
