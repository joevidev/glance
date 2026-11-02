import { Loader2 } from 'lucide-react'
import { Button } from '@glance/ui/components/button'
import type { VoiceUi } from './useVoiceRecorder'

const HINT = 'Look at something, press Option+Space, say “open that”, press it again.'

/** One line of voice state for the dashboard: hint, listening timer, spinner while transcribing, transcript or the reason it failed. */
export function VoiceStatus({ voice }: { voice: VoiceUi }) {
  const denied = voice.problem === 'mic-denied'
  return (
    <div className="min-w-0 flex-1 text-[15px] leading-snug text-white/70">
      {voice.phase === 'listening' ? (
        <span className="font-mono tabular-nums text-white">Listening {(voice.elapsedMs / 1000).toFixed(1)} s · press Option+Space to send</span>
      ) : voice.phase === 'transcribing' ? (
        <span className="inline-flex items-center gap-2 text-white">
          <Loader2 className="size-4 animate-spin" /> Transcribing…
        </span>
      ) : voice.phase === 'starting' ? (
        <span>Starting the microphone…</span>
      ) : (
        <span className={voice.problem ? 'text-white' : undefined}>{voice.heard ?? HINT}</span>
      )}
      {denied && (
        <div className="pt-2">
          <Button size="sm" variant="glass" onClick={() => void window.glance.invoke('perm:openSettings', 'Microphone')}>
            Open Microphone settings
          </Button>
        </div>
      )}
    </div>
  )
}
