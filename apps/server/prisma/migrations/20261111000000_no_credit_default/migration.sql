-- Клуб больше не сажает в долг: лимит по умолчанию 0, и существующие клубы тоже.
ALTER TABLE "Club" ALTER COLUMN "creditLimit" SET DEFAULT 0;
UPDATE "Club" SET "creditLimit" = 0;
