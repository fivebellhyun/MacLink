"""Display-only support placeholders; no payment links, configuration, or I/O."""

SUPPORT_MESSAGE = '아직 후원 기능은 지원하지 않습니다. 마음만 감사히 받겠습니다.'

_TIERS = (
    ('gum', '껌 던져주기', '🍬'),
    ('coffee', '따뜻한 커피 한 잔 후원하기', '☕'),
    ('meal', '한 끼 대접하기', '🍚'),
)


def support_options() -> tuple[dict, ...]:
    """Return the three button labels without payment destinations or amounts."""
    return tuple({'id': tier_id, 'label': label, 'icon': icon}
                 for tier_id, label, icon in _TIERS)
