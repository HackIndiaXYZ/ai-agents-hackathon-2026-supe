import { useEffect } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { Sparkles, Monitor, Zap, ArrowRight, Globe, FolderOpen, Settings, Brain } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageBackground } from '../components/JellyfishBackground';

const Home = () => {
    const textControls = useAnimation();
    const buttonControls = useAnimation();

    useEffect(() => {
        textControls.start((i: number) => ({
            opacity: 1,
            y: 0,
            transition: { delay: i * 0.06 + 0.8, duration: 1, ease: [0.2, 0.65, 0.3, 0.9] }
        }));
        buttonControls.start({
            opacity: 1,
            y: 0,
            transition: { delay: 1.8, duration: 1 }
        });
    }, [textControls, buttonControls]);

    const headline = "Pecifics AI";
    const highlights = [
        { icon: <Globe className="w-5 h-5" />, text: "Browser Automation" },
        { icon: <FolderOpen className="w-5 h-5" />, text: "File Management" },
        { icon: <Monitor className="w-5 h-5" />, text: "Office Suite Control" },
        { icon: <Settings className="w-5 h-5" />, text: "System Settings" },
        { icon: <Brain className="w-5 h-5" />, text: "Vision-Based AI" },
        { icon: <Zap className="w-5 h-5" />, text: "Multi-Task Execution" },
    ];

    return (
        <div className="relative w-full min-h-screen overflow-hidden font-sans">
            <PageBackground showJellyfish={true} isHome={true} />

            {/* Hero Section */}
            <div className="relative min-h-screen flex items-center justify-center px-4">
                <div className="relative z-20 text-center max-w-5xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3, duration: 0.8 }}
                        className="inline-flex items-center gap-2 bg-sky-500/10 border border-sky-400/20 backdrop-blur-sm px-4 py-2 rounded-full mb-8"
                    >
                        <Sparkles className="w-4 h-4 text-sky-400" />
                        <span className="text-sky-200 text-sm font-medium">AI-Powered Desktop Assistant</span>
                    </motion.div>

                    <h1 className="text-6xl md:text-8xl lg:text-9xl font-bold tracking-tighter text-white mb-6">
                        {headline.split("").map((char: string, i: number) => (
                            <motion.span
                                key={i}
                                custom={i}
                                initial={{ opacity: 0, y: 50 }}
                                animate={textControls}
                                className="inline-block"
                            >
                                {char === " " ? "\u00A0" : char}
                            </motion.span>
                        ))}
                    </h1>

                    <motion.p
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 1.2, duration: 1 }}
                        className="text-xl md:text-2xl text-sky-100 mb-12 max-w-3xl mx-auto leading-relaxed font-light"
                    >
                        Control your entire PC with natural language. Browse the web, manage files, 
                        automate Office apps, and adjust system settings — all through a single AI assistant.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={buttonControls}
                        className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16"
                    >
                        <Link to="/download">
                            <motion.button
                                whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(56, 189, 248, 0.5)" }}
                                whileTap={{ scale: 0.95 }}
                                className="group relative px-8 py-4 bg-gradient-to-r from-blue-600 to-sky-400 text-white font-semibold rounded-full shadow-lg hover:shadow-2xl transition-all flex items-center gap-2"
                            >
                                <Monitor className="w-5 h-5" />
                                Download for Free
                                <motion.span
                                    className="inline-block"
                                    animate={{ x: [0, 5, 0] }}
                                    transition={{ duration: 1.5, repeat: Infinity }}
                                >
                                    <ArrowRight className="w-4 h-4" />
                                </motion.span>
                            </motion.button>
                        </Link>
                        <Link to="/features">
                            <motion.button
                                whileHover={{ scale: 1.05, backgroundColor: "rgba(255, 255, 255, 0.2)" }}
                                whileTap={{ scale: 0.95 }}
                                className="px-8 py-4 bg-white/10 backdrop-blur-sm border border-white/20 text-white font-semibold rounded-full hover:bg-white/20 transition-all flex items-center gap-2"
                            >
                                <Sparkles className="w-5 h-5" />
                                See What It Can Do
                            </motion.button>
                        </Link>
                    </motion.div>

                    {/* Quick Feature Highlights */}
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 2.2, duration: 1 }}
                        className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl mx-auto"
                    >
                        {highlights.map((item, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 2.4 + i * 0.1, duration: 0.6 }}
                                whileHover={{ scale: 1.05, borderColor: "rgba(56, 189, 248, 0.4)" }}
                                className="flex items-center gap-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-3"
                            >
                                <div className="text-sky-400">{item.icon}</div>
                                <span className="text-sky-100 text-sm font-medium">{item.text}</span>
                            </motion.div>
                        ))}
                    </motion.div>
                </div>
            </div>

            {/* Social Proof / Stats Section */}
            <div className="relative z-20 py-20 px-6">
                <div className="max-w-6xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 40 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8 }}
                        className="text-center mb-16"
                    >
                        <h2 className="text-3xl md:text-5xl font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] mb-4">
                            Your PC, Supercharged
                        </h2>
                        <p className="text-white/85 text-lg max-w-2xl mx-auto drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                            Pecifics uses advanced AI to understand your intent and execute complex multi-step tasks across your entire system.
                        </p>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {[
                            { number: "50+", label: "Supported Actions", desc: "From file ops to browser automation to Office control" },
                            { number: "< 2s", label: "Response Time", desc: "Powered by Groq LLM for lightning-fast task planning" },
                            { number: "100%", label: "Free & Open Source", desc: "No subscriptions. No hidden costs. Your data stays local." },
                        ].map((stat, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.2, duration: 0.6 }}
                                className="bg-blue-950/70 backdrop-blur-md border border-sky-500/30 rounded-2xl p-8 text-center hover:border-sky-400/50 transition-colors shadow-lg"
                            >
                                <div className="text-4xl font-bold bg-gradient-to-r from-white to-sky-300 bg-clip-text text-transparent mb-2 drop-shadow-[0_0_12px_rgba(255,255,255,0.4)]">
                                    {stat.number}
                                </div>
                                <div className="text-white font-bold mb-2 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">{stat.label}</div>
                                <div className="text-sky-100/85 text-sm">{stat.desc}</div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* CTA Section */}
            <div className="relative z-20 py-20 px-6">
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8 }}
                    className="max-w-4xl mx-auto text-center bg-gradient-to-r from-blue-900/40 to-sky-900/30 backdrop-blur-xl border border-sky-500/20 rounded-3xl p-12"
                >
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                        Ready to Transform Your Workflow?
                    </h2>
                    <p className="text-sky-200/80 text-lg mb-8 max-w-xl mx-auto">
                        Get Pecifics running in under 5 minutes. Free forever, open source, and built for power users.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link to="/download">
                            <motion.button
                                whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(56, 189, 248, 0.4)" }}
                                whileTap={{ scale: 0.95 }}
                                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-sky-400 text-white font-semibold rounded-full shadow-lg transition-all"
                            >
                                Download Pecifics
                            </motion.button>
                        </Link>
                        <Link to="/install">
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className="px-8 py-4 bg-white/10 backdrop-blur-sm border border-white/20 text-white font-semibold rounded-full hover:bg-white/20 transition-all"
                            >
                                View Install Guide
                            </motion.button>
                        </Link>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default Home;
