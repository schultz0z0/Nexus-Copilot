// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LeadResults } from '@/lib/marketingOps/leads';
import { LeadCharts } from './LeadResultsView';

// Supply layout dimensions absent in jsdom while keeping the actual Recharts SVG.
vi.mock('recharts', async importOriginal => {
  const original = await importOriginal<typeof import('recharts')>();
  return { ...original, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 600, height: 240 }) };
});
afterEach(cleanup);
it('keeps decorative charts out of the tab order while exposing their table alternatives', () => {
  const results = { weekly: [{ week: '2026-09-28', leads: 2 }], channels: [{ channel: 'google_ads', leads: 2 }] } as LeadResults;
  const { container, getByText } = render(<LeadCharts results={results} />);
  expect(container.querySelectorAll('.recharts-pie').length).toBeGreaterThan(0);
  expect(container.querySelector('[aria-hidden="true"] [tabindex="0"]')).toBeNull();
  expect(getByText('Ver valores por canal')).toBeTruthy();
  expect(getByText('Ver valores por semana')).toBeTruthy();
});
