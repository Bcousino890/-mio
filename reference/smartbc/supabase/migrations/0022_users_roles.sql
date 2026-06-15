-- ============================================================
-- 0020: Add `created_by` column to profiles for audit trail
-- ============================================================

-- Add created_by column to track which admin/advisor created a user
alter table profiles
add column created_by uuid references profiles(id) on delete set null;

-- Create index for efficient queries
create index idx_profiles_created_by on profiles(created_by);

-- Add comment for clarity
comment on column profiles.created_by is 'References the user (admin/advisor) who created this profile, for audit purposes';
