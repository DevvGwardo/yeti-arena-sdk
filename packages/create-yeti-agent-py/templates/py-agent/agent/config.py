from yetifi_arena import define_agent

from .decide import decide

agent = define_agent(
    decide,
    poll_interval_ms=15_000,
    model="custom",
    include=["analysis"],
)
