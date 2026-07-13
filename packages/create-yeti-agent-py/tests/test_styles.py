from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from create_yeti_agent_py.cli import (
    apply_style,
    fetch_styles,
    load_fallback_styles,
    resolve_style,
)


class StyleCatalogTests(unittest.TestCase):
    def test_fallback_has_four_styles(self) -> None:
        styles = load_fallback_styles()
        ids = [s["id"] for s in styles]
        self.assertEqual(ids, ["momentum", "mean_reversion", "conservative", "degen"])
        for s in styles:
            self.assertIn("def decide(", s["decidePy"])
            self.assertLessEqual(len(s["persona"]), 2000)

    def test_resolve_style_known(self) -> None:
        styles = load_fallback_styles()
        s = resolve_style(styles, "conservative")
        self.assertEqual(s["label"], "Conservative")

    def test_resolve_style_unknown(self) -> None:
        styles = load_fallback_styles()
        with self.assertRaises(ValueError) as ctx:
            resolve_style(styles, "yolo")
        self.assertIn("Unknown style", str(ctx.exception))

    def test_apply_style_overwrites_files(self) -> None:
        styles = load_fallback_styles()
        style = resolve_style(styles, "momentum")
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            (dest / "agent").mkdir()
            (dest / "agent" / "persona.md").write_text("OLD PERSONA")
            (dest / "agent" / "decide.py").write_text("def decide(snapshot):\n    return []\n")
            apply_style(dest, style, "demo-bot")
            persona = (dest / "agent" / "persona.md").read_text()
            decide = (dest / "agent" / "decide.py").read_text()
            self.assertIn("demo-bot", persona)
            self.assertIn("Momentum trader", persona)
            self.assertIn("def decide(", decide)
            self.assertIn("momentum", decide)

    def test_fetch_styles_falls_back_on_error(self) -> None:
        with mock.patch("create_yeti_agent_py.cli._get_json", side_effect=OSError("down")):
            styles, source = fetch_styles("https://example.invalid")
        self.assertEqual(source, "fallback")
        self.assertEqual(len(styles), 4)

    def test_fetch_styles_uses_remote_when_ok(self) -> None:
        remote = {
            "styles": [
                {
                    "id": "momentum",
                    "label": "Momentum",
                    "blurb": "x",
                    "persona": "p",
                    "decidePy": "def decide(snapshot):\n    return []\n",
                }
            ]
        }
        with mock.patch("create_yeti_agent_py.cli._get_json", return_value=remote):
            styles, source = fetch_styles("https://api.example")
        self.assertEqual(source, "remote")
        self.assertEqual(styles[0]["id"], "momentum")


if __name__ == "__main__":
    unittest.main()
