import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Script from "next/script";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";
import { LOCAL_STORAGE_KEYS } from "@/lib/storage-contract";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlyReq Image - AI Image Generator",
  description: "FlyReq Image AI image generation workspace",
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.png',
    apple: '/icon-192.png',
  },
  manifest: '/api/flyreq/manifest.webmanifest',
  other: {
    'theme-color': '#1a1a2e',
  },
};

/**
 * 构建应用根布局，并在 React 水合前恢复主题、语言和宽屏偏好。
 * @param children 当前路由需要渲染的页面内容。
 * @returns 包含启动脚本、全局 Provider 与页面内容的 HTML 文档。
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = window.localStorage.getItem(${JSON.stringify(LOCAL_STORAGE_KEYS.theme)});
                  if (theme === 'dark' || theme === 'light') {
                    document.documentElement.setAttribute('data-theme', theme);
                  } else {
                    document.documentElement.removeAttribute('data-theme');
                  }
                } catch {
                  document.documentElement.removeAttribute('data-theme');
                }
              })();
            `,
          }}
        />
        <Script
          id="locale-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var parts = window.location.pathname.split('/').filter(Boolean);
                  var urlLocale = parts[0] === 'zh' || parts[0] === 'en' ? parts[0] : '';
                  var stored = window.localStorage.getItem(${JSON.stringify(LOCAL_STORAGE_KEYS.locale)});
                  var locale = urlLocale || (stored === 'zh' || stored === 'en' ? stored : 'en');
                  if (urlLocale) window.localStorage.setItem(${JSON.stringify(LOCAL_STORAGE_KEYS.locale)}, urlLocale);
                  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
                } catch {
                  document.documentElement.lang = 'en';
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className="antialiased min-h-screen bg-background text-foreground"
      >
        <div id="app-boot-loader" className="fixed inset-0 z-[99999] flex items-center justify-center bg-background" suppressHydrationWarning>
          <svg className="animate-spin h-8 w-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <TooltipProvider>
          <ServiceWorkerManager />
          <ErrorBoundary>
            <main>
              {children}
            </main>
          </ErrorBoundary>
        </TooltipProvider>
      </body>
    </html>
  );
}
