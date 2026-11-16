create table if not exists github_admins (
  github_id text primary key,
  login text not null unique,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
