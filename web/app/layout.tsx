import type { Metadata } from 'next';
import '../public/css/reset.css';
import '../public/css/style.css';
import './styles/tokens.css';
import './styles/tailwind.css';
import AuthGate from './components/AuthGate';

export const metadata: Metadata = {
  title: 'Smash Bracket',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
