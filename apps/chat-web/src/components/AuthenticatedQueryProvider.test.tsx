// @vitest-environment jsdom
import { useQueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useReducer } from 'react';
import { AuthenticatedQueryProvider } from './AuthenticatedQueryProvider';

afterEach(cleanup);

function CacheProbe() {
  const client = useQueryClient();
  const [, refresh] = useReducer((value) => value + 1, 0);
  const cached = client.getQueryData<string>(['private-capabilities']) ?? 'empty';
  return <>
    <span>{cached}</span>
    <button onClick={() => { client.setQueryData(['private-capabilities'], 'member-only'); refresh(); }}>Store</button>
  </>;
}

describe('AuthenticatedQueryProvider', () => {
  it('uses an isolated query cache whenever the authenticated identity changes', () => {
    const view = render(<AuthenticatedQueryProvider identity="member-user"><CacheProbe /></AuthenticatedQueryProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Store' }));
    expect(screen.getByText('member-only')).toBeTruthy();

    view.rerender(<AuthenticatedQueryProvider identity="admin-user"><CacheProbe /></AuthenticatedQueryProvider>);

    expect(screen.getByText('empty')).toBeTruthy();
    expect(screen.queryByText('member-only')).toBeNull();
  });
});
