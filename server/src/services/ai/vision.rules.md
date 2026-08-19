# Vision subagent — extraction rules

Declarative rules the vision subagent (`extractCardInfoFromImage`) should
always follow. Loaded once at server startup and appended to the system
prompt — meaning every entry in this file becomes part of the ephemeral
cache key and travels with every card OCR request.

## Editing this file

Every rule belongs to a `## <field>` section so the compiled prompt block
stays organized ("Rules for set_code:" etc.). Keep entries terse — the
prompt already includes the JSON schema; these are corrections on top.

New rules are added by the curation script (`curate-vision-corrections.ts`)
based on clusters of user corrections, then reviewed and committed like any
other code change. Do not add speculative rules — every entry should trace
back to a concrete failure the subagent has actually made.

Each entry MUST include a one-line `_Why:_` note pointing at the pattern
that motivated it, so future maintainers can decide whether to remove or
reword it. If a rule stops paying its way (correction rate for that pattern
doesn't drop), delete it.

---

## set_code

- Preserve the exact casing shown on the card. Codes like `SV8a`, `SV6a`,
  `M2a`, `S12a`, `SM11b` keep their lowercase suffix — do not uppercase.
  _Why:_ Aug 2026 audit found ~10 catalog rows where the model returned
  `SV8A` but the canonical code (matching `card_catalog.set_code`) is `SV8a`.

## card_number

- Trainer Gallery (`TG`) and Galarian Gallery (`GG`) subsets keep their
  letter prefix inside the card number. `TG05` and `GG17` are DIFFERENT
  cards than `005` and `017` in the same set. Never strip the letter prefix.
  _Why:_ multiple SWSH11 and SWSH12.5 catalog rows have card_numbers like
  `TG05`/`GG17`; stripping merges two different cards under one SKU.
- Sub-set numbering like `AOT-001.1` (Union Arena parallel foils) uses a
  decimal to disambiguate variants. Preserve the decimal — do NOT collapse
  to `AOT-0011`.
  _Why:_ Union Arena catalog rows carry `.1`/`.2` for foil variants.

## cert_number

- Cert numbers are digits `0-9` only. If the OCR shows a character that
  could be `0` or `O`, `1` or `I`/`l`, `5` or `S`, always pick the digit.
  Cert numbers with letters are a misread, not a valid cert.
  _Why:_ common OCR failure mode on low-contrast PSA labels.

## language

- The `language` field describes the LANGUAGE PRINTED ON THE CARD, not the
  language you output the card_name in. `card_name` and `set_name` are
  always in English (Latin script). `language: JP` means the physical card
  has Japanese text; the returned name is still the English translation.
  _Why:_ recurring confusion in test cases — models return `language: EN`
  because the OUTPUT is English, even when the card itself is Japanese.
- Traditional / Simplified Chinese, Korean, and other non-EN/JP languages
  use the language column value that appears on the card (`ZH-TW`, `ZH-CN`,
  `KR`). Do NOT collapse everything non-JP to `EN`.
  _Why:_ Aug 2026 audit found a Traditional Chinese Pikachu (`ZH-TW`) whose
  SKU was later regenerated as if it were English. Language preservation
  matters for catalog uniqueness.

## grading_company

- ARS grade labels are grade-inclusive (`ARS10`, `ARS 9`) — the grade
  number is part of the label string, not a separate suffix.
  _Why:_ ARS is one of the few companies where the label already contains
  the grade; a second grade append produces `ARS10 10`.
