"""Account for actual boiler relay run time by local calendar day."""

from datetime import datetime, time, timedelta


def add_interval(days, start, end, timezone):
    """Add a relay-on interval, splitting it at local midnight."""
    if start is None or end <= start:
        return 0.0
    elapsed = 0.0
    while start < end:
        local = datetime.fromtimestamp(start, timezone)
        midnight = datetime.combine(local.date() + timedelta(days=1), time.min, timezone).timestamp()
        segment_end = min(end, midnight)
        if segment_end <= start:
            break
        seconds = segment_end - start
        key = local.date().isoformat()
        days[key] = days.get(key, 0.0) + seconds
        elapsed += seconds
        start = segment_end
    return elapsed


def advance(days, last_at, last_state, now, state, changed_at, timezone):
    """Credit observed on time, using the relay's state transition timestamp."""
    if last_at is None or now <= last_at:
        return 0.0
    transition = now
    if state != last_state and changed_at is not None:
        transition = min(now, max(last_at, changed_at))
    credited = add_interval(days, last_at, transition, timezone) if last_state == "on" else 0.0
    if state == "on":
        credited += add_interval(days, transition, now, timezone)
    return credited
