// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import App from './App';
import { useApp } from './store';

afterEach(cleanup);
it('shows a desktop-only message instead of fictional fixtures in a browser', async () => {
  useApp.setState({snapshot:null,loading:true,error:null});
  render(<App/>);
  expect(await screen.findByText('Match data is available in the desktop app.')).toBeTruthy();
  expect(screen.queryByText('DEMO DATA')).toBeNull();
  expect(screen.queryByRole('button', {name:/Match details:/})).toBeNull();
});
