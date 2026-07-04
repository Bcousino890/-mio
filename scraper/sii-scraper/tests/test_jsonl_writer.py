import datetime
import json
import pytest

from sii_scraper.storage.jsonl_writer import JsonlWriter


def test_append_writes_one_object_per_line(tmp_path):
    path = tmp_path / "sub" / "out.jsonl"
    with JsonlWriter(str(path)) as w:
        w.append({"a": 1})
        w.append({"b": "áéí"})
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0]) == {"a": 1}
    assert json.loads(lines[1]) == {"b": "áéí"}
    assert "áéí" in lines[1]  # ensure_ascii=False


def test_append_is_appendonly(tmp_path):
    path = tmp_path / "out.jsonl"
    with JsonlWriter(str(path)) as w:
        w.append({"a": 1})
    with JsonlWriter(str(path)) as w:
        w.append({"a": 2})
    assert len(path.read_text().splitlines()) == 2


def test_append_after_close_raises(tmp_path):
    path = tmp_path / "out.jsonl"
    w = JsonlWriter(str(path))
    w.close()
    with pytest.raises(ValueError, match="close"):
        w.append({"a": 1})


def test_append_uses_default_str_for_non_serializable(tmp_path):
    path = tmp_path / "out.jsonl"
    with JsonlWriter(str(path)) as w:
        w.append({"when": datetime.date(2024, 1, 1)})
    line = path.read_text(encoding="utf-8").strip()
    assert json.loads(line) == {"when": "2024-01-01"}
