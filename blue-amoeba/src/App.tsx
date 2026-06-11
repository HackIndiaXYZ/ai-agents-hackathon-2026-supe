import { useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navigation from './components/Navigation';
import Footer from './components/Footer';
import Home from './pages/Home';
import Features from './pages/Features';
import Install from './pages/Install';
import Download from './pages/Download';

const ScrollToTop = () => {
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);
    return null;
};

export default function App() {
    return (
        <HashRouter>
            <ScrollToTop />
            <div className="relative min-h-screen text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
                <Navigation />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/features" element={<Features />} />
                    <Route path="/install" element={<Install />} />
                    <Route path="/download" element={<Download />} />
                </Routes>
                <Footer />
            </div>
        </HashRouter>
    );
}
