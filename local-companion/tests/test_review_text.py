import json
from pathlib import Path

from tda_companion.review_text import count_words_v1, valid_review_string_v1


def test_shared_word_count_contract():
    fixture = json.loads((Path(__file__).resolve().parents[2] / "fixtures/transcript-review-words-v1.json").read_text(encoding="utf-8"))
    for item in fixture["examples"]:
        assert count_words_v1(item["text"]) == item["count"]
    for code in fixture["separators"]:
        separator = chr(code)
        assert count_words_v1(f"{separator}a{separator}{separator}b{separator}") == 2
    for code in fixture["non_separators"]:
        assert count_words_v1(f"a{chr(code)}b") == 1


def test_shared_editorial_string_contract():
    fixture = json.loads((Path(__file__).resolve().parents[2] / "fixtures/transcript-review-strings-v1.json").read_text(encoding="utf-8"))
    for item in fixture["cases"]:
        value = ("".join(chr(code) for code in item["codePoints"]) if "codePoints" in item else item["value"]) * item["repeat"]
        assert valid_review_string_v1(value, item["field"]) == item["valid"], item["name"]
