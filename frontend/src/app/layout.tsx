import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import '@/styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Linker Pro - Multi-Platform E-Commerce Dashboard',
  description:
    'Manage products, inventory, orders, and pricing across all your e-commerce platforms from one dashboard.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#2563EB" />
      </head>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1E293B',
              color: '#E2E8F0',
              border: '1px solid #334155',
              borderRadius: '0.75rem',
              fontSize: '0.875rem',
            },
            success: {
              iconTheme: {
                primary: '#059669',
                secondary: '#E2E8F0',
              },
            },
            error: {
              iconTheme: {
                primary: '#EF4444',
                secondary: '#E2E8F0',
              },
            },
          }}
        />
      </body>
    </html>
  );
}
