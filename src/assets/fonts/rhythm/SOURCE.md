# Rhythm game fonts

These fonts are self-hosted local assets. There is no Google Fonts CSS import or external runtime request.

## Origin and license

Retrieved on 2026-11-15 from the official [Google Fonts repository](https://github.com/google/fonts), pinned commit `cc39c4c2c304bc368c9b7c311ea2bcc6013299fe`.

| Local font | Official source | License |
| --- | --- | --- |
| Dokdo-Regular.woff2 | [Dokdo-Regular.ttf](https://github.com/google/fonts/blob/cc39c4c2c304bc368c9b7c311ea2bcc6013299fe/ofl/dokdo/Dokdo-Regular.ttf) | [OFL-Dokdo.txt](OFL-Dokdo.txt) |
| YeonSung-Regular.woff2 | [YeonSung-Regular.ttf](https://github.com/google/fonts/blob/cc39c4c2c304bc368c9b7c311ea2bcc6013299fe/ofl/yeonsung/YeonSung-Regular.ttf) | [OFL-YeonSung.txt](OFL-YeonSung.txt) |

- Dokdo copyright: Copyright (c) 2005-2017 FONTRIX. All Rights Reserved.
- Yeon Sung license-file copyright: Copyright 2018 The BM YEONSUNG Project Authors.
- Both fonts: SIL Open Font License 1.1; normal style, weight 400.
- Both full original OFL files are retained unchanged. Their full text is additionally included in the WOFF2 license metadata; original font name/copyright/license records are unchanged.
- No glyph subsetting, outline edits, metric changes, name changes, or artificial bold weight were applied.

## Compression and verification

Converted the full original TTF files using FontTools 4.68.0 WOFF2 compression with Brotli 1.2.1. Added WOFF2 XML metadata containing the original copyright and complete OFL text.

After conversion, every glyph drawing operation, character mapping, horizontal metric, and original name-table byte was compared with the source TTF and found identical.

| Font | WOFF2 bytes | SHA-256 |
| --- | --- | --- |
| Dokdo | 408,449 | e29ac4a32ba11c66dbab1be9645450c82df3a20c77d9fb9907dd5fa171b77cff |
| Yeon Sung | 544,348 | b3ba5011d1f1058a55f3fabccfef8e6f4beafb7f22e61f13d72ea60d83db7547 |

Combined WOFF2 budget: **952,797 bytes**, below 1,000,000 bytes.

Original TTF hashes:
- Dokdo: `5b3a3d8d28af31fa9adec3fc5da81a88b52e1ff39ed3930c1db787aa4e79c36d`
- Yeon Sung: `49ac2a11009f5f58307d377911eb45d210cf4c1d379d9eca38fb4cdad5491ef6`

## Coverage and intended use

- Dokdo: expressive short judgement labels; 2,600 glyphs, 2,599 mapped codepoints, 2,350 modern Hangul syllables.
- Yeon Sung: game UI; 3,120 glyphs, 3,119 mapped codepoints, 2,436 modern Hangul syllables.
- These are complete original fonts, not complete coverage of all 11,172 modern Hangul syllables.
- All 182 unique Hangul syllables in current `rhythm/*.tsx` files and all requested judgement phrases were present in both fonts.
- Keep a Korean serif fallback for future rare syllables; use normal 400 weight.

