import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { AudioLines, Menu, X } from 'lucide-react';

const links = [
  { label: 'Home', href: '#home' },
  { label: 'Discover', href: '#discover' },
];

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuTriggerRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 16);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const menuTrigger = menuTriggerRef.current;
    const menu = document.getElementById('mobile-navigation');
    const getFocusable = () => menu?.querySelectorAll('a[href], button:not([disabled])') || [];
    getFocusable()[0]?.focus();
    const handleMenuKey = (event) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleMenuKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleMenuKey);
      document.body.style.overflow = '';
      menuTrigger?.focus();
    };
  }, [mobileMenuOpen]);

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <>
      <header className={`fixed inset-x-0 top-0 z-40 border-b transition-colors duration-200 ${scrolled ? 'border-white/10 bg-[#10100f]/90 backdrop-blur-xl' : 'border-transparent bg-transparent'}`}>
        <nav aria-label="Main navigation" className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#home" className="inline-flex items-center gap-2.5 rounded-md text-white" aria-label="Moddy Player home">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-[#201b13]">
              <AudioLines aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold tracking-tight">moddy<span className="text-amber-100">.</span></span>
          </a>

          <div className="hidden items-center gap-8 md:flex">
            {links.map((link) => <a key={link.href} href={link.href} className="rounded py-2 text-sm text-white/65 transition hover:text-white">{link.label}</a>)}
          </div>

          <button
            type="button"
            ref={menuTriggerRef}
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/10 md:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
        </nav>
      </header>

      <AnimatePresence>
        {mobileMenuOpen && (
          <Motion.div
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#10100f]/98 px-6 py-5 backdrop-blur-xl md:hidden"
          >
            <div className="flex justify-end">
              <button type="button" onClick={closeMenu} aria-label="Close navigation menu" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <nav aria-label="Mobile navigation" className="mt-12 flex flex-col items-center gap-5">
              {links.map((link) => (
                <a key={link.href} href={link.href} onClick={closeMenu} className="rounded-md px-4 py-3 text-2xl font-medium text-white/80 hover:text-amber-100">
                  {link.label}
                </a>
              ))}
            </nav>
          </Motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default Navbar;
