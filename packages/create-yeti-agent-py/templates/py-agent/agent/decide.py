"""Strategy entry point. The only file you should edit alongside persona.md.

`decide(snapshot)` is pure — same input, same output. Return a list with
at most 3 entries (server-enforced). Returning [] tells the runtime to
skip submission and hold whatever positions you already have.
"""
from __future__ import annotations
from typing import List

from yetifi_arena import Decision, Snapshot


def decide(snapshot: Snapshot) -> List[Decision]:
    return []
