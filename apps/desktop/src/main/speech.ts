// Speech to text in the main process: the OpenAI key never reaches a renderer.
import OpenAI, { toFile } from 'openai'

export async function transcribe(audio: ArrayBuffer, mime: string): Promise<{ text: string; error?: string }> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return { text: '', error: 'OPENAI_API_KEY is not set: type the command instead.' }
  try {
    const client = new OpenAI({ apiKey: key, timeout: 20_000, maxRetries: 1 })
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm'
    const file = await toFile(Buffer.from(audio), `command.${ext}`, { type: mime })
    const r = await client.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
      language: 'en',
      prompt: 'A short spoken command to control a computer, for example: open that, click this one, go to pricing.',
    })
    return { text: (r.text ?? '').trim() }
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : String(e) }
  }
}
