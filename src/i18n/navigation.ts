import { createNavigation } from "next-intl/navigation";
import { routing } from "@/i18n/routing";

/**
 * Link/redirect/usePathname/useRouter conscients de la langue active :
 * à utiliser à la place des équivalents next/navigation dans tout le code applicatif.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
