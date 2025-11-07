class AuthService {
    constructor() {
        this.user = null;
        this.token = null; // if your API returns a token/JWT
    }

    async login(email, password) {
        try {
            const normalizedEmail = String(email || '').trim().toLowerCase();
            if (normalizedEmail === AuthService.DEV_LOGIN_EMAIL) {
                AuthService.setApiBaseUrl(AuthService.DEV_API_BASE_URL);
            } else {
                AuthService.resetApiBaseUrl();
            }

            // Use global fetch (Node 18+/Electron)
            const { login: loginUrl } = AuthService.getApiEndpoints();

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
        AuthService.resetApiBaseUrl();
        return { success: true };
    }

    static normalizeBaseUrl(baseUrl) {
        if (!baseUrl) return AuthService.DEFAULT_API_BASE_URL;
        return String(baseUrl).replace(/\/+$/, '');
    }

    static setApiBaseUrl(baseUrl) {
        AuthService._apiBaseUrl = AuthService.normalizeBaseUrl(baseUrl);
        return AuthService._apiBaseUrl;
    }

    static resetApiBaseUrl() {
        return AuthService.setApiBaseUrl(AuthService.DEFAULT_API_BASE_URL);
    }

    static getApiBaseUrl() {
        return AuthService._apiBaseUrl;
    }

    static getApiEndpoints() {
        const base = AuthService.getApiBaseUrl();
        const apiRoot = `${base}/api`;
        return {
            login: `${apiRoot}/electron-login`,
            printQueue: `${apiRoot}/printQueue`,
            updatePdfStatus: `${apiRoot}/updatePdfStatus`,
            zebraQueue: `${apiRoot}/zebra/zebraQueue`
        };
    }

    static getApiConfig() {
        return {
            baseUrl: AuthService.getApiBaseUrl(),
            endpoints: AuthService.getApiEndpoints()
        };
    }
}

AuthService.DEFAULT_API_BASE_URL = 'https://www.apinfautprd.com';
AuthService.DEV_API_BASE_URL = 'https://dev.apinfautprd.com';
AuthService.DEV_LOGIN_EMAIL = 'dev@dev.com';
AuthService._apiBaseUrl = AuthService.DEFAULT_API_BASE_URL;

module.exports = AuthService;
