// smart-agent/src/skills.ts
// Loads YAML skill files and formats them for the system prompt
import yaml from "js-yaml"
import type { Skill } from "./types"

/** Load skills from file paths or inline objects */
export async function loadSkills(skills: (string | Skill)[]): Promise<Skill[]> {
    const loaded: Skill[] = []

    for (const skill of skills) {
        if (typeof skill === "string") {
            // YAML file path — lazy load
            const file = Bun.file(skill)
            if (!(await file.exists())) {
                console.warn(`[smart-agent] Skill file not found: ${skill}`)
                continue
            }
            const content = await file.text()
            const parsed = yaml.load(content) as Skill
            if (parsed && parsed.name && parsed.commands) {
                loaded.push(parsed)
            } else {
                console.warn(`[smart-agent] Invalid skill file: ${skill}`)
            }
        } else {
            loaded.push(skill)
        }
    }

    return loaded
}

/** Format loaded skills into a system prompt section */
export function formatSkillsForPrompt(skills: Skill[]): string {
    if (skills.length === 0) return ""

    const sections = skills.map(skill => {
        const cmds = skill.commands
            .map(cmd => {
                const params = cmd.params
                    ? Object.entries(cmd.params).map(([k, v]) => `      ${k}: ${v}`).join("\n")
                    : ""
                return `    ${cmd.name}: ${cmd.description}\n      Usage: ${cmd.usage}${params ? `\n      Params:\n${params}` : ""}`
            })
            .join("\n")
        return `  ${skill.name} — ${skill.description}\n${cmds}`
    })

    return `\nAVAILABLE SKILLS (use via exec tool):\n${sections.join("\n\n")}`
}
