import Image from "next/image";
import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="bg-white p-8">
      <div className="mx-auto flex max-w-[96rem] flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="order-2 max-w-xs md:order-1">
          <div className="mb-1 inline-flex items-center gap-2">
            <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
            <span className="text-xl font-bold tracking-[-0.04em]">abadge</span>
          </div>
          <span className="mb-4 block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">
            Credential control plane for AI agents
          </span>
        </div>

        <div className="order-1 flex items-center gap-6 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap md:order-2">
          <Link href="/blog" className="transition-colors hover:text-[#0047FF]">
            Blog
          </Link>
          <a
            href="https://github.com/punitarani/abadge"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[#0047FF]"
          >
            GitHub
          </a>
          <a
            href="https://docs.abadge.io"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[#0047FF]"
          >
            Docs
          </a>
        </div>
      </div>
    </footer>
  );
}
