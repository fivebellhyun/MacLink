"""Permission-gated macOS system audio. Microphone input is never enabled."""
import asyncio
from functools import lru_cache

from av import AudioFrame


class AudioCaptureError(RuntimeError):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def available():
    """Loading the framework does not start capture or request permission."""
    try:
        import ScreenCaptureKit as SC
        import CoreMedia
        return hasattr(SC.SCStreamConfiguration, 'setCapturesAudio_')
    except (ImportError, AttributeError):
        return False


def pcm_frame(data, description, samples):
    """Copy ScreenCaptureKit's linear PCM into owned PyAV planes."""
    rate, kind, flags, _, _, _, channels, bits, _ = description
    if (kind != int.from_bytes(b'lpcm', 'big') or rate != 48000 or channels not in (1, 2)
            or bits != 32 or not flags & 1 or flags & 2 or not 0 < samples <= 9600):
        raise AudioCaptureError('capture-failed')
    planar = bool(flags & 32)
    size = samples * 4 * channels
    if len(data) != size:
        raise AudioCaptureError('capture-failed')
    frame = AudioFrame(format='fltp' if planar else 'flt', layout='stereo' if channels == 2 else 'mono', samples=samples)
    frame.sample_rate = 48000
    for index, plane in enumerate(frame.planes):
        start = index * samples * 4 if planar else 0
        plane.update(data[start:start + plane.buffer_size])
    return frame


@lru_cache(maxsize=1)
def _output_type():
    import objc
    import CoreMedia as CM
    import ScreenCaptureKit as SC
    from Foundation import NSObject

    class MacLinkSystemAudioOutput(NSObject, protocols=[objc.protocolNamed('SCStreamOutput'), objc.protocolNamed('SCStreamDelegate')]):
        def stream_didOutputSampleBuffer_ofType_(self, stream, sample, kind):
            capture = self.capture
            if kind != SC.SCStreamOutputTypeAudio or capture.closed or not capture.permitted():
                return
            revision = capture.revision()
            try:
                if not CM.CMSampleBufferDataIsReady(sample):
                    return
                description = CM.CMAudioFormatDescriptionGetStreamBasicDescription(CM.CMSampleBufferGetFormatDescription(sample))
                samples = CM.CMSampleBufferGetNumSamples(sample)
                block = CM.CMSampleBufferGetDataBuffer(sample)
                if block is None:
                    raise AudioCaptureError('capture-failed')
                length = CM.CMBlockBufferGetDataLength(block)
                if not 0 < length <= 9600 * 8:
                    raise AudioCaptureError('capture-failed')
                status, data = CM.CMBlockBufferCopyDataBytes(block, 0, length, None)
                if status:
                    raise AudioCaptureError('capture-failed')
                frame = pcm_frame(data, description, samples)
                if not capture.closed and capture.permitted() and revision == capture.revision():
                    capture.deliver(frame, revision)
            except Exception:
                capture.failed('capture-failed')

        def stream_didStopWithError_(self, stream, error):
            if not self.capture.closed:
                self.capture.failed('permission' if error and error.code() == -3801 else 'capture-failed')

    return MacLinkSystemAudioOutput


class ScreenAudioCapture:
    def __init__(self, deliver, permitted, failed, revision):
        self.deliver, self.permitted, self.failed = deliver, permitted, failed
        self.revision = revision
        self.closed = False
        self.stream = self.output = None

    async def _complete(self, invoke):
        loop = asyncio.get_running_loop()
        result = loop.create_future()

        def completed(*values):
            def resolve():
                if not result.done():
                    result.set_result(values)
            if not loop.is_closed():
                loop.call_soon_threadsafe(resolve)

        invoke(completed)
        return await asyncio.wait_for(result, 8)

    async def start(self):
        try:
            await self._start()
        except BaseException:
            self.close()
            raise

    async def _start(self):
        try:
            import CoreMedia as CM
            import Quartz
            import ScreenCaptureKit as SC
        except ImportError as error:
            raise AudioCaptureError('unavailable') from error
        if not Quartz.CGPreflightScreenCaptureAccess():
            raise AudioCaptureError('permission')
        content, error = await self._complete(lambda done: SC.SCShareableContent.getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler_(True, True, done))
        if self.closed:
            return
        if error or content is None:
            raise AudioCaptureError('permission' if error and error.code() == -3801 else 'capture-failed')
        display = next((item for item in content.displays() if item.displayID() == Quartz.CGMainDisplayID()), None)
        if display is None:
            raise AudioCaptureError('capture-failed')
        configuration = SC.SCStreamConfiguration.alloc().init()
        configuration.setWidth_(2)
        configuration.setHeight_(2)
        configuration.setMinimumFrameInterval_(CM.CMTimeMake(1, 1))
        configuration.setCapturesAudio_(True)
        configuration.setSampleRate_(48000)
        configuration.setChannelCount_(2)
        configuration.setExcludesCurrentProcessAudio_(True)
        # Only the system-audio output is registered. No microphone API is used.
        content_filter = SC.SCContentFilter.alloc().initWithDisplay_excludingWindows_(display, [])
        self.output = _output_type().alloc().init()
        self.output.capture = self
        self.stream = SC.SCStream.alloc().initWithFilter_configuration_delegate_(content_filter, configuration, self.output)
        success, error = self.stream.addStreamOutput_type_sampleHandlerQueue_error_(self.output, SC.SCStreamOutputTypeAudio, None, None)
        if not success:
            raise AudioCaptureError('capture-failed')
        stream = self.stream
        def start_capture(done):
            def started(error):
                # Cancellation can race the asynchronous native start. Stop a
                # late successful start even if close() already detached it.
                if self.closed:
                    stream.stopCaptureWithCompletionHandler_(lambda stopped_error: None)
                done(error)
            stream.startCaptureWithCompletionHandler_(started)
        error, = await self._complete(start_capture)
        if error:
            raise AudioCaptureError('permission' if error.code() == -3801 else 'capture-failed')

    def close(self):
        """Detach immediately; native shutdown completes without holding polling."""
        self.closed = True
        stream, output = self.stream, self.output
        self.stream = self.output = None
        if stream is not None:
            # Keep both native objects alive until ScreenCaptureKit finishes.
            def stopped(error):
                _ = stream, output
            try:
                stream.stopCaptureWithCompletionHandler_(stopped)
            except Exception:
                pass
