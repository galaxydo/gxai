// app/src/skills/page.client.tsx — Dynamic skill discovery and display
import { render } from 'melina/client'

interface CommandDef {
    name: string
    description: string
    usage: string
    params?: Record<string, string>
}

interface SkillData {
    id: string
    name: string
    description: string
    commands: CommandDef[]
    filePath: string
}

let skills: SkillData[] = []
let expandedSkill: string | null = null

const SKILL_ICONS: Record<string, string> = {
    bun: '⚡',
    docker: '🐳',
    git: '📦',
    npm: '📋',
}

function CommandRow({ cmd }: { cmd: CommandDef }) {
    const params = cmd.params ? Object.entries(cmd.params) : []
    return (
        <div className="command-row">
            <div className="command-header">
                <code className="command-name">{cmd.name}</code>
                <span className="command-desc">{cmd.description}</span>
            </div>
            <div className="command-usage">
                <code>{cmd.usage}</code>
            </div>
            {params.length > 0 && (
                <div className="command-params">
                    {params.map(([k, v]) => (
                        <div className="param-item" key={k}>
                            <code className="param-name">{k}</code>
                            <span className="param-desc">{v}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function SkillCard({ skill }: { skill: SkillData }) {
    const isExpanded = expandedSkill === skill.id
    const icon = SKILL_ICONS[skill.id] || '🔧'
    return (
        <div className={`skill-card ${isExpanded ? 'expanded' : ''}`}>
            <div className="skill-header" onClick={() => { expandedSkill = isExpanded ? null : skill.id; rerender() }}>
                <div className="skill-identity">
                    <span className="skill-icon">{icon}</span>
                    <div>
                        <h2 className="skill-name">{skill.name}</h2>
                        <span className="skill-desc">{skill.description}</span>
                    </div>
                </div>
                <div className="skill-meta">
                    <span className="skill-cmds-count">{skill.commands.length} command{skill.commands.length !== 1 ? 's' : ''}</span>
                    <span className="skill-file-badge">{skill.id}.yaml</span>
                    <span className={`skill-expand-arrow ${isExpanded ? 'open' : ''}`}>▶</span>
                </div>
            </div>

            {isExpanded && (
                <div className="skill-commands">
                    <div className="commands-divider" />
                    {skill.commands.map(cmd => <CommandRow cmd={cmd} />)}
                </div>
            )}
        </div>
    )
}

async function loadSkills() {
    try {
        skills = await fetch('/api/skills').then(r => r.json())
    } catch {
        skills = []
    }
    rerender()
}

function rerender() {
    const container = document.getElementById('skills-content')
    if (!container) return
    render(
        <div className="skills-list">
            {skills.length === 0 ? (
                <div className="overview-empty">
                    No skill files found in <code>skills/</code> directory.<br />
                    Create a <code>.yaml</code> file to define new skills.
                </div>
            ) : (
                skills.map(s => <SkillCard skill={s} />)
            )}
            <div className="skills-footer">
                <div className="skills-hint">
                    <span className="hint-icon">💡</span>
                    <span>
                        Skills are YAML files placed in <code>skills/</code>. Each skill defines CLI commands the agent can use via the <code>exec</code> tool.
                        Toggle skills per-agent using the chips in the chat header.
                    </span>
                </div>
            </div>
        </div>,
        container
    )
}

export default function mount() {
    loadSkills()
    return () => { }
}
