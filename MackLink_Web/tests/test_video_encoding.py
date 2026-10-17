import asyncio
import concurrent.futures
import sys
import threading
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'connector'))
import aiortc
from aiortc import RTCConfiguration, RTCPeerConnection, VideoStreamTrack
from aiortc.codecs import CODECS, depayload, get_decoder
from aiortc.jitterbuffer import JitterFrame
from aiortc.rtcrtpparameters import RTCRtpCodecParameters
from av import VideoFrame
from PIL import Image

from quality import PROFILES, QualitySettings
from video_encoding import (H264_LEVELS, SessionVideoEncoding, h264_dimensions,
                            install_video_encoding)


def codec(mime, level='33', asymmetry='1'):
    if mime == 'video/VP8':
        return next(value for value in CODECS['video'] if value.mimeType == mime)
    return RTCRtpCodecParameters(mimeType=mime, clockRate=90000, payloadType=100,
                                parameters={'profile-level-id': '42e0' + level,
                                            'packetization-mode': '1', 'level-asymmetry-allowed': asymmetry})


def frame(image=None, dimensions=(640, 360), index=0, fps=60):
    value = VideoFrame.from_image(image if image is not None else Image.new('RGB', dimensions, (30, 110, 70)))
    value.pts, value.time_base = index * 90000 // fps, Fraction(1, 90000)
    return value


def policy(mime, name='ultra', level='33'):
    quality = QualitySettings()
    quality.select(name)
    encoding = SessionVideoEncoding(quality)
    selected = codec(mime, level)
    encoding.configure(selected)
    quality.bind_encoding(encoding)
    return quality, encoding, selected


class VideoEncodingTests(unittest.TestCase):
    def test_real_codec_targets_exceed_old_clamps_and_feedback_can_reduce_them(self):
        for mime in ('video/VP8', 'video/H264'):
            with self.subTest(mime=mime):
                quality, encoding, selected = policy(mime)
                self.assertIsNone(encoding.applied_profile)
                decoder = get_decoder(selected)
                packets, timestamp = encoding.encode(frame())
                self.assertTrue(packets)
                decoded = decoder.decode(JitterFrame(b''.join(depayload(selected, packet) for packet in packets), timestamp))
                self.assertEqual((decoded[-1].width, decoded[-1].height), (640, 360))
                self.assertEqual(encoding._encoder.codec.bit_rate, 16_000_000)
                self.assertEqual(encoding._encoder.codec.framerate, Fraction(60))
                self.assertEqual(encoding.applied_profile, 'ultra')
                encoding.target_bitrate = 90_000_000
                encoding.encode(frame(index=1))
                self.assertEqual(encoding._encoder.codec.bit_rate, 40_000_000)
                encoding.target_bitrate = 200_000
                quality.select('high')
                self.assertIsNone(encoding.applied_profile)
                encoding.encode(frame(index=2,fps=30))
                self.assertEqual(encoding._encoder.codec.bit_rate, 200_000)
                self.assertEqual(encoding._encoder.codec.framerate, Fraction(30))
                self.assertEqual(encoding.applied_profile, 'high')
                encoding.close()
                self.assertIsNone(quality.encoding)
                self.assertEqual(encoding.encode(frame(index=3))[0], [])

    def test_complex_video_really_produces_more_data_at_the_higher_policy(self):
        images = [Image.effect_noise((640, 360), 100).convert('RGB') for _ in range(10)]
        for mime in ('video/VP8', 'video/H264'):
            rates = []
            for name in ('low', 'ultra'):
                _, encoding, _ = policy(mime, name)
                sizes = [sum(map(len, encoding.encode(frame(image, index=index,fps=PROFILES[name].fps))[0])) for index, image in enumerate(images)]
                rates.append(sum(sizes[2:]))
                encoding.close()
            self.assertGreater(rates[1], rates[0] * 1.25, (mime, rates))

    def test_inflight_old_frame_cannot_ack_a_new_profile_or_block_policy_change(self):
        for mime in ('video/VP8', 'video/H264'):
            quality, encoding, _ = policy(mime)
            started, release = threading.Event(), threading.Event()
            original = encoding._encoder.encode
            def slow(image, keyframe=False):
                started.set()
                if not release.wait(3):
                    raise TimeoutError('Synthetic encoder barrier timed out.')
                return original(image, keyframe)
            encoding._encoder.encode = slow
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(encoding.encode, frame())
                try:
                    self.assertTrue(started.wait(2))
                    quality.select('high')
                    encoding.target_bitrate = 400_000
                finally:
                    release.set()
                self.assertTrue(pending.result()[0])
            self.assertIsNone(encoding.applied_profile)
            encoding._encoder.encode = original
            encoding.encode(frame(index=1))
            self.assertEqual(encoding.applied_profile, 'high')
            self.assertEqual(encoding._encoder.codec.bit_rate, 400_000)
            _, independent, _ = policy(mime, 'balanced')
            self.assertEqual(independent.target_bitrate, 4_000_000)
            encoding.close(); independent.close()

    def test_h264_odd_portrait_and_large_frames_obey_receive_level(self):
        for asymmetry in ('0', '1'):
            quality, previous, selected = policy('video/H264')
            previous.close()
            encoding = SessionVideoEncoding(quality)
            remote = codec('video/H264', '1e', asymmetry)
            encoding.configure(selected, remote)
            quality.bind_encoding(encoding)
            decoder = get_decoder(selected)
            for name in ('high','ultra'):
                quality.select(name)
                for index, dimensions in enumerate(((1601, 901), (901, 1601), (5120, 2880))):
                    packets, timestamp = encoding.encode(frame(dimensions=dimensions, index=index,fps=PROFILES[name].fps))
                    decoded = decoder.decode(JitterFrame(b''.join(depayload(selected, p) for p in packets), timestamp))
                    output = decoded[-1]
                    fps=PROFILES[name].fps
                    expected = h264_dimensions(*dimensions, fps, 30)
                    self.assertEqual((output.width, output.height), expected)
                    self.assertEqual(encoding._encoder.codec.framerate,Fraction(fps))
                    self.assertLessEqual(output.width, dimensions[0]); self.assertLessEqual(output.height, dimensions[1])
                    self.assertEqual(output.width % 2 + output.height % 2, 0)
                    fs, mbps, limit = H264_LEVELS[30]
                    blocks = ((output.width + 15) // 16) * ((output.height + 15) // 16)
                    self.assertLessEqual(blocks, fs); self.assertLessEqual(blocks * fps, mbps)
                    self.assertLessEqual(encoding.target_bitrate, limit)
            encoding.close()

    def test_install_is_instance_local_pinned_and_restored_on_close(self):
        async def run():
            pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            other = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            offer = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 97\r\na=mid:0\r\na=rtpmap:97 VP8/90000\r\n'
            try:
                sender, untouched = pc.addTrack(VideoStreamTrack()), other.addTrack(VideoStreamTrack())
                quality = QualitySettings()
                original = sender.send.__func__
                with patch.object(aiortc, '__version__', '0.0.0'):
                    with self.assertRaises(RuntimeError): install_video_encoding(sender, quality, remote_sdp=offer)
                encoding = install_video_encoding(sender, quality, remote_sdp=offer)
                self.assertEqual(untouched.send.__func__, original)
                with self.assertRaises(RuntimeError): install_video_encoding(sender, quality, remote_sdp=offer)
                encoding.close()
                self.assertEqual(sender.send.__func__, original)
            finally:
                await pc.close(); await other.close()
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
