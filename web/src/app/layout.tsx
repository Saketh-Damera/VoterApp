import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces, Rubik_Mono_One, Anton } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Logo letter fonts — each letter uses a different display face.
const fraunces = Fraunces({
  variable: "--font-logo-j",
  subsets: ["latin"],
  weight: ["900"],
  style: ["italic"],
});
const rubikMono = Rubik_Mono_One({
  variable: "--font-logo-e",
  subsets: ["latin"],
  weight: ["400"],
});
const anton = Anton({
  variable: "--font-logo-d",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "JED — Voter Intelligence Notebook",
  description:
    "Capture, identify, prioritize, and follow up with voters. Built for first-time local candidates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${rubikMono.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
