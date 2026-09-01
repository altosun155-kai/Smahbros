// error.tsx — Next's file-convention error boundary. Must be a client
// component (Next's own requirement). Without this, an uncaught render
// error in any page fell through to Next's default error UI (a dev overlay
// locally; a blank/generic failure in prod) instead of a branded fallback.
// Deliberately a fallback UI only -- no error-type distinction, no reporting
// integration; out of scope here.
'use client';

import Link from 'next/link';
import Card from './components/Card';
import Button from './components/Button';
import PageContainer, { PageHeader } from './components/PageContainer';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageContainer>
      <PageHeader>
        <h1>Something went wrong</h1>
      </PageHeader>
      <Card>
        <p>An unexpected error occurred while loading this page.</p>
        <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
          <Button variant="primary" onClick={() => reset()}>
            Try again
          </Button>
          <Link href="/">
            <Button variant="outline">Back to home</Button>
          </Link>
        </div>
      </Card>
    </PageContainer>
  );
}
