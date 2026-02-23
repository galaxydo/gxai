// app/src/page.tsx — Server-rendered chat page
// Renders the static shell. Client mount script adds all interactivity.
export default function ChatPage() {
    return (
        <div className="app-shell">
            <header className="header">
                <h1 className="header-title">
                    <span className="header-icon">🤖</span>
                    smart-agent
                </h1>
                <div className="header-controls">
                    <div id="skill-toggles" className="skill-toggles"></div>
                    <select id="model-select" className="model-select">
                        <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                        <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="claude-sonnet-4-20250514">Claude Sonnet</option>
                        <option value="deepseek-chat">DeepSeek Chat</option>
                    </select>
                </div>
            </header>

            <div id="chat-area" className="chat-area">
                <div id="empty-state" className="empty-state">
                    <div className="empty-icon">🤖</div>
                    <h2>What should I build?</h2>
                    <p>Describe a task and I'll generate objectives, use tools, and work until it's done.</p>
                    <div className="example-chips">
                        <button className="example-chip" data-prompt="Create a hello.txt file with 'Hello World'">Create a file</button>
                        <button className="example-chip" data-prompt="Create a TypeScript project with an add function and passing tests">Scaffold a project</button>
                        <button className="example-chip" data-prompt="Write a Fibonacci function in fib.ts and verify it outputs the first 10 numbers">Write &amp; test code</button>
                    </div>
                </div>
            </div>

            <div className="input-area">
                <div className="input-row">
                    <textarea id="input" className="input-field" placeholder="Describe what you want the agent to do..." rows={1}></textarea>
                    <button id="send-btn" className="send-btn" title="Send">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
