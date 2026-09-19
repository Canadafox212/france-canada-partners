# France-Canada Partners

Plateforme B2B de mise en relation entre entreprises françaises et canadiennes — priorité France ↔ Québec au lancement.

Le document de référence du projet (vision, architecture, modèle de données, feuille de route) est **`PROJECT_SPEC.md`** à la racine de ce dépôt. Toute question sur _pourquoi_ le projet est construit ainsi trouve sa réponse là-bas.

## Démarrer en local

Prérequis : Node.js 26+, npm.

```bash
npm install
cp .env.example .env.local   # puis renseigner vos identifiants Supabase
npm run dev
```

Le site est accessible sur [http://localhost:3000](http://localhost:3000) (redirection automatique vers `/fr`).

> Sans identifiants Supabase valides dans `.env.local`, le site démarre et s'affiche normalement (aucune fonctionnalité de cette phase n'appelle encore Supabase). Les identifiants ne seront nécessaires qu'à partir de la Phase 2/3.

## Commandes disponibles

| Commande            | Effet                                     |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Démarre le serveur de développement       |
| `npm run build`     | Compile la version de production          |
| `npm run start`     | Démarre la version compilée               |
| `npm run lint`      | Vérifie le style et les erreurs courantes |
| `npm run typecheck` | Vérifie les types TypeScript              |
| `npm test`          | Lance les tests automatisés               |
| `npm run format`    | Reformate le code automatiquement         |

## Documentation

- `PROJECT_SPEC.md` — document de référence (vision, architecture, données, feuille de route)
- `CHANGELOG.md` — historique des changements
- `docs/ARCHITECTURE.md` — organisation du code
- `docs/DATABASE.md` — état du modèle de données
- `docs/SECURITY.md` — principes de sécurité
- `docs/PRIVACY.md` — brouillon technique de conformité RGPD/Loi 25
- `data/README.md` — rôle des données brutes de sourcing (non versionnées)

## Stack technique

Next.js 16 (TypeScript, App Router) · Tailwind CSS 4 · Supabase (PostgreSQL, région Canada Central) · next-intl (FR/EN) · Zod · Vitest.
