"""Uncompressed capture-byte fidelity, bounded transport and authorization."""
import json
import asyncio
from pathlib import Path
import struct
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'connector'))
from av import AudioFrame
from pcm_audio import CHANNEL_LABEL, FORMAT, HEADER, MAX_BUFFERED_BYTES, MAX_SCTP_BYTES, READY, SystemPCMSender, packets
from aiortc import RTCConfiguration, RTCPeerConnection


def source(count=960):
    # Include values below the S16 quantization floor and signed zero. PCM must
    # preserve the original float32 bits, rather than round-trip through S16.
    left = b''.join(struct.pack('<I', (0x00000001, 0x80000000, 0x3eaaaaab, 0xbf123456)[index % 4]) for index in range(count))
    right = b''.join(struct.pack('<I', (0x3f012345, 0x00000000, 0x80000001, 0x3dcccccd)[index % 4]) for index in range(count))
    frame = AudioFrame(format='fltp', layout='stereo', samples=count)
    frame.sample_rate = 48000
    frame.planes[0].update(left); frame.planes[1].update(right)
    return frame, left, right


class Channel:
    label = CHANNEL_LABEL
    readyState = 'open'
    ordered = False
    maxRetransmits = 0
    maxPacketLifeTime = None
    def __init__(self):
        self.sent, self.bufferedAmount, self.closed = [], 0, False
        self.id = 1
        self.transport = SimpleNamespace(_sent_queue=[], _outbound_queue=[])
    def send(self, packet): self.sent.append(packet); self.bufferedAmount += len(packet)
    def close(self): self.closed = True


class PacketTests(unittest.TestCase):
    def test_planar_source_bits_survive_chunking_interleave_and_sequence_wrap(self):
        frame, left, right = source(2050)
        encoded = list(packets(frame, 0xfffffffe))
        self.assertEqual(len(encoded), 3)
        output = bytearray()
        for packet, sequence, count in zip(encoded, (0xfffffffe, 0xffffffff, 0), (960, 960, 130)):
            self.assertEqual(HEADER.unpack(packet[:16]), (b'MLP1', sequence, count, 2, 1, 48000))
            self.assertEqual(len(packet), 16 + count * 8)
            self.assertLessEqual(len(packet), 7696)
            output.extend(packet[16:])
        expected = b''.join(left[index:index + 4] + right[index:index + 4] for index in range(0, len(left), 4))
        self.assertEqual(bytes(output), expected)

    def test_already_packed_float_source_is_not_reencoded(self):
        original, left, right = source(480)
        payload = b''.join(left[index:index + 4] + right[index:index + 4] for index in range(0, len(left), 4))
        packed = AudioFrame(format='flt', layout='stereo', samples=480); packed.sample_rate = 48000
        packed.planes[0].update(payload)
        self.assertEqual(list(packets(packed, 3))[0][16:], payload)

    def test_quantized_audio_cannot_be_mistaken_for_original_float_capture(self):
        frame = AudioFrame(format='s16', layout='stereo', samples=960); frame.sample_rate = 48000
        with self.assertRaises(ValueError): list(packets(frame, 0))


