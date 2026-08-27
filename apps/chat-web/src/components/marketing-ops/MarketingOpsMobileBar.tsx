import type { ReactNode } from 'react';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

interface MarketingOpsMobileBarProps {
  label: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function MarketingOpsMobileBar({ label, icon, action }: MarketingOpsMobileBarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-white/40 bg-white/70 px-4 shadow-sm backdrop-blur-xl md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Abrir menu"
            title="Menu"
            className="glass-surface shadow-glass h-10 w-10 rounded-full"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="z-[70] w-20 border-none bg-transparent p-0 shadow-none [&>button]:-right-12 [&>button]:top-3 [&>button]:rounded-full [&>button]:bg-white/90 [&>button]:p-2 [&>button]:opacity-100 [&>button]:shadow-md"
        >
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <SheetDescription className="sr-only">Acesse as áreas principais do aplicativo.</SheetDescription>
          <Sidebar isMobile onMobileClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex max-w-[calc(100%-7rem)] items-center gap-2 rounded-full bg-white/70 px-3 py-2 text-sm font-semibold text-text-primary shadow-sm">
        {icon}
        <span className="truncate">{label}</span>
      </div>

      {action ?? <span className="h-10 w-10" aria-hidden="true" />}
    </div>
  );
}
