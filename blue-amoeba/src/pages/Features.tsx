import { motion } from 'framer-motion';
import { 
    Globe, FolderOpen, Settings, Brain, Zap, 
    FileText, Mail, Camera, Volume2, Search, Presentation,
    Shield, Cpu, Wifi, Keyboard, ArrowRight, CheckCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageBackground } from '../components/JellyfishBackground';

const features = [
    {
        icon: <Globe className="w-7 h-7" />,
        title: "Browser Automation",
        description: "Open Chrome, search the web, navigate to any website, fill forms, and interact with web pages — all via natural language commands.",
        highlights: ["Google Search", "Navigate URLs", "Click & Type", "Tab Management"],
        color: "from-blue-600 to-sky-400",
    },
    {
        icon: <FolderOpen className="w-7 h-7" />,
        title: "File Management",
        description: "Create, move, rename, delete files and folders. Open documents, organize your workspace, and manage your entire file system effortlessly.",
        highlights: ["Create Files", "Move & Rename", "Open Explorer", "Batch Operations"],
        color: "from-sky-500 to-blue-700",
    },
    {
        icon: <Presentation className="w-7 h-7" />,
        title: "Office Automation",
        description: "Control PowerPoint, Word, Excel, OneNote, and Publisher via COM automation. Create presentations, edit documents, and manage spreadsheets.",
        highlights: ["PowerPoint", "Word", "Excel", "OneNote"],
        color: "from-blue-500 to-indigo-600",
    },
    {
        icon: <Brain className="w-7 h-7" />,
        title: "Vision-Based AI",
        description: "Take screenshots and let AI analyze what's on your screen. CogAgent integration provides state-of-the-art visual understanding of your desktop.",
        highlights: ["Screen Analysis", "CogAgent", "Gemini Vision", "Context-Aware"],
        color: "from-indigo-500 to-sky-500",
    },
    {
        icon: <Settings className="w-7 h-7" />,
        title: "System Control",
        description: "Adjust volume, toggle dark mode, manage processes, check system info, and control every aspect of your Windows system.",
        highlights: ["Volume Control", "Dark Mode", "Process Manager", "System Info"],
        color: "from-sky-600 to-blue-500",
    },
    {
        icon: <Zap className="w-7 h-7" />,
        title: "Multi-Task Execution",
        description: "Chain multiple commands in a single prompt. Pecifics intelligently plans and executes complex multi-step workflows automatically.",
        highlights: ["Task Planning", "Sequential Execution", "Error Recovery", "Progress Tracking"],
        color: "from-blue-700 to-sky-400",
    },
];

const useCases = [
    { icon: <Mail className="w-5 h-5" />, text: "\"Open Gmail and compose an email to my team about tomorrow's meeting\"" },
    { icon: <Presentation className="w-5 h-5" />, text: "\"Create a 10-slide PowerPoint about machine learning trends\"" },
    { icon: <Camera className="w-5 h-5" />, text: "\"Take a screenshot and tell me what apps are open\"" },
    { icon: <Volume2 className="w-5 h-5" />, text: "\"Set volume to 30% and enable dark mode\"" },
    { icon: <Search className="w-5 h-5" />, text: "\"Search for the latest tech news on Google\"" },
    { icon: <FileText className="w-5 h-5" />, text: "\"Create a Word document with a project proposal template\"" },
];

const advantages = [
    { icon: <Shield className="w-6 h-6" />, title: "Privacy First", desc: "Everything runs locally on your machine. No cloud processing, no data collection. Your commands never leave your PC." },
    { icon: <Cpu className="w-6 h-6" />, title: "Blazing Fast", desc: "Powered by Groq LLM for sub-2-second task planning. Actions execute instantly through native system APIs." },
    { icon: <Wifi className="w-6 h-6" />, title: "Works Offline*", desc: "Core actions work without internet. Only LLM-based planning requires a connection to the local backend." },
    { icon: <Keyboard className="w-6 h-6" />, title: "Global Hotkey", desc: "Summon Pecifics instantly with Ctrl+Shift+J from anywhere. Always-on-top mode keeps it accessible." },
];

