/**
 * Transforme un texte libre en identifiant d'URL propre (slug).
 * Utilisé notamment pour /entreprise/[slug] à partir du nom d'une entreprise.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
