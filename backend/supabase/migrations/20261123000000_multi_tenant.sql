-- Multi-tenant: tiap akuarium adalah satu tenant dengan tepat satu owner, member lain bergabung lewat join request.
-- Peran admin global dan monitoring_public dihapus: user yang bukan owner/member otomatis viewer (dihitung di backend).
-- Tidak ada GRANT atau policy baru: tabel baru hanya diakses backend (RLS aktif tanpa policy).

-- 1. banyak owner -> sisakan yang tertua, sisanya menjadi member
update public.aquarium_members m
set role = 'member'
where m.role = 'owner'
  and exists (
      select 1 from public.aquarium_members o
      where o.aquarium_id = m.aquarium_id and o.role = 'owner'
        and (o.created_at, o.user_id) < (m.created_at, m.user_id)
  );

-- 2. tanpa owner -> pembuat akuarium (created_by)
insert into public.aquarium_members (aquarium_id, user_id, role)
select a.id, a.created_by, 'owner'
from public.aquariums a
where a.created_by is not null
  and not exists (select 1 from public.aquarium_members o where o.aquarium_id = a.id and o.role = 'owner')
on conflict (aquarium_id, user_id) do update set role = 'owner';

-- 3. masih tanpa owner -> member tertua
update public.aquarium_members m
set role = 'owner'
where m.role = 'member'
  and not exists (select 1 from public.aquarium_members o where o.aquarium_id = m.aquarium_id and o.role = 'owner')
  and (m.created_at, m.user_id) = (
      select x.created_at, x.user_id from public.aquarium_members x
      where x.aquarium_id = m.aquarium_id
      order by x.created_at, x.user_id
      limit 1
  );

-- 4. satu owner per akuarium
create unique index aquarium_one_owner on public.aquarium_members (aquarium_id) where role = 'owner';

-- 5. permintaan bergabung; baris dihapus setelah diterima, ditolak, atau dibatalkan
create table public.aquarium_join_requests (
    id          uuid primary key default gen_random_uuid(),
    aquarium_id text        not null references public.aquariums (id) on delete cascade,
    user_id     uuid        not null references public.profiles (id) on delete cascade,
    created_at  timestamptz not null default now(),
    unique (aquarium_id, user_id)
);
create index on public.aquarium_join_requests (user_id);

alter table public.aquarium_join_requests enable row level security;
revoke all on public.aquarium_join_requests from anon, authenticated;

-- 6. hapus model peran lama
alter table public.aquariums drop column monitoring_public;
alter table public.profiles drop column role;
