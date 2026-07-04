#!/usr/bin/env python3
import argparse
import asyncio

from dotenv import load_dotenv

from sii_scraper.config import load_config
from sii_scraper.logging_setup import setup_logging
from sii_scraper.orchestrator import run_stage, STAGES


def main() -> None:
    # Carga sii-scraper/.env si existe (variables de proxy, etc.) sin
    # pisar variables ya exportadas en el entorno real.
    load_dotenv()

    parser = argparse.ArgumentParser(description="Scraper de predios del SII → JSONL")
    parser.add_argument("stage", choices=sorted(STAGES),
                        help="etapa a ejecutar")
    parser.add_argument("--config", default="config.json",
                        help="ruta al archivo de configuración (default: config.json)")
    args = parser.parse_args()

    setup_logging()
    config = load_config(args.config)
    asyncio.run(run_stage(args.stage, config))


if __name__ == "__main__":
    main()
