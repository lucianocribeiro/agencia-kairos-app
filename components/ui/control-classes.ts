/** Estilos compartidos de Input y Select. El borde de foco usa `accent-text` (en claro, AA sobre blanco). */
export const controlClasses =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-text placeholder:text-muted/70 " +
  "transition hover:border-muted focus-visible:border-accent-text " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-invalid:border-danger";
