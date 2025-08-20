class AuthService {
    constructor() {
        this.user = null;
        this.token = null; // if your API returns a token/JWT
    }

    async login(email, password) {
        try {
            // Use global fetch (Node 18+/Electron)
            const res = await fetch('http://18.228.150.85/api/electron-login', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                return { success: false, message: data.message || 'Invalid credentials', data };
            }

            // Expecting Breeze-like payload; adjust field names as your API returns
            // e.g., { user: {...}, token: '...' }
            this.user = data.user || data.data || data;
            this.token = data.token || null;

            return { success: true, message: 'Login successful', user: this.user, token: this.token };
        } catch (e) {
            return { success: false, message: e?.message || 'Network error' };
        }
    }

    async getUser() {
        if (!this.user) return { success: false, message: 'Not logged in' };
        return { success: true, user: this.user, token: this.token };
    }

    async logout() {
        this.user = null;
        this.token = null;
        return { success: true };
    }
}

module.exports = AuthService;
