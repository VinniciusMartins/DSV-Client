// services/apiConfig.js

const DEFAULT_API_BASE_URL = 'https://www.apinfautprd.com';

let API_BASE_URL = DEFAULT_API_BASE_URL;
let API_ROOT = `${API_BASE_URL}/api`;

const endpoints = {
    login: `${API_ROOT}/electron-login`,
    printQueue: `${API_ROOT}/printQueue`,
    updatePdfStatus: `${API_ROOT}/updatePdfStatus`,
    zebraQueue: `${API_ROOT}/zebra/zebraQueue`
};

function rebuildEndpoints() {
    endpoints.login = `${API_ROOT}/electron-login`;
    endpoints.printQueue = `${API_ROOT}/printQueue`;
    endpoints.updatePdfStatus = `${API_ROOT}/updatePdfStatus`;
    endpoints.zebraQueue = `${API_ROOT}/zebra/zebraQueue`;
}

function normalizeBaseUrl(baseUrl) {
    if (!baseUrl) return DEFAULT_API_BASE_URL;
    return String(baseUrl).replace(/\/+$/, '');
}

function setApiBaseUrl(baseUrl) {
    API_BASE_URL = normalizeBaseUrl(baseUrl);
    API_ROOT = `${API_BASE_URL}/api`;
    rebuildEndpoints();
    return API_BASE_URL;
}

function resetApiBaseUrl() {
    return setApiBaseUrl(DEFAULT_API_BASE_URL);
}

function getApiBaseUrl() {
    return API_BASE_URL;
}

function getApiRoot() {
    return API_ROOT;
}

module.exports = {
    DEFAULT_API_BASE_URL,
    endpoints,
    getApiBaseUrl,
    getApiRoot,
    resetApiBaseUrl,
    setApiBaseUrl
};
