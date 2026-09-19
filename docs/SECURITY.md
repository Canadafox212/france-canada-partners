# Sécurité

Vue d'ensemble des principes de sécurité de la plateforme. Le détail produit/architecture est dans `PROJECT_SPEC.md` §9. Les obligations de confidentialité (RGPD/Loi 25) sont documentées séparément dans `docs/PRIVACY.md`.

## Secrets et variables d'environnement

- Aucun secret n'est jamais écrit en dur dans le code.
- `.env.local` (valeurs réelles) n'est jamais versionné — voir `.gitignore`.
- `.env.example` documente les variables attendues, sans valeurs réelles.
- La clé Supabase "secrète" (`SUPABASE_SECRET_KEY`) donne un accès complet à la base (elle contourne la sécurité par ligne) : elle ne doit exister que côté serveur, jamais dans du code exécuté par le navigateur, jamais préfixée par `NEXT_PUBLIC_`.
- Toute variable d'environnement utilisée par l'application passe par `src/lib/env.ts`, qui vérifie sa présence et son format avant utilisation (voir `docs/ARCHITECTURE.md`).

## Authentification (à partir de la Phase 3)

- Gérée par Supabase Auth (mots de passe hashés, jamais stockés en clair).
- Base technique déjà en place : `src/lib/supabase/client.ts` (navigateur) et `server.ts` (serveur).

## Row Level Security (en place depuis la Phase 2)

Chaque table créée en Phase 2 (`profiles`, `companies`, `company_locations`, `company_members`, taxonomie, offres/besoins, marchés, langues, certifications, sources) a sa politique de sécurité au niveau ligne, écrite dans la même migration que la table — pas ajoutée après coup. Deux fonctions réutilisables portent la logique : `is_platform_admin()` (administration globale) et `has_company_role(company_id, roles[])` (droits dans une entreprise précise). Cette protection est appliquée par PostgreSQL lui-même — elle reste active même en cas d'erreur dans le code applicatif. Chaque nouvelle table des phases suivantes suit la même règle : politique RLS écrite en même temps que la table.

## Validation des entrées

Toute donnée fournie par un utilisateur (formulaire, import) doit être validée par un schéma Zod avant d'être utilisée — voir `src/validations/`.

## Ce qui n'est pas encore fait (attendu, pas un oubli)

- Limitation de fréquence (anti-abus) sur les formulaires publics : à ajouter avec les premiers formulaires (Phase 3).
- Journal d'audit (`audit_logs`) : ajouté au schéma avec le back-office (Phase 9), pas avant — inutile tant qu'il n'y a pas d'actions admin à tracer.
- Rafraîchissement de session dans `src/proxy.ts` : ajouté avec la connexion (Phase 3).
- Vérification du comportement réel des politiques RLS face à un vrai utilisateur connecté : la validation de Phase 2 a été faite avec un moteur de test qui contourne la RLS (voir `docs/DATABASE.md`) — à revérifier une fois un vrai projet Supabase connecté.
