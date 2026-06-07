-- Add L1HG (HeartGold Collection) and L1SS (SoulSilver Collection) as
-- standalone JP set codes. L1 is the legacy combined code; existing data
-- stays under L1 and will be reclassified by hand.

INSERT INTO set_codes (user_id, game, language, set_code, set_name, era, aliases, is_seeded)
SELECT DISTINCT user_id, 'pokemon', 'JP', 'L1HG', 'HeartGold Collection', 'HGSS',
                ARRAY['heartgold collection','heart gold collection','hg collection','l1 hg','l1-hg']::text[], true
  FROM set_codes
 WHERE language = 'JP'
   AND user_id NOT IN (
     SELECT user_id FROM set_codes WHERE language = 'JP' AND set_code = 'L1HG'
   );

INSERT INTO set_codes (user_id, game, language, set_code, set_name, era, aliases, is_seeded)
SELECT DISTINCT user_id, 'pokemon', 'JP', 'L1SS', 'SoulSilver Collection', 'HGSS',
                ARRAY['soulsilver collection','soul silver collection','ss collection','l1 ss','l1-ss']::text[], true
  FROM set_codes
 WHERE language = 'JP'
   AND user_id NOT IN (
     SELECT user_id FROM set_codes WHERE language = 'JP' AND set_code = 'L1SS'
   );
