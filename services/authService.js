const apiConfig = require('./apiConfig');
const { setApiBaseUrl, resetApiBaseUrl } = apiConfig;

const DEV_LOGIN_EMAIL = 'dev@dev.com';
const DEV_API_BASE_URL = 'https://dev.apinfautprd.com';

class AuthService {
    constructor() {
        this.user = null;
        this.token = null; // if your API returns a token/JWT
    }

    async login(email, password) {
        try {
            const normalizedEmail = String(email || '').trim().toLowerCase();
            if (normalizedEmail === DEV_LOGIN_EMAIL) {
                setApiBaseUrl(DEV_API_BASE_URL);
            } else {
                resetApiBaseUrl();
            }

            // Use global fetch (Node 18+/Electron)
            const { login: loginUrl } = apiConfig.getEndpoints();

            const res = await fetch(loginUrl, {
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
