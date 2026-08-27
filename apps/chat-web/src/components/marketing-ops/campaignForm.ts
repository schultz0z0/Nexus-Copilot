import type {
  MarketingOpsCampaign,
  MarketingOpsCampaignEditableFields,
  MarketingOpsCampaignPatch
} from '@/lib/marketingOps/types';

export type CampaignFormValues = MarketingOpsCampaignEditableFields;
export type CampaignFormErrors = Partial<Record<'name' | 'endsOn' | 'secondaryChannels', string>>;

const editableKeys: Array<keyof CampaignFormValues> = [
  'name',
  'objective',
  'referenceType',
  'referenceKey',
  'referenceTitleSnapshot',
  'referenceDocumentId',
  'audience',
  'startsOn',
  'endsOn',
  'primaryChannel',
  'secondaryChannels',
  'briefing',
  'notes'
];

export function campaignToFormValues(campaign: MarketingOpsCampaign): CampaignFormValues {
  return {
    name: campaign.name,
    objective: campaign.objective,
    referenceType: campaign.referenceType,
    referenceKey: campaign.referenceKey,
    referenceTitleSnapshot: campaign.referenceTitleSnapshot,
    referenceDocumentId: campaign.referenceDocumentId,
    audience: campaign.audience,
    startsOn: campaign.startsOn,
    endsOn: campaign.endsOn,
    primaryChannel: campaign.primaryChannel,
    secondaryChannels: [...campaign.secondaryChannels],
    briefing: campaign.briefing,
    notes: campaign.notes
  };
}

export function validateCampaignForm(values: CampaignFormValues): CampaignFormErrors {
  const errors: CampaignFormErrors = {};
  if (!values.name.trim()) errors.name = 'Informe o nome da campanha.';
  if (values.startsOn && values.endsOn && values.endsOn < values.startsOn) {
    errors.endsOn = 'O término não pode ser anterior ao início.';
  }
  if (values.primaryChannel && values.secondaryChannels.includes(values.primaryChannel)) {
    errors.secondaryChannels = 'O canal principal não pode ser repetido nos canais secundários.';
  }
  return errors;
}

function normalized(values: CampaignFormValues): CampaignFormValues {
  return {
    ...values,
    name: values.name.trim(),
    referenceKey: values.referenceKey?.trim() || null,
    referenceTitleSnapshot: values.referenceTitleSnapshot?.trim() || null,
    secondaryChannels: [...values.secondaryChannels]
  };
}

export function campaignPatch(
  campaign: MarketingOpsCampaign,
  values: CampaignFormValues
): MarketingOpsCampaignPatch {
  const baseline = campaignToFormValues(campaign);
  const next = normalized(values);
  const patch: MarketingOpsCampaignPatch = {};
  for (const key of editableKeys) {
    const before = baseline[key];
    const after = next[key];
    if (Array.isArray(before) && Array.isArray(after)) {
      if (before.length !== after.length || before.some((value, index) => value !== after[index])) {
        (patch as Record<string, unknown>)[key] = after;
      }
    } else if (before !== after) {
      (patch as Record<string, unknown>)[key] = after;
    }
  }
  return patch;
}
