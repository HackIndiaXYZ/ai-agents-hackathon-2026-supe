import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
    Download, Monitor, Apple, Laptop, CheckCircle, 
    Cpu, HardDrive, Wifi, ArrowRight, Shield, Zap
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageBackground } from '../components/JellyfishBackground';

type Platform = 'windows' | 'mac' | 'linux';

const platforms: { id: Platform; name: string; icon: React.ReactNode; available: boolean; desc: string }[] = [
    { id: 'windows', name: 'Windows', icon: <Monitor className="w-8 h-8" />, available: true, desc: 'Windows 10/11 (64-bit)' },
    { id: 'mac', name: 'macOS', icon: <Apple className="w-8 h-8" />, available: false, desc: 'Coming Soon' },
    { id: 'linux', name: 'Linux', icon: <Laptop className="w-8 h-8" />, available: false, desc: 'Coming Soon' },
];

const systemReqs = [
    { icon: <Monitor className="w-5 h-5" />, label: "OS", value: "Windows 10 / 11 (64-bit)" },
    { icon: <Cpu className="w-5 h-5" />, label: "Processor", value: "Intel i5 / AMD Ryzen 5 or better" },
    { icon: <HardDrive className="w-5 h-5" />, label: "Storage", value: "2 GB free space" },
    { icon: <Wifi className="w-5 h-5" />, label: "Network", value: "Internet for AI features" },
];

const whatsIncluded = [
    "Pecifics Desktop App (Electron)",
    "Browser Automation Module (Playwright)",
    "Office COM Automation (Word, PPT, Excel, OneNote, Publisher)",
    "File & System Manager",
    "Screen Agent with Vision AI",
    "Safety Guard System",
    "Global Hotkey (Ctrl+Shift+J)",
    "Always-on-Top Mode",
];

