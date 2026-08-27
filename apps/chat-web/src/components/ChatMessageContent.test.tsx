// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ChatMessageContent } from './ChatMessageContent';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

afterEach(() => cleanup());

describe('ChatMessageContent Marketing Ops links', () => {
  it('uses SPA navigation for a valid internal deep link', () => {
    render(
      <MemoryRouter>
        <ChatMessageContent
          role="assistant"
          content={`[Abrir campanha](/marketing-ops/campaigns/${campaignId})`}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Abrir campanha' });
    expect(link.getAttribute('href')).toBe(`/marketing-ops/campaigns/${campaignId}`);
    expect(link.getAttribute('target')).toBeNull();
  });

  it('does not render a malformed Marketing Ops route as a clickable link', () => {
    render(
      <MemoryRouter>
        <ChatMessageContent
          role="assistant"
          content="[Abrir campanha](/marketing-ops/campaigns/not-a-uuid)"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Abrir campanha')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Abrir campanha' })).toBeNull();
  });
});
