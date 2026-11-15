import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import { processImage } from '@/lib/image'
import { toast } from '@/ui/Toast'

export interface PendingShot {
  blob: Blob
  thumb: Blob
  sha256: string
  url: string
}

// 相机生命周期 + 拍摄 → 待确认流程，入住（Camera）与退租（Align）共用。
// 摄像头开不了（权限/非安全上下文/无设备）→ fileMode 降级为文件上传，不弹错误。
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startToken = useRef(0)
  const wakeRef = useRef<WakeLockSentinel | null>(null)
  const fileModeRef = useRef(false)

  const [fileMode, setFileMode] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [pending, setPending] = useState<PendingShot | null>(null)

  const pendingRef = useRef<PendingShot | null>(null)
  pendingRef.current = pending

  const requestWake = useCallback(async () => {
    try {
      if (!('wakeLock' in navigator)) return
      wakeRef.current = await navigator.wakeLock.request('screen')
    } catch {
      // 设备不支持或页面刚切后台，静默跳过
    }
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const stopCamera = useCallback(() => {
    startToken.current++
    stopStream()
    void wakeRef.current?.release().catch(() => {})
    wakeRef.current = null
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.url)
  }, [stopStream])

  const startCamera = useCallback(async () => {
    const token = ++startToken.current
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('camera unavailable')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      if (token !== startToken.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const v = videoRef.current
      if (v) {
        v.srcObject = stream
        try {
          await v.play()
        } catch {
          // 自动播放被拦时用户点快门前画面会亮起，不阻断
        }
      }
      const track = stream.getVideoTracks()[0]
      const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
      setTorchAvailable(Boolean(caps?.torch))
      setFileMode(false)
      fileModeRef.current = false
    } catch {
      // 拒绝权限 / 非安全上下文 / 无摄像头 → 直接切文件上传，不弹错误对话框
      if (token === startToken.current) {
        setFileMode(true)
        fileModeRef.current = true
      }
    }
  }, [])

  // 屏幕常亮 + 相机生命周期；切后台回来重取常亮锁、预览流死了就重启
  useEffect(() => {
    void requestWake()
    void startCamera()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void requestWake()
      if (fileModeRef.current) return
      const track = streamRef.current?.getVideoTracks()[0]
      if (!track || track.readyState !== 'live') void startCamera()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      stopCamera()
    }
  }, [requestWake, startCamera, stopCamera])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      })
      setTorchOn(next)
    } catch {
      setTorchAvailable(false)
      setTorchOn(false)
    }
  }

  async function capture() {
    const v = videoRef.current
    if (!v || !v.videoWidth || capturing || pending) return
    setCapturing(true)
    try {
      const out = await processImage(v)
      setPending({ ...out, url: URL.createObjectURL(out.blob) })
    } catch {
      toast('这张没存上，再拍一次。')
    } finally {
      setCapturing(false)
    }
  }

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || pending || capturing) return
    setCapturing(true)
    try {
      const out = await processImage(f)
      setPending({ ...out, url: URL.createObjectURL(out.blob) })
    } catch {
      toast('这张图读不出来，换一张试试。')
    } finally {
      setCapturing(false)
    }
  }

  function reshoot() {
    if (pending) URL.revokeObjectURL(pending.url)
    setPending(null)
  }

  return {
    videoRef,
    fileMode,
    torchAvailable,
    torchOn,
    capturing,
    pending,
    capture,
    onPickFile,
    toggleTorch,
    reshoot,
  }
}
