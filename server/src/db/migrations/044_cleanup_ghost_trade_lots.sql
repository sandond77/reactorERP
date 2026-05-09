-- One-time cleanup: any raw_purchases row created from a trade
-- (source='trade') that has no card_instances pointing to it is a ghost lot
-- left behind by the pre-fix deleteTrade flow. Safe to remove because every
-- legitimate trade-source lot has exactly one card_instance attached, and we
-- guard on source='trade' so real purchases are untouched.

DELETE FROM raw_purchases rp
WHERE rp.source = 'trade'
  AND NOT EXISTS (
    SELECT 1 FROM card_instances ci WHERE ci.raw_purchase_id = rp.id
  );
