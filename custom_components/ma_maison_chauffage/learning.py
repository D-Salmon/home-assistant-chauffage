"""Per-room, rolling-window heat-up learning helpers."""
from statistics import median


def add_sample(samples, now, temperature, heating, window_days, outdoor=None):
    """Keep one temperature observation per five-minute bucket for a rolling window."""
    cutoff = now - window_days * 86400
    kept = [item for item in samples if cutoff <= item[0] <= now and isinstance(item[1], (int, float))]
    if kept and now - kept[-1][0] < 300:
        return kept, False
    kept.append([now, float(temperature), bool(heating), outdoor if isinstance(outdoor, (int, float)) else None])
    return kept, True


def estimate_minutes(samples, current, target, now, window_days, warming, outdoor=None, fallback=30):
    """Estimate warm-up or cool-down duration from matching recent room observations."""
    cutoff = now - window_days * 86400
    recent = [item for item in samples if cutoff <= item[0] <= now]
    rates = []
    for prev, item in zip(recent, recent[1:]):
        t0, v0 = prev[:2]
        t1, v1 = item[:2]
        minutes = (t1 - t0) / 60
        rate = (v1 - v0) / minutes if minutes > 0 else 0
        matching_mode = len(prev) >= 3 and len(item) >= 3 and bool(prev[2]) == warming and bool(item[2]) == warming
        weather = (prev[3], item[3]) if len(prev) >= 4 and len(item) >= 4 else (None, None)
        if 5 <= minutes <= 90 and matching_mode and ((warming and 0.005 <= rate <= 0.12) or (not warming and -0.12 <= rate <= -0.005)):
            rates.append((rate if warming else -rate, weather))
    if not isinstance(current, (int, float)):
        return fallback, len(rates)
    if (warming and target <= current) or (not warming and target >= current):
        return 0, len(rates)
    if not rates:
        return fallback, 0
    weather_rates = [rate for rate, pair in rates if isinstance(outdoor, (int, float)) and all(isinstance(v, (int, float)) for v in pair) and abs(sum(pair) / 2 - outdoor) <= 5]
    usable = weather_rates if len(weather_rates) >= 3 else [rate for rate, _ in rates]
    return min(180, max(5, abs(target - current) / median(usable))), len(usable)


def upcoming_block(schedule_data, now):
    """Return the next profile transition, including block ends back to Eco."""
    if not isinstance(schedule_data, dict):
        return None, None
    names = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    candidates = []
    for offset in range(8):
        day = now.date().fromordinal(now.date().toordinal() + offset)
        for block in schedule_data.get(names[day.weekday()], []):
            try:
                profile = (block.get("data") or {}).get("profil", "confort")
                if profile not in ("confort", "eco", "nuit", "absent"):
                    continue
                for field, next_profile, priority in (("from", profile, 0), ("to", "eco", 1)):
                    hour, minute, *_ = map(int, block[field].split(":"))
                    event_day = day
                    if hour == 24 and minute == 0:
                        event_day = day.fromordinal(day.toordinal() + 1)
                        hour = 0
                    stamp = now.replace(year=event_day.year, month=event_day.month, day=event_day.day,
                                        hour=hour, minute=minute, second=0, microsecond=0)
                    if stamp > now:
                        candidates.append((stamp.timestamp(), priority, next_profile))
            except (KeyError, ValueError, TypeError):
                continue
    if not candidates:
        return None, None
    stamp, _, profile = min(candidates)
    return stamp, profile
