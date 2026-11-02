// Entry point of the assistant feature: wires the runtime to IPC. index.ts only calls registerAgent().
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { repoRoot } from '../../env'
import type { Browse } from '../../browse'
import type { Controller } from '../../controller'
import type { InputHelper } from '../../input'
import { AgentRuntime } from './runtime'

// the automated end-to-end run never touches the real calibration/settings (must be set before app ready)
export const E2E = process.env.GLANCE_AGENT_E2E === '1'
if (E2E) app.setPath('userData', join(tmpdir(), `glance-agent-e2e-${process.pid}`))

export function registerAgent(deps: { browse: Browse; controller: Controller; input: InputHelper; outDir: string }): AgentRuntime {
  const rt = new AgentRuntime(deps)
  ipcMain.handle('agent:run', (_e, a: { command: string; source: 'typed' | 'voice' }) => rt.run(a.command, a.source, deps.controller.gaze))
  ipcMain.handle('agent:confirm', (_e, a: { id: number; ok: boolean }) => rt.settleConfirm(a.id, a.ok))
  ipcMain.handle('agent:demo', () => deps.browse.open('file://' + join(repoRoot(), 'apps/desktop/resources/demo/index.html')))
  ipcMain.handle('agent:state', () => rt.state)
  ipcMain.handle('agent:voice', (_e, v?: boolean) => {
    if (typeof v === 'boolean') rt.voiceMode = v
    return rt.voiceMode
  })
  if (E2E) void import('./e2e').then((m) => m.runAgentE2E({ ...deps, outDir: join(repoRoot(), 'apps/desktop/.screens'), agent: rt }))
  return rt
}
