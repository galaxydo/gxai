// Example: Agent refactors a messy codebase into clean modules
// Given a single monolithic file, the agent splits it into proper modules with imports
import { Agent } from "../src"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"

const dir = join(import.meta.dir, ".refactor")
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

// Write a messy monolithic file
await Bun.write(join(dir, "app.ts"), `
// Everything in one file — messy!
interface User { id: number; name: string; email: string }
interface Post { id: number; authorId: number; title: string; body: string }

const users: User[] = []
const posts: Post[] = []
let nextUserId = 1
let nextPostId = 1

function createUser(name: string, email: string): User {
    const user = { id: nextUserId++, name, email }
    users.push(user)
    return user
}

function getUser(id: number): User | undefined {
    return users.find(u => u.id === id)
}

function createPost(authorId: number, title: string, body: string): Post {
    if (!getUser(authorId)) throw new Error("User not found")
    const post = { id: nextPostId++, authorId, title, body }
    posts.push(post)
    return post
}

function getPostsByUser(userId: number): Post[] {
    return posts.filter(p => p.authorId === userId)
}

function formatUser(user: User): string {
    return \`\${user.name} <\${user.email}>\`
}

function formatPost(post: Post): string {
    const author = getUser(post.authorId)
    return \`[\${post.title}] by \${author ? formatUser(author) : "unknown"}\`
}

// Main
const alice = createUser("Alice", "alice@example.com")
const bob = createUser("Bob", "bob@example.com")
createPost(alice.id, "Hello World", "My first post!")
createPost(bob.id, "TypeScript Tips", "Use strict mode.")
createPost(alice.id, "Bun is Fast", "Seriously, try it.")

console.log("Users:", users.map(formatUser))
console.log("Alice's posts:", getPostsByUser(alice.id).map(formatPost))
console.log("All posts:", posts.map(formatPost))
`)

const agent = new Agent({
    model: "gemini-2.5-flash",
    cwd: dir,
    skills: [join(import.meta.dir, "../skills/bun.yaml")],
    maxIterations: 8,
    objectives: [
        {
            name: "types_module",
            description: "types.ts exists with User and Post interfaces",
            validate: async () => {
                const f = Bun.file(join(dir, "types.ts"))
                if (!(await f.exists())) return { met: false, reason: "types.ts missing" }
                const t = await f.text()
                if (!t.includes("interface User") || !t.includes("interface Post"))
                    return { met: false, reason: "Missing interfaces" }
                return { met: true, reason: "types.ts has both interfaces" }
            },
        },
        {
            name: "users_module",
            description: "users.ts exists with createUser and getUser",
            validate: async () => {
                const f = Bun.file(join(dir, "users.ts"))
                if (!(await f.exists())) return { met: false, reason: "users.ts missing" }
                const t = await f.text()
                if (!t.includes("createUser") || !t.includes("getUser"))
                    return { met: false, reason: "Missing functions" }
                if (!t.includes("import") || !t.includes("types"))
                    return { met: false, reason: "Should import from types.ts" }
                return { met: true, reason: "users.ts with proper imports" }
            },
        },
        {
            name: "posts_module",
            description: "posts.ts exists with createPost and getPostsByUser",
            validate: async () => {
                const f = Bun.file(join(dir, "posts.ts"))
                if (!(await f.exists())) return { met: false, reason: "posts.ts missing" }
                const t = await f.text()
                if (!t.includes("createPost")) return { met: false, reason: "Missing createPost" }
                return { met: true, reason: "posts.ts exists" }
            },
        },
        {
            name: "app_works",
            description: "Run the refactored app.ts with 'bun run app.ts' — should print users and posts",
            validate: (state) => {
                const last = state.toolHistory.findLast(
                    t => t.tool === "exec" && t.params.command?.includes("bun run app.ts")
                )
                if (!last) return { met: false, reason: "Haven't run app.ts yet" }
                if (!last.result.success) return { met: false, reason: `Failed: ${last.result.error}` }
                if (!last.result.output.includes("Alice")) return { met: false, reason: "Output doesn't include Alice" }
                return { met: true, reason: "App runs correctly" }
            },
        },
    ],
})

console.log("🔄 Refactor: split monolithic app.ts into clean modules\n")

for await (const event of agent.run(
    "Refactor app.ts: extract types into types.ts, user functions into users.ts, post functions into posts.ts, formatters into format.ts. Update app.ts to import from these modules. Make sure 'bun run app.ts' still works."
)) {
    switch (event.type) {
        case "iteration_start":
            console.log(`\n── Iteration ${event.iteration} ──`)
            break
        case "thinking":
            console.log(`💭 ${event.message.substring(0, 250)}`)
            break
        case "tool_start":
            console.log(`🔧 ${event.tool}(${JSON.stringify(event.params).substring(0, 100)})`)
            break
        case "tool_result":
            console.log(`   ${event.result.success ? "✓" : "✗"} ${event.result.output.substring(0, 150)}`)
            break
        case "objective_check":
            for (const r of event.results) console.log(`   ${r.met ? "✅" : "❌"} ${r.name}: ${r.reason}`)
            break
        case "complete":
            console.log(`\n🎉 Refactored in ${event.iteration + 1} iterations`)
            break
    }
}

// Show new structure
const { readdirSync } = await import("fs")
console.log("\n📁 New file structure:", readdirSync(dir).filter(f => f.endsWith(".ts")))

rmSync(dir, { recursive: true, force: true })
