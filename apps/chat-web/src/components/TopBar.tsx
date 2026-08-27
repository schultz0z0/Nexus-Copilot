import { Button } from "@/components/ui/button";
import { Megaphone, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar";
import { useState } from "react";

export const TopBar = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 md:left-20 right-0 h-16 flex items-center justify-between px-4 md:px-8 z-40 bg-white/50 backdrop-blur-md border-b border-white/20 md:bg-transparent md:border-none md:backdrop-filter-none">
      <div className="flex items-center gap-2">
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden mr-2" aria-label="Abrir menu">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-20 bg-transparent border-none">
            <SheetTitle className="sr-only">Menu de Navegação</SheetTitle>
            <Sidebar isMobile={true} onMobileClose={() => setIsMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>
        
        <div className="flex items-center gap-2 glass-surface rounded-full px-4 py-2 shadow-glass">
          <img src="/icon-robo.svg" alt="Ícone" className="h-5 w-auto" />
          <span className="text-sm font-medium">Nexus AI</span>
        </div>
      </div>

      

      <Button className="chat-send-button text-white rounded-xl px-6 shadow-glass hover:scale-105 transition-transform">
        <Megaphone className="w-4 h-4 mr-2" />
        Marketing ENS
      </Button>
    </header>
  );
};

const Sparkles = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 3v18M3 12h18M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </svg>
);