const DownloadPage = () => {
    const [selectedPlatform, setSelectedPlatform] = useState<Platform>('windows');

    return (
        <div className="relative w-full min-h-screen overflow-hidden font-sans">
            <PageBackground showJellyfish={true} isHome={false} />

            {/* Hero */}
            <div className="relative z-20 pt-32 pb-16 px-6">
                <div className="max-w-4xl mx-auto text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                    >
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
                            className="inline-flex p-4 rounded-2xl bg-gradient-to-r from-blue-600 to-sky-400 mb-8"
                        >
                            <Download className="w-10 h-10 text-white" />
                        </motion.div>
                        <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 tracking-tight">
                            Download{' '}
                            <span className="bg-gradient-to-r from-sky-300 to-blue-500 bg-clip-text text-transparent">
                                Pecifics
                            </span>
                        </h1>
                        <p className="text-xl text-sky-100/80 max-w-2xl mx-auto mb-4">
                            Free, open-source, and ready to supercharge your desktop in minutes.
                        </p>
                        <p className="text-sky-300 text-sm font-medium">Version 1.0.0 &middot; Released March 2026</p>
                    </motion.div>
                </div>
            </div>

            {/* Platform Selector */}
            <div className="relative z-20 py-8 px-6">
                <div className="max-w-3xl mx-auto">
                    <div className="grid grid-cols-3 gap-4 mb-8">
                        {platforms.map((p) => (
                            <motion.button
                                key={p.id}
                                whileHover={{ scale: p.available ? 1.02 : 1 }}
                                whileTap={{ scale: p.available ? 0.98 : 1 }}
                                onClick={() => p.available && setSelectedPlatform(p.id)}
                                className={`relative p-6 rounded-2xl border transition-all text-center ${
                                    selectedPlatform === p.id
                                        ? 'bg-sky-500/10 border-sky-400/40 shadow-[0_0_30px_rgba(56,189,248,0.15)]'
                                        : p.available
                                            ? 'bg-white/5 border-blue-500/20 hover:border-blue-400/30'
                                            : 'bg-white/[0.02] border-blue-500/10 opacity-50 cursor-not-allowed'
                                }`}
                            >
                                <div className={`flex justify-center mb-3 ${selectedPlatform === p.id ? 'text-sky-400' : 'text-blue-300'}`}>
                                    {p.icon}
                                </div>
                                <div className="text-white font-semibold">{p.name}</div>
                                <div className="text-sky-200/50 text-xs mt-1">{p.desc}</div>
                                {selectedPlatform === p.id && (
                                    <motion.div
                                        layoutId="platformHighlight"
                                        className="absolute inset-0 border-2 border-sky-400/40 rounded-2xl"
                                    />
                                )}
                            </motion.button>
                        ))}
                    </div>

                    {/* Download Button */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="text-center"
                    >
                        <motion.a
                            href="https://github.com/zainab-06-p/Pecifics/releases/latest/download/Pecifics-LAM.exe"
                            whileHover={{ scale: 1.05, boxShadow: "0 0 40px rgba(56, 189, 248, 0.5)" }}
                            whileTap={{ scale: 0.95 }}
                            className="inline-flex items-center gap-3 px-10 py-5 bg-gradient-to-r from-blue-600 to-sky-400 text-white font-bold text-lg rounded-full shadow-xl transition-all"
                        >
                            <Download className="w-6 h-6" />
                            Download for Windows
                            <span className="text-white/60 text-sm font-normal">(~85 MB)</span>
                        </motion.a>
                        <p className="text-sky-200/40 text-xs mt-4">
                            Portable .exe — no installer needed. Just download, extract, and run.
                        </p>
                    </motion.div>
                </div>
            </div>

            {/* What's Included */}
            <div className="relative z-20 py-16 px-6">
                <div className="max-w-4xl mx-auto">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-2xl font-bold text-white mb-8 text-center"
                    >
                        What's Included
                    </motion.h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                        {whatsIncluded.map((item, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, x: -20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.05 }}
                                className="flex items-center gap-3 bg-white/5 rounded-lg px-4 py-3"
                            >
                                <CheckCircle className="w-4 h-4 text-sky-400 flex-shrink-0" />
                                <span className="text-sky-100 text-sm">{item}</span>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* System Requirements */}
            <div className="relative z-20 py-16 px-6">
                <div className="max-w-3xl mx-auto">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-2xl font-bold text-white mb-8 text-center"
                    >
                        System Requirements
                    </motion.h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {systemReqs.map((req, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 15 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className="flex items-center gap-4 bg-white/5 border border-blue-500/15 rounded-xl p-5"
                            >
                                <div className="text-sky-400">{req.icon}</div>
                                <div>
                                    <div className="text-white font-semibold text-sm">{req.label}</div>
                                    <div className="text-sky-200/50 text-xs">{req.value}</div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Trust Badges */}
            <div className="relative z-20 py-16 px-6">
                <div className="max-w-4xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                            { icon: <Shield className="w-8 h-8" />, title: "Safe & Secure", desc: "Open source code you can audit. No telemetry, no tracking." },
                            { icon: <Zap className="w-8 h-8" />, title: "Lightweight", desc: "Minimal resource usage. Runs in the background without slowing you down." },
                            { icon: <Download className="w-8 h-8" />, title: "Auto Updates", desc: "Stay up to date with the latest features and improvements." },
                        ].map((badge, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.15 }}
                                className="text-center bg-white/5 backdrop-blur-sm border border-blue-500/15 rounded-2xl p-6"
                            >
                                <div className="text-sky-400 flex justify-center mb-3">{badge.icon}</div>
                                <div className="text-white font-bold mb-2">{badge.title}</div>
                                <div className="text-sky-200/50 text-sm">{badge.desc}</div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* After Download */}
            <div className="relative z-20 py-16 px-6">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="max-w-3xl mx-auto text-center bg-gradient-to-r from-blue-900/40 to-sky-900/30 backdrop-blur-xl border border-blue-500/20 rounded-3xl p-10"
                >
                    <h2 className="text-2xl font-bold text-white mb-4">After Downloading?</h2>
                    <p className="text-sky-200/70 mb-6">
                        Follow our step-by-step installation guide to get everything configured and running in minutes.
                    </p>
                    <Link to="/install">
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="px-8 py-4 bg-white/10 backdrop-blur-sm border border-white/20 text-white font-semibold rounded-full hover:bg-white/20 transition-all inline-flex items-center gap-2"
                        >
                            View Installation Guide
                            <ArrowRight className="w-4 h-4" />
                        </motion.button>
                    </Link>
                </motion.div>
            </div>
        </div>
    );
};

export default DownloadPage;
