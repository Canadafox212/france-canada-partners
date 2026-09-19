// Le paquet "server-only" lève une erreur dès qu'il est chargé en dehors du
// bundler Next.js (qui pose une condition spéciale pour son bundle serveur).
// Les tests d'intégration tournent sous Node/Vitest, jamais sous Next.js :
// sans ce remplacement, tout module marqué "server-only" (le moteur de
// matching, par ex.) serait impossible à importer directement dans un test,
// alors qu'il s'exécute bien côté serveur en production.
export {};
