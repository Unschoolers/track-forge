#!/usr/bin/env python3
"""Optional offline JSONL -> Parquet converter (requires `pip install duckdb`).
No DuckDB dependency is added to the game, Android build or npm package lock.
Example: python3 qa/optimization/to_parquet.py qa/results/optimization
"""
import argparse
from pathlib import Path


def convert(folder: Path) -> None:
    try:
        import duckdb
    except ImportError as exc:
        raise SystemExit("DuckDB not installed. Install offline analysis dependency: pip install duckdb") from exc
    if not folder.is_dir():
        raise SystemExit(f"Directory not found: {folder}")
    db = duckdb.connect()
    try:
        for name in ("runs", "events", "telemetry"):
            source = folder / f"{name}.jsonl"
            if not source.is_file() or source.stat().st_size == 0:
                print(f"skip {name}: missing or empty")
                continue
            destination = folder / f"{name}.parquet"
            # Relation API accepts paths directly; no SQL interpolation or
            # database schema, and no in-memory Pandas materialization.
            db.read_json(str(source), format="newline_delimited").write_parquet(
                str(destination), compression="zstd"
            )
            print(f"wrote {destination}")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    convert(parser.parse_args().directory)
