"""Regression checks for MP4 validation, isolated from the AI model dependencies."""
import ast
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from imageio_ffmpeg import get_ffmpeg_exe

SOURCE = Path(__file__).resolve().parents[1] / "public" / "pulse-audio-ai-server.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in
             {"validate_platform_safe_mp4", "platform_safe_video_args", "platform_track_duration_tolerance"}]
namespace = {"Path": Path, "re": re, "subprocess": subprocess, "ffmpeg_executable": get_ffmpeg_exe}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), "exec"), namespace)
validate = namespace["validate_platform_safe_mp4"]


def trace(video_duration, audio_duration, video_start=0, audio_start=0):
    return (f"stream 0: start_time: {video_start:.6f} duration: {video_duration:.6f}\n"
            f"stream 1: start_time: {audio_start:.6f} duration: {audio_duration:.6f}\n")


class PlatformValidationTests(unittest.TestCase):
    def check_trace(self, text):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stderr=text.encode())):
            validate(Path("test.mp4"))

    def test_reported_one_frame_tail_rounding_passes(self):
        self.check_trace(trace(243.621333, 243.588333))

    def test_aac_and_video_packet_tail_budget_passes(self):
        self.check_trace(trace(10.053, 10.0))
        self.check_trace(trace(10.0, 10.053))

    def test_real_tail_mismatch_is_rejected(self):
        for gap in (0.06, 0.1, 1.0):
            with self.subTest(gap=gap), self.assertRaisesRegex(RuntimeError, "mismatched"):
                self.check_trace(trace(10 + gap, 10))

    def test_start_shift_stays_strict(self):
        with self.assertRaisesRegex(RuntimeError, "non-zero track starts"):
            self.check_trace(trace(10, 10, audio_start=0.033))

    def test_edit_list_is_still_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "edit list"):
            self.check_trace("type:'elst'\n" + trace(10, 10))

    def test_missing_stream_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "both video and audio"):
            self.check_trace("stream 0: start_time: 0.000000 duration: 10.000000")

    def test_real_ffmpeg_outputs_in_both_orientations(self):
        with tempfile.TemporaryDirectory(prefix="pulse-mv-validation-") as directory:
            for size, duration in (("160x90", "243.6"), ("90x160", "2.019")):
                with self.subTest(size=size):
                    output = Path(directory) / f"{size}.mp4"
                    subprocess.run([
                        get_ffmpeg_exe(), "-y", "-f", "lavfi", "-i", f"color=c=blue:s={size}:r=30",
                        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
                        "-t", duration, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "48000", "-ac", "2",
                        *namespace["platform_safe_video_args"](), str(output),
                    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
                    validate(output)


if __name__ == "__main__":
    unittest.main()
