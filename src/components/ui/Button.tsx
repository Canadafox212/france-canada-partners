import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

type Variant = "primary" | "secondary";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200",
  secondary:
    "border border-slate-300 text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800",
};

const baseClasses =
  "inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-medium transition-colors";

type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: Variant;
};

/**
 * Bouton d'action principal du site, toujours conscient de la langue active
 * (utilise le Link de next-intl plutôt que next/link).
 */
export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: LinkButtonProps) {
  const classes = [baseClasses, variantClasses[variant], className]
    .filter(Boolean)
    .join(" ");

  return <Link {...props} className={classes} />;
}

type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  isLoading?: boolean;
};

export function SubmitButton({
  variant = "primary",
  className,
  isLoading,
  disabled,
  children,
  type = "submit",
  ...props
}: SubmitButtonProps) {
  const classes = [baseClasses, variantClasses[variant], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={`${classes} disabled:cursor-not-allowed disabled:opacity-60`}
      disabled={disabled || isLoading}
      {...props}
    >
      {children}
    </button>
  );
}
