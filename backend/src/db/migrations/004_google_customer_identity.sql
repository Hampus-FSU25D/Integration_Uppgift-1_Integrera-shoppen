alter table users
  alter column password_hash drop not null,
  add column name text,
  add column google_sub text unique,
  add constraint users_auth_method_required check (password_hash is not null or google_sub is not null);
