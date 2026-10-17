"""Width-limited screen policies; WebRTC rates are bounded targets, not guarantees.

Every preset preserves the source aspect ratio and avoids upscaling. Codec,
receiver and network limits still apply.
"""
from typing import NamedTuple

class Profile(NamedTuple):
    size: int | None
    fps: int
    target_bitrate: int
    max_bitrate: int

PROFILES = {
    'low': Profile(1600, 15, 2_000_000, 4_000_000),
    'balanced': Profile(1600, 24, 4_000_000, 8_000_000),
    'high': Profile(2560, 30, 8_000_000, 16_000_000),
    'ultra': Profile(2560, 60, 16_000_000, 40_000_000),
}

class QualitySettings:
    def __init__(self):
        self.name = 'balanced'
        self.encoding = None

    def bind_encoding(self, encoding):
        """Only the current attachment receives explicit quality changes."""
        self.encoding = encoding
        if encoding is not None:
            encoding.set_profile(self.name, self.profile)

    @property
    def profile(self):
        # Immutable tuples are safe to snapshot from the screen capture thread.
        return PROFILES[self.name]

    def select(self, name, track=None):
        if not isinstance(name, str) or name not in PROFILES:
            return False
        changed = self.name != name
        self.name = name
        if changed and track is not None:
            track.set_fps(self.profile.fps)
        if changed and self.encoding is not None:
            self.encoding.set_profile(self.name, self.profile)
        return changed

def _limit_width(image, maximum):
    if maximum is not None and image.width > maximum:
        return image.resize((maximum, max(1, round(image.height * maximum / image.width))))
    return image

def prepare_capture(image, profile):
    return _limit_width(image, profile.size)
