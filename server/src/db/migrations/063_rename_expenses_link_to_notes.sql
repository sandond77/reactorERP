-- Rename expenses.link → expenses.notes. The column was originally intended for a
-- receipt/reference URL, but usage evolved into free-form notes (any text, links
-- included). Server-side validation was already relaxed from .url() to a plain
-- length-capped string in a prior commit; this migration aligns the schema with
-- how the field is actually used.

ALTER TABLE expenses RENAME COLUMN link TO notes;