class SenderTests(unittest.TestCase):
    def test_original_audio_requires_ready_and_authorization_after_every_pause(self):
        allowed = [False]
        channel = Channel(); sender = SystemPCMSender(lambda: allowed[0]); sender.attach(channel)
        frame, _, _ = source()
        sender.receive(json.dumps(READY)); self.assertFalse(sender.send(frame))
        allowed[0] = True
        self.assertFalse(sender.send(frame))
        sender.receive(json.dumps(READY)); self.assertTrue(sender.send(frame))
        self.assertEqual(sum(isinstance(item, bytes) for item in channel.sent), 1)
        self.assertEqual(json.loads(channel.sent[-1]), {'type': 'format', 'format': FORMAT})
        allowed[0] = False; sender.sync()
        self.assertEqual(json.loads(channel.sent[-1]), {'type': 'format', 'format': 'opus'})
        self.assertFalse(sender.ready)
        allowed[0] = True
        self.assertFalse(sender.send(frame))
        sender.receive(json.dumps(READY)); self.assertTrue(sender.send(frame))
        sender.close(); self.assertFalse(sender.send(frame))

    def test_only_small_exact_audio_messages_affect_readiness(self):
        channel = Channel(); sender = SystemPCMSender(lambda: True); sender.attach(channel)
        malformed = [b'binary', '{}', '[]', 'x' * 257, '\ud800', json.dumps({'type': 'key', 'code': 'KeyA', 'down': True}),
                     json.dumps({**READY, 'sampleRate': 48000.0}), json.dumps({**READY, 'channels': 2.0}),
                     json.dumps({**READY, 'format': 's16'}), json.dumps({**READY, 'extra': 'ignored'})]
        for raw in malformed:
            sender.receive(raw); self.assertFalse(sender.ready)
        sender.receive(json.dumps(READY)); self.assertTrue(sender.ready)
        sender.receive('{"type":"disabled"}'); self.assertFalse(sender.ready)

    def test_reliable_unknown_and_duplicate_channels_are_closed(self):
        sender = SystemPCMSender(lambda: True)
        reliable = Channel(); reliable.ordered = True
        self.assertFalse(sender.attach(reliable)); self.assertTrue(reliable.closed)
        unknown = Channel(); unknown.label = 'control'
        self.assertFalse(sender.attach(unknown)); self.assertTrue(unknown.closed)
        current = Channel(); self.assertTrue(sender.attach(current))
        duplicate = Channel(); self.assertFalse(sender.attach(duplicate)); self.assertTrue(duplicate.closed)
        sender.detach(duplicate); self.assertIs(sender.channel, current)
        sender.detach(current); self.assertIsNone(sender.channel)

    def test_backpressure_drops_instead_of_building_a_stale_pcm_queue(self):
        channel = Channel(); sender = SystemPCMSender(lambda: True); sender.attach(channel)
        sender.receive(json.dumps(READY)); channel.bufferedAmount = MAX_BUFFERED_BYTES - 100
        self.assertFalse(sender.send(source()[0]))
        self.assertFalse(any(isinstance(item, bytes) for item in channel.sent))
        self.assertFalse(sender.ready)
        channel.bufferedAmount = 0
        self.assertFalse(sender.send(source()[0]))
        sender.receive(json.dumps(READY)); self.assertTrue(sender.send(source()[0]))

    def test_retained_gap_acked_pcm_counts_toward_sctp_budget_even_after_channel_buffer_drains(self):
        channel = Channel(); sender = SystemPCMSender(lambda: True); sender.attach(channel)
        retained = SimpleNamespace(stream_id=channel.id, user_data=bytes(MAX_SCTP_BYTES - 100), _acked=True)
        channel.transport._sent_queue.append(retained)
        sender.receive(json.dumps(READY))
        self.assertEqual(channel.bufferedAmount, 0)
        self.assertFalse(sender.send(source()[0]))
        self.assertFalse(sender.ready)
        self.assertIs(channel.transport._sent_queue[0], retained)

    def test_sctp_guard_fails_closed_without_private_queue_interface_and_leaves_other_streams_alone(self):
        channel = Channel(); sender = SystemPCMSender(lambda: True); sender.attach(channel)
        other = SimpleNamespace(stream_id=9, user_data=bytes(MAX_SCTP_BYTES), _acked=True)
        channel.transport._sent_queue.append(other)
        sender.receive(json.dumps(READY)); self.assertTrue(sender.send(source()[0]))
        self.assertIs(channel.transport._sent_queue[0], other)
        del channel.transport._sent_queue
        channel.bufferedAmount = 0
        self.assertFalse(sender.send(source()[0]))
        self.assertFalse(sender.ready)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_unreliable_dtls_data_channel_preserves_pcm_and_keeps_control_separate(self):
        configuration = RTCConfiguration(iceServers=[])
        viewer, host = RTCPeerConnection(configuration), RTCPeerConnection(configuration)
        received = asyncio.get_running_loop().create_future()
        control_received = asyncio.get_running_loop().create_future()
        sender = SystemPCMSender(lambda: host.connectionState == 'connected')
        audio = viewer.createDataChannel(CHANNEL_LABEL, ordered=False, maxRetransmits=0)
        control = viewer.createDataChannel('control', ordered=True)
        frame, left, right = source()
        @audio.on('open')
        def ready(): audio.send(json.dumps(READY))
        @audio.on('message')
        def receive(packet):
            if isinstance(packet, bytes) and not received.done(): received.set_result(packet)
        @control.on('open')
        def control_ready(): control.send('separate-control-ping')
        @host.on('datachannel')
        def opened(channel):
            if channel.label == CHANNEL_LABEL:
                self.assertTrue(sender.attach(channel))
                @channel.on('message')
                def audio_ready(raw):
                    sender.receive(raw)
                    sender.send(frame)
            else:
                @channel.on('message')
                def control_message(raw):
                    if not control_received.done(): control_received.set_result(raw)
        try:
            await viewer.setLocalDescription(await viewer.createOffer())
            await host.setRemoteDescription(viewer.localDescription)
            await host.setLocalDescription(await host.createAnswer())
            await viewer.setRemoteDescription(host.localDescription)
            packet, message = await asyncio.wait_for(asyncio.gather(received, control_received), 10)
            self.assertEqual(message, 'separate-control-ping')
            self.assertEqual(HEADER.unpack(packet[:16]), (b'MLP1', 0, 960, 2, 1, 48000))
            self.assertEqual(packet[16:], b''.join(left[index:index + 4] + right[index:index + 4] for index in range(0, len(left), 4)))
        finally:
            sender.close(); await viewer.close(); await host.close()


if __name__ == '__main__': unittest.main()
