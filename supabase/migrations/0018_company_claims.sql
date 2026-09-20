-- Phase 7 — Revendication d'entreprise (§14-§23 du cahier des charges)
--
-- Toute écriture sur company_claims passe EXCLUSIVEMENT par les fonctions
-- ci-dessous (SECURITY DEFINER) : aucune politique RLS d'insertion/mise à
-- jour n'est créée pour authenticated/anon, ce qui rend une modification
-- directe de claim_status structurellement impossible (§19), pas seulement
-- déconseillée — il n'existe simplement aucun chemin RLS pour le faire.

create table public.company_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  professional_email text not null,
  verification_method text not null check (verification_method in ('domain_match', 'manual')),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'approved', 'rejected', 'cancelled')),
  justification text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.company_claims is
  'Demandes de revendication d''une fiche entreprise existante. Voir '
  'docs/CLAIMING.md pour le workflow complet (méthode A domaine, méthode B '
  'manuelle) et les règles d''attribution du rôle.';

create index company_claims_company_idx on public.company_claims (company_id);
create index company_claims_user_idx on public.company_claims (user_id);
create index company_claims_status_idx on public.company_claims (status);

-- Une entreprise revendiquée (au moins une fois approuvée) ne doit plus
-- être écrasée aveuglément par un futur réimport (§23) — voir
-- docs/CLAIMING.md pour la stratégie complète (pas de versioning complet
-- construit cette phase, seulement ce marqueur).
alter table public.companies add column claimed_at timestamptz;

create trigger set_company_claims_updated_at
  before update on public.company_claims
  for each row execute function public.set_updated_at();

alter table public.company_claims enable row level security;

create policy "company_claims_select_own_or_company_or_admin" on public.company_claims
  for select
  using (
    user_id = auth.uid()
    or public.has_company_role(company_id, array['owner', 'admin'])
    or public.is_platform_admin()
  );

-- 1) Soumission (méthode A / méthode B) ---------------------------------------
--
-- Auto-approbation UNIQUEMENT si TOUTES ces conditions tiennent :
--  - l'entreprise a un professional_email dont le domaine correspond
--    exactement à celui soumis par le demandeur ;
--  - ce domaine n'est pas un domaine grand public (gmail, outlook, ...) ;
--  - le domaine de l'adresse COURRIEL DE CONNEXION du demandeur (déjà
--    confirmée par Supabase) correspond AUSSI à ce domaine — la seule
--    adresse "professionnelle" saisie dans le formulaire n'est, elle,
--    jamais vérifiée : ce croisement empêche quiconque de taper une
--    adresse qu'il ne contrôle pas réellement (voir docs/CLAIMING.md) ;
--  - l'entreprise n'a encore AUCUN membre (§18 : ne jamais déplacer un
--    owner déjà légitime).
-- Dans tous les autres cas : la demande reste 'pending', en attente d'un
-- examen manuel par un administrateur (méthode B).
create or replace function public.submit_company_claim(
  p_company_id uuid,
  p_professional_email text,
  p_justification text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_company_domain text;
  v_claim_domain text;
  v_member_count int;
  v_claim_id uuid;
  v_status text := 'pending';
  v_method text := 'manual';
  v_freemail_domains text[] := array[
    'gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'yahoo.com', 'live.com', 'aol.com', 'protonmail.com'
  ];
begin
  if v_user_id is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;
  if p_professional_email is null or position('@' in p_professional_email) = 0 then
    raise exception 'Adresse courriel professionnelle invalide.';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Entreprise introuvable.';
  end if;
  if exists (
    select 1 from public.company_claims
    where company_id = p_company_id and user_id = v_user_id and status in ('pending', 'verified')
  ) then
    raise exception 'Une revendication est déjà en cours pour cette entreprise.';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;
  v_claim_domain := lower(split_part(p_professional_email, '@', 2));
  select lower(split_part(professional_email, '@', 2)) into v_company_domain
    from public.companies where id = p_company_id and professional_email is not null;
  select count(*) into v_member_count from public.company_members where company_id = p_company_id;

  if v_company_domain is not null
     and v_claim_domain = v_company_domain
     and not (v_claim_domain = any(v_freemail_domains)) then
    v_method := 'domain_match';
    if lower(split_part(coalesce(v_user_email, ''), '@', 2)) = v_claim_domain
       and v_member_count = 0 then
      v_status := 'approved';
    end if;
  end if;

  insert into public.company_claims (
    company_id, user_id, professional_email, verification_method, status, justification,
    reviewed_at
  )
  values (
    p_company_id, v_user_id, p_professional_email, v_method, v_status, p_justification,
    case when v_status = 'approved' then now() else null end
  )
  returning id into v_claim_id;

  if v_status = 'approved' then
    insert into public.company_members (company_id, user_id, role, status, joined_at)
    values (p_company_id, v_user_id, 'owner', 'active', now())
    on conflict (company_id, user_id) do nothing;
    update public.companies set claimed_at = now() where id = p_company_id;
    perform public.log_audit_event(
      'company_claim_auto_approved', 'company_claim', v_claim_id,
      null, jsonb_build_object('company_id', p_company_id, 'method', v_method)
    );
  else
    perform public.log_audit_event(
      'company_claim_submitted', 'company_claim', v_claim_id,
      null, jsonb_build_object('company_id', p_company_id, 'method', v_method)
    );
  end if;

  return json_build_object('id', v_claim_id, 'status', v_status);
end;
$$;

comment on function public.submit_company_claim is
  'Point d''entrée UNIQUE pour créer une revendication — voir docs/CLAIMING.md.';

revoke execute on function public.submit_company_claim from anon;
grant execute on function public.submit_company_claim to authenticated;

-- 2) Annulation par le demandeur lui-même -------------------------------------
create or replace function public.cancel_company_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.company_claims
  set status = 'cancelled'
  where id = p_claim_id and user_id = auth.uid() and status in ('pending', 'verified');
  if not found then
    raise exception 'Revendication introuvable ou non annulable.';
  end if;
  perform public.log_audit_event('company_claim_cancelled', 'company_claim', p_claim_id, null, null);
