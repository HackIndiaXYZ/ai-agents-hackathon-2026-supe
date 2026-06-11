import { motion } from 'framer-motion';
import { 
    Download, Terminal, Settings, Play, CheckCircle, 
    AlertTriangle, Monitor, Cpu, HardDrive, ArrowRight,
    Copy
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageBackground } from '../components/JellyfishBackground';

const prerequisites = [
    { icon: <Monitor className="w-5 h-5" />, name: "Windows 10/11", desc: "64-bit OS required" },
    { icon: <Cpu className="w-5 h-5" />, name: "Node.js 18+", desc: "Download from nodejs.org" },
    { icon: <Terminal className="w-5 h-5" />, name: "Python 3.10+", desc: "With pip package manager" },
    { icon: <HardDrive className="w-5 h-5" />, name: "2 GB Free Space", desc: "For app + dependencies" },
];

const steps = [
    {
        number: "01",
        title: "Download Pecifics",
        description: "Get the latest Pecifics desktop app. Click the download button below or visit our releases page.",
        code: null,
        note: "The download is a portable .exe — no installation wizard needed.",
    },
    {
        number: "02",
        title: "Clone the Backend Repository",
        description: "The Pecifics backend handles AI task-planning. Clone the repository and set up the Python environment.",
        code: `git clone https://github.com/your-org/pecifics-lam.git
cd pecifics-lam
python -m venv .venv
.venv\\Scripts\\activate`,
        note: null,
    },
    {
        number: "03",
        title: "Install Python Dependencies",
        description: "Install the required Python packages for the LangChain backend that powers Pecifics' task planning.",
        code: `cd colab-backend
pip install -r requirements_langchain.txt`,
        note: "This installs LangChain, Groq SDK, FastAPI, and other dependencies.",
    },
    {
        number: "04",
        title: "Configure API Keys",
        description: "Set up your Groq API key for the LLM backend. You can get a free key from groq.com.",
        code: `# Create a .env file in colab-backend/
GROQ_API_KEY=your_groq_api_key_here
GOOGLE_API_KEY=your_gemini_key_here  # Optional: for vision`,
        note: "Groq offers generous free-tier API access. Gemini key is optional but enables vision features.",
    },
    {
        number: "05",
        title: "Start the Backend Server",
        description: "Launch the LangChain FastAPI backend that Pecifics communicates with for task planning.",
        code: `cd colab-backend
python langchain_backend.py`,
        note: "The server starts on http://localhost:8000. Keep this terminal running.",
    },
    {
        number: "06",
        title: "Launch Pecifics Desktop",
        description: "Run the Pecifics Electron app. It will auto-connect to the backend running on localhost:8000.",
        code: `# Option A: Run the portable .exe you downloaded
# Option B: Run from source
cd jarvis-desktop
npm install
npm start`,
        note: "Press Ctrl+Shift+J to toggle the app from anywhere on your desktop.",
    },
];

const troubleshooting = [
    { q: "Backend won't start?", a: "Make sure Python 3.10+ is in your PATH and all requirements are installed. Check that port 8000 is free." },
    { q: "App shows 'Disconnected'?", a: "Ensure the backend is running. Click Retry in the app or check Settings > Backend URL." },
    { q: "Vision features not working?", a: "You need either a CogAgent instance on Kaggle or a Google Gemini API key configured." },
    { q: "Playwright errors?", a: "Run 'npx playwright install chromium' in the jarvis-desktop folder to install browser binaries." },
];

