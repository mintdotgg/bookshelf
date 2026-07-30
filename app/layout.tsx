import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/inter";
import "./globals.css";
import { siteConfig } from "./site-config";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const { title, description } = siteConfig;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: siteConfig.applicationName,
    category: "music",
    openGraph: {
      title,
      description,
      type: "website",
      siteName: siteConfig.applicationName,
      images: [
        {
          url: `${origin}/side-one-social.png`,
          width: 1200,
          height: 630,
          alt: siteConfig.socialImageAlt,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/side-one-social.png`],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f2f0eb",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
