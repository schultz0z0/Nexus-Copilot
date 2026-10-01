import { BrandLogo } from "@/components/BrandLogo";

export const OrbLoader = () => (
  <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-md">
    <div className="relative flex h-64 w-64 items-center justify-center">
      <div className="absolute h-48 w-48 rounded-full bg-primary/10 blur-2xl" />
      <div aria-hidden="true" className="absolute h-48 w-48 animate-spin rounded-full border border-border border-t-brand-accent [animation-duration:3s]" />
      <BrandLogo symbol className="h-48 w-48" />
    </div>
    <p className="mt-8 text-lg font-medium text-text-secondary">Preparando seu espaço de trabalho</p>
  </div>
);
