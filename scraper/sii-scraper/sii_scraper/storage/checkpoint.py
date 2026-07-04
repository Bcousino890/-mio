import json
import logging
import os

logger = logging.getLogger(__name__)


class Checkpoint:
    def __init__(self, path: str):
        self.path = path
        self._done: set[str] = set()
        self._discarded: set[str] = set()
        self._load()

    def _load(self) -> None:
        if os.path.exists(self.path):
            try:
                with open(self.path, encoding="utf-8") as f:
                    data = json.load(f)
                self._done = set(data.get("done", []))
                self._discarded = set(data.get("discarded", []))
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                logger.warning(f"Failed to load checkpoint from {self.path}: {e}. Starting fresh.")
                self._done = set()
                self._discarded = set()

    def is_processed(self, key: str) -> bool:
        return key in self._done or key in self._discarded

    def mark_done(self, key: str) -> None:
        self._done.add(key)
        self._save()

    def mark_discarded(self, key: str) -> None:
        self._discarded.add(key)
        self._save()

    def _save(self) -> None:
        parent = os.path.dirname(self.path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"done": sorted(self._done),
                       "discarded": sorted(self._discarded)}, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)
