import { Button } from '@/components/ui/button';
import type { AnalyticsProvider } from '@/lib/marketingOps/analytics';

export function AnalyticsProviderSwitch({ value, onChange }: { value: AnalyticsProvider; onChange: (value: AnalyticsProvider) => void }) {
  return <div role="group" aria-label="Fonte de análise" className="inline-flex max-w-full rounded-lg bg-muted p-1">{(['ga4', 'clarity'] as const).map(provider => <Button key={provider} variant="ghost" className={`min-h-11 text-sm ${value === provider ? 'bg-background text-brand-accent shadow-sm' : 'text-muted-foreground'}`} aria-pressed={value === provider} onClick={() => onChange(provider)}>{provider === 'ga4' ? 'Google Analytics' : 'Clarity'}</Button>)}</div>;
}
