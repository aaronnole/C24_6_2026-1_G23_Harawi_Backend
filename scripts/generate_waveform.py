import argparse
import json
import os
import sys

import librosa
import numpy as np
import soundfile as sf


def build_waveform(input_path, points):
    y, sr = sf.read(input_path, always_2d=False)
    if isinstance(y, np.ndarray) and y.ndim > 1:
        y = np.mean(y, axis=1)
    y = np.asarray(y, dtype=np.float32)
    if y.size == 0:
        raise ValueError("El archivo de audio no contiene muestras legibles")

    duration = float(len(y) / sr) if sr else 0.0
    frame_count = min(points, y.size)
    frames = np.array_split(y, frame_count)

    peaks = []
    for frame in frames:
        if frame.size == 0:
            peaks.append(0.0)
            continue
        peaks.append(float(np.max(np.abs(frame))))

    max_peak = max(peaks) if peaks else 0.0
    if max_peak > 0:
        peaks = [round(peak / max_peak, 4) for peak in peaks]

    return {
        "sampleRate": int(sr),
        "duration": round(duration, 4),
        "points": len(peaks),
        "peaks": peaks,
    }


def main():
    parser = argparse.ArgumentParser(description="Genera datos de waveform usando librosa.")
    parser.add_argument("input_path")
    parser.add_argument("--points", type=int, default=800)
    args = parser.parse_args()

    input_path = os.path.abspath(args.input_path)
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"No existe el archivo de audio: {input_path}")

    waveform = build_waveform(input_path, max(32, args.points))
    print(json.dumps(waveform, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
