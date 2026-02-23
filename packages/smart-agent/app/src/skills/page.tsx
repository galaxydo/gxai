// app/src/skills/page.tsx — Skills discovery page
export default function SkillsPage() {
    return (
        <div className="page-container" id="skills-page">
            <div className="page-header">
                <h1>Agent Skills</h1>
                <p className="page-subtitle">Skills are YAML files that teach your agents how to use CLI tools. They're automatically discovered from the <code>skills/</code> directory.</p>
            </div>
            <div id="skills-content" className="skills-content">
                <div className="overview-empty">Discovering skills…</div>
            </div>
        </div>
    )
}
