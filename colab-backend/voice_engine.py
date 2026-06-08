"""
Optional local voice utilities for Pecifics.

This module is intentionally dependency-light at import time. Audio packages are
only imported when a test/listener is started, so the backend can run even when
sounddevice/faster-whisper are not installed yet.
"""

from dataclasses import dataclass
from typing import Callable, Dict, Optional
import time
import json
import urllib.request


@dataclass
class ClapConfig:
    sample_rate: int = 16000
    chunk_ms: int = 50
    amplitude_threshold: float = 0.25
    peak_rms_ratio: float = 7.0
    debounce_ms: int = 650


class ClapDetector:
    def __init__(self, config: Optional[ClapConfig] = None):
        self.config = config or ClapConfig()
        self._last_clap_at = 0.0

    def analyze(self, samples) -> Dict:
        import numpy as np

        chunk = np.asarray(samples, dtype="float32")
        if chunk.ndim > 1:
            chunk = chunk[:, 0]
        if chunk.size == 0:
            return {"clap": False, "amplitude": 0.0, "ratio": 0.0}

        amplitude = float(np.abs(chunk).max())
        rms = float(np.sqrt(np.mean(chunk ** 2)) + 1e-10)
        ratio = amplitude / rms if rms else 0.0
        now = time.time() * 1000
        enough_gap = (now - self._last_clap_at) >= self.config.debounce_ms
        clap = (
            enough_gap
            and amplitude >= self.config.amplitude_threshold
            and ratio >= self.config.peak_rms_ratio
        )
        if clap:
            self._last_clap_at = now
        return {"clap": clap, "amplitude": amplitude, "ratio": ratio}


class VoiceStatusClient:
    def __init__(self, backend_url: str = "http://127.0.0.1:8000"):
        self.backend_url = backend_url.rstrip("/")
        self.current_state = "ready"

    def set_state(self, state: str, text: str = "", command: str = ""):
        self.current_state = state
        payload = json.dumps({"state": state, "text": text, "command": command}).encode("utf-8")
        request = urllib.request.Request(
            f"{self.backend_url}/voice_state",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(request, timeout=1).read()
        except Exception:
            # Voice status is UI-only. Audio should not fail just because the
            # HUD/backend stream is unavailable.
            pass


def run_clap_listener(
    on_clap: Callable[[Dict], None],
    config: Optional[ClapConfig] = None,
    on_sound: Optional[Callable[[Dict], None]] = None,
):
    """Run a blocking microphone clap listener.

    Use this from a dedicated process/thread only after calibration.
    """
    import sounddevice as sd

    cfg = config or ClapConfig()
    detector = ClapDetector(cfg)
    chunk_size = int(cfg.sample_rate * cfg.chunk_ms / 1000)

    def callback(indata, frames, time_info, status):
        result = detector.analyze(indata)
        if result["clap"]:
            on_clap(result)
        elif on_sound and result["amplitude"] >= cfg.amplitude_threshold * 0.4:
            on_sound(result)

    with sd.InputStream(
        samplerate=cfg.sample_rate,
        channels=1,
        dtype="float32",
        blocksize=chunk_size,
        callback=callback,
    ):
        while True:
            time.sleep(0.1)
