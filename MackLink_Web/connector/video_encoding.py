"""Per-sender video policies for the pinned aiortc 1.15.0 implementation.

aiortc exposes no public bitrate/encoder-factory API. This narrow adapter wraps
one sender's public send() and installs its encoder before RTP starts. No codec
globals or sender classes are patched. An incompatible private interface fails
that attachment's setup rather than silently using the old 1.5/3Mbps ceilings.

Targets/ceilings are bounded fidelity policies, not hardware/network maxima or
lossless promises. REMB may lower them to 100kbps. H264 obeys the negotiated
Baseline level even when this requires smaller output than the requested native
size, and rounds odd dimensions down for 4:2:0. VP8 should be preferred for large
desktops. Video and remote input use WebRTC exclusively.
"""
from __future__ import annotations

import math
import multiprocessing
import re
import threading
import weakref
from fractions import Fraction

import aiortc
import av
from aiortc import RTCRtpSender
from aiortc.codecs.base import Encoder
from aiortc.codecs.h264 import H264Encoder
from aiortc.codecs.vpx import Vp8Encoder, number_of_threads
from aiortc.mediastreams import VIDEO_TIME_BASE, convert_timebase
from aiortc.sdp import SessionDescription

from quality import PROFILES

SUPPORTED_AIORTC = '1.15.0'
MIN_FEEDBACK_BITRATE = 100_000

# Baseline Annex A limits: maximum macroblocks/frame, macroblocks/s and bits/s.
# Primary reference: x264 common/tables.c, x264_levels (ITU-T H.264 Annex A).
# https://code.videolan.org/videolan/x264/-/blob/master/common/tables.c
H264_LEVELS = {
    9: (99, 1485, 128_000), 10: (99, 1485, 64_000),
    11: (396, 3000, 192_000), 12: (396, 6000, 384_000),
    13: (396, 11880, 768_000), 20: (396, 11880, 2_000_000),
    21: (792, 19800, 4_000_000), 22: (1620, 20250, 4_000_000),
    30: (1620, 40500, 10_000_000), 31: (3600, 108000, 14_000_000),
    32: (5120, 216000, 20_000_000), 40: (8192, 245760, 20_000_000),
    41: (8192, 245760, 50_000_000), 42: (8704, 522240, 50_000_000),
    50: (22080, 589824, 135_000_000), 51: (36864, 983040, 240_000_000),
    52: (36864, 2073600, 240_000_000),
}


def _h264_level(codec):
    value = codec.parameters.get('profile-level-id', '42e01f')
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-fA-F]{6}', value):
        raise RuntimeError('Unsupported H264 profile-level-id.')
    profile, flags, level = bytes.fromhex(value)
    if profile != 0x42 or str(codec.parameters.get('packetization-mode', '0')) != '1':
        raise RuntimeError('Only negotiated Baseline H264 packetization mode 1 is supported.')
    if level == 11 and flags & 0x10:
        level = 9
    if level not in H264_LEVELS:
        raise RuntimeError('Unsupported H264 receive level.')
    # level-asymmetry-allowed is not permission to exceed the peer's receive
    # level. Conservatively use the selected codec's level in either case.
    return level


def h264_dimensions(width, height, fps, level):
    """Fit within the negotiated frame/MBPS/dimension limits, never upscale."""
    if width < 2 or height < 2:
        raise ValueError('H264 requires at least a 2x2 source.')
    fs, mbps, _ = H264_LEVELS[level]
    blocks = min(fs, mbps // fps)
    side = math.isqrt(fs * 8)
    macroblocks = math.ceil(width / 16) * math.ceil(height / 16)
    scale = min(1, math.sqrt(blocks / macroblocks), side * 16 / max(width, height))
    for _ in range(100):
        w, h = max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2)
        mw, mh = math.ceil(w / 16), math.ceil(h / 16)
        if mw * mh <= blocks and max(mw, mh) <= side:
            return w, h
        scale *= .99
    raise ValueError('Could not fit the H264 receive level.')


