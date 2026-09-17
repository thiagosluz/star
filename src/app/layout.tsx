import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'EventFlow',
    template: '%s · EventFlow',
  },
  description:
    'Plataforma de gestão de eventos acadêmicos, corporativos e comunitários: submissões, avaliação por pares, gamificação e certificados.',
  applicationName: 'EventFlow',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
