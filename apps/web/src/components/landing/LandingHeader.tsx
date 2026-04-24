import Image from "next/image";
import Link from "next/link";

export type LandingHeaderPage = "home" | "security" | "terms" | "privacy";

type LandingHeaderProps = {
  currentPage: LandingHeaderPage;
};

export function LandingHeader({ currentPage }: LandingHeaderProps) {
  const securityLinkClass =
    currentPage === "security"
      ? "text-[11px] font-bold uppercase tracking-widest text-[#0047FF]"
      : "text-[11px] font-bold uppercase tracking-widest transition-colors hover:text-[#0047FF]";

  return (
    <header className="sticky top-0 z-30 flex w-full items-center justify-between border-b border-black bg-white px-4 py-2">
      <Link href="/" className="inline-flex items-center gap-2">
        <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
        <span className="text-xl font-bold tracking-[-0.04em]">abadge</span>
      </Link>

      <div className="flex items-center gap-3">
        <Link href="/security" className={securityLinkClass}>
          Security
        </Link>
        <a
          href="https://docs.abadge.io"
          className="border border-black bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-black transition-colors hover:border-[#0047FF] hover:bg-zinc-100"
        >
          Docs
        </a>
        <Link
          href="/login"
          className="border border-black bg-black px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-white transition-colors hover:border-[#0047FF] hover:bg-[#0047FF]"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
