from __future__ import annotations

import unittest

from create_yeti_agent_py.cli import FALLBACK_BASE_URL, PRIMARY_BASE_URL, resolve_base_url


class ResolveBaseUrlTests(unittest.TestCase):
    def test_primary_ok(self):
        self.assertEqual(resolve_base_url(None, probe=lambda u: None), (PRIMARY_BASE_URL, False, None))

    def test_fallback_on_failure(self):
        url, fell, reason = resolve_base_url(None, probe=lambda u: "cert mismatch")
        self.assertEqual((url, fell, reason), (FALLBACK_BASE_URL, True, "cert mismatch"))

    def test_explicit_never_probed(self):
        def boom(u):
            raise AssertionError("must not probe")
        self.assertEqual(resolve_base_url("http://localhost:3001/", probe=boom), ("http://localhost:3001", False, None))


if __name__ == "__main__":
    unittest.main()
