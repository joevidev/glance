import { AnimatePresence, motion } from 'motion/react'
import type { ConfirmRequest } from '../../../shared/agent'

/** Glass card shown in the overlay while an irreversible step waits. Never auto-confirms: a left wink or Enter does. */
export function ConfirmCard({ req }: { req: ConfirmRequest | null | undefined }) {
  return (
    <AnimatePresence>
      {req && (
        <motion.div
          key={req.id}
          initial={{ opacity: 0, y: 28, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="absolute left-1/2 top-24 -translate-x-1/2"
        >
          <div className="glass glass-dark px-9 py-6 text-center text-white" style={{ borderRadius: 28, minWidth: 420, borderColor: 'rgba(255,255,255,.7)', boxShadow: '0 0 60px rgba(255,255,255,.28), inset 0 1.5px 0 rgba(255,255,255,.6)' }}>
            <div className="relative font-mono text-[11px] uppercase tracking-[0.18em] text-white/60">Needs your OK</div>
            <div className="relative mt-1.5 text-[26px] font-semibold tracking-tight">{req.title}</div>
            <div className="relative mt-1 text-[14px] text-white/75">{req.detail}</div>
            <div className="relative mt-3 inline-block rounded-full border border-white/30 bg-white/10 px-3 py-1 font-mono text-[12px] text-white/90">{req.actionName}</div>
            <div className="relative mt-4 flex items-center justify-center gap-3 font-mono text-[12px] uppercase tracking-[0.12em]">
              <span className="rounded-full bg-white px-4 py-1.5 text-black">Left wink · Enter = do it</span>
              <span className="rounded-full border border-white/40 px-4 py-1.5 text-white/80">Esc · right wink = cancel</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
