"""Entry point for the packaged Matchbox backend."""
import os
import sys

if getattr(sys, 'frozen', False):
    meipass = sys._MEIPASS
    os.environ['LD_LIBRARY_PATH'] = os.pathsep.join([
        os.path.join(meipass, 'ctranslate2.libs'),
        os.path.join(meipass, 'av.libs'),
        meipass,
    ])

import logging
from pathlib import Path

log_dir = Path.home() / "Documents" / "Matchbox"
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / "backend.log"

logging.basicConfig(
    filename=str(log_file),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

import uvicorn

if __name__ == "__main__":
    logging.info("Backend starting on port 8765")
    try:
        uvicorn.run("api:app", host="127.0.0.1", port=8765, log_level="warning")
    except Exception as e:
        logging.error(f"Backend error: {e}")
    logging.info("Backend stopped")
