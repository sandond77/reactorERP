import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));
}

export const STATUS_LABELS: Record<string, string> = {
  purchased_raw: 'Purchased Raw',
  inspected: 'Inspected',
  grading_submitted: 'Sent for Grading',
  graded: 'Graded',
  raw_for_sale: 'Listed Raw',
  sold: 'Sold',
  lost_damaged: 'Lost / Damaged',
};

export const STATUS_COLORS: Record<string, string> = {
  purchased_raw: 'bg-blue-500/20 text-blue-300',
  inspected: 'bg-yellow-500/20 text-yellow-300',
  grading_submitted: 'bg-purple-500/20 text-purple-300',
  graded: 'bg-green-500/20 text-green-300',
  raw_for_sale: 'bg-orange-500/20 text-orange-300',
  sold: 'bg-gray-500/20 text-gray-400',
  lost_damaged: 'bg-red-500/20 text-red-400',
};
