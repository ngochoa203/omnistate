#!/usr/bin/env python3
"""edge_tts CLI wrapper: --text <str> --voice <str> --output <path>"""
import argparse
import asyncio
import sys

import edge_tts


async def synthesize(text: str, voice: str, output: str) -> None:
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        asyncio.run(synthesize(args.text, args.voice, args.output))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
