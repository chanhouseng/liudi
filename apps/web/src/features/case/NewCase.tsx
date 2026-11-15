import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { newId } from '@/domain/repo'
import type { Case, LandlordType } from '@/domain/types'
import { DEFAULT_ROOM_KINDS } from '@/content/roomTemplates'
import { createCaseWithRooms } from '@/lib/idb'
import { Button } from '@/ui/Button'
import { Field, fieldControlClass } from '@/ui/Field'
import { toast } from '@/ui/Toast'

const landlordOptions: { value: LandlordType; label: string }[] = [
  { value: 'personal', label: '个人' },
  { value: 'agency', label: '中介' },
  { value: 'sublet', label: '二房东' },
]

const POSITIVE_INT = /^[1-9]\d*$/

export default function NewCase() {
  const navigate = useNavigate()
  const [alias, setAlias] = useState('')
  const [rent, setRent] = useState('')
  const [deposit, setDeposit] = useState('')
  const [leaseStart, setLeaseStart] = useState('')
  const [leaseEnd, setLeaseEnd] = useState('')
  const [landlordType, setLandlordType] = useState<LandlordType>('personal')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const rentError = rent !== '' && !POSITIVE_INT.test(rent) ? '要填正整数' : null
  const depositError = deposit !== '' && !POSITIVE_INT.test(deposit) ? '要填正整数' : null
  const dateError =
    leaseStart !== '' && leaseEnd !== '' && leaseEnd <= leaseStart ? '到期日要晚于起租日' : null
  const doorPlateHint = /[室号]/.test(alias) ? '建议只写到楼栋' : null
  const missing = [alias, rent, deposit, leaseStart, leaseEnd].filter((v) => v === '').length
  const canSubmit =
    missing === 0 && rentError === null && depositError === null && dateError === null && !submitting

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const c: Case = {
        id: newId(),
        alias,
        city: 'hangzhou',
        addressMasked: alias,
        rentMonthly: Number(rent) * 100,
        deposit: Number(deposit) * 100,
        leaseStart,
        leaseEnd,
        landlordType,
        createdAt: new Date().toISOString(),
      }
      await createCaseWithRooms(c, DEFAULT_ROOM_KINDS)
      toast('先拍玄关，30 秒。')
      navigate(`/case/${c.id}/capture`)
    } catch {
      setSubmitError('没存上，请再试一次。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-5 pb-10">
      <header className="pt-10">
        <Link to="/" className="text-[13px] text-ink-2">
          ← 首页
        </Link>
        <h1 className="mt-4 font-serif text-[22px] font-semibold">新建案件</h1>
      </header>

      <form className="mt-6 space-y-5" onSubmit={onSubmit}>
        <Field label="房子怎么称呼" hint={doorPlateHint ?? undefined}>
          <input
            className={fieldControlClass}
            value={alias}
            maxLength={20}
            placeholder="文一西路 3 幢"
            onChange={(e) => setAlias(e.target.value)}
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-[13px] text-ink-2">城市</span>
          <span className="inline-block rounded-doc border border-rule px-2.5 py-1 text-[13px] text-ink-2">
            杭州
          </span>
        </div>

        <Field label="月租（元）" error={rentError ?? undefined}>
          <input
            className={fieldControlClass}
            inputMode="numeric"
            placeholder="4000"
            value={rent}
            onChange={(e) => setRent(e.target.value.replace(/\D/g, ''))}
          />
        </Field>

        <Field label="押金（元）" error={depositError ?? undefined}>
          <input
            className={fieldControlClass}
            inputMode="numeric"
            placeholder="4000"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ''))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="起租日">
            <input
              type="date"
              className={fieldControlClass}
              value={leaseStart}
              onChange={(e) => setLeaseStart(e.target.value)}
            />
          </Field>
          <Field label="到期日" error={dateError ?? undefined}>
            <input
              type="date"
              className={fieldControlClass}
              value={leaseEnd}
              onChange={(e) => setLeaseEnd(e.target.value)}
            />
          </Field>
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] text-ink-2">房东类型</span>
          <div className="flex gap-2">
            {landlordOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setLandlordType(o.value)}
                className={`h-9 flex-1 rounded-doc border text-[13px] ${
                  landlordType === o.value
                    ? 'border-accent bg-accent text-white'
                    : 'border-rule text-ink-2'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-ink-3">
          只写到楼栋就行，不用填门牌号。
          <br />
          我们不收集房东的姓名和电话。
        </p>

        <div className="pt-2">
          <Button type="submit" className="w-full" loading={submitting} disabled={!canSubmit}>
            开始拍底稿
          </Button>
          {missing > 0 && <p className="mt-2 text-[13px] text-ink-3">还差 {missing} 项</p>}
          {submitError && (
            <p role="alert" className="mt-2 text-[13px] text-alert">
              {submitError}
            </p>
          )}
        </div>
      </form>
    </main>
  )
}
