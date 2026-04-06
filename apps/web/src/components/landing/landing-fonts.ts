import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";

export const landingSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-landing-sans",
});

export const landingMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-landing-mono",
});

export const landingCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-landing-condensed",
});

/** Root wrapper class for marketing pages (IBM Plex + selection styles). */
export const landingRootClassName = `${landingSans.variable} ${landingMono.variable} min-h-screen bg-white text-black selection:bg-[#0047FF] selection:text-white [font-family:var(--font-landing-sans)]`;
