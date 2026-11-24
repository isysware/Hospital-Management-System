import React from 'react';
import { Construction } from 'lucide-react';

/** Honest placeholder — never fabricated data. pharmacy.md §20 lists exactly which build step wires this screen up. */
export const ComingSoonPage: React.FC<{ title: string; step: string }> = ({ title, step }) => (
  <div className="p-10 flex flex-col items-center justify-center text-center gap-3 max-w-md mx-auto mt-16">
    <div className="h-12 w-12 rounded-full bg-[#effaf5] border border-[#c2e7db] flex items-center justify-center">
      <Construction className="h-6 w-6 text-[#129b70]" />
    </div>
    <h2 className="text-base font-bold text-[#111827]">{title}</h2>
    <p className="text-xs text-[#52665e]">{step}</p>
  </div>
);
