// Speech to text in the main process: the OpenAI key never reaches a renderer. Logic lives in features/voice.
import type { SpeechReply } from '../shared/voice'
import { transcribeAudio, type SttOptions } from './features/voice/transcribe'

export async function transcribe(audio: ArrayBuffer, mime: string, opts?: SttOptions): Promise<SpeechReply> {
  return transcribeAudio(audio, mime, opts)
}
