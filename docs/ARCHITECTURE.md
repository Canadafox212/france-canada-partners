# Architecture technique

Référence complète des décisions produit : voir `PROJECT_SPEC.md` à la racine. Ce document se concentre sur l'organisation concrète du code.

## Stack

- **Next.js 16** (App Router, TypeScript, React 19)
- **Tailwind CSS 4** (configuration "CSS-first" dans `src/app/globals.css`, pas de `tailwind.config.js`)
- **Supabase** (PostgreSQL, authentification, stockage) — région `ca-central-1`
- **next-intl** pour le bilingue FR/EN
- **Zod** pour la validation des entrées
- **Vitest** pour les tests unitaires

## Organisation des dossiers

```
src/
  app/
    [locale]/        toutes les pages du site (routage par langue)
      layout.tsx      layout racine réel (html/body), fournit les traductions
      page.tsx         page d'accueil
    globals.css        styles globaux + configuration Tailwind
    favicon.ico
  components/
    ui/                composants d'interface génériques et réutilisables
  lib/
    env.ts             lecture + validation des variables d'environnement
    utils.ts            fonctions utilitaires pures (ex. slugify)
    supabase/
      client.ts          client Supabase pour le navigateur
      server.ts           client Supabase pour le code serveur
  validations/         schémas Zod partagés entre formulaires
  i18n/
    routing.ts          langues supportées, langue par défaut
    navigation.ts        Link/redirect/useRouter conscients de la langue
    request.ts            chargement des traductions par requête
  proxy.ts              routage de langue (exécuté avant chaque page)
messages/
  fr.json, en.json      textes d'interface traduits
tests/
  unit/                tests unitaires (Vitest)
supabase/
  migrations/           migrations SQL (schéma + Row Level Security, voir docs/DATABASE.md)
data/
  raw/                  données brutes de sourcing, non versionnées (voir data/README.md)
docs/                   cette documentation
```

## Pourquoi `src/proxy.ts` et pas `middleware.ts` ?

Next.js 16 a renommé la convention `middleware.ts` en `proxy.ts` (le nom prêtait à confusion avec les middlewares Express.js). Le fichier joue le même rôle : il s'exécute avant chaque page pour rediriger vers la bonne langue (`/` → `/fr`).

## Pourquoi `next/root-params` pour la langue ?

Depuis Next.js 16.3, la langue (premier segment de route `[locale]`) peut être lue n'importe où côté serveur via `import { locale } from "next/root-params"`, sans avoir à la faire passer manuellement de composant en composant. C'est ce que `src/i18n/request.ts` et `src/app/[locale]/layout.tsx` utilisent.

## Authentification (statut à cette phase)

`src/lib/supabase/client.ts` et `server.ts` fournissent la connexion technique à Supabase. Côté base de données, l'identité repose sur `auth.users` (géré par Supabase) + une table `profiles` en relation 1:1 pour les données applicatives — voir `docs/DATABASE.md` et `PROJECT_SPEC.md` §4.1. **Aucune page de connexion/inscription n'existe encore côté interface** : ce sera fait en Phase 3. Le rafraîchissement automatique de session dans `proxy.ts` sera ajouté à ce moment-là aussi (inutile tant qu'il n'y a pas de session à rafraîchir).

## Conventions de nommage

- Fichiers de composants React : `PascalCase.tsx` (ex. `Button.tsx`)
- Fichiers utilitaires/logique : `camelCase.ts` (ex. `env.ts`, `utils.ts`)
- Dossiers : `kebab-case` ou un seul mot en minuscules
- Clés de traduction : regroupées par page/section (ex. `HomePage.title`)
- Tables et colonnes de base de données : `snake_case` (voir `PROJECT_SPEC.md` §4)

## Gestion des erreurs

Les fonctions qui dépendent de configuration externe (ex. `getPublicEnv`/`getServerEnv` dans `src/lib/env.ts`) valident leurs entrées avec Zod et lancent une erreur explicite en français plutôt que de échouer silencieusement ou avec un message technique obscur.
