"""Synthetic system audio: permissions, native PCM bridge and encrypted WebRTC."""
import asyncio
import math
import struct
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'connector'))
from aiortc import RTCConfiguration, RTCPeerConnection
from aiortc.mediastreams import MediaStreamError
from media import SystemAudioTrack
from system_audio import AudioCaptureError, pcm_frame
import system_audio
from maclink import SessionAuthorization, close_attachment
from pcm_audio import install_audio_encoding


ASBD = (48000., int.from_bytes(b'lpcm', 'big'), 1 | 8 | 32, 4, 1, 4, 2, 32, 0)


def tone(value=.4, samples=960):
    channel = struct.pack('<' + 'f' * samples, *[value * math.sin(index * 2 * math.pi * 440 / 48000) for index in range(samples)])
    return pcm_frame(channel + channel, ASBD, samples)


class FakeCapture:
    def __init__(self, deliver, permitted, failed, revision):
        self.deliver, self.permitted, self.failed = deliver, permitted, failed
        self.revision = revision
        self.started = self.closed = False

    async def start(self):
        self.started = True
        self.deliver(tone())

    def close(self):
        self.closed = True


class AudioClock:
    """Deterministic wall clock with a scheduler that wakes 1 ms late."""
    def __init__(self):
        self.now, self.waits, self.after_sleep = 100., [], None

    def __call__(self): return self.now

    async def sleep(self, delay):
        self.waits.append(delay)
        self.now += delay + .001
        if self.after_sleep:
            callback, self.after_sleep = self.after_sleep, None
            callback()
        await asyncio.sleep(0)


class PCMTests(unittest.TestCase):
    def test_planar_stereo_keeps_samples_and_does_not_require_numpy(self):
        frame = tone()
        self.assertEqual((frame.sample_rate, frame.samples, frame.layout.name, frame.format.name), (48000, 960, 'stereo', 'fltp'))
        self.assertEqual(bytes(frame.planes[0]), bytes(frame.planes[1]))
        self.assertTrue(any(bytes(frame.planes[0])))

    def test_rejects_malformed_or_unexpected_native_audio(self):
        for description, samples, data in ((ASBD, 960, b'bad'), ((44100., *ASBD[1:]), 960, bytes(960 * 8)), (ASBD, 10000, bytes(80000))):
            with self.subTest(samples=samples, rate=description[0]):
                with self.assertRaises(AudioCaptureError):
                    pcm_frame(data, description, samples)

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS CoreMedia bridge')
    def test_real_native_sample_buffer_copies_into_owned_planes_without_capture(self):
        import CoreMedia as CM
        import ScreenCaptureKit as SC
        from CoreFoundation import kCFAllocatorNull
        from system_audio import _output_type
        data = bytes(tone(samples=480).planes[0]) + bytes(tone(samples=480).planes[1])
        status, description = CM.CMAudioFormatDescriptionCreate(None, ASBD, 0, None, 0, None, None, None)
        self.assertEqual(status, 0)
        status, block = CM.CMBlockBufferCreateEmpty(None, 1, 0, None)
        self.assertEqual(status, 0)
        self.assertEqual(CM.CMBlockBufferAppendMemoryBlock(block, data, len(data), kCFAllocatorNull, None, 0, len(data), 0), 0)
        status, sample = CM.CMSampleBufferCreateReady(None, block, description, 480, 0, None, 0, None, None)
        self.assertEqual(status, 0)
        delivered, errors = [], []
        receiver = _output_type().alloc().init()
        receiver.capture = SimpleNamespace(closed=False, permitted=lambda: True, revision=lambda: 0, deliver=lambda frame, revision: delivered.append(frame), failed=errors.append)
        receiver.stream_didOutputSampleBuffer_ofType_(None, sample, SC.SCStreamOutputTypeAudio)
        self.assertEqual(errors, [])
        self.assertEqual(len(delivered), 1)
        self.assertEqual(bytes(delivered[0].planes[0]), data[:480 * 4])
        receiver.capture.permitted = lambda: False
        receiver.stream_didOutputSampleBuffer_ofType_(None, sample, SC.SCStreamOutputTypeAudio)
        self.assertEqual(len(delivered), 1)


