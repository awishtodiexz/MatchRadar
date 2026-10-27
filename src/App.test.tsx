// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
afterEach(cleanup);
describe('widget', () => {
  it('labels browser demo data and opens match details', async () => {
    render(<App/>);
    expect(await screen.findByText('DEMO DATA')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: /Match details: Arsenal versus Chelsea/}));
    expect(screen.getByText('Match details')).toBeTruthy();
    expect(screen.getByText(/Event details aren’t available/)).toBeTruthy();
  });
  it('allows filtering to followed teams', async () => {
    render(<App/>);
    await screen.findByText('DEMO DATA');
    fireEvent.click(screen.getByRole('button', {name:'Settings'}));
    fireEvent.click(screen.getByLabelText(/Following only/));
    fireEvent.click(screen.getByRole('button', {name:'Back'}));
    await waitFor(() => expect(screen.queryByText('Brighton & Hove Albion')).toBeNull());
  });
});
