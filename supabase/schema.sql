-- Lo schema completo è quello già eseguito nel progetto Supabase.
-- Questo file aggiunge in modo sicuro eventuali indici mancanti.
create extension if not exists pgcrypto;
create unique index if not exists users_username_unique on users(lower(username));
create unique index if not exists one_open_order_per_table on orders(table_id) where status='APERTO';
create unique index if not exists only_one_active_evening on work_evenings(active) where active=true;
create index if not exists orders_work_evening_idx on orders(work_evening_id);
create index if not exists orders_waiter_idx on orders(waiter_id);
create index if not exists orders_status_idx on orders(status);
create index if not exists order_events_order_idx on order_events(order_id);
-- Gli ordini diretti creati dal cassiere non sono associati a un tavolo.
alter table orders alter column table_id drop not null;
-- Numero di persone associate all'ordine, usato anche per il calcolo a testa.
alter table orders add column if not exists guest_count integer not null default 1;
alter table orders drop constraint if exists orders_guest_count_check;
alter table orders add constraint orders_guest_count_check check (guest_count between 1 and 100);

-- Menu distinti per servizio ai tavoli e stand. I dati esistenti restano nel menu Tavoli.
alter table menu_categories add column if not exists menu_type text not null default 'TAVOLO';
alter table menu_categories drop constraint if exists menu_categories_menu_type_check;
alter table menu_categories drop constraint if exists menu_categories_name_key;
alter table menu_categories add constraint menu_categories_menu_type_check check (menu_type in ('TAVOLO','STAND'));
create unique index if not exists menu_categories_name_type_unique on menu_categories(lower(name),menu_type);

-- Anche gli ordini diretti ricordano quale menu utilizzare.
alter table orders add column if not exists service_type text not null default 'TAVOLO';
alter table orders drop constraint if exists orders_service_type_check;
alter table orders add constraint orders_service_type_check check (service_type in ('TAVOLO','STAND'));
