export const Mascot = () => (
  <div className="relative">
    <img src="/mascot.svg" width={120} height={140} alt="Mascote robô da Prometeus" className="drop-shadow-lg" />
    <div className="hidden lg:block absolute -left-36 top-8 glass-surface rounded-2xl px-3 py-2 text-xs text-text-primary shadow-glass animate-pulse whitespace-nowrap pointer-events-none select-none overflow-hidden">
      Vamos crescer? 👋
    </div>
    <div className="hidden lg:block absolute -right-36 top-4 glass-surface rounded-2xl px-3 py-2 text-xs text-text-primary shadow-glass animate-pulse delay-500 whitespace-nowrap pointer-events-none select-none overflow-hidden">
      Potencialize já! ✨
    </div>
  </div>
);
