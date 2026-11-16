import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'

import Home from '@/features/case/Home'
import NewCase from '@/features/case/NewCase'
import Annotate from '@/features/capture/Annotate'
import Camera from '@/features/capture/Camera'
import CapturePage from '@/features/capture/CapturePage'
import Deed from '@/features/capture/Deed'
import Align from '@/features/compare/Align'
import ComparePage from '@/features/compare/ComparePage'
import JudgementList from '@/features/compare/JudgementList'
import NegotiatePage from '@/features/negotiate/NegotiatePage'
import SlotListPage from '@/features/capture/SlotListPage'
import ParsePage from '@/features/valuation/Parse'
import ValuationPage from '@/features/valuation/Valuation'
import { Skeleton } from '@/ui/Skeleton'
import { ToastHost } from '@/ui/Toast'

// 对比结果页拉起 opencv（13MB）与差异检测，必须懒加载，不进首屏 bundle；
// 模拟页静态引用 lib/api/wording（zod），同样懒加载
const Compare = lazy(() => import('@/features/compare/Compare'))
const Roleplay = lazy(() => import('@/features/negotiate/Roleplay'))

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
        <Route path="/case/:id/judge" element={<JudgementList />} />
        <Route
          path="/case/:id/compare/:roomId/:slotId/result"
          element={
            <Suspense
              fallback={
                <div className="mx-auto min-h-dvh max-w-[480px] space-y-4 px-5 pt-14">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-56 w-full" />
                </div>
              }
            >
              <Compare />
            </Suspense>
          }
        />
        <Route path="/case/:id/value" element={<ParsePage />} />
        <Route path="/case/:id/value/result" element={<ValuationPage />} />
        <Route path="/case/:id/negotiate" element={<NegotiatePage />} />
        <Route
          path="/case/:id/negotiate/roleplay"
          element={
            <Suspense
              fallback={
                <div className="mx-auto min-h-dvh max-w-[480px] space-y-4 px-5 pt-14">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-40 w-full" />
                </div>
              }
            >
              <Roleplay />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </>
  )
}
