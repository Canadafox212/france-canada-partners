-- Phase 8 (suite) — correction du libellé anglais d'un sous-secteur.
--
-- La migration 0021 a seedé le sous-secteur "Équipements agricoles et
-- agro-industriels" (sous Agroalimentaire et AgTech) avec un libellé
-- anglais "Agricultural and agri-industrial equipment". Le propriétaire du
-- projet a demandé le libellé "Agricultural and agro-industrial equipment"
-- (voir échange du 2026-09-20 sur le bilinguisme des fiches publiques).
-- 0021 est déjà appliquée sur Supabase et ne doit plus être modifiée
-- (migration immuable, historique figé) : cette correction est donc une
-- migration séparée, portant uniquement sur la colonne concernée.
update public.subindustries
set name_en = 'Agricultural and agro-industrial equipment'
where slug = 'equipements-agricoles-agro-industriels';
