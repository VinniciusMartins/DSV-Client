const $ = (id) => document.getElementById(id);
const form = $('loginForm');
const emailEl = $('email');
const passEl = $('password');
const msgEl = $('msg');
const btn = $('loginBtn');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    btn.disabled = true;

    const email = emailEl.value.trim();
    const password = passEl.value;

    const res = await window.AuthAPI.login(email, password);
    if (!res.success) {
        msgEl.className = 'msg err';
        msgEl.textContent = res.message || 'Login failed';
        btn.disabled = false;
        return;
    }

    // Show success then navigate to print UI
    msgEl.className = 'msg ok';
    msgEl.textContent = 'Login successful. Opening print menu...';
    setTimeout(() => {
        window.location.replace('./index.html');
    }, 800);
});