const Install = () => {
    return (
        <div className="relative w-full min-h-screen overflow-hidden font-sans">
            <PageBackground showJellyfish={true} isHome={false} />

            {/* Hero */}
            <div className="relative z-20 pt-32 pb-12 px-6">
                <div className="max-w-4xl mx-auto text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                    >
                        <span className="inline-block text-sky-300 text-sm font-semibold uppercase tracking-wider mb-4">
                            Setup Guide
                        </span>
                        <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 tracking-tight">
                            Get Pecifics Running in{' '}
                            <span className="bg-gradient-to-r from-sky-300 to-blue-500 bg-clip-text text-transparent">
                                5 Minutes
                            </span>
                        </h1>
                        <p className="text-xl text-sky-100/80 max-w-2xl mx-auto">
                            Follow these simple steps to install and configure Pecifics on your Windows PC.
                        </p>
                    </motion.div>
                </div>
            </div>

            {/* Prerequisites */}
            <div className="relative z-20 py-12 px-6">
                <div className="max-w-4xl mx-auto">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-2xl font-bold text-white mb-6 flex items-center gap-3"
                    >
                        <Settings className="w-6 h-6 text-sky-400" />
                        Prerequisites
                    </motion.h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        {prerequisites.map((req, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className="bg-white/5 backdrop-blur-sm border border-blue-500/20 rounded-xl p-4 text-center"
                            >
                                <div className="text-sky-400 flex justify-center mb-3">{req.icon}</div>
                                <div className="text-white font-semibold text-sm">{req.name}</div>
                                <div className="text-sky-200/50 text-xs mt-1">{req.desc}</div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Steps */}
            <div className="relative z-20 py-12 px-6">
                <div className="max-w-4xl mx-auto">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-2xl font-bold text-white mb-10 flex items-center gap-3"
                    >
                        <Play className="w-6 h-6 text-sky-400" />
                        Installation Steps
                    </motion.h2>

                    <div className="space-y-8">
                        {steps.map((step, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, x: -30 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1, duration: 0.6 }}
                                className="relative"
                            >
                                {/* Connecting Line */}
                                {i < steps.length - 1 && (
                                    <div className="absolute left-6 top-16 bottom-0 w-px bg-gradient-to-b from-sky-500/40 to-transparent" />
                                )}

                                <div className="flex gap-6">
                                    {/* Step Number */}
                                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-r from-blue-600 to-sky-400 flex items-center justify-center text-white font-bold text-sm">
                                        {step.number}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 bg-white/5 backdrop-blur-sm border border-blue-500/20 rounded-2xl p-6 hover:border-sky-400/30 transition-colors">
                                        <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
                                        <p className="text-sky-200/70 text-sm mb-4 leading-relaxed">{step.description}</p>

                                        {step.code && (
                                            <div className="relative group">
                                                <pre className="bg-[#020b18] border border-blue-900/40 rounded-lg p-4 text-sm font-mono text-sky-300 overflow-x-auto">
                                                    <code>{step.code}</code>
                                                </pre>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(step.code || '')}
                                                    className="absolute top-3 right-3 p-1.5 bg-white/10 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/20"
                                                    title="Copy"
                                                >
                                                    <Copy className="w-3.5 h-3.5 text-sky-200" />
                                                </button>
                                            </div>
                                        )}

                                        {step.note && (
                                            <div className="mt-3 flex items-start gap-2 text-xs text-sky-200/50">
                                                <CheckCircle className="w-3.5 h-3.5 mt-0.5 text-sky-400/60 flex-shrink-0" />
                                                {step.note}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Troubleshooting */}
            <div className="relative z-20 py-16 px-6">
                <div className="max-w-4xl mx-auto">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-2xl font-bold text-white mb-8 flex items-center gap-3"
                    >
                        <AlertTriangle className="w-6 h-6 text-amber-400" />
                        Troubleshooting
                    </motion.h2>

                    <div className="space-y-4">
                        {troubleshooting.map((item, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 15 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className="bg-white/5 backdrop-blur-sm border border-blue-500/15 rounded-xl p-5"
                            >
                                <h4 className="text-white font-semibold text-sm mb-2">{item.q}</h4>
                                <p className="text-blue-200/60 text-sm">{item.a}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>

            {/* CTA */}
            <div className="relative z-20 py-16 px-6">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="max-w-3xl mx-auto text-center"
                >
                    <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">All Set?</h2>
                    <p className="text-sky-200/70 mb-8">
                        Download Pecifics and start controlling your PC with AI today.
                    </p>
                    <Link to="/download">
                        <motion.button
                            whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(56, 189, 248, 0.4)" }}
                            whileTap={{ scale: 0.95 }}
                            className="px-8 py-4 bg-gradient-to-r from-blue-600 to-sky-400 text-white font-semibold rounded-full shadow-lg transition-all inline-flex items-center gap-2"
                        >
                            <Download className="w-5 h-5" />
                            Download Pecifics
                            <ArrowRight className="w-4 h-4" />
                        </motion.button>
                    </Link>
                </motion.div>
            </div>
        </div>
    );
};

export default Install;