class AudioTrackTests(unittest.IsolatedAsyncioTestCase):
    async def test_muting_stops_capture_and_recv_until_fresh_unmute(self):
        captures, states = [], []
        def factory(*args):
            capture = FakeCapture(*args); captures.append(capture); return capture
        track = SystemAudioTrack(capture_factory=factory, status=lambda ready, error: states.append((ready, error)))
        pending = None
        try:
            await track.recv()
            old = captures[0]
            self.assertTrue(track.set_enabled(False))
            self.assertTrue(old.closed)
            self.assertFalse(old.permitted())
            self.assertEqual((len(track.queue), track.fifo.samples, track.pcm_fifo.samples), (0, 0, 0))
            pending = asyncio.create_task(track.recv())
            await asyncio.sleep(.07)
            old.deliver(tone()); old.failed('capture-failed')
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
            self.assertEqual(len(captures), 1)
            self.assertFalse(track.failed)
            self.assertTrue(track.set_enabled(True))
            fresh = await asyncio.wait_for(pending, .5)
            self.assertEqual(len(captures), 2)
            self.assertTrue(captures[1].started)
            self.assertTrue(any(bytes(fresh.planes[0])))
            # A native callback from the first capture must remain invalid even
            # after unmute restores the track's permission predicate.
            old.deliver(tone()); old.failed('permission')
            await asyncio.sleep(0)
            self.assertEqual(len(track.queue), 0)
            self.assertFalse(track.failed)
            self.assertEqual(states, [(True, None), (False, None), (True, None)])
        finally:
            track.stop()
            if pending and not pending.done(): pending.cancel()

    async def test_muted_before_recv_never_starts_native_capture(self):
        captures = []
        def factory(*args):
            capture = FakeCapture(*args); captures.append(capture); return capture
        track = SystemAudioTrack(capture_factory=factory)
        track.set_enabled(False)
        pending = asyncio.create_task(track.recv())
        try:
            await asyncio.sleep(.07)
            self.assertEqual(captures, [])
            self.assertFalse(pending.done())
            track.set_enabled(True)
            await asyncio.wait_for(pending, .5)
            self.assertEqual(len(captures), 1)
        finally: track.stop()

    async def test_mute_during_native_start_can_unmute_without_cancelling_rtp_receiver(self):
        entered, cancelled, captures = asyncio.Event(), asyncio.Event(), []
        class Slow(FakeCapture):
            async def start(self):
                entered.set()
                try: await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled.set(); raise
        def factory(*args):
            capture = (Slow if not captures else FakeCapture)(*args)
            captures.append(capture); return capture
        track = SystemAudioTrack(capture_factory=factory)
        pending = asyncio.create_task(track.recv())
        try:
            await entered.wait()
            track.set_enabled(False)
            await cancelled.wait(); await asyncio.sleep(0)
            self.assertFalse(pending.done())
            self.assertTrue(captures[0].closed)
            track.set_enabled(True)
            await asyncio.wait_for(pending, .5)
            self.assertEqual(len(captures), 2)
            self.assertTrue(captures[1].started)
        finally:
            track.stop()
            if not pending.done(): pending.cancel()

    async def test_opus_only_skips_all_float_fifo_preparation_and_pcm_callback(self):
        class UnusedFloatFIFO:
            samples = 0
            def write(self, frame): raise AssertionError('Opus-only path copied float samples')
            def read(self, *args, **kwargs): raise AssertionError('Opus-only path read float samples')
        raw, demanded = [], [False]
        track = SystemAudioTrack(capture_factory=FakeCapture, pcm=raw.append, pcm_demand=lambda: demanded[0])
        unused = UnusedFloatFIFO(); track.pcm_fifo = unused
        try:
            first = await track.recv()
            for _ in range(3): await track.recv()
            self.assertTrue(any(bytes(first.planes[0])))
            self.assertEqual(raw, [])
            self.assertIs(track.pcm_fifo, unused)
            from av import AudioFifo
            track.pcm_fifo = AudioFifo(); demanded[0] = True
            track.push(tone(samples=2050)); await track.recv()
            self.assertGreater(track.pcm_fifo.samples, 0)
            demanded[0] = False
            await track.recv()
            self.assertEqual(track.pcm_fifo.samples, 0)
            self.assertEqual(len(raw), 1)
        finally: track.stop()

    async def test_sample_deadline_absorbs_scheduler_and_processing_delays_without_drift(self):
        clock, delivered, returned, timestamps = AudioClock(), [], [], []
        def pcm(frame):
            delivered.append(bytes(frame.planes[0]))
            clock.now += .0005  # PCM packing/conversion work inside recv().
        track = SystemAudioTrack(capture_factory=FakeCapture, pcm=pcm, clock=clock, sleep=clock.sleep)
        try:
            for _ in range(1000):
                frame = await track.recv()
                returned.append(clock.now); timestamps.append(frame.pts)
                clock.now += .0015  # RTP encoding work before requesting again.
            self.assertAlmostEqual(returned[-1] - returned[0], 999 * .02, places=7)
            self.assertTrue(all(later - earlier >= 960 for earlier, later in zip(timestamps, timestamps[1:])))
            self.assertLess(max(returned[index + 1] - returned[index] for index in range(999)), .020001)
            self.assertEqual(delivered[0], bytes(tone().planes[0]))
            self.assertFalse(any(delivered[-1]))
        finally: track.stop()

    async def test_short_scheduler_stall_recovers_without_a_burst_of_frames(self):
        clock, returned = AudioClock(), []
        track = SystemAudioTrack(capture_factory=FakeCapture, clock=clock, sleep=clock.sleep)
        try:
            await track.recv()
            clock.now += .065
            for _ in range(12):
                await track.recv(); returned.append(clock.now)
            spacing = [later - earlier for earlier, later in zip(returned, returned[1:])]
            self.assertTrue(all(interval >= .01 for interval in spacing))
            self.assertAlmostEqual(spacing[-1], .02, places=7)
        finally: track.stop()

    async def test_long_scheduler_stall_drops_stale_fifo_and_reanchors_without_catchup(self):
        clock, raw = AudioClock(), []
        class Burst(FakeCapture):
            async def start(self): self.deliver(tone(samples=2050))
        track = SystemAudioTrack(capture_factory=Burst, pcm=raw.append, clock=clock, sleep=clock.sleep)
        try:
            first = await track.recv()
            self.assertGreater(track.pcm_fifo.samples, 0)
            clock.now += 2
            resumed = await track.recv(); resumed_at = clock.now
            self.assertFalse(any(bytes(resumed.planes[0])))
            self.assertFalse(any(bytes(raw[-1].planes[0])))
            self.assertEqual(track.pcm_fifo.samples, 0)
            self.assertGreaterEqual(resumed.pts, first.pts + 960)
            self.assertEqual(clock.waits[-1], 0)
            await track.recv()
            self.assertAlmostEqual(clock.now - resumed_at, .02, places=7)
        finally: track.stop()

    async def test_pause_resets_sample_deadline_and_resume_discards_old_float_samples(self):
        clock, raw = AudioClock(), []
        class Burst(FakeCapture):
            async def start(self): self.deliver(tone(samples=2050))
        track = SystemAudioTrack(capture_factory=Burst, pcm=raw.append, clock=clock, sleep=clock.sleep)
        try:
            first = await track.recv()
            old_revision = track.revision
            track.push(tone())
            track.pause()
            self.assertIsNone(track.deadline)
            self.assertIsNone(track.last)
            self.assertEqual(track.pcm_fifo.samples, 0)
            self.assertEqual(len(track.queue), 0)
            clock.now += 5
            track.resume(); track.push(tone(), old_revision)
            resumed = await track.recv()
            self.assertEqual(clock.waits[-1], 0)
            self.assertFalse(any(bytes(raw[-1].planes[0])))
            self.assertGreaterEqual(resumed.pts, first.pts + 960)
            track.push(tone(samples=480))
            await track.recv()
            self.assertEqual(bytes(raw[-1].planes[0])[:480 * 4], bytes(tone(samples=480).planes[0]))
            self.assertFalse(any(bytes(raw[-1].planes[0])[480 * 4:]))
        finally: track.stop()
        self.assertIsNone(track.deadline)

    async def test_long_oversleep_discards_audio_before_returning_and_reanchors(self):
        clock, raw = AudioClock(), []
        track = SystemAudioTrack(capture_factory=FakeCapture, pcm=raw.append, clock=clock, sleep=clock.sleep)
        def delayed_wakeup(): clock.now += .5
        try:
            await track.recv()
            track.push(tone())
            clock.after_sleep = delayed_wakeup
            frame = await track.recv(); resumed_at = clock.now
            self.assertFalse(any(bytes(frame.planes[0])))
            self.assertFalse(any(bytes(raw[-1].planes[0])))
            self.assertEqual(len(track.queue), 0)
            await track.recv()
            self.assertAlmostEqual(clock.now - resumed_at, .021, places=7)
            next_at = clock.now
            await track.recv()
            self.assertAlmostEqual(clock.now - next_at, .02, places=7)
        finally: track.stop()

    async def test_stop_during_pacing_sleep_does_not_release_another_pcm_frame(self):
        clock, raw = AudioClock(), []
        track = SystemAudioTrack(capture_factory=FakeCapture, pcm=raw.append, clock=clock, sleep=clock.sleep)
        try:
            await track.recv()
            clock.after_sleep = track.stop
            with self.assertRaises(MediaStreamError): await track.recv()
            self.assertEqual(len(raw), 1)
            self.assertIsNone(track.deadline)
        finally: track.stop()

    async def test_permission_revoked_during_pacing_sleep_blocks_audio_and_resets_clock(self):
        clock, raw, allowed = AudioClock(), [], [True]
        track = SystemAudioTrack(gate=lambda: allowed[0], capture_factory=FakeCapture, pcm=raw.append, clock=clock, sleep=clock.sleep)
        revoked = asyncio.Event()
        def revoke():
            allowed[0] = False; revoked.set()
        try:
            await track.recv()
            track.push(tone())
            clock.after_sleep = revoke
            pending = asyncio.create_task(track.recv())
            await revoked.wait(); await asyncio.sleep(0)
            self.assertFalse(pending.done())
            self.assertEqual(len(raw), 1)
            self.assertIsNone(track.deadline)
            self.assertEqual(len(track.queue), 0)
            clock.now += 1
            allowed[0] = True; track.resume()
            resumed = await asyncio.wait_for(pending, .2)
            self.assertFalse(any(bytes(resumed.planes[0])))
            self.assertEqual(clock.waits[-1], 0)
        finally: track.stop()

    async def test_native_configuration_registers_only_system_audio_and_closes(self):
        values, outputs, stops, pending_starts = {}, [], [], []
        class Object:
            @classmethod
            def alloc(cls): return cls()
            def init(self): return self
        class Configuration(Object):
            def __getattr__(self, name): return lambda value: values.update({name: value})
        class Filter(Object):
            def initWithDisplay_excludingWindows_(self, display, windows): return self
        class Stream(Object):
            delay_start = False
            def initWithFilter_configuration_delegate_(self, content_filter, configuration, output): return self
            def addStreamOutput_type_sampleHandlerQueue_error_(self, output, kind, queue, error): outputs.append(kind); return True, None
            def startCaptureWithCompletionHandler_(self, done):
                if self.delay_start: pending_starts.append(done)
                else: done(None)
            def stopCaptureWithCompletionHandler_(self, done): stops.append(True); done(None)
        display = SimpleNamespace(displayID=lambda: 3)
        fake = SimpleNamespace(SCShareableContent=SimpleNamespace(getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler_=lambda desktop, onscreen, done: done(SimpleNamespace(displays=lambda: [display]), None)), SCStreamConfiguration=Configuration, SCContentFilter=Filter, SCStream=Stream, SCStreamOutputTypeAudio=1)
        capture = system_audio.ScreenAudioCapture(lambda frame, revision: None, lambda: True, lambda reason: None, lambda: 0)
        with patch.dict(sys.modules, {'ScreenCaptureKit': fake, 'CoreMedia': SimpleNamespace(CMTimeMake=lambda value, scale: (value, scale)), 'Quartz': SimpleNamespace(CGPreflightScreenCaptureAccess=lambda: True, CGMainDisplayID=lambda: 3)}), patch.object(system_audio, '_output_type', return_value=Object):
            await capture.start()
            capture.close()
            Stream.delay_start = True
            cancelled = system_audio.ScreenAudioCapture(lambda frame, revision: None, lambda: True, lambda reason: None, lambda: 0)
            starting = asyncio.create_task(cancelled.start())
            await asyncio.sleep(.01)
            self.assertEqual(len(pending_starts), 1)
            starting.cancel()
            with self.assertRaises(asyncio.CancelledError): await starting
            stop_count = len(stops)
            pending_starts[0](None)
            self.assertEqual(len(stops), stop_count + 1)
        self.assertEqual(outputs, [1, 1])
        self.assertEqual(values['setCapturesAudio_'], True)
        self.assertEqual(values['setSampleRate_'], 48000)
        self.assertEqual(values['setChannelCount_'], 2)
        self.assertEqual(values['setExcludesCurrentProcessAudio_'], True)
        self.assertFalse(any('microphone' in key.lower() for key in values))
        self.assertTrue(stops)

    async def test_capture_starts_only_after_authorization_then_returns_stereo_twenty_ms(self):
        allowed, captures, status = [False], [], []
        def factory(*args):
            capture = FakeCapture(*args); captures.append(capture); return capture
        track = SystemAudioTrack(gate=lambda: allowed[0], capture_factory=factory, status=lambda ready, error: status.append((ready, error)))
        pending = asyncio.create_task(track.recv())
        try:
            await asyncio.sleep(.07)
            self.assertEqual(captures, [])
            self.assertFalse(pending.done())
            allowed[0] = True; track.resume()
            first = await asyncio.wait_for(pending, .5)
            second = await asyncio.wait_for(track.recv(), .5)
            self.assertEqual((first.sample_rate, first.samples, first.layout.name, first.format.name), (48000, 960, 'stereo', 's16'))
            self.assertEqual(first.time_base.denominator, 48000)
            self.assertGreaterEqual(second.pts - first.pts, 960)
            self.assertTrue(any(bytes(first.planes[0])))
            self.assertEqual(status, [(True, None)])
        finally:
            track.stop()
        self.assertTrue(captures[0].closed)

    async def test_uncompressed_callback_receives_native_float_before_opus_quantization(self):
        captured = []
        left = struct.pack('<4I', 0x00000001, 0x80000000, 0x3eaaaaab, 0xbf123456) * 240
        right = struct.pack('<4I', 0x3f012345, 0x00000000, 0x80000001, 0x3dcccccd) * 240
        class OriginalFloats(FakeCapture):
            async def start(self): self.deliver(pcm_frame(left + right, ASBD, 960))
        track = SystemAudioTrack(capture_factory=OriginalFloats, pcm=lambda frame: captured.append((frame.format.name, bytes(frame.planes[0]), bytes(frame.planes[1]))))
        try:
            converted = await track.recv()
            self.assertEqual(converted.format.name, 's16')
            self.assertEqual(captured[0][0], 'fltp')
            # Tiny sub-S16 values and signed zero must survive the capture/FIFO
            # path, even though the parallel RTP fallback quantizes to S16.
            self.assertEqual(captured[0][1:], (left, right))
        finally: track.stop()

    async def test_silent_capture_gaps_keep_a_twenty_ms_float_pcm_clock(self):
        captured = []
        track = SystemAudioTrack(capture_factory=FakeCapture, pcm=captured.append)
        try:
            for _ in range(4): await track.recv()
            self.assertEqual(len(captured), 4)
            self.assertTrue(any(bytes(captured[0].planes[0])))
            for frame in captured[1:]:
                self.assertEqual((frame.format.name, frame.samples, frame.sample_rate), ('fltp', 960, 48000))
                self.assertFalse(any(bytes(frame.planes[0])))
        finally: track.stop()

    async def test_partial_native_buffer_is_padded_once_without_replaying_samples(self):
        captured = []
        class Partial(FakeCapture):
            async def start(self): self.deliver(tone(samples=480))
        track = SystemAudioTrack(capture_factory=Partial, pcm=captured.append)
        try:
            opus = await track.recv(); await track.recv()
            self.assertTrue(any(bytes(opus.planes[0])))
            self.assertEqual(bytes(captured[0].planes[0])[:480 * 4], bytes(tone(samples=480).planes[0]))
            self.assertFalse(any(bytes(captured[0].planes[0])[480 * 4:]))
            self.assertFalse(any(bytes(captured[1].planes[0])))
        finally: track.stop()

    async def test_burst_native_buffer_preserves_every_float_sample_across_twenty_ms_frames(self):
        captured = []
        original = tone(samples=2050)
        expected = bytes(original.planes[0])
        class Burst(FakeCapture):
            async def start(self): self.deliver(original)
        track = SystemAudioTrack(capture_factory=Burst, pcm=captured.append)
        try:
            for _ in range(4): await track.recv()
            combined = b''.join(bytes(frame.planes[0]) for frame in captured)
            self.assertEqual(combined[:len(expected)], expected)
            self.assertFalse(any(combined[len(expected):]))
            track.pause()
            self.assertEqual(track.pcm_fifo.samples, 0)
        finally: track.stop()

    async def test_pcm_transport_failure_does_not_break_opus_fallback(self):
        def fail(frame): raise RuntimeError('synthetic transport failure')
        track = SystemAudioTrack(capture_factory=FakeCapture, pcm=fail)
        try:
            converted = await track.recv()
            self.assertTrue(any(bytes(converted.planes[0])))
        finally: track.stop()

    async def test_expired_lease_blocks_audio_and_discards_every_buffer_from_before_pause(self):
        now = [100.]
        authorization = SessionAuthorization(lambda: now[0])
        session = {'id': 'audio', 'generation': 0, 'status': 'active'}
        authorization.confirm(session)
        track = SystemAudioTrack(gate=lambda: authorization.allows(session), capture_factory=FakeCapture)
        try:
            await track.recv()
            track.push(tone())
            now[0] += 17
            old_revision = track.revision
            track.pause()
            pending = asyncio.create_task(track.recv())
            await asyncio.sleep(.07)
            self.assertFalse(pending.done())
            track.push(tone())
            authorization.confirm(session); track.resume()
            track.push(tone(), old_revision)
            resumed = await asyncio.wait_for(pending, .5)
            self.assertFalse(any(bytes(resumed.planes[0])))
            track.push(tone())
            fresh = await asyncio.wait_for(track.recv(), .5)
            self.assertTrue(any(bytes(fresh.planes[0])))
        finally:
            track.stop()

    async def test_capture_queue_is_bounded_and_stopping_wakes_blocked_receive(self):
        track = SystemAudioTrack(gate=lambda: True, capture_factory=FakeCapture)
        await track.recv()
        for _ in range(100):
            track.push(tone())
        self.assertLessEqual(sum(item[2].samples for item in track.queue), 4800)
        track.pause(); pending = asyncio.create_task(track.recv())
        await asyncio.sleep(.01); track.stop()
        with self.assertRaises(MediaStreamError):
            await asyncio.wait_for(pending, .2)

    async def test_capture_failure_is_safe_status_and_does_not_release_audio(self):
        statuses = []
        class Failure(FakeCapture):
            async def start(self):
                raise AudioCaptureError('permission')
        track = SystemAudioTrack(capture_factory=Failure, status=lambda ready, error: statuses.append((ready, error)))
        pending = asyncio.create_task(track.recv())
        try:
            await asyncio.sleep(.07)
            self.assertEqual(statuses, [(False, 'permission')])
            self.assertFalse(pending.done())
            self.assertTrue(track.capture.closed)
        finally:
            track.stop()
        with self.assertRaises(MediaStreamError):
            await pending

    async def test_stopping_during_native_start_cancels_wait_and_closes_capture(self):
        entered = asyncio.Event()
        class Slow(FakeCapture):
            async def start(self):
                entered.set(); await asyncio.Event().wait()
        track = SystemAudioTrack(capture_factory=Slow)
        pending = asyncio.create_task(track.recv())
        await entered.wait(); track.stop()
        with self.assertRaises(MediaStreamError):
            await asyncio.wait_for(pending, .2)
        self.assertTrue(track.capture.closed)

    async def test_session_teardown_stops_audio_before_awaiting_peer_cleanup(self):
        stopped = []
        authorization = SessionAuthorization()
        owner = object()
        class Peer:
            async def close(self):
                self.assert_stopped = bool(stopped)
        peer = Peer()
        state = {'owner': owner, 'pc': peer, 'track': None, 'audio': SimpleNamespace(stop=lambda: stopped.append(True)), 'audio_available': True, 'setting': None, 'session': {}, 'ready': True}
        await close_attachment(state, authorization, SimpleNamespace(release=lambda: None, seq=0), SimpleNamespace(select=lambda _: None))
        self.assertTrue(peer.assert_stopped)
        self.assertIsNone(state['audio'])
        self.assertFalse(state['audio_available'])

    async def test_real_opus_webrtc_roundtrip_decodes_non_silent_stereo(self):
        configuration = RTCConfiguration(iceServers=[])
        viewer, host = RTCPeerConnection(configuration), RTCPeerConnection(configuration)
        source = SystemAudioTrack(capture_factory=FakeCapture)
        received = asyncio.get_running_loop().create_future()
        viewer.addTransceiver('audio', direction='recvonly')
        @viewer.on('track')
        def arrived(track):
            async def read():
                try:
                    for _ in range(10):
                        frame = await track.recv()
                        if any(bytes(frame.planes[0])):
                            if not received.done(): received.set_result(frame)
                            return
                    if not received.done(): received.set_exception(AssertionError('Only silence was decoded'))
                except Exception as error:
                    if not received.done(): received.set_exception(error)
            asyncio.create_task(read())
        try:
            await viewer.setLocalDescription(await viewer.createOffer())
            await host.setRemoteDescription(viewer.localDescription)
            sender = host.addTrack(source)
            encoder = install_audio_encoding(sender)
            self.assertEqual(encoder.codec.bit_rate, 192000)
            self.assertEqual(encoder.codec.options, {'application': 'audio'})
            from aiortc.codecs.opus import OpusEncoder
            untouched = OpusEncoder()
            self.assertEqual(untouched.codec.bit_rate, 96000)
            self.assertEqual(untouched.codec.options, {'application': 'voip'})
            await host.setLocalDescription(await host.createAnswer())
            await viewer.setRemoteDescription(host.localDescription)
            frame = await asyncio.wait_for(received, 10)
            self.assertEqual((frame.sample_rate, frame.layout.name), (48000, 'stereo'))
            self.assertTrue(any(bytes(frame.planes[0])))
        finally:
            source.stop(); await viewer.close(); await host.close()

    async def test_real_opus_mute_stops_encoder_and_rtp_until_unmute(self):
        configuration = RTCConfiguration(iceServers=[])
        viewer, host = RTCPeerConnection(configuration), RTCPeerConnection(configuration)
        captures, encoded = [], []
        def factory(*args):
            capture = FakeCapture(*args); captures.append(capture); return capture
        source = SystemAudioTrack(capture_factory=factory)
        viewer.addTransceiver('audio', direction='recvonly')
        async def wait_for_encoding(count):
            async def ready():
                while len(encoded) < count: await asyncio.sleep(.01)
            await asyncio.wait_for(ready(), 5)
        try:
            await viewer.setLocalDescription(await viewer.createOffer())
            await host.setRemoteDescription(viewer.localDescription)
            sender = host.addTrack(source)
            encoder = install_audio_encoding(sender)
            original_encode = encoder.encode
            def encode(frame, force_keyframe=False):
                encoded.append(frame.pts)
                return original_encode(frame, force_keyframe)
            encoder.encode = encode
            await host.setLocalDescription(await host.createAnswer())
            await viewer.setRemoteDescription(host.localDescription)
            await wait_for_encoding(4)
            source.set_enabled(False)
            self.assertTrue(captures[0].closed)
            await asyncio.sleep(.05)  # Let any frame already in the encoder finish.
            muted_count = len(encoded)
            muted_stats = next(item for item in (await sender.getStats()).values() if item.type == 'outbound-rtp')
            await asyncio.sleep(.12)
            later_stats = next(item for item in (await sender.getStats()).values() if item.type == 'outbound-rtp')
            self.assertEqual(len(encoded), muted_count)
            self.assertEqual(later_stats.packetsSent, muted_stats.packetsSent)
            source.set_enabled(True)
            await wait_for_encoding(muted_count + 2)
            self.assertEqual(len(captures), 2)
            self.assertTrue(captures[1].started)
        finally:
            source.stop(); await viewer.close(); await host.close()


if __name__ == '__main__':
    unittest.main()
