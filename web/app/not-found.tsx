// not-found.tsx — Next's file-convention 404. Without this, any bad URL
// under the Next.js app fell through to Next's generic default 404 page
// instead of matching the rest of the site. Renders standalone, outside
// AuthGate's guard (Next always renders not-found.tsx on its own, per the
// file-convention contract), so it works whether or not the visitor is
// logged in.
import Link from 'next/link';
import Card from './components/Card';
import Button from './components/Button';
import PageContainer, { PageHeader } from './components/PageContainer';

export default function NotFound() {
  return (
    <PageContainer>
      <PageHeader>
        <h1>Page not found</h1>
      </PageHeader>
      <Card>
        <p>There&rsquo;s nothing at this address.</p>
        <Link href="/">
          <Button variant="primary">Back to home</Button>
        </Link>
      </Card>
    </PageContainer>
  );
}
