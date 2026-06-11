
import { Waves } from 'lucide-react';
import { Link } from 'react-router-dom';

const Footer = () => {
    return (
        <footer className="relative z-20 bg-gradient-to-t from-black/90 to-blue-950/60 backdrop-blur-sm border-t border-blue-400/30 py-12 px-6">
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <Waves className="w-6 h-6 text-cyan-400" />
                            <span className="text-xl font-bold bg-gradient-to-r from-white to-cyan-300 bg-clip-text text-transparent">
                                Pecifics
                            </span>
                        </div>
                        <p className="text-white/70 text-sm">
                            Your AI-powered desktop assistant that controls your entire PC with natural language commands.
                        </p>
                    </div>
                    <div>
                        <h3 className="text-white font-semibold mb-4">Product</h3>
                        <ul className="space-y-2 text-white/70 text-sm">
                            <li><Link to="/features" className="hover:text-white transition-colors">Features</Link></li>
                            <li><Link to="/download" className="hover:text-white transition-colors">Download</Link></li>
                            <li><Link to="/install" className="hover:text-white transition-colors">Installation Guide</Link></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-white font-semibold mb-4">Resources</h3>
                        <ul className="space-y-2 text-white/70 text-sm">
                            <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">API Reference</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">GitHub</a></li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-white font-semibold mb-4">Connect</h3>
                        <ul className="space-y-2 text-white/70 text-sm">
                            <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">Discord Community</a></li>
                            <li><a href="#" className="hover:text-white transition-colors">Twitter / X</a></li>
                        </ul>
                    </div>
                </div>
                <div className="border-t border-blue-500/20 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                    <p className="text-white/60 text-sm">
                        &copy; 2026 Pecifics AI. All rights reserved.
                    </p>
                    <div className="flex gap-6 text-white/60 text-sm">
                        <a href="#" className="hover:text-white transition-colors">Privacy</a>
                        <a href="#" className="hover:text-white transition-colors">Terms</a>
                        <a href="#" className="hover:text-white transition-colors">License</a>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
