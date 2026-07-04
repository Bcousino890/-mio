from sii_scraper.storage.checkpoint import Checkpoint


def test_mark_and_query(tmp_path):
    path = str(tmp_path / "ck.json")
    ck = Checkpoint(path)
    assert not ck.is_processed("5")
    ck.mark_done("5")
    ck.mark_discarded("6")
    assert ck.is_processed("5")
    assert ck.is_processed("6")
    assert not ck.is_processed("7")


def test_persists_across_instances(tmp_path):
    path = str(tmp_path / "ck.json")
    ck = Checkpoint(path)
    ck.mark_done("10")
    ck2 = Checkpoint(path)  # recarga desde disco
    assert ck2.is_processed("10")


def test_corrupt_checkpoint_file_falls_back_to_empty(tmp_path):
    path = tmp_path / "ck.json"
    path.write_text("{not valid json", encoding="utf-8")
    ck = Checkpoint(str(path))
    assert not ck.is_processed("anything")
    ck.mark_done("1")
    assert ck.is_processed("1")
