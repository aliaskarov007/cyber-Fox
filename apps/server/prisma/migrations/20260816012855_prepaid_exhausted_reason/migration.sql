-- Закончившаяся предоплата и исчерпанный кредит — разные события в отчёте.
ALTER TYPE "SegmentEndReason" ADD VALUE 'PREPAID_EXHAUSTED';
