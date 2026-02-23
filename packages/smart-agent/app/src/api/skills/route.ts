// app/src/api/skills/route.ts — Skill discovery API
import { join } from 'path'
import { readdirSync } from 'fs'
import yaml from 'js-yaml'
import { measureSync } from 'measure-fn'

const skillsDir = join(import.meta.dir, '../../../../skills')

export interface SkillInfo {
    id: string         // filename without extension
    name: string
    description: string
    commands: Array<{
        name: string
        description: string
        usage: string
        params?: Record<string, string>
    }>
    filePath: string
}

// ── GET /api/skills — Discover and return all skill files ──

export async function GET() {
    const skills = measureSync('Discover skills', () => {
        const result: SkillInfo[] = []
        try {
            for (const f of readdirSync(skillsDir)) {
                if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue
                const id = f.replace(/\.(yaml|yml)$/, '')
                const filePath = join(skillsDir, f)
                try {
                    const content = require('fs').readFileSync(filePath, 'utf-8')
                    const parsed = yaml.load(content) as any
                    if (parsed?.name && parsed?.commands) {
                        result.push({
                            id,
                            name: parsed.name,
                            description: parsed.description || '',
                            commands: parsed.commands || [],
                            filePath,
                        })
                    }
                } catch { /* skip unparseable files */ }
            }
        } catch { /* skills dir doesn't exist yet */ }
        return result
    })

    return Response.json(skills)
}
