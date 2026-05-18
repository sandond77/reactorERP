-- Backfill total_cost_basis for sales linked to a card_instance with qty > 1.
--
-- computeCostBasis() was using card_instances.purchase_cost (per-card) without
-- multiplying by quantity, so multi-qty raw sales had the cost basis of one
-- card written into sales.total_cost_basis. That made profit display overstate
-- by (qty - 1) × per_card_cost.
--
-- This UPDATE rewrites total_cost_basis = (purchase_cost × quantity) +
-- COALESCE(grading_cost, 0) for the affected rows only. Single-qty rows are
-- untouched.

UPDATE sales s
   SET total_cost_basis = (ci.purchase_cost * ci.quantity) + COALESCE(sd.grading_cost, 0)
  FROM card_instances ci
  LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
 WHERE s.card_instance_id = ci.id
   AND ci.quantity > 1;