class _PolicyVp8Encoder(Vp8Encoder):
    def __init__(self):
        super().__init__()
        self.fps = 24

    @property
    def target_bitrate(self):
        return self._Vp8Encoder__target_bitrate

    @target_bitrate.setter
    def target_bitrate(self, value):
        # Base encode() also uses this field for its CBR buffer size.
        self._Vp8Encoder__target_bitrate = value

    def encode(self, frame, force_keyframe=False):
        if self.codec and (frame.width != self.codec.width or frame.height != self.codec.height
                           or abs(self.target_bitrate - self.codec.bit_rate) / self.codec.bit_rate > .1):
            self.codec = None
        if self.codec is None:
            self.codec = av.CodecContext.create('libvpx', 'w')
            self.codec.width, self.codec.height = frame.width, frame.height
            self.codec.bit_rate = self.target_bitrate
            self.codec.pix_fmt = 'yuv420p'
            self.codec.framerate, self.codec.time_base = Fraction(self.fps, 1), Fraction(1, self.fps)
            self.codec.gop_size, self.codec.qmin, self.codec.qmax = 3000, 2, 56
            self.codec.options = {'bufsize': str(self.target_bitrate), 'cpu-used': '-6',
                                  'deadline': 'realtime', 'lag-in-frames': '0',
                                  'minrate': str(self.target_bitrate), 'maxrate': str(self.target_bitrate),
                                  'noise-sensitivity': '4', 'overshoot-pct': '15', 'partitions': '0',
                                  'static-thresh': '1', 'undershoot-pct': '100'}
            self.codec.thread_count = number_of_threads(frame.width * frame.height, multiprocessing.cpu_count())
        return super().encode(frame, force_keyframe)


class _PolicyH264Encoder(H264Encoder):
    def __init__(self, level):
        super().__init__()
        self.level = level
        self.fps = 24

    @property
    def target_bitrate(self):
        return self._H264Encoder__target_bitrate

    @target_bitrate.setter
    def target_bitrate(self, value):
        self._H264Encoder__target_bitrate = value

    def _encode_frame(self, frame, force_keyframe):
        # Retain aiortc's native packetization, keyframe and buffer handling;
        # create only the codec context ourselves to avoid its forced level 3.1.
        if self.codec and (frame.width != self.codec.width or frame.height != self.codec.height
                           or abs(self.target_bitrate - self.codec.bit_rate) / self.codec.bit_rate > .1):
            self.codec = None
            self.buffer_data, self.buffer_pts = b'', None
        if self.codec is None:
            self.codec = av.CodecContext.create('libx264', 'w')
            self.codec.width, self.codec.height = frame.width, frame.height
            self.codec.bit_rate = self.target_bitrate
            self.codec.pix_fmt = 'yuv420p'
            self.codec.framerate = Fraction(self.fps, 1)
            self.codec.time_base = Fraction(1, self.fps)
            self.codec.profile = 'Baseline'
            self.codec.options = {'level': '1b' if self.level == 9 else str(self.level / 10),
                                  'tune': 'zerolatency', 'preset': 'veryfast',
                                  'maxrate': str(self.target_bitrate), 'bufsize': str(self.target_bitrate)}
        yield from super()._encode_frame(frame, force_keyframe)


