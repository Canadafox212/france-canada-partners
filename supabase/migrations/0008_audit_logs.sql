-- Phase 3 — Journal d'audit
--
-- Préparé maintenant (plutôt qu'en Phase 9) car plusieurs événements de
-- cette phase doivent déjà pouvoir être tracés : création d'entreprise,
-- tentative de modification d'un champ protégé, ajout de membre, changement
-- de rôle. Jamais de mot de passe, jeton ou secret dans ce journal.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_summary jsonb,
  after_summary jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Journal des événements significatifs (création d''entreprise, changement '
  'de rôle, tentative de modification d''un champ protégé, actions admin). '
  'Ne jamais y écrire de mot de passe, jeton ou secret.';

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id);

-- Fonction d'écriture centralisée : SECURITY DEFINER pour que des triggers
-- déclenchés par une action utilisateur normale (RLS restrictive sur
-- audit_logs) puissent tout de même y écrire une ligne.
create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb default null,
  p_after jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, before_summary, after_summary)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after);
end;
$$;

alter table public.audit_logs enable row level security;

-- Lecture réservée aux administrateurs de la plateforme. Aucune politique
-- d'écriture directe : toute insertion passe par log_audit_event() (appelée
-- par des triggers ou du code serveur de confiance), jamais par un client.
create policy "audit_logs_select_admin_only" on public.audit_logs
  for select using (public.is_platform_admin());
