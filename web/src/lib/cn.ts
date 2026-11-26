import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes condicionais e resolve conflitos do Tailwind. */
export function cn(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas));
}