class SessionVideoEncoding(Encoder):
    def __init__(self, quality):
        self._lock = threading.Lock()
        self._quality = weakref.ref(quality)
        self._sender = None
        self._original_send = None
        self._wrapped_send = None
        self._encoder = None
        self._codec_limit = None
        self._level = None
        self._feedback = None
        self._revision = 0
        self._applied = None
        self._closed = False
        self._configured = None
        self._context_policy = None
        self.encoded_size = None
        self.set_profile(quality.name, quality.profile)

    def set_profile(self, name, profile):
        if name not in PROFILES or profile != PROFILES[name]:
            raise ValueError('Invalid video profile.')
        with self._lock:
            if self._closed:
                return
            self._name, self._profile = name, profile
            self._requested = min(profile.target_bitrate, self._feedback) if self._feedback is not None else profile.target_bitrate
            self._revision += 1
            self._applied = None

    def _target(self):
        ceiling = min(self._profile.max_bitrate, self._codec_limit or self._profile.max_bitrate)
        return max(min(MIN_FEEDBACK_BITRATE, ceiling), min(self._requested, ceiling))

    @property
    def target_bitrate(self):
        with self._lock:
            return self._target()

    @target_bitrate.setter
    def target_bitrate(self, value):
        if isinstance(value, bool) or not isinstance(value, int):
            return
        with self._lock:
            self._feedback = value
            self._requested = value

    @property
    def applied_profile(self):
        with self._lock:
            return self._applied if not self._closed else None

    def configure(self, codec, remote_codec=None):
        key = (codec.mimeType.lower(), tuple(sorted(codec.parameters.items())),
               tuple(sorted(remote_codec.parameters.items())) if remote_codec else ())
        if self._configured is not None:
            if key != self._configured:
                raise RuntimeError('A running sender cannot replace its negotiated encoder.')
            return
        if codec.clockRate != 90000:
            raise RuntimeError('Unsupported video clock rate.')
        if key[0] == 'video/vp8':
            encoder = _PolicyVp8Encoder()
        elif key[0] == 'video/h264':
            self._level = _h264_level(codec)
            if remote_codec is not None:
                # aiortc 1.15 copies the local codec and payload type, but not
                # the remote receive level, into RTCRtpSendParameters.
                self._level = min(self._level, _h264_level(remote_codec), key=lambda level: 10.5 if level == 9 else level)
            self._codec_limit = H264_LEVELS[self._level][2]
            encoder = _PolicyH264Encoder(self._level)
        else:
            raise RuntimeError('Unsupported negotiated video codec.')
        self._encoder, self._configured = encoder, key

    def encode(self, frame, force_keyframe=False):
        if not isinstance(frame, av.VideoFrame) or self._encoder is None:
            raise ValueError('A negotiated raw video frame is required.')
        with self._lock:
            if self._closed:
                return [], convert_timebase(frame.pts, frame.time_base, VIDEO_TIME_BASE)
            name, profile, revision, bitrate = self._name, self._profile, self._revision, self._target()
        # Only this encoding thread mutates PyAV contexts. RTCP and quality
        # changes update the tiny policy snapshot, never wait for frame encoding.
        policy = (profile.fps, profile.max_bitrate)
        if policy != self._context_policy:
            self._encoder.codec = None
            self._context_policy = policy
        self._encoder.target_bitrate = bitrate
        self._encoder.fps = profile.fps
        if self._level is not None:
            dimensions = h264_dimensions(frame.width, frame.height, profile.fps, self._level)
            if dimensions != (frame.width, frame.height):
                frame = frame.reformat(width=dimensions[0], height=dimensions[1])
        payloads, timestamp = self._encoder.encode(frame, force_keyframe)
        if payloads:
            with self._lock:
                if not self._closed and revision == self._revision:
                    self._applied = name
                    self.encoded_size = (frame.width, frame.height)
        return payloads, timestamp

    def pack(self, packet):
        raise ValueError('Pre-encoded packets cannot satisfy a screen encoding policy.')

    def close(self):
        with self._lock:
            self._closed, self._applied = True, None
        quality = self._quality()
        if quality is not None and quality.encoding is self:
            quality.bind_encoding(None)
        sender = self._sender() if self._sender else None
        if sender is not None and getattr(sender, '_maclink_video_encoding', None) is self:
            if sender.send is self._wrapped_send:
                del sender.send
            del sender._maclink_video_encoding


def install_video_encoding(sender, quality, *, remote_sdp):
    """Install once before createAnswer/setLocalDescription starts the sender."""
    if (aiortc.__version__ != SUPPORTED_AIORTC or not isinstance(sender, RTCRtpSender)
            or sender.kind != 'video' or not hasattr(sender, '_RTCRtpSender__encoder')
            or getattr(sender, '_RTCRtpSender__started', True)
            or getattr(sender, '_RTCRtpSender__encoder') is not None
            or getattr(sender.send, '__func__', None) is not RTCRtpSender.send
            or hasattr(sender, '_maclink_video_encoding')):
        raise RuntimeError('Unsupported aiortc sender interface; video setup stopped.')
    if (not hasattr(Vp8Encoder(), '_Vp8Encoder__target_bitrate')
            or not hasattr(H264Encoder(), '_H264Encoder__target_bitrate')):
        raise RuntimeError('Unsupported aiortc encoder interface; video setup stopped.')
    if not isinstance(remote_sdp, str) or len(remote_sdp) > 1_000_000:
        raise RuntimeError('A bounded remote offer is required for video encoding.')
    description = SessionDescription.parse(remote_sdp)
    remote_codecs = {(media.rtp.muxId, codec.payloadType): codec
                     for media in description.media if media.kind == 'video' for codec in media.rtp.codecs}
    controller = SessionVideoEncoding(quality)
    original = sender.send

    async def send(parameters):
        if controller._closed or not parameters.codecs:
            raise RuntimeError('Video encoding policy is not available.')
        selected = parameters.codecs[0]
        remote = remote_codecs.get((parameters.muxId, selected.payloadType))
        if remote is None or remote.mimeType.lower() != selected.mimeType.lower():
            raise RuntimeError('The selected video codec was not offered by the peer.')
        controller.configure(selected, remote)
        sender._RTCRtpSender__encoder = controller
        await original(parameters)

    controller._sender = weakref.ref(sender)
    controller._original_send, controller._wrapped_send = original, send
    sender.send = send
    sender._maclink_video_encoding = controller
    quality.bind_encoding(controller)
    return controller
