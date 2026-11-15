// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useLocalDay } from './useLocalDay';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('advances local date at midnight with one timer and cleans it up', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 59));
  const { result, unmount } = renderHook(useLocalDay);
  expect(result.current.getDate()).toBe(29);
  act(() => {
    vi.advanceTimersByTime(1100);
  });
  expect(result.current.getDate()).toBe(30);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it('reconciles the local date on focus after a clock change or resume', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 29, 12));
  const { result } = renderHook(useLocalDay);
  vi.setSystemTime(new Date(2026, 9, 31, 12));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(result.current.getDate()).toBe(31);
  expect(vi.getTimerCount()).toBe(1);
});
