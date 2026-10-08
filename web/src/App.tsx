import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashboardPage } from "@/pages/DashboardPage.tsx";
import { FpvPage } from "@/pages/FpvPage.tsx";
import { CameraPage } from "@/pages/CameraPage.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/fpv" element={<FpvPage />} />
        <Route path="/camera" element={<CameraPage />} />
      </Routes>
    </BrowserRouter>
  );
}
