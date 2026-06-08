import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { JellyfishLogo } from './JellyfishBackground';

const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/features', label: 'Features' },
    { to: '/install', label: 'Install' },
];

const Navigation = () => {
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <motion.nav
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3 }}
            className="fixed top-0 left-0 right-0 z-50 px-6 py-5"
        >
            <div className="max-w-7xl mx-auto flex justify-between items-center">
                <Link to="/" className="flex items-center gap-3 group">
                    <div className="relative">
                        <JellyfishLogo size={36} className="group-hover:opacity-80 transition-opacity" />
                        <div className="absolute inset-0 bg-sky-400/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <span className="text-2xl font-bold bg-gradient-to-r from-sky-100 to-sky-400 bg-clip-text text-transparent">
                        Pecifics
                    </span>
                </Link>

                {/* Desktop Nav */}
                <div className="hidden md:flex items-center gap-8">
                    {navLinks.map((link) => (
                        <Link key={link.to} to={link.to}>
                            <motion.span
                                whileHover={{ scale: 1.1 }}
                                className={`transition-colors cursor-pointer ${
                                    location.pathname === link.to
                                        ? 'text-white font-semibold'
                                        : 'text-sky-200 hover:text-white'
                                }`}
                            >
                                {link.label}
                                {location.pathname === link.to && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="h-0.5 bg-sky-400 rounded-full mt-0.5"
                                    />
                                )}
                            </motion.span>
                        </Link>
                    ))}
                </div>

                <Link to="/download">
                    <motion.button
                        whileHover={{ scale: 1.05, backgroundColor: "rgba(56, 189, 248, 0.3)" }}
                        whileTap={{ scale: 0.95 }}
                        className="hidden md:block bg-sky-500/20 hover:bg-sky-500/30 backdrop-blur-sm border border-sky-400/30 text-white px-6 py-2 rounded-full transition-all font-medium"
                    >
                        Download Now
                    </motion.button>
                </Link>

                {/* Mobile Menu Toggle */}
                <button
                    className="md:hidden text-white p-2"
                    onClick={() => setMobileOpen(!mobileOpen)}
                >
                    {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </div>

            {/* Mobile Nav */}
            <AnimatePresence>
                {mobileOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="md:hidden mt-4 bg-[#020b18]/90 backdrop-blur-xl rounded-2xl border border-sky-500/20 overflow-hidden"
                    >
                        <div className="p-4 flex flex-col gap-3">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.to}
                                    to={link.to}
                                    onClick={() => setMobileOpen(false)}
                                    className={`px-4 py-2 rounded-lg transition-colors ${
                                        location.pathname === link.to
                                            ? 'bg-sky-500/20 text-white'
                                            : 'text-sky-200 hover:text-white hover:bg-white/5'
                                    }`}
                                >
                                    {link.label}
                                </Link>
                            ))}
                            <Link
                                to="/download"
                                onClick={() => setMobileOpen(false)}
                                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-sky-400 text-white rounded-lg text-center font-medium"
                            >
                                Download Now
                            </Link>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.nav>
    );
};

export default Navigation;
