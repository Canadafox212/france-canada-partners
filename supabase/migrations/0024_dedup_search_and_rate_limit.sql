-- Phase 10C, LOT 10C-2 — Détection de doublon avant création + limitation
-- anti-rafale des demandes de mise en relation.
--
-- Ne touche à AUCUNE des migrations 0001-0023, ni à la logique du
-- moteur de matching, ni aux coordonnées professionnelles (company_contacts
-- reste hors périmètre de ce lot).

-- =====================================================================
-- A2 — Recherche d'entreprises similaires avant création (anti-doublon)
-- =====================================================================
--
-- La comparaison fine (compareForDuplicate, src/lib/companies/dedup.ts)
-- reste côté application, pure et déjà testée unitairement — cette
-- fonction ne fait QUE le raccourci de candidats à comparer, en SQL, pour
-- pouvoir chercher parmi des fiches qui ne sont pas forcément publiques
-- (une entreprise déjà importée mais encore `draft`, par exemple, doit
-- pouvoir être détectée pour éviter un doublon — sans jamais exposer ses
-- coordonnées privées à l'utilisateur qui fait la recherche).
--
-- Colonnes volontairement exclues du retour : professional_email, phone,
-- et toute information de membre. `is_claimed` n'est PAS
-- `companies.claimed_at is not null` : une entreprise auto-créée
-- (create_company(), Phase 3) a un owner dès sa création mais claimed_at
-- reste NULL indéfiniment (jamais de passage par company_claims). Utiliser
-- claimed_at ici inviterait à tort un visiteur à "revendiquer" une
-- entreprise qui a déjà un propriétaire légitime — même correction que
-- Phase 10C LOT 10C-1 (src/lib/companies/completeness.ts).
--
-- Durcissement (revue de sécurité avant application) :
--   - p_city retiré : jamais utilisé pour restreindre la recherche côté
--     SQL (seulement pour affiner le SCORE côté application) — un
--     paramètre accepté mais ignoré aurait été trompeur.
--   - p_country_code ajouté : sert uniquement à qualifier une
--     correspondance de numéro officiel (voir plus bas), jamais à filtrer
--     la recherche par nom/domaine.
--   - Recherche par sous-chaîne réécrite avec position()/strpos() au lieu
--     de `ilike '%...%'` : `ilike` interprète `%`/`_` dans l'entrée
--     utilisateur comme des méta-caractères — un utilisateur pouvait
--     passer p_display_name='%' et obtenir un dump de TOUTES les
--     entreprises (y compris les fiches draft) jusqu'à la limite. position()
--     compare une sous-chaîne littérale, sans aucun méta-caractère.
--   - Longueur minimale (3 caractères après trim) exigée pour toute
--     recherche par nom ou par domaine — un caractère unique aurait un
--     taux de correspondance trop large et faciliterait une énumération
--     progressive des fiches non publiques. Le numéro officiel reste une
--     égalité exacte, non concerné par ce risque.
--   - registration_number_match (boolean) remplace toute idée de retourner
--     company_registration_number du candidat : le signal est transmis au
--     scoring sans jamais exposer la valeur elle-même. Qualifié par
--     country_code pour éviter qu'un numéro français (SIREN/SIRET) et un
--     identifiant étranger numériquement identique ne soient confondus.
--   - Aucun paramètre significatif fourni (après application des règles
--     ci-dessus) -> retourne explicitement aucune ligne, sans dépendre
--     implicitement de la forme du WHERE.
--
-- Deuxième revue de sécurité (avant application) — restriction DRAFT :
--   - Une entreprise ACTIVE reste trouvable par recherche floue (nom en
--     sous-chaîne, domaine en sous-chaîne, numéro officiel) — elle est de
--     toute façon déjà publique via l'annuaire.
--   - Une entreprise DRAFT/non active n'est retournée QUE si un signal
--     FORT est présent : numéro officiel exact + même country_code, OU
--     domaine exact après normalisation (plus une sous-chaîne), OU nom
--     normalisé (trim+minuscule) EXACT + même country_code + même ville
--     si les deux sont connues. Une recherche générique ("tech", "air",
--     "inc"...) ne peut donc plus, par construction, révéler l'existence
--     d'une fiche non publique.
--   - public.extract_website_domain() centralise la normalisation de
--     domaine (utilisée pour l'entrée ET pour chaque candidat, afin que
--     l'égalité exacte soit réellement comparable des deux côtés).
--   - search_path fixé à "pg_catalog, public" plutôt que "public" seul :
--     pg_catalog est de toute façon TOUJOURS consulté en premier par
--     Postgres pour résoudre un appel non qualifié, qu'il soit ou non
--     mentionné dans search_path — ce réglage ne change donc pas la
--     résolution des fonctions natives, mais la rend explicite plutôt que
--     dépendante d'une règle implicite. La protection réelle contre un
--     détournement via pg_temp reste la qualification systématique
--     public.* de chaque table/fonction applicative (déjà en place).
create or replace function public.extract_website_domain(p_website text)
returns text
language sql
immutable
as $$
  select nullif(
    split_part(
      regexp_replace(
        case
          when lower(trim(coalesce(p_website, ''))) ~ '^https?://' then lower(trim(p_website))
          else 'https://' || lower(trim(coalesce(p_website, '')))
        end,
        '^https?://(www\.)?', ''
      ),
      '/', 1
    ),
    ''
  );
$$;

comment on function public.extract_website_domain is
  'Normalise un site web en domaine comparable ("https://www.ex.com/x" -> '
  '"ex.com") — utilisée par find_similar_companies() pour comparer '
  'l''entrée utilisateur ET chaque candidat avec la même règle. Fonction '
  'pure, sans accès aux tables : aucune restriction d''exécution requise.';

create or replace function public.find_similar_companies(
  p_display_name text default null,
  p_website text default null,
  p_registration_number text default null,
  p_country_code text default null,
  p_city text default null
)
returns table (
  id uuid,
  display_name text,
  legal_name text,
  slug text,
  website text,
  country_code text,
  region text,
  city text,
  is_claimed boolean,
  registration_number_match boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  v_domain text;
  v_name text;
  v_city text;
  v_registration text;
  v_has_criteria boolean;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;

  v_name := lower(nullif(trim(coalesce(p_display_name, '')), ''));
  if v_name is not null and length(v_name) < 3 then
    v_name := null;
  end if;

  v_domain := public.extract_website_domain(p_website);
  if v_domain is not null and length(v_domain) < 4 then
    v_domain := null;
  end if;

  v_registration := nullif(trim(coalesce(p_registration_number, '')), '');
  v_city := lower(nullif(trim(coalesce(p_city, '')), ''));

  v_has_criteria := v_name is not null or v_domain is not null or v_registration is not null;
  if not v_has_criteria then
    return;
  end if;

  return query
  select
    c.id,
    c.display_name,
    c.legal_name,
    c.slug,
    c.website,
    c.country_code,
    loc.region,
    loc.city,
    exists (
      select 1 from public.company_members m
      where m.company_id = c.id and m.status = 'active' and m.role in ('owner', 'admin')
    ) as is_claimed,
    (
      v_registration is not null
      and p_country_code is not null
      and c.company_registration_number = v_registration
      and c.country_code = upper(p_country_code)
    ) as registration_number_match
  from public.companies c
  left join lateral (
    select cl.region, cl.city
    from public.company_locations cl
    where cl.company_id = c.id and cl.is_primary
    limit 1
  ) loc on true
  where
    -- Entreprise ACTIVE (déjà publique via l'annuaire) : recherche floue.
    (
      c.status = 'active'
      and (
        (v_registration is not null and c.company_registration_number = v_registration)
        or (v_domain is not null and c.website is not null and position(v_domain in lower(c.website)) > 0)
        or (
          v_name is not null and (
            position(v_name in lower(c.display_name)) > 0
            or (c.legal_name is not null and position(v_name in lower(c.legal_name)) > 0)
          )
        )
      )
    )
    -- Entreprise DRAFT/non active : signal FORT uniquement (§1 de la revue).
    or (
      c.status != 'active'
      and (
        (
          v_registration is not null and p_country_code is not null
          and c.company_registration_number = v_registration
          and c.country_code = upper(p_country_code)
        )
        or (
          v_domain is not null
          and public.extract_website_domain(c.website) = v_domain
        )
        or (
          v_name is not null and p_country_code is not null
          and (
            lower(trim(c.display_name)) = v_name
            or (c.legal_name is not null and lower(trim(c.legal_name)) = v_name)
          )
          and c.country_code = upper(p_country_code)
          and (
            v_city is null
            or loc.city is null
            or lower(trim(loc.city)) = v_city
          )
        )
      )
    )
  limit 20;
end;
$$;

comment on function public.find_similar_companies is
  'Recherche de fiches existantes pouvant correspondre à une entreprise sur '
  'le point d''être créée (Phase 10C, LOT 10C-2) — retourne un jeu de '
  'candidats restreint (jamais professional_email/phone/membres/numéro '
  'officiel brut). Une entreprise ACTIVE (déjà publique) reste trouvable '
  'par recherche floue ; une entreprise DRAFT n''est retournée que sur un '
  'signal FORT (numéro officiel+pays, domaine exact, ou nom exact+pays'
  '+ville) — jamais par simple sous-chaîne de nom, pour ne jamais servir '
  'd''annuaire des fiches non publiques. Recherche par sous-chaîne via '
  'position() (jamais ilike avec wildcards utilisateur), longueur minimale '
  'de 3/4 caractères, aucun paramètre significatif -> aucune ligne. La '
  'comparaison fine (niveau EXACT/VERY_LIKELY/POSSIBLE/UNLIKELY) reste '
  'calculée côté application via src/lib/companies/dedup.ts.';

revoke all on function public.find_similar_companies from public;
revoke execute on function public.find_similar_companies from anon;
grant execute on function public.find_similar_companies to authenticated;

-- =====================================================================
-- A3/§2 (revue) — Prévisualisation minimale pour revendiquer une fiche
-- non publique trouvée via find_similar_companies()
-- =====================================================================
--
-- loadCompanyBySlug() (src/lib/directory/companyPageData.ts) est soumis à
-- la RLS publique (status = 'active' OU appartenance réelle) : une
-- entreprise draft trouvée par find_similar_companies() donnerait un 404
-- pur à un visiteur non membre cliquant "Revendiquer cette entreprise",
-- alors que submit_company_claim() (0018) n'exige elle-même AUCUN statut
-- particulier. Cette fonction ne retourne que le strict nécessaire pour
-- afficher "cette entreprise existe déjà, la revendiquer" SANS rendre le
-- reste de la fiche (offres/besoins/description/coordonnées) public.
create or replace function public.get_company_claim_preview(p_slug text)
returns table (
  id uuid,
  display_name text,
  slug text,
  is_claimed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;
  if p_slug is null or length(trim(p_slug)) = 0 then
    return;
  end if;

  return query
  select
    c.id,
    c.display_name,
    c.slug,
    exists (
      select 1 from public.company_members m
      where m.company_id = c.id and m.status = 'active' and m.role in ('owner', 'admin')
    ) as is_claimed
  from public.companies c
  where c.slug = trim(p_slug)
  limit 1;
end;
$$;

comment on function public.get_company_claim_preview is
  'Prévisualisation minimale (nom + statut de revendication uniquement) '
  'd''une fiche non publique, pour permettre sa revendication sans exposer '
  'le reste de son contenu — voir find_similar_companies() ci-dessus.';

revoke all on function public.get_company_claim_preview from public;
revoke execute on function public.get_company_claim_preview from anon;
grant execute on function public.get_company_claim_preview to authenticated;

-- =====================================================================
-- B — Limitation anti-rafale des demandes de mise en relation
-- =====================================================================

-- B3 : index composite pour la fenêtre glissante — aucun index existant
-- (partnership_requests_requester_idx, migration 0023) ne couvre
-- (requester_company_id, created_at) ensemble.
create index partnership_requests_requester_created_idx
  on public.partnership_requests (requester_company_id, created_at);

-- B1/B2/B4 : create_partnership_request() redéfinie pour ajouter UN SEUL
-- contrôle supplémentaire, juste après la vérification de doublon de
-- demande active — le reste de la fonction est IDENTIQUE à 0023 (aucune
-- règle de permission, de provenance ou de notification modifiée).
--
-- Seuil : 20 demandes créées (tous statuts confondus) par la même
-- ENTREPRISE DEMANDEUSE (requester_company_id, jamais actor_user_id — un
-- membre différent de la même entreprise partage la même limite) sur une
-- fenêtre glissante d'une heure. Ce n'est PAS un quota commercial : à ce
-- volume, aucun usage professionnel normal ne peut l'atteindre en usage
-- réel (voir docs/SECURITY.md pour l'analyse complète) — seule une rafale
-- automatisée le peut. Le message d'erreur est un identifiant stable
-- ('RATE_LIMIT_EXCEEDED'), jamais un texte figé dans une langue : le
-- texte affiché à l'utilisateur (FR/EN) est traduit côté application
-- (RequestPartnershipButton.tsx), cohérent avec le fonctionnement bilingue
-- du reste de l'interface plutôt qu'avec les autres messages de cette
-- fonction (restés en français, comme dans 0023, pour ne pas modifier une
-- convention établie sur des messages non concernés par ce lot).
create or replace function public.create_partnership_request(
  p_requester_company_id uuid,
  p_target_company_id uuid,
  p_subject text,
  p_message text,
  p_source_type text default 'OTHER',
  p_source_match_id uuid default null,
  p_source_opportunity_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_requester_status text;
  v_target_status text;
  v_target_claimed_at timestamptz;
  v_status text;
  v_request_id uuid;
  v_member_user_id uuid;
  v_match_need_company_id uuid;
  v_match_offer_company_id uuid;
  v_opportunity_company_id uuid;
  v_recent_request_count int;
begin
  if v_user_id is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;

  if p_requester_company_id = p_target_company_id then
    raise exception 'Une entreprise ne peut pas s''envoyer une demande à elle-même.';
  end if;

  -- Permission recalculée depuis auth.uid() + l'appartenance réelle en
  -- base — jamais depuis une supposition sur qui appelle (§7 de la demande).
  if not public.has_company_role(p_requester_company_id, array['owner', 'admin', 'member']) then
    raise exception 'Vous devez être autorisé à agir au nom de cette entreprise.' using errcode = '42501';
  end if;

  -- Entreprise demandeuse : doit être 'active'. Une entreprise fraîchement
  -- créée par son propriétaire démarre 'draft' (comportement inchangé
  -- depuis la Phase 3, `create_company()`) et n'a aujourd'hui AUCUNE voie
  -- en libre-service pour devenir 'active' — seule une action
  -- administrative (ex. publication d'un import, Phase 8) le fait. Cette
  -- phase ne construit PAS ce parcours "mon entreprise devient active" :
  -- il est traité séparément, comme décision produit à part entière. En
  -- attendant, une entreprise 'draft' ne peut donc pas encore envoyer de
  -- demande — cas volontairement bloquant, pas un oubli.
  select status into v_requester_status from public.companies where id = p_requester_company_id;
  if v_requester_status is null then
    raise exception 'Entreprise demandeuse introuvable.';
  end if;
  if v_requester_status != 'active' then
    raise exception 'Votre entreprise doit être active pour envoyer une demande de mise en relation.';
  end if;

  select status, claimed_at into v_target_status, v_target_claimed_at
  from public.companies where id = p_target_company_id;

  if v_target_status is null then
    raise exception 'Entreprise cible introuvable.';
  end if;
  if v_target_status != 'active' then
    raise exception 'Cette entreprise n''est pas disponible pour une mise en relation.';
  end if;

  if p_subject is null or char_length(trim(p_subject)) = 0 then
    raise exception 'Le sujet est obligatoire.';
  end if;
  if p_message is null or char_length(trim(p_message)) = 0 then
    raise exception 'Le message est obligatoire.';
  end if;

  -- Intégrité de la provenance MATCH : le match référencé doit concerner
  -- RÉELLEMENT ces deux entreprises précises, dans un sens ou l'autre —
  -- jamais un match arbitraire d'une autre paire (revue §2). Vérifié via
  -- l'offre et le besoin réellement référencés par le match, pas via les
  -- colonnes dénormalisées matches.company_id/candidate_company_id seules.
  if coalesce(p_source_type, 'OTHER') = 'MATCH' and p_source_match_id is not null then
    select cn.company_id, co.company_id
    into v_match_need_company_id, v_match_offer_company_id
    from public.matches m
    join public.company_needs cn on cn.id = m.need_id
    join public.company_offers co on co.id = m.offer_id
    where m.id = p_source_match_id;

    if v_match_need_company_id is null then
      raise exception 'Match introuvable.';
    end if;
    if not (
      (v_match_need_company_id = p_requester_company_id and v_match_offer_company_id = p_target_company_id)
      or (v_match_need_company_id = p_target_company_id and v_match_offer_company_id = p_requester_company_id)
    ) then
      raise exception 'Ce match ne concerne pas ces deux entreprises.';
    end if;
  end if;

  -- Intégrité de la provenance OPPORTUNITY : pour cette première version,
  -- une demande "issue d'une opportunité" s'adresse TOUJOURS à l'entreprise
  -- qui a publié cette opportunité (revue §3 — pas encore le cas d'une
  -- entreprise candidate suggérée par opportunity_matches, volontairement
  -- laissé pour un futur modèle explicite, non mélangé ici).
  if coalesce(p_source_type, 'OTHER') = 'OPPORTUNITY' and p_source_opportunity_id is not null then
    select company_id into v_opportunity_company_id
    from public.opportunities where id = p_source_opportunity_id;

    if v_opportunity_company_id is null then
      raise exception 'Opportunité introuvable.';
    end if;
    if v_opportunity_company_id != p_target_company_id then
      raise exception 'Cette opportunité n''appartient pas à l''entreprise cible.';
    end if;
  end if;

  if exists (
    select 1 from public.partnership_requests
    where requester_company_id = p_requester_company_id
      and target_company_id = p_target_company_id
      and status in ('pending', 'pending_unclaimed')
  ) then
    raise exception 'Une demande est déjà en cours entre ces deux entreprises.';
  end if;

  -- Anti-rafale (§B de la demande LOT 10C-2) : compte TOUTES les demandes
  -- créées par cette entreprise, quel que soit leur statut actuel, sur la
  -- dernière heure glissante — jamais filtré par actor_user_id, pour que
  -- plusieurs membres de la même entreprise partagent la même limite.
  --
  -- Verrou consultatif transactionnel AVANT le COUNT (revue de sécurité) :
  -- un simple "COUNT puis INSERT" n'est PAS atomique — deux appels
  -- concurrents pour la MÊME entreprise (ex. 19 demandes existantes, deux
  -- requêtes simultanées) pourraient tous les deux lire 19, tous les deux
  -- passer le contrôle, et produire 21 lignes au lieu de 20 au maximum.
  -- pg_advisory_xact_lock() sérialise les appels concurrents portant sur
  -- la MÊME entreprise demandeuse (hashtextextended() réduit l'UUID à un
  -- entier 64 bits utilisable comme clé de verrou) : le second appel
  -- attend que le premier ait validé (ou annulé) sa transaction avant de
  -- faire son propre COUNT, qui reflète alors correctement l'insertion
  -- précédente. Portée : par ENTREPRISE (p_requester_company_id), jamais
  -- par utilisateur — deux appels pour deux entreprises différentes ne se
  -- bloquent jamais mutuellement. Verrou automatiquement relâché à la fin
  -- de la transaction (variante "xact"), aucun déverrouillage manuel requis.
  perform pg_advisory_xact_lock(hashtextextended(p_requester_company_id::text, 0));

  select count(*) into v_recent_request_count
  from public.partnership_requests
  where requester_company_id = p_requester_company_id
    and created_at >= now() - interval '1 hour';

  if v_recent_request_count >= 20 then
    raise exception 'RATE_LIMIT_EXCEEDED';
  end if;

  v_status := case when v_target_claimed_at is null then 'pending_unclaimed' else 'pending' end;

  insert into public.partnership_requests (
    requester_company_id, target_company_id, created_by, status, subject, message,
    source_type, source_match_id, source_opportunity_id
  )
  values (
    p_requester_company_id, p_target_company_id, v_user_id, v_status, trim(p_subject), trim(p_message),
    coalesce(p_source_type, 'OTHER'), p_source_match_id, p_source_opportunity_id
  )
  returning id into v_request_id;

  -- Notifications envoyées seulement à owner/admin (choix explicite de
  -- cette première version, voir revue §6) : un member peut agir sur la
  -- demande (accepter/refuser/retirer selon le camp) mais ne reçoit pas
  -- automatiquement la notification — décision à ne pas changer sans
  -- validation séparée.
  if v_status = 'pending' then
    for v_member_user_id in
      select user_id from public.company_members
      where company_id = p_target_company_id and role in ('owner', 'admin') and status = 'active'
    loop
      perform public.create_notification(
        v_member_user_id,
        'partnership_request_received',
        jsonb_build_object('request_id', v_request_id, 'requester_company_id', p_requester_company_id)
      );
    end loop;
  end if;
  -- pending_unclaimed : aucune notification, aucune sollicitation
  -- automatique d'une adresse récupérée par import (§3/§14 de la demande).

  perform public.log_audit_event(
    'partnership_request_created', 'partnership_request', v_request_id,
    null,
    jsonb_build_object(
      'requester_company_id', p_requester_company_id,
      'target_company_id', p_target_company_id,
      'status', v_status,
      'source_type', coalesce(p_source_type, 'OTHER')
    )
  );

  return json_build_object('id', v_request_id, 'status', v_status);
end;
$$;

comment on function public.create_partnership_request is
  'Point d''entrée UNIQUE pour créer une demande de mise en relation — '
  'voir docs/PARTNERSHIP_REQUESTS.md. Ne journalise jamais subject/message '
  '(§17 de la demande Phase 9). Anti-rafale ajouté en Phase 10C (LOT '
  '10C-2) : 20 demandes maximum par entreprise demandeuse sur une heure '
  'glissante, sérialisé par pg_advisory_xact_lock() pour éviter la course '
  'critique entre COUNT et INSERT sous appels concurrents — voir '
  'docs/SECURITY.md.';

revoke all on function public.create_partnership_request from public;
revoke execute on function public.create_partnership_request from anon;
grant execute on function public.create_partnership_request to authenticated;
