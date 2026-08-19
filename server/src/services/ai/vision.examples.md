# Vision subagent — few-shot examples

Concrete input/output pairs for patterns that don't compress into a
simple rule. Loaded once at startup and appended to the system prompt as
a "Reference examples" block.

## When to add an example vs a rule

- **Rule** (in `vision.rules.md`): pattern generalises across many cards.
  "Set codes preserve case" applies to every SV / M / SM card, no need
  to enumerate.
- **Example** (here): pattern is specific to a card family, a label style,
  or a visual artifact the model has to see the correct answer for.

## Editing this file

Each example is one `## <title>` section with:
- `Context:` — one line describing what the model tends to get wrong
- `Input:` — brief description of the image (not the image itself —
  examples in the prompt are text-only; the model has already been shown
  the actual image at request time)
- `Output:` — the correct JSON

Keep the total examples block under ~600 tokens. When it grows past that,
the curation script drops the lowest-impact examples first.

---

<!-- No examples yet. Add the first entry the next time we ship a fix
that "just adding a rule wouldn't have solved" — e.g., a specific label
variant the model keeps misreading despite the schema being clear. -->
