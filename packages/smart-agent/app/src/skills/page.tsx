// app/src/skills/page.tsx — Skills management page
const SKILLS = [
    { id: 'bun', name: 'Bun Runtime', icon: '⚡', desc: 'Execute JavaScript/TypeScript code using the Bun runtime.', builtin: true },
    { id: 'docker', name: 'Docker', icon: '🐳', desc: 'Build, run, and manage Docker containers.', builtin: true },
    { id: 'git', name: 'Git', icon: '🌿', desc: 'Version control operations — commit, push, branch, merge.', builtin: true },
    { id: 'npm', name: 'NPM', icon: '📦', desc: 'Install and manage Node.js packages.', builtin: true },
    { id: 'browser', name: 'Browser', icon: '🌐', desc: 'Browse the web, scrape pages, and interact with websites.', builtin: false },
    { id: 'filesystem', name: 'Filesystem', icon: '📁', desc: 'Read, write, and manage files on the local system.', builtin: true },
]

export default function SkillsPage() {
    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Skills</h1>
                <p className="page-subtitle">Skills give agents access to tools and external systems. Built-in skills are always available.</p>
            </div>

            <div className="skills-list">
                {SKILLS.map(s => (
                    <div className={`skill-row ${s.builtin ? 'builtin' : ''}`} key={s.id}>
                        <div className="skill-icon">{s.icon}</div>
                        <div className="skill-info">
                            <h3>{s.name}</h3>
                            <p>{s.desc}</p>
                        </div>
                        <div className="skill-status">
                            {s.builtin
                                ? <span className="skill-badge builtin">Built-in</span>
                                : <span className="skill-badge optional">Optional</span>
                            }
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
