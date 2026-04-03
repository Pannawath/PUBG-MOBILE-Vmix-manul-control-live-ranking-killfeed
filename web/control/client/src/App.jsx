import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminDashboard from './pages/AdminDashboard';
import OverlayKillfeed from './pages/OverlayKillfeed';
import OverlayRanking from './pages/OverlayRanking';
import OverlayTop4 from './pages/OverlayTop4';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div className="p-10 text-2xl font-bold">PUBG Control Hub <a href="/admin" className="text-blue-400 text-sm ml-4">Go to Admin</a></div>} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/overlay/killfeed" element={<OverlayKillfeed />} />
        <Route path="/overlay/ranking" element={<OverlayRanking />} />
        <Route path="/overlay/top4" element={<OverlayTop4 />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
