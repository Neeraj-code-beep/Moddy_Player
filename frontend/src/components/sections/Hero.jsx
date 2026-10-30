import { motion as Motion } from 'framer-motion';
import { ArrowDown, AudioLines } from 'lucide-react';

const Hero = () => (
  <section id="home" aria-labelledby="home-title" className="relative flex min-h-[min(780px,92svh)] items-center justify-center overflow-hidden px-5 pb-20 pt-28 sm:px-8">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-1/4 h-[22rem] w-[22rem] -translate-x-1/2 rounded-full bg-amber-200/10 blur-[100px] sm:h-[34rem] sm:w-[34rem]" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background to-transparent" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
    </div>

    <Motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center"
    >
      <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-amber-100/15 bg-white/[0.04] px-4 py-2 text-xs font-medium tracking-wide text-amber-100/90 sm:text-sm">
        <AudioLines aria-hidden="true" className="h-4 w-4" />
        A soundtrack that meets the moment
      </div>
      <h1 id="home-title" className="max-w-4xl text-balance text-5xl font-semibold leading-[1.04] tracking-[-0.055em] text-white sm:text-6xl md:text-7xl lg:text-[5.5rem]">
        Find the feeling in your next song.
      </h1>
      <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-white/60 sm:text-lg sm:leading-8">
        Choose a mood and listening intention. Moddy shapes a thoughtful set of tracks from the music available in its catalog.
      </p>
      <a
        href="#discover"
        className="mt-9 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-amber-100 px-6 py-3 text-sm font-semibold text-[#201b13] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-100"
      >
        Explore your mood
        <ArrowDown aria-hidden="true" className="h-4 w-4" />
      </a>
      <div aria-hidden="true" className="mt-14 flex h-16 items-center gap-1.5 opacity-50">
        {[14, 27, 19, 35, 22, 42, 18, 31, 13, 25, 38, 17, 29, 12, 22, 36, 18, 28, 14, 33, 20, 12, 26, 17, 35, 21, 13, 30, 18].map((height, index) => (
          <span key={index} className="w-1 rounded-full bg-gradient-to-t from-amber-800 to-amber-100/80" style={{ height }} />
        ))}
      </div>
    </Motion.div>
  </section>
);

export default Hero;
