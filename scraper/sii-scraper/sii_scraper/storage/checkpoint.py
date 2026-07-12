import json
import logging
import os

logger = logging.getLogger(__name__)


class Checkpoint:
    """Registro persistente de claves ya procesadas.

    `save_every`: cada mark_*() acumula en memoria y solo reescribe el archivo
    (sorted + fsync) cada `save_every` marcas, en vez de en CADA una. Esto evita
    el costo O(n²) de reescribir el set completo por cada predio/punto cuando hay
    cientos de miles (era una de las razones por las que Las Condes tardaba
    días). Llamar flush() al terminar para persistir el remanente.

    Seguridad ante caídas: si el proceso muere con marcas sin guardar, esas
    claves se re-procesan en la próxima corrida — inofensivo, porque la salida
    (JSONL) se ingesta con INSERT ... ON CONFLICT DO UPDATE (idempotente).
    """

    def __init__(self, path: str, save_every: int = 1):
        self.path = path
        self.save_every = max(1, save_every)
        self._done: set[str] = set()
        self._discarded: set[str] = set()
        self._pending_since_save = 0
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
        self._maybe_save()

    def mark_discarded(self, key: str) -> None:
        self._discarded.add(key)
        self._maybe_save()

    def _maybe_save(self) -> None:
        self._pending_since_save += 1
        if self._pending_since_save >= self.save_every:
            self._save()

    def flush(self) -> None:
        """Persiste cualquier marca acumulada. Llamar al terminar una etapa."""
        if self._pending_since_save > 0:
            self._save()

    def _save(self) -> None:
        self._pending_since_save = 0
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
