"""Versioned editorial token counting: Unicode White_Space, explicit v1 set.

This observes strings without changing their stored bytes. U+001C..001F and
U+FEFF are deliberately not separators. This is not linguistic tokenization.
"""
from __future__ import annotations

import re

WHITE_SPACE_V1 = "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
_TOKENS = re.compile(f"[^{WHITE_SPACE_V1}]+")


def count_words_v1(value: str) -> int:
    return sum(1 for _ in _TOKENS.finditer(value))