end;
$$;

revoke execute on function public.cancel_company_claim from anon;
grant execute on function public.cancel_company_claim to authenticated;

-- 3) Examen administrateur -----------------------------------------------------
--
-- Entreprise déjà membre(s) : la demande approuvée ajoute un rôle 'admin',
-- jamais 'owner' (§18 : ne jamais déplacer un owner légitime déjà en place).
create or replace function public.review_company_claim(
  p_claim_id uuid,
  p_decision text,
  p_notes text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_member_count int;
  v_role text;
begin
  if not public.is_platform_admin() then
    raise exception 'Réservé aux administrateurs de la plateforme.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Décision invalide.';
  end if;

  select * into v_claim from public.company_claims where id = p_claim_id for update;
  if v_claim is null then
    raise exception 'Revendication introuvable.';
  end if;
  if v_claim.status not in ('pending', 'verified') then
    raise exception 'Cette revendication a déjà été traitée.';
  end if;

  if p_decision = 'approved' then
    select count(*) into v_member_count from public.company_members where company_id = v_claim.company_id;
    v_role := case when v_member_count = 0 then 'owner' else 'admin' end;
    insert into public.company_members (company_id, user_id, role, status, joined_at)
    values (v_claim.company_id, v_claim.user_id, v_role, 'active', now())
    on conflict (company_id, user_id) do nothing;
    update public.companies set claimed_at = coalesce(claimed_at, now()) where id = v_claim.company_id;
  end if;

  update public.company_claims
  set status = p_decision, reviewed_at = now(), reviewed_by = auth.uid(),
      internal_notes = coalesce(p_notes, internal_notes)
  where id = p_claim_id;

  perform public.log_audit_event(
    case when p_decision = 'approved' then 'company_claim_approved' else 'company_claim_rejected' end,
    'company_claim', p_claim_id,
    jsonb_build_object('status', v_claim.status), jsonb_build_object('status', p_decision)
  );

  return json_build_object('id', p_claim_id, 'status', p_decision);
end;
$$;

comment on function public.review_company_claim is
  'Réservé aux administrateurs de la plateforme (vérifié en interne, pas '
  'seulement par la permission d''exécution) — voir docs/CLAIMING.md.';

revoke execute on function public.review_company_claim from anon;
grant execute on function public.review_company_claim to authenticated;
