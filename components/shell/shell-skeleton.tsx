/** Lo que se ve mientras se valida la sesión (parte estática del layout). */
export function ShellSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-h-dvh">
      <div className="hidden w-64 shrink-0 border-r border-line bg-surface md:block" />
      <div className="flex flex-1 flex-col">
        <div className="h-14 border-b border-line bg-surface" />
      </div>
    </div>
  );
}
