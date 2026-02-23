// app/src/lib/settings.tsx — Settings modal
import { render } from 'melina/client'
import { state, dom } from './state'

function SettingsModal() {
    const cwd = location.origin
    const model = dom.modelSelect.value
    const agentCount = state.agents.length

    return (
        <div className="settings-overlay" onClick={(e: Event) => {
            if ((e.target as HTMLElement).classList.contains('settings-overlay')) closeSettings()
        }}>
            <div className="settings-panel">
                <div className="settings-header">
                    <span className="settings-title">⚙ Settings</span>
                    <button className="settings-close" onClick={closeSettings}>✕</button>
                </div>
                <div className="settings-body">
                    <div className="settings-group">
                        <span className="settings-label">Working Directory</span>
                        <div className="settings-value">{cwd}</div>
                    </div>

                    <div className="settings-group">
                        <span className="settings-label">Active Model</span>
                        <div className="settings-value">{model}</div>
                    </div>

                    <div className="settings-group">
                        <span className="settings-label">Agents</span>
                        <div className="settings-value">{agentCount} active</div>
                    </div>

                    <div className="settings-group">
                        <span className="settings-label">Keyboard Shortcuts</span>
                        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                            <div className="settings-kbd"><span className="kbd">Ctrl+N</span> New agent</div>
                            <div className="settings-kbd"><span className="kbd">Ctrl+L</span> Clear chat</div>
                            <div className="settings-kbd"><span className="kbd">Enter</span> Send message</div>
                            <div className="settings-kbd"><span className="kbd">Shift+Enter</span> New line</div>
                            <div className="settings-kbd"><span className="kbd">Esc</span> Stop agent / Close modal</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export function openSettings() {
    const container = document.getElementById('settings-modal')!
    render(<SettingsModal />, container)
}

export function closeSettings() {
    const container = document.getElementById('settings-modal')!
    container.innerHTML = ''
}
