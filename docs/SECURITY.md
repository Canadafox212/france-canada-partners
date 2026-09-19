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

## Row Level Security (à partir de la Phase 2)

Chaque table contenant des données appartenant à un utilisateur ou une entreprise précise aura une politique de sécurité au niveau ligne, appliquée par PostgreSQL lui-même — pas seulement par le code de l'application. C'est une protection qui reste active même en cas d'erreur dans le code applicatif.

## Validation des entrées

Toute donnée fournie par un utilisateur (formulaire, import) doit être validée par un schéma Zod avant d'être utilisée — voir `src/validations/`.

## Ce qui n'est pas encore fait (attendu, pas un oubli)

- Limitation de fréquence (anti-abus) sur les formulaires publics : à ajouter avec les premiers formulaires (Phase 3).
- Journal d'audit (`audit_logs`) : créé avec le reste du schéma en Phase 2, utilisé à partir du back-office (Phase 9).
- Rafraîchissement de session dans `src/proxy.ts` : ajouté avec la connexion (Phase 3).
