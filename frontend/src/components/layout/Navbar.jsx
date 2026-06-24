import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Play, Menu, X } from 'lucide-react';
import { cn } from '../../lib/utils';

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = ['Discover', 'Library', 'Premium'];

  return (
    <>
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-in-out px-6 py-4 flex items-center justify-between',
          scrolled ? 'glass-panel border-b border-white/10' : 'bg-transparent'
        )}
      >
        <div className="flex items-center gap-2 cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-secondary flex items-center justify-center group-hover:scale-110 transition-transform">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Moddy
          </span>
        </div>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase()}`}
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors relative group"
            >
              {link}
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-secondary transition-all group-hover:w-full"></span>
            </a>
          ))}
        </div>

        <div className="hidden md:block">
          <button className="px-5 py-2 rounded-full bg-white text-black font-semibold text-sm hover:scale-105 active:scale-95 transition-all shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:shadow-[0_0_25px_rgba(255,255,255,0.5)]">
            Log In
          </button>
        </div>

        <div className="md:hidden">
          <button onClick={() => setMobileMenuOpen(true)} className="text-white p-2">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </motion.nav>

      {/* Mobile Menu Drawer */}
      <motion.div
        className={cn(
          'fixed inset-0 z-[60] glass-panel flex flex-col p-6',
          mobileMenuOpen ? 'pointer-events-auto' : 'pointer-events-none'
        )}
        initial={{ opacity: 0, x: '100%' }}
        animate={{ opacity: mobileMenuOpen ? 1 : 0, x: mobileMenuOpen ? '0%' : '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      >
        <div className="flex justify-end">
          <button onClick={() => setMobileMenuOpen(false)} className="text-white p-2">
            <X className="w-8 h-8" />
          </button>
        </div>
        <div className="flex flex-col gap-8 mt-12 items-center text-2xl font-semibold">
          {navLinks.map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase()}`}
              className="text-gray-300 hover:text-white transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              {link}
            </a>
          ))}
          <button className="mt-8 px-8 py-3 rounded-full bg-gradient-to-r from-primary to-secondary text-white font-bold w-full max-w-xs shadow-lg">
            Log In
          </button>
        </div>
      </motion.div>
    </>
  );
};

export default Navbar;
