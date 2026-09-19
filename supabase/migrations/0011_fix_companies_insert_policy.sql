-- Phase 3 — Correction de la politique d'insertion sur companies
--
-- La politique d'origine (migration 0002) utilisait auth.role() pour
-- distinguer un utilisateur authentifié d'un visiteur :
--
--   with check (auth.role() = 'authenticated' or auth.role() = 'service_role')
--
-- Testé en conditions réelles contre le projet Supabase (pas seulement en
-- local), cette politique rejetait à tort les utilisateurs authentifiés :
-- auth.role() ne reflétait pas la revendication "role" du jeton pourtant
-- bien présente (vérifié par décodage direct du JWT). auth.uid(), utilisé
-- partout ailleurs dans le schéma (is_platform_admin, has_company_role),
-- s'est lui révélé fiable dans les mêmes tests.
--
-- Correction : ne plus dépendre de auth.role(), et utiliser uniquement
-- auth.uid() is not null pour détecter un utilisateur authentifié — cohérent
-- avec le reste du schéma. Les appels effectués avec la clé secrète
-- (service_role) contournent de toute façon entièrement la RLS et ne sont
-- pas concernés par cette politique.
--
-- On ne modifie pas le fichier 0002 déjà appliqué (ne jamais réécrire une
-- migration déjà exécutée) : cette correction est additive.

drop policy if exists "companies_insert_authenticated" on public.companies;

create policy "companies_insert_authenticated" on public.companies
  for insert
  with check (auth.uid() is not null);
