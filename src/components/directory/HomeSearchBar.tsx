import { inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

/**
 * Barre de recherche de la page d'accueil (§32 du cahier des charges
 * Phase 7) : simple formulaire GET redirigeant vers l'annuaire avec le
 * paramètre `q`, sans JavaScript ni IA. `actionPath` est déjà résolu avec
 * son préfixe de langue par la page appelante (next-intl `getPathname`).
 */
export function HomeSearchBar({
  actionPath,
  placeholder,
  buttonLabel,
}: {
  actionPath: string;
  placeholder: string;
  buttonLabel: string;
}) {
  return (
    <form action={actionPath} className="flex w-full max-w-xl gap-2">
      <label htmlFor="home-search-q" className="sr-only">
        {placeholder}
      </label>
      <input
        id="home-search-q"
        name="q"
        type="search"
        placeholder={placeholder}
        className={`${inputClasses} flex-1`}
      />
      <SubmitButton variant="primary">{buttonLabel}</SubmitButton>
    </form>
  );
}
