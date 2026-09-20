// Pas de garde "server-only" ici : ce module doit aussi pouvoir tourner
// en script CLI autonome (scripts/import-companies.ts, via tsx), un
// contexte que "server-only" ne reconnaît pas (il ne détecte que le
// bundler Next.js). Aucune page/Client Component n'importe ce module —
// le risque qu'il visait à prévenir ne s'applique pas ici.
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

/**
 * Lecture CSV via une bibliothèque stable (`csv-parse`) plutôt qu'un
 * découpage manuel par virgule : les fichiers sources contiennent des
 * champs entre guillemets pouvant inclure des virgules et des retours à
 * la ligne (ex. descriptions), qu'un simple `split(',')` casserait. Pas de
 * support XLSX : le CSV est la source canonique retenue pour le pipeline
 * (voir docs/DATA_INVENTORY.md §6 — les classeurs XLSX ne contiennent que
 * des vues dérivées du même contenu).
 */
export function readCsvFile(filePath: string): Record<string, string>[] {
  const content = readFileSync(filePath, "utf8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  }) as Record<string, string>[];
}
