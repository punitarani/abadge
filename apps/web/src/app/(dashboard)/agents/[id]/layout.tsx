import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent details",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
