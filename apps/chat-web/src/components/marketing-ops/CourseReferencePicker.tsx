import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import type { MarketingOpsReferenceType } from '@/lib/marketingOps/types';

interface CourseReferenceValue {
  referenceKey: string | null;
  referenceTitleSnapshot: string | null;
  referenceDocumentId: string | null;
}

interface CourseReferencePickerProps extends CourseReferenceValue {
  referenceType: MarketingOpsReferenceType | null;
  client: MarketingOpsClient;
  disabled: boolean;
  debounceMs: number;
  onChange: (value: CourseReferenceValue) => void;
}

function correlationId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { correlationId?: unknown }).correlationId;
  return typeof value === 'string' ? value : null;
}

export function CourseReferencePicker({
  referenceType,
  referenceKey,
  referenceTitleSnapshot,
  referenceDocumentId,
  client,
  disabled,
  debounceMs,
  onChange
}: CourseReferencePickerProps) {
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const normalized = searchValue.trim();
    const timeout = window.setTimeout(() => setDebouncedSearch(normalized), debounceMs);
    return () => window.clearTimeout(timeout);
  }, [debounceMs, searchValue]);

  const referencesQuery = useQuery({
    queryKey: marketingOpsKeys.courseReferences(debouncedSearch, 10),
    queryFn: () => client.searchCourseReferences(debouncedSearch, 10),
    enabled: referenceType === 'course' && debouncedSearch.length >= 2
  });

  if (referenceType === 'course') {
    const queryCorrelation = correlationId(referencesQuery.error);
    return (
      <div className="space-y-3 md:col-span-2">
        <div className="space-y-1.5">
          <Label htmlFor="campaign-course-search">Buscar curso oficial</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              id="campaign-course-search"
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              disabled={disabled}
              maxLength={200}
              className="h-11 rounded-[8px] bg-white/80 pl-9"
            />
            {referencesQuery.isFetching ? (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-muted" />
            ) : null}
          </div>
        </div>

        {referenceTitleSnapshot && referenceKey ? (
          <div className="flex items-start gap-2 border-l-2 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{referenceTitleSnapshot}</p>
              <p className="text-xs text-emerald-800">{referenceKey}</p>
            </div>
          </div>
        ) : null}

        {referencesQuery.isError ? (
          <Alert variant="destructive" className="rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
            <AlertTitle>Catálogo oficial indisponível</AlertTitle>
            <AlertDescription>
              A pesquisa não foi concluída.
              {queryCorrelation ? <span className="ml-1 text-xs">Correlação: {queryCorrelation}</span> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {referencesQuery.data?.data.length ? (
          <div className="glass-surface shadow-glass divide-y divide-white/50 overflow-hidden rounded-[8px] border-white/60">
            {referencesQuery.data.data.map((reference) => (
              <Button
                key={`${reference.documentId}:${reference.referenceKey}`}
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  onChange({
                    referenceKey: reference.referenceKey,
                    referenceTitleSnapshot: reference.title,
                    referenceDocumentId: reference.documentId
                  });
                  setSearchValue('');
                  setDebouncedSearch('');
                }}
                className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 text-left"
              >
                <span>
                  <span className="block font-medium">{reference.title}</span>
                  <span className="mt-0.5 block text-xs text-text-muted">{reference.referenceKey}</span>
                </span>
              </Button>
            ))}
          </div>
        ) : null}

        <input type="hidden" value={referenceDocumentId ?? ''} readOnly />
      </div>
    );
  }

  if (referenceType === 'product' || referenceType === 'initiative') {
    return (
      <>
        <div className="space-y-1.5">
          <Label htmlFor="campaign-reference-key">Identificador da referência</Label>
          <Input
            id="campaign-reference-key"
            value={referenceKey ?? ''}
            onChange={(event) => onChange({
              referenceKey: event.target.value || null,
              referenceTitleSnapshot,
              referenceDocumentId: null
            })}
            disabled={disabled}
            maxLength={200}
            className="h-11 rounded-[8px] bg-white/80"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="campaign-reference-title">Título da referência</Label>
          <Input
            id="campaign-reference-title"
            value={referenceTitleSnapshot ?? ''}
            onChange={(event) => onChange({
              referenceKey,
              referenceTitleSnapshot: event.target.value || null,
              referenceDocumentId: null
            })}
            disabled={disabled}
            maxLength={300}
            className="h-11 rounded-[8px] bg-white/80"
          />
        </div>
      </>
    );
  }

  return null;
}
