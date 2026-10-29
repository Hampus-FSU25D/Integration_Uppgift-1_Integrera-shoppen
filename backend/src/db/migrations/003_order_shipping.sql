alter table orders
  add column if not exists shipping_method text not null default 'home'
    check (shipping_method in ('service-point', 'home')),
  add column if not exists shipping_price numeric not null default 0
    check (shipping_price >= 0),
  add column if not exists service_point_id text,
  add column if not exists service_point_country_code text,
  add column if not exists service_point_name text,
  add column if not exists service_point_address text,
  add column if not exists service_point_postal_code text,
  add column if not exists service_point_city text;

alter table orders
  add constraint orders_service_point_matches_shipping_method check (
    (shipping_method = 'service-point' and service_point_id is not null and service_point_country_code is not null
      and service_point_name is not null and service_point_address is not null
      and service_point_postal_code is not null and service_point_city is not null)
    or
    (shipping_method = 'home' and service_point_id is null and service_point_country_code is null
      and service_point_name is null and service_point_address is null
      and service_point_postal_code is null and service_point_city is null)
  );
