"""Bounded, encrypted, uncompressed system audio for the Ultra profile."""
import json
import struct

CHANNEL_LABEL = 'maclink-system-audio'
FORMAT = 'pcm-f32le'
MAX_FRAMES = 960
MAX_BUFFERED_BYTES = 32768
MAX_SCTP_BYTES = 131072
HEADER = struct.Struct('<4sIHBBI')
READY = {'type': 'ready', 'format': FORMAT, 'sampleRate': 48000, 'channels': 2}


def packets(frame, sequence):
    """Interleave float bytes without numeric conversion or S16 quantization."""
    if frame.sample_rate != 48000 or frame.layout.name != 'stereo' or frame.format.name not in ('flt', 'fltp') or not 0 < frame.samples <= 4800:
        raise ValueError('Unsupported native PCM format')
    planar = frame.format.name == 'fltp'
    planes = [bytes(plane) for plane in frame.planes]
    for start in range(0, frame.samples, MAX_FRAMES):
        count = min(MAX_FRAMES, frame.samples - start)
        if planar:
            left, right = (plane[start * 4:(start + count) * 4] for plane in planes)
            payload = bytearray(count * 8)
            for byte in range(4):
                payload[byte::8] = left[byte::4]
                payload[byte + 4::8] = right[byte::4]
        else:
            payload = planes[0][start * 8:(start + count) * 8]
        yield HEADER.pack(b'MLP1', sequence, count, 2, 1, 48000) + payload
        sequence = (sequence + 1) & 0xffffffff


class SystemPCMSender:
    """All methods run on the peer's asyncio thread, separate from input control."""
    def __init__(self, gate):
        self.gate = gate
        self.channel = None
        self.ready = False
        self.sequence = 0
        self.format = 'opus'
        self.closed = False

    def attach(self, channel):
        if (self.closed or channel.label != CHANNEL_LABEL or self.channel is not None or channel.ordered is not False
                or type(channel.maxRetransmits) is not int or channel.maxRetransmits != 0 or channel.maxPacketLifeTime is not None):
            channel.close()
            return False
        self.channel = channel
        return True

    def receive(self, raw):
        if not isinstance(raw, str) or len(raw) > 256 or self.closed or self.channel is None or self.channel.readyState != 'open':
            return
        try:
            if len(raw.encode('utf-8')) > 256: return
            event = json.loads(raw)
        except (ValueError, TypeError, UnicodeError):
            return
        if event == {'type': 'disabled'}:
            self.pause()
        elif isinstance(event, dict) and event == READY and type(event['sampleRate']) is int and type(event['channels']) is int and self.gate():
            self.ready = True

    def _format(self, value):
        if self.format == value:
            return
        self.format = value
        message = json.dumps({'type': 'format', 'format': value}, separators=(',', ':'))
        if self.channel and self.channel.readyState == 'open' and self.channel.bufferedAmount + len(message) <= MAX_BUFFERED_BYTES and self._queued_bytes() + len(message) <= MAX_SCTP_BYTES:
            try:
                self.channel.send(message)
            except Exception:
                pass

    def pause(self):
        self.ready = False
        self._format('opus')

    def sync(self):
        if not self.gate(): self.pause()

    def detach(self, channel):
        if channel is self.channel:
            self.pause(); self.channel = None

    def close(self):
        self.pause(); self.closed = True; self.channel = None

    def _queued_bytes(self):
        """Pinned aiortc 1.15 retains even gap-ACKed chunks until cumulative ACK."""
        channel = self.channel
        try:
            transport, stream_id = channel.transport, channel.id
            if type(stream_id) is not int: return MAX_SCTP_BYTES
            total = channel.bufferedAmount
            scanned = 0
            for queue in (transport._sent_queue, transport._outbound_queue):
                for chunk in queue:
                    scanned += 1
                    if scanned > 4096: return MAX_SCTP_BYTES
                    if chunk.stream_id == stream_id:
                        total += len(chunk.user_data)
                        if total >= MAX_SCTP_BYTES: return total
            return total
        except (AttributeError, TypeError):
            # An unknown transport interface must fall back to Opus, rather
            # than silently stop bounding queued PCM payloads.
            return MAX_SCTP_BYTES

    def send(self, frame):
        channel = self.channel
        if self.closed or not self.gate():
            self.pause(); return False
        if not self.ready or channel is None or channel.readyState != 'open':
            return False
        try:
            for packet in packets(frame, self.sequence):
                if not self.gate() or channel.bufferedAmount + len(packet) > MAX_BUFFERED_BYTES or self._queued_bytes() + len(packet) > MAX_SCTP_BYTES:
                    self.pause(); return False
                channel.send(packet)
                self.sequence = (self.sequence + 1) & 0xffffffff
            self._format(FORMAT)
            return True
        except Exception:
            self.pause()
            return False


def install_audio_encoding(sender):
    """Music-oriented Opus on this sender only; retain it as PCM fallback."""
    import aiortc
    from aiortc.codecs.opus import OpusEncoder
    if aiortc.__version__ != '1.15.0' or sender.kind != 'audio' or getattr(sender, '_RTCRtpSender__encoder', None) is not None:
        raise RuntimeError('Unsupported audio sender')
    encoder = OpusEncoder()
    encoder.codec.bit_rate = 192000
    encoder.codec.options = {'application': 'audio'}
    sender._RTCRtpSender__encoder = encoder
    return encoder
