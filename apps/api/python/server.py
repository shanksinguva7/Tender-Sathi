"""Flask pipeline server reachable from the monorepo python folder."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("tender_sathi_flask", ROOT / "server.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
app = module.app

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
