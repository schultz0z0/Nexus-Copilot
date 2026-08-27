import { motion } from "framer-motion";

export const OrbLoader = () => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md">
      <div className="relative flex items-center justify-center w-64 h-64">
        {/* Core - Núcleo pulsante */}
        <motion.div
          className="absolute w-16 h-16 rounded-full bg-brand-primary/20 blur-md"
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        
        <motion.div
          className="absolute w-12 h-12 rounded-full bg-brand-primary shadow-[0_0_30px_rgba(var(--brand-primary),0.6)]"
          animate={{
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* Inner Ring - Anel Interno */}
        <motion.div
          className="absolute w-32 h-32 rounded-full border border-brand-primary/30 border-t-brand-primary/80"
          animate={{ rotate: 360 }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Middle Ring - Anel Médio (Rotação oposta) */}
        <motion.div
          className="absolute w-48 h-48 rounded-full border border-brand-secondary/20 border-b-brand-secondary/60"
          animate={{ rotate: -360 }}
          transition={{
            duration: 5,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Outer Ring - Anel Externo (Lento e sutil) */}
        <motion.div
          className="absolute w-64 h-64 rounded-full border border-white/10 border-l-white/40"
          animate={{ rotate: 360 }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Orbiting Particles - Partículas orbitando */}
        <motion.div
          className="absolute w-56 h-56"
          animate={{ rotate: 360 }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          <div className="w-2 h-2 rounded-full bg-brand-accent absolute top-0 left-1/2 -translate-x-1/2 shadow-[0_0_10px_currentColor]" />
        </motion.div>
      </div>

      {/* Loading Text */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-12 flex flex-col items-center gap-2"
      >
        <h3 className="text-xl font-medium tracking-[0.2em] text-foreground/80 uppercase">
          Inicializando Sistema
        </h3>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-brand-primary"
              animate={{
                opacity: [0.3, 1, 0.3],
                scale: [1, 1.2, 1],
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                delay: i * 0.2,
              }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
};
