alter table orders
  add column if not exists guest_payment_token_hash text;
