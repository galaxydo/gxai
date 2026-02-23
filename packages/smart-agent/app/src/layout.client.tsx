// layout.client.tsx — Persistent layout script (runs once, survives navigation)
export default function mount() {
    // Highlight active nav rail item based on current path
    function updateActiveNav() {
        const path = location.pathname
        document.querySelectorAll('.nav-rail-btn[href]').forEach(btn => {
            const href = btn.getAttribute('href')!
            const isActive = href === '/' ? path === '/' : path.startsWith(href)
            btn.classList.toggle('active', isActive)
        })
    }

    updateActiveNav()
    window.addEventListener('melina:navigated', updateActiveNav)

    // Nav rail Settings button — navigate to home page (where settings modal lives)
    const settingsBtn = document.getElementById('nav-settings-btn')
    const handleSettings = (e: Event) => {
        e.preventDefault()
        // If on home page, try to open settings modal directly
        const openSettingsEvt = new CustomEvent('smart-agent:open-settings')
        window.dispatchEvent(openSettingsEvt)
    }
    settingsBtn?.addEventListener('click', handleSettings)

    return () => {
        window.removeEventListener('melina:navigated', updateActiveNav)
        settingsBtn?.removeEventListener('click', handleSettings)
    }
}
