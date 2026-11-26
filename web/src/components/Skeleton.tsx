import { cn } from "@/lib/cn";

interface SkeletonProps {
  className?: string;
}

/** Bloco cinza pulsante usado enquanto os dados carregam. */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn("bg-surface animate-pulse rounded-md", className)} />;
}

/** Grade de 3 colunas com quadrados de carregamento. */
export function GradeSkeleton({ quantidade = 9 }: { quantidade?: number }) {
  return (
    <div className="grid grid-cols-3 gap-1" role="status" aria-label="Carregando posts">
      {Array.from({ length: quantidade }, (_, i) => (
        <Skeleton key={i} className="aspect-square rounded-none" />
      ))}
    </div>
  );
}
