import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import ResidentPage from './pages/ResidentPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  return (
    <BrowserRouter>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/resident" element={<ResidentPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
      <Footer />
    </BrowserRouter>
  );
}
