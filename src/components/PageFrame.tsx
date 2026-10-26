import type { ReactNode } from 'react';
import { usePageScroll } from '../lib/usePageScroll';
import { SectionBoundary } from './SectionBoundary';

export function PageFrame({ page, children }: { page: string; children: ReactNode }) {
  usePageScroll(page);
  return <SectionBoundary resetKey={page}>{children}</SectionBoundary>;
}
