import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'

import Home from '@/features/case/Home'
import NewCase from '@/features/case/NewCase'
import Annotate from '@/features/capture/Annotate'
import Camera from '@/features/capture/Camera'
import CapturePage from '@/features/capture/CapturePage'
import Deed from '@/features/capture/Deed'
import Align from '@/features/compare/Align'
import ComparePage from '@/features/compare/ComparePage'
import NegotiatePage from '@/features/negotiate/NegotiatePage'
import SlotListPage from '@/features/capture/SlotListPage'
import ValuePage from '@/features/valuation/ValuePage'
import { ToastHost } from '@/ui/Toast'

export default function App() {
  const navigate = useNavigate()

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      navigate('/case/demo/compare', { replace: true })
    }
  }, [navigate])

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/case/new" element={<NewCase />} />
        <Route path="/case/:id/capture" element={<CapturePage />} />
        <Route path="/case/:id/capture/:roomId" element={<SlotListPage />} />
        <Route path="/case/:id/capture/:roomId/:slotId" element={<Camera />} />
        <Route path="/case/:id/capture/:roomId/:slotId/annotate" element={<Annotate />} />
        <Route path="/case/:id/deed" element={<Deed />} />
        <Route path="/case/:id/compare" element={<ComparePage />} />
        <Route path="/case/:id/compare/:roomId/:slotId" element={<Align />} />
        <Route path="/case/:id/value" element={<ValuePage />} />
        <Route path="/case/:id/negotiate" element={<NegotiatePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </>
  )
}
