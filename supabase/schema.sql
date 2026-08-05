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
