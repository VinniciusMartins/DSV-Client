const DEFAULT_BASE_URL = 'https://www.apinfautprd.com/api';

let baseApiUrl = DEFAULT_BASE_URL;

function sanitizeBase(url) {
    if (!url || typeof url !== 'string') return DEFAULT_BASE_URL;
    const trimmed = url.trim();
    if (!trimmed) return DEFAULT_BASE_URL;
    return trimmed.replace(/\/+$/, '');
}

function setBaseApiUrl(url) {
    baseApiUrl = sanitizeBase(url);
}

function getBaseApiUrl() {
    return baseApiUrl;
}

function buildApiUrl(path = '') {
    const base = getBaseApiUrl();
    if (!path) return base;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
}

module.exports = {
    DEFAULT_BASE_URL,
    setBaseApiUrl,
    getBaseApiUrl,
    buildApiUrl
};
