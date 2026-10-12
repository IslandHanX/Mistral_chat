import type { ReactNode } from 'react';

export const metadata = {
  title: 'Mistral Chat',
  description: 'A small streaming chat on Mistral AI, with model fallback and rate limiting.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
