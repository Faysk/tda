"""Synthetic review I/O/RSS probe. No audio, models or existing user data.

Run with the Companion environment: python tools/benchmark_review_snapshot.py
An optional --source points at another checkout for before/after measurement.
"""
from __future__ import annotations

import argparse
import gc
import json
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

import psutil


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--segments", type=int, nargs="+", default=[7500, 100000])
    args = parser.parse_args()
    sys.path.insert(0, str(args.source.resolve()))
    from tda_companion.local_review import open_review, save_review
    from tda_companion.transcript import (
        TranscriptDocument, TranscriptEngine, TranscriptSegment, TranscriptTrack,
        TranscriptWord, stats_for_tracks,
    )
    from tda_companion.transcription_runs import write_completed_run

    for count in args.segments:
        with tempfile.TemporaryDirectory(prefix="tda-review-synthetic-") as directory:
            package = Path(directory) / "source"
            package.mkdir()
            segments = tuple(TranscriptSegment(
                id=f"s{i}", start=float(i), end=i + .9, text="Synthetic words",
                words=(TranscriptWord("Synthetic", float(i), i + .4),
                       TranscriptWord("words", i + .5, i + .9)),
            ) for i in range(count))
            track = TranscriptTrack(1, "Synthetic", "synthetic.flac", "a" * 64, float(count), segments)
            document = TranscriptDocument(
                None, "b" * 64, "pt", TranscriptEngine("test", "test", "test", "cpu"),
                (track,), stats_for_tracks((track,), processing_seconds=1),
            )
            run = write_completed_run(package, document, job_id="synthetic", attempt=1)
            review = open_review(package, source_id="source", run_id=run["run_id"])
            review["segments"][0]["text"] = "Explicit synthetic edit"
            del document, track, segments
            gc.collect()
            counters = {"transcript_reads": 0, "transcript_bytes_read": 0}
            original_open = Path.open

            class CountedFile:
                def __init__(self, handle):
                    self.handle = handle

                def __enter__(self):
                    return self

                def __exit__(self, *exc):
                    return self.handle.__exit__(*exc)

                def read(self, *params):
                    data = self.handle.read(*params)
                    counters["transcript_bytes_read"] += len(data.encode("utf-8") if isinstance(data, str) else data)
                    return data

            def counted_open(path, mode="r", *params, **kwargs):
                handle = original_open(path, mode, *params, **kwargs)
                if path.name == "transcript.json" and "r" in mode:
                    counters["transcript_reads"] += 1
                    return CountedFile(handle)
                return handle

            process = psutil.Process()
            rss_before = process.memory_info().rss
            peak = [rss_before]
            stopped = threading.Event()

            def sample():
                while not stopped.wait(.01):
                    peak[0] = max(peak[0], process.memory_info().rss)

            sampler = threading.Thread(target=sample, daemon=True)
            sampler.start()
            started = time.perf_counter()
            try:
                with patch.object(Path, "open", counted_open):
                    saved = save_review(package, source_id="source", run_id=run["run_id"], value={
                        "expected_draft_revision": review["draft_revision"],
                        "expected_draft_sha256": review["draft_sha256"],
                        "status": "draft", "segments": review["segments"],
                    })
            finally:
                elapsed = time.perf_counter() - started
                stopped.set()
                sampler.join()
            assert saved["segments"][0]["text"] == "Explicit synthetic edit"
            print(json.dumps({"segments": count, "transcript_bytes": run["transcript_size_bytes"],
                              **counters, "save_seconds": round(elapsed, 4),
                              "sampled_peak_rss_bytes": peak[0],
                              "sampled_rss_growth_bytes": peak[0] - rss_before}))


if __name__ == "__main__":
    main()
