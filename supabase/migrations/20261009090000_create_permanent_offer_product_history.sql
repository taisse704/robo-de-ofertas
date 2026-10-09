create table if not exists public.offer_product_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  external_product_id text not null,
  external_item_id text,
  product_title text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, provider, external_product_id)
);
create index if not exists offer_product_history_provider_seen_idx
  on public.offer_product_history (user_id, provider, last_seen_at desc);
alter table public.offer_product_history enable row level security;
revoke all on public.offer_product_history from anon, authenticated;
grant all on public.offer_product_history to service_role;
insert into public.offer_product_history
  (user_id, provider, external_product_id, external_item_id, product_title, first_seen_at, last_seen_at, metadata)
select
  o.user_id,
  case
    when lower(coalesce(o.store_provider,'')) = 'shopee' or lower(p.nome) = 'shopee' then 'shopee'
    when lower(coalesce(o.store_provider,'')) in ('mercadolivre','mercado livre') or lower(p.nome) = 'mercado livre' then 'mercadolivre'
    else lower(coalesce(o.store_provider,p.nome,'unknown'))
  end,
  o.product_external_id,
  nullif(o.dados_origem->>'item_id',''),
  o.titulo,
  coalesce(o.encontrada_em,o.created_at,now()),
  coalesce(o.atualizada_em,o.created_at,now()),
  jsonb_build_object('backfilled_from_offer_id',o.id)
from public.offers o
left join public.platforms p on p.id=o.platform_id
where nullif(o.product_external_id,'') is not null
on conflict (user_id, provider, external_product_id) do update set
  external_item_id = coalesce(excluded.external_item_id, public.offer_product_history.external_item_id),
  product_title = coalesce(excluded.product_title, public.offer_product_history.product_title),
  first_seen_at = least(public.offer_product_history.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(public.offer_product_history.last_seen_at, excluded.last_seen_at),
  metadata = public.offer_product_history.metadata || excluded.metadata;
