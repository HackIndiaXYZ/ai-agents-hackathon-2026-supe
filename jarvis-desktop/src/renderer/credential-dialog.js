(function () {
    const emailEl = document.getElementById('email');
    const passwordEl = document.getElementById('password');
    const errorEl = document.getElementById('error');
    const saveBtn = document.getElementById('save');
    const cancelBtn = document.getElementById('cancel');

    function showError(message) {
        errorEl.textContent = message || '';
    }

    function submit() {
        const email = emailEl.value.trim();
        const password = passwordEl.value;
        if (!email || !email.includes('@')) {
            showError('Enter a valid Google email.');
            emailEl.focus();
            return;
        }
        if (!password) {
            showError('Enter the password.');
            passwordEl.focus();
            return;
        }
        saveBtn.disabled = true;
        window.electronAPI.submitCredentialDialog({ email, password });
    }

    saveBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => window.electronAPI.cancelCredentialDialog());
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submit();
        if (event.key === 'Escape') window.electronAPI.cancelCredentialDialog();
    });
    window.electronAPI.onCredentialDialogError((message) => {
        saveBtn.disabled = false;
        showError(message);
    });
    emailEl.focus();
})();
