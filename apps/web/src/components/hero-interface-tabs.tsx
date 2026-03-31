"use client";

import { useState } from "react";

type HeroInterfaceExample = {
  name: string;
  body: string;
};

type HeroInterfaceTabsProps = {
  examples: HeroInterfaceExample[];
};

export function HeroInterfaceTabs({ examples }: HeroInterfaceTabsProps) {
  const [activeTab, setActiveTab] = useState(examples[0]?.name ?? "CLI");
  const activeExample = examples.find((example) => example.name === activeTab) ?? examples[0];

  return (
    <div className="w-full max-w-[38rem] overflow-hidden border border-black bg-white shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="border-b border-zinc-100 bg-[#F6F6F4] px-3 pt-2.5">
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0">
            {examples.map((example) => {
              const isActive = example.name === activeTab;

              return (
                <button
                  key={example.name}
                  type="button"
                  onClick={() => setActiveTab(example.name)}
                  className={`min-w-[5.5rem] rounded-t-[8px] border border-b-0 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.28em] transition-colors ${
                    isActive
                      ? "border-zinc-300 bg-white text-black"
                      : "border-transparent bg-[#ECECE8] text-zinc-500 hover:bg-[#F1F1EE] hover:text-zinc-700"
                  }`}
                >
                  {example.name}
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 gap-1.5 pb-3 pr-1">
            <span className="h-2 w-2 rounded-full bg-zinc-200" />
            <span className="h-2 w-2 rounded-full bg-zinc-200" />
            <span className="h-2 w-2 rounded-full bg-zinc-200" />
          </div>
        </div>
      </div>

      <div className="min-h-[25rem] border-t border-zinc-200 bg-white p-5 md:min-h-[26rem] md:p-6">
        <pre className="h-full overflow-x-auto whitespace-pre-wrap break-words [font-family:var(--font-landing-mono)] text-[11px] leading-[1.7] text-black md:text-[12px]">
          {activeExample?.body}
        </pre>
      </div>
    </div>
  );
}
