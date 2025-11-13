const { DEFAULT_BASE_URL, setBaseApiUrl, getBaseApiUrl } = require('./apiConfig');

class AuthService {
    constructor() {
        this.user = null;
        this.token = null; // if your API returns a token/JWT
    }

    _resolveBaseUrl(email) {
        const normalized = String(email || '').trim().toLowerCase();
        if (normalized === 'dev@dev.com') {
            return 'https://dev.apinfautprd.com/api';
        }
        return DEFAULT_BASE_URL;
    }

    async login(email, password) {
        const baseUrl = this._resolveBaseUrl(email);
        setBaseApiUrl(baseUrl);
        const resolvedBaseUrl = getBaseApiUrl();

        try {
            // Use global fetch (Node 18+/Electron)
            const res = await fetch(`${resolvedBaseUrl}/electron-login`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                return { success: false, message: data.message || 'Invalid credentials', data, baseUrl: getBaseApiUrl() };
            }

            // Expecting Breeze-like payload; adjust field names as your API returns
            // e.g., { user: {...}, token: '...' }
            this.user = data.user || data.data || data;
            this.token = data.token || null;

            return { success: true, message: 'Login successful', user: this.user, token: this.token, baseUrl: getBaseApiUrl() };
        } catch (e) {
            return { success: false, message: e?.message || 'Network error', baseUrl: getBaseApiUrl() };
        }
    }

    async getUser() {
        if (!this.user) return { success: false, message: 'Not logged in', baseUrl: getBaseApiUrl() };
        return { success: true, user: this.user, token: this.token, baseUrl: getBaseApiUrl() };
    }

    getBaseUrl() {
        return { success: true, baseUrl: getBaseApiUrl() };
    }

    async logout() {
        this.user = null;
        this.token = null;
        setBaseApiUrl(DEFAULT_BASE_URL);
        return { success: true };
    }
}

module.exports = AuthService;
