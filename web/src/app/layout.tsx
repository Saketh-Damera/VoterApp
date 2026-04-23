import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Instrument_Serif, Fraunces, Rubik_Mono_One, Anton } from "next/font/google";
import "./globals.css";

// Primary UI face
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Editorial display face for hero page titles
const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
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
      className={`${jakarta.variable} ${instrumentSerif.variable} ${fraunces.variable} ${rubikMono.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
