import { motion } from 'framer-motion';
import { ArrowDown, Sparkles } from 'lucide-react';

const Hero = () => {
  const headline = 'Your AI-Powered Soundtrack';

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-20">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[20%] left-[10%] w-[400px] h-[400px] bg-primary/30 rounded-full blur-[120px] mix-blend-screen animate-[blob_7s_infinite]" />
        <div className="absolute top-[40%] right-[10%] w-[350px] h-[350px] bg-secondary/30 rounded-full blur-[120px] mix-blend-screen animate-[blob_7s_infinite_2s]" />
        <div className="absolute -bottom-[20%] left-[40%] w-[500px] h-[500px] bg-accent/20 rounded-full blur-[150px] mix-blend-screen animate-[blob_7s_infinite_4s]" />

        {/* Subtle Noise Overlay */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
      </div>

      <div className="relative z-10 text-center px-6 max-w-4xl mx-auto flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md mb-8"
        >
          <Sparkles className="w-4 h-4 text-secondary" />
          <span className="text-sm font-medium text-gray-300">
            Next-gen Music Experience
          </span>
        </motion.div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6">
          {headline.split('').map((char, index) => (
            <motion.span
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.5,
                delay: index * 0.05,
                type: 'spring',
                damping: 12,
                stiffness: 200,
              }}
              className="inline-block bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-500"
            >
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="text-lg md:text-xl text-gray-400 mb-12 max-w-2xl mx-auto leading-relaxed"
        >
          Let our advanced AI analyze your emotions and curate the perfect
          playlist. Music that feels exactly how you do right now.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.8, duration: 0.8 }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <button
            onClick={() => {
              document
                .getElementById('detector-section')
                ?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="group relative px-8 py-4 bg-white text-black font-bold rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_40px_rgba(255,255,255,0.4)]"
          >
            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-gray-100 to-white group-hover:from-white group-hover:to-gray-100 transition-colors"></div>
            <span className="relative flex items-center gap-2">
              Start Scanning{' '}
              <ArrowDown className="w-5 h-5 group-hover:translate-y-1 transition-transform" />
            </span>
          </button>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.5, duration: 1 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-50"
      >
        <span className="text-xs uppercase tracking-widest text-gray-500">
          Scroll to discover
        </span>
        <div className="w-[1px] h-12 bg-gradient-to-b from-gray-500 to-transparent"></div>
      </motion.div>
    </section>
  );
};

export default Hero;
