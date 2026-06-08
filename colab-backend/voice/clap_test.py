"""
Standalone clap calibration test for Pecifics.

Run:
  ..\\.venv\\Scripts\\python.exe voice\\clap_test.py

Tune amplitude/ratio in colab-backend/voice_engine.py after checking your
microphone's real values. This script does not start Pecifics actions.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from voice_engine import ClapConfig, run_clap_listener


def main():
    config = ClapConfig()
    print("Pecifics clap calibration running.")
    print("Clap near your microphone. Press Ctrl+C to stop.")
    print(f"amplitude_threshold={config.amplitude_threshold}, peak_rms_ratio={config.peak_rms_ratio}")
    print("")

    def on_clap(result):
        print(f"CLAP DETECTED amplitude={result['amplitude']:.3f} ratio={result['ratio']:.1f}")

    def on_sound(result):
        print(f"sound amplitude={result['amplitude']:.3f} ratio={result['ratio']:.1f}")

    try:
        run_clap_listener(on_clap=on_clap, config=config, on_sound=on_sound)
    except KeyboardInterrupt:
        print("\nStopped. Use the values above to adjust ClapConfig if needed.")
    except ModuleNotFoundError as exc:
        print(f"Missing audio dependency: {exc.name}")
        print("Install later with: pip install sounddevice numpy")


if __name__ == "__main__":
    main()
