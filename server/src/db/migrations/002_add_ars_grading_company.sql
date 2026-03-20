-- Migration: 002_add_ars_grading_company
-- Add ARS (Japanese grading company) to grading_company enum

ALTER TYPE grading_company ADD VALUE IF NOT EXISTS 'ARS';
