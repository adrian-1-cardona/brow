import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brow Studio — Your live brow guide",
  description:
    "A private, live eyebrow mirror. Find your shape, protect what stays, and compare a carefully reviewed preview.",
  applicationName: "Brow Studio",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Brow Studio",
  },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f4ef",
  viewportFit: "cover",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
