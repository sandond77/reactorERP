-- Fix Japanese Base Set (BS) set_name from 'expansion pack' to 'Japanese Base Set'
UPDATE card_catalog
SET set_name = 'Japanese Base Set'
WHERE set_code = 'BS'
  AND language = 'JP'
  AND LOWER(set_name) = 'expansion pack';
