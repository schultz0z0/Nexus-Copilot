import { FormEvent } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type {
  MarketingOpsCampaignChannel,
  MarketingOpsReferenceType
} from '@/lib/marketingOps/types';
import type { CampaignFormErrors, CampaignFormValues } from './campaignForm';
import { CourseReferencePicker } from './CourseReferencePicker';

const referenceTypes: Array<{ value: MarketingOpsReferenceType; label: string }> = [
  { value: 'course', label: 'Curso' },
  { value: 'product', label: 'Produto' },
  { value: 'initiative', label: 'Iniciativa' }
];

const channels: Array<{ value: MarketingOpsCampaignChannel; label: string }> = [
  { value: 'email', label: 'E-mail' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website', label: 'Site' },
  { value: 'paid_media', label: 'Mídia paga' },
  { value: 'events', label: 'Eventos' },
  { value: 'press', label: 'Imprensa' },
  { value: 'other', label: 'Outro' }
];

const selectClass = 'h-11 w-full rounded-[8px] border border-input bg-white/80 px-3 text-sm text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-50';

interface CampaignFieldsFormProps {
  values: CampaignFormValues;
  errors: CampaignFormErrors;
  disabled: boolean;
  client: MarketingOpsClient;
  referenceDebounceMs: number;
  onChange: (patch: Partial<CampaignFormValues>) => void;
  onSubmit: () => void;
}

export function CampaignFieldsForm({
  values,
  errors,
  disabled,
  client,
  referenceDebounceMs,
  onChange,
  onSubmit
}: CampaignFieldsFormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form id="campaign-workspace-form" onSubmit={submit} className="space-y-0">
      <fieldset disabled={disabled}>
        <section aria-labelledby="campaign-essentials" className="border-b border-white/50 bg-white/50 px-4 py-6 backdrop-blur-xl sm:px-6 md:px-8">
          <div className="mx-auto max-w-5xl">
            <h2 id="campaign-essentials" className="text-lg font-semibold text-text-primary">Essenciais</h2>
            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="campaign-name">Nome</Label>
                <Input
                  id="campaign-name"
                  value={values.name}
                  onChange={(event) => onChange({ name: event.target.value })}
                  maxLength={200}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'campaign-name-error' : undefined}
                  className="h-11 rounded-[8px] bg-white/80"
                />
                {errors.name ? <p id="campaign-name-error" className="text-sm text-red-700">{errors.name}</p> : null}
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="campaign-objective">Objetivo</Label>
                <Textarea
                  id="campaign-objective"
                  value={values.objective ?? ''}
                  onChange={(event) => onChange({ objective: event.target.value || null })}
                  maxLength={2000}
                  rows={4}
                  className="rounded-[8px] bg-white/80"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="campaign-reference-type">Tipo de referência</Label>
                <select
                  id="campaign-reference-type"
                  className={selectClass}
                  value={values.referenceType ?? ''}
                  onChange={(event) => onChange({
                    referenceType: (event.target.value || null) as MarketingOpsReferenceType | null,
                    referenceKey: null,
                    referenceTitleSnapshot: null,
                    referenceDocumentId: null
                  })}
                >
                  <option value="">Sem referência</option>
                  {referenceTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>

              <CourseReferencePicker
                referenceType={values.referenceType}
                referenceKey={values.referenceKey}
                referenceTitleSnapshot={values.referenceTitleSnapshot}
                referenceDocumentId={values.referenceDocumentId}
                client={client}
                disabled={disabled}
                debounceMs={referenceDebounceMs}
                onChange={onChange}
              />

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="campaign-audience">Público</Label>
                <Textarea
                  id="campaign-audience"
                  value={values.audience ?? ''}
                  onChange={(event) => onChange({ audience: event.target.value || null })}
                  maxLength={2000}
                  rows={3}
                  className="rounded-[8px] bg-white/80"
                />
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="campaign-planning" className="border-b border-white/40 bg-white/25 px-4 py-6 backdrop-blur-lg sm:px-6 md:px-8">
          <div className="mx-auto max-w-5xl">
            <h2 id="campaign-planning" className="text-lg font-semibold text-text-primary">Planejamento</h2>
            <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-starts-on">Início</Label>
                <Input
                  id="campaign-starts-on"
                  type="date"
                  value={values.startsOn ?? ''}
                  onChange={(event) => onChange({ startsOn: event.target.value || null })}
                  className="h-11 rounded-[8px] bg-white/80"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="campaign-ends-on">Término</Label>
                <Input
                  id="campaign-ends-on"
                  type="date"
                  value={values.endsOn ?? ''}
                  onChange={(event) => onChange({ endsOn: event.target.value || null })}
                  aria-invalid={Boolean(errors.endsOn)}
                  aria-describedby={errors.endsOn ? 'campaign-ends-on-error' : undefined}
                  className="h-11 rounded-[8px] bg-white/80"
                />
                {errors.endsOn ? <p id="campaign-ends-on-error" className="text-sm text-red-700">{errors.endsOn}</p> : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="campaign-primary-channel">Canal principal</Label>
                <select
                  id="campaign-primary-channel"
                  className={selectClass}
                  value={values.primaryChannel ?? ''}
                  onChange={(event) => {
                    const primaryChannel = (event.target.value || null) as MarketingOpsCampaignChannel | null;
                    onChange({
                      primaryChannel,
                      secondaryChannels: values.secondaryChannels.filter((channel) => channel !== primaryChannel)
                    });
                  }}
                >
                  <option value="">Não definido</option>
                  {channels.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">Canais secundários</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {channels.map((channel) => {
                    const checked = values.secondaryChannels.includes(channel.value);
                    const isPrimary = values.primaryChannel === channel.value;
                    return (
                      <div key={channel.value} className="flex min-h-11 items-center gap-2">
                        <Checkbox
                          id={`campaign-secondary-${channel.value}`}
                          checked={checked}
                          disabled={disabled || isPrimary}
                          onCheckedChange={(nextChecked) => onChange({
                            secondaryChannels: nextChecked
                              ? [...values.secondaryChannels, channel.value]
                              : values.secondaryChannels.filter((value) => value !== channel.value)
                          })}
                        />
                        <Label htmlFor={`campaign-secondary-${channel.value}`} className="font-normal">{channel.label}</Label>
                      </div>
                    );
                  })}
                </div>
                {errors.secondaryChannels ? <p className="text-sm text-red-700">{errors.secondaryChannels}</p> : null}
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="campaign-briefing" className="border-b border-white/50 bg-white/50 px-4 py-6 backdrop-blur-xl sm:px-6 md:px-8">
          <div className="mx-auto max-w-5xl">
            <h2 id="campaign-briefing" className="text-lg font-semibold text-text-primary">Briefing</h2>
            <div className="mt-5 grid grid-cols-1 gap-5">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-briefing-field">Briefing</Label>
                <Textarea
                  id="campaign-briefing-field"
                  value={values.briefing ?? ''}
                  onChange={(event) => onChange({ briefing: event.target.value || null })}
                  maxLength={20000}
                  rows={8}
                  className="rounded-[8px] bg-white/80"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="campaign-notes">Notas</Label>
                <Textarea
                  id="campaign-notes"
                  value={values.notes ?? ''}
                  onChange={(event) => onChange({ notes: event.target.value || null })}
                  maxLength={10000}
                  rows={5}
                  className="rounded-[8px] bg-white/80"
                />
              </div>
            </div>
          </div>
        </section>
      </fieldset>
    </form>
  );
}