const Features = () => {
    return (
        <div className="relative w-full min-h-screen overflow-hidden font-sans">
            <PageBackground showJellyfish={true} isHome={false} />

            {/* Hero */}
            <div className="relative z-20 pt-32 pb-16 px-6">
                <div className="max-w-6xl mx-auto text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                    >
                        <span className="inline-block text-sky-300 text-sm font-semibold uppercase tracking-wider mb-4">
                            Capabilities
                        </span>
                        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 tracking-tight">
                            Everything Your PC Can Do,{' '}
                            <span className="bg-gradient-to-r from-sky-300 to-blue-500 bg-clip-text text-transparent">
                                Now Voice-Controlled
                            </span>
                        </h1>
                        <p className="text-xl text-sky-100/80 max-w-3xl mx-auto">
                            From simple tasks to complex workflows, Pecifics turns your natural language into real actions across your entire system.
                        </p>
                    </motion.div>
                </div>
            </div>

            {/* Feature Grid */}
            <div className="relative z-20 py-16 px-6">
                <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {features.map((feature, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1, duration: 0.6 }}
                            whileHover={{ y: -5, borderColor: "rgba(56, 189, 248, 0.4)" }}
                            className="bg-white/5 backdrop-blur-md border border-blue-500/20 rounded-2xl p-6 transition-all group"
                        >
                            <div className={`inline-flex p-3 rounded-xl bg-gradient-to-r ${feature.color} mb-4`}>
                                <div className="text-white">{feature.icon}</div>
                            </div>
                            <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                            <p className="text-sky-200/70 text-sm mb-4 leading-relaxed">{feature.description}</p>
                            <div className="flex flex-wrap gap-2">
                                {feature.highlights.map((h, j) => (
                                    <span key={j} className="text-xs bg-sky-500/10 text-sky-200 border border-sky-500/20 px-2 py-1 rounded-full">
                                        {h}
                                    </span>
                                ))}
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>

            {/* Use Cases */}
            <div className="relative z-20 py-20 px-6">
                <div className="max-w-5xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8 }}
                        className="text-center mb-12"
                    >
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
                            Just Say What You Need
                        </h2>
                        <p className="text-sky-200/70 text-lg">
                            Real examples of what Pecifics can do for you
                        </p>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {useCases.map((uc, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1, duration: 0.5 }}
                                className="flex items-start gap-4 bg-white/5 backdrop-blur-sm border border-blue-500/15 rounded-xl p-5 hover:border-sky-400/30 transition-colors"
                            >
                                <div className="text-sky-400 mt-1 flex-shrink-0">{uc.icon}</div>
                                <p className="text-sky-100 text-sm italic leading-relaxed">{uc.text}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Advantages */}
            <div className="relative z-20 py-20 px-6">
                <div className="max-w-6xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8 }}
                        className="text-center mb-12"
                    >
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
                            Why Choose Pecifics?
                        </h2>
                        <p className="text-sky-200/70 text-lg max-w-2xl mx-auto">
                            Built different from the ground up. Here's what sets us apart.
                        </p>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {advantages.map((adv, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.15, duration: 0.6 }}
                                className="flex gap-5 bg-gradient-to-r from-white/5 to-transparent border border-blue-500/15 rounded-2xl p-6 hover:border-sky-400/30 transition-colors"
                            >
                                <div className="flex-shrink-0 text-sky-400 bg-sky-400/10 p-3 rounded-xl h-fit">
                                    {adv.icon}
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white mb-2">{adv.title}</h3>
                                    <p className="text-sky-200/60 text-sm leading-relaxed">{adv.desc}</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Comparison / Selling */}
            <div className="relative z-20 py-20 px-6">
                <div className="max-w-4xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="bg-gradient-to-br from-blue-900/40 to-sky-900/30 backdrop-blur-xl border border-blue-500/20 rounded-3xl p-8 md:p-12"
                    >
                        <h2 className="text-2xl md:text-3xl font-bold text-white mb-6 text-center">
                            Pecifics vs Traditional Assistants
                        </h2>
                        <div className="space-y-4">
                            {[
                                { feature: "Controls your actual desktop apps", pecifics: true, others: false },
                                { feature: "Creates real PowerPoint & Word files", pecifics: true, others: false },
                                { feature: "Manages files & folders natively", pecifics: true, others: false },
                                { feature: "Browser automation (click, type, navigate)", pecifics: true, others: false },
                                { feature: "Vision-based screen understanding", pecifics: true, others: false },
                                { feature: "100% local & private", pecifics: true, others: false },
                                { feature: "Free & open source", pecifics: true, others: false },
                                { feature: "Multi-step task chains", pecifics: true, others: false },
                            ].map((row, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -20 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: i * 0.05 }}
                                    className="flex items-center justify-between bg-white/5 rounded-lg px-5 py-3"
                                >
                                    <span className="text-sky-100 text-sm">{row.feature}</span>
                                    <div className="flex gap-8">
                                        <CheckCircle className="w-5 h-5 text-sky-400" />
                                        <span className="text-red-400/60 text-sm">✗</span>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                        <div className="flex justify-center gap-16 mt-4 text-xs text-sky-200/50">
                            <span className="ml-auto mr-4">Pecifics</span>
                            <span>Others</span>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* CTA */}
            <div className="relative z-20 py-20 px-6">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8 }}
                    className="max-w-3xl mx-auto text-center"
                >
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                        Experience the Future of Desktop AI
                    </h2>
                    <p className="text-sky-200/70 text-lg mb-8">
                        Download Pecifics today and see what your PC can really do.
                    </p>
                    <Link to="/download">
                        <motion.button
                            whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(56, 189, 248, 0.4)" }}
                            whileTap={{ scale: 0.95 }}
                            className="px-8 py-4 bg-gradient-to-r from-blue-600 to-sky-400 text-white font-semibold rounded-full shadow-lg transition-all inline-flex items-center gap-2"
                        >
                            Get Started Free
                            <ArrowRight className="w-5 h-5" />
                        </motion.button>
                    </Link>
                </motion.div>
            </div>
        </div>
    );
};

export default Features;
