import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Fraunces, Rubik_Mono_One, Anton } from "next/font/google";
import "./globals.css";

// Primary UI face — used for body AND display / page titles
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Per-letter fonts for the JED logo (only used in JedLogo)
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
      className={`${jakarta.variable} ${fraunces.variable} ${rubikMono.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
