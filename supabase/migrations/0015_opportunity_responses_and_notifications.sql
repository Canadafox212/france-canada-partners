-- Phase 5 — Réponses aux opportunités + notifications
--
-- Une entreprise répond à une opportunité AU NOM d'une entreprise, jamais
-- en son nom personnel (responding_company_id + responding_user_id).
-- Confidentialité stricte : une réponse n'est visible que par l'entreprise
-- répondante, l'entreprise ayant publié l'opportunité, et les administrateurs
-- de la plateforme — jamais par le grand public ni par une autre entreprise.
--
-- notifications est avancée depuis sa phase d'origine (8), comme
-- audit_logs et company_translations l'ont été en Phase 3 : nécessaire dès
-- maintenant pour "votre opportunité a reçu une réponse", etc.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Notifications internes simples (ex. "votre opportunité a reçu une '
  'réponse"). Écriture réservée à create_notification() (SECURITY DEFINER) '
  '— jamais d''insertion directe par un client.';

create index notifications_user_id_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid() or public.is_platform_admin());

create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.create_notification(p_user_id uuid, p_type text, p_payload jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, payload) values (p_user_id, p_type, p_payload);
end;
$$;

-- Réponses aux opportunités.
create table public.opportunity_responses (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  responding_company_id uuid not null references public.companies (id) on delete cascade,
  responding_user_id uuid not null references public.profiles (id) on delete restrict,
  message text,
  status text not null default 'declared_interest'
    check (status in ('declared_interest', 'under_review', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- MVP : une seule réponse par entreprise et par opportunité (modifiable/
  -- retirable ensuite, jamais recréée) — voir PROJECT_SPEC.md §4.4bis.
  unique (opportunity_id, responding_company_id)
);

comment on table public.opportunity_responses is
  'Réponse d''une entreprise à une opportunité publiée par une autre. '
  'Jamais publique : voir les politiques RLS ci-dessous.';

create trigger set_opportunity_responses_updated_at
  before update on public.opportunity_responses
  for each row execute function public.set_updated_at();

create index opportunity_responses_opportunity_idx on public.opportunity_responses (opportunity_id);
create index opportunity_responses_company_idx on public.opportunity_responses (responding_company_id);

-- Une entreprise ne peut jamais répondre à sa propre opportunité — garanti
-- par un déclencheur (pas seulement par l'interface), testé explicitement.
create or replace function public.prevent_self_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opportunity_company_id uuid;
begin
  select company_id into v_opportunity_company_id from public.opportunities where id = new.opportunity_id;
  if v_opportunity_company_id = new.responding_company_id then
    raise exception 'Une entreprise ne peut pas répondre à sa propre opportunité.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger prevent_self_response_trigger
  before insert on public.opportunity_responses
  for each row execute function public.prevent_self_response();

-- Qui peut changer quoi : l'entreprise répondante peut modifier son message
-- et retirer sa réponse (-> withdrawn) ; seule l'entreprise ayant publié
-- l'opportunité peut faire progresser le statut (under_review/accepted/
-- declined). Ni l'une ni l'autre ne peut faire les deux.
create or replace function public.protect_opportunity_response_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opportunity_company_id uuid;
  v_is_responder boolean;
  v_is_publisher boolean;
begin
  if public.is_platform_admin() then
    return new;
  end if;

  select company_id into v_opportunity_company_id from public.opportunities where id = new.opportunity_id;
  v_is_responder := public.has_company_role(new.responding_company_id, array['owner', 'admin', 'member']);
  v_is_publisher := public.has_company_role(v_opportunity_company_id, array['owner', 'admin', 'member']);

  if new.message is distinct from old.message and not v_is_responder then
    raise exception 'Seule l''entreprise répondante peut modifier le message.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'withdrawn' then
      if not v_is_responder then
        raise exception 'Seule l''entreprise répondante peut retirer sa réponse.' using errcode = '42501';
      end if;
    elsif new.status in ('under_review', 'accepted', 'declined') then
      if not v_is_publisher then
        raise exception 'Seule l''entreprise ayant publié l''opportunité peut changer ce statut.' using errcode = '42501';
      end if;
    else
      raise exception 'Transition de statut non autorisée.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_opportunity_response_update_trigger
  before update on public.opportunity_responses
  for each row execute function public.protect_opportunity_response_update();

-- RLS — confidentialité stricte (point 17) : ni le grand public, ni une
-- entreprise tierce ne peut jamais voir une réponse.
alter table public.opportunity_responses enable row level security;

create policy "opportunity_responses_select_involved_parties" on public.opportunity_responses
  for select
  using (
    public.has_company_role(responding_company_id, array['owner', 'admin', 'member', 'viewer'])
    or exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member', 'viewer'])
    )
    or public.is_platform_admin()
  );

create policy "opportunity_responses_insert_member" on public.opportunity_responses
  for insert
  with check (public.has_company_role(responding_company_id, array['owner', 'admin', 'member']));

create policy "opportunity_responses_update_involved_parties" on public.opportunity_responses
  for update
  using (
    public.has_company_role(responding_company_id, array['owner', 'admin', 'member'])
    or exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member'])
    )
    or public.is_platform_admin()
  );

-- Audit (jamais le contenu du message) + notifications.
create or replace function public.log_and_notify_opportunity_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opportunity_company_id uuid;
  v_opportunity_title text;
  v_publisher_user_id uuid;
begin
  select company_id, title into v_opportunity_company_id, v_opportunity_title
  from public.opportunities where id = new.opportunity_id;

  if tg_op = 'INSERT' then
    perform public.log_audit_event('opportunity_response_created', 'opportunity_response', new.id, null,
      jsonb_build_object('opportunity_id', new.opportunity_id, 'responding_company_id', new.responding_company_id));

    for v_publisher_user_id in
      select user_id from public.company_members
      where company_id = v_opportunity_company_id and role in ('owner', 'admin') and status = 'active'
    loop
      perform public.create_notification(
        v_publisher_user_id,
        'opportunity_response_received',
        jsonb_build_object('opportunity_id', new.opportunity_id, 'response_id', new.id, 'opportunity_title', v_opportunity_title)
      );
    end loop;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.log_audit_event('opportunity_response_status_changed', 'opportunity_response', new.id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));

    if new.status in ('accepted', 'declined') then
      perform public.create_notification(
        new.responding_user_id,
        'opportunity_response_' || new.status,
        jsonb_build_object('opportunity_id', new.opportunity_id, 'response_id', new.id, 'opportunity_title', v_opportunity_title)
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger log_and_notify_opportunity_response_trigger
  after insert or update on public.opportunity_responses
  for each row execute function public.log_and_notify_opportunity_response();
