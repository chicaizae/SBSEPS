/**
 * Due Diligence - Seguridad de la Información & Cumplimiento SB/SEPS
 * Interactive Dashboard, Drill-down, Roles and Custom Reports Generation
 */

document.addEventListener('DOMContentLoaded', () => {
    // Application State
    const state = {
        evaluationId: '',     // Current evaluation ID
        fileName: '',         // Template filename
        companyName: 'Corporación CFC S.A.',
        evaluatorName: '',
        evaluationDate: new Date().toISOString().split('T')[0],
        orgSettings: {
            companyName: 'Corporacion CFC S.A.',
            legalRepresentative: 'Representante Legal',
            logoUrl: 'CFC.png'
        },
        
        // Active evaluation rows
        rows: [],
        
        // Current user profile/role
        currentRole: 'auditor', // default
        currentUser: null,
        
        // Active Report Type
        activeReportType: 'exec-summary',

        // Chart instances
        charts: {
            states: null,
            priorities: null,
            categories: null,
            evolution: null
        },
        
        // Active view target
        activeSection: 'sec-dashboard-exec',
        
        // Dynamic filters (used for drill-down)
        filters: {
            category: 'all',
            state: 'all',
            priority: 'all',
            phase: 'all',
            domain: 'all',
            normative: 'all',
            gapOnly: false
        }
    };

    // DOM Elements
    const welcomeScreen = document.getElementById('upload-screen');
    const loginScreen = document.getElementById('login-screen');
    const workspace = document.getElementById('workspace');
    const companyInput = document.getElementById('company-name');
    const evaluatorInput = document.getElementById('evaluator-name');
    const dateInput = document.getElementById('evaluation-date');
    const dbEvaluationsList = document.getElementById('db-evaluations-list');
    
    // Sidebar elements
    const badgeCompany = document.getElementById('badge-company');
    const badgeDate = document.getElementById('badge-date');
    const gapCountBadge = document.getElementById('gap-count');
    const roleSelect = document.getElementById('user-role-select');
    const passwordModal = document.getElementById('password-modal');
    
    // Set default date input value to today
    dateInput.value = state.evaluationDate;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function safeUploadHref(value) {
        const href = String(value || '');
        return href.startsWith('/uploads/') ? href : '#';
    }

    function getLogoHtml(className = '') {
        const safeUrl = escapeAttribute(state.orgSettings.logoUrl || 'CFC.png');
        const safeAlt = escapeAttribute(`Logo ${state.orgSettings.companyName || 'institucional'}`);
        return `<img class="${className}" src="${safeUrl}" alt="${safeAlt}" onerror="this.style.display='none';">`;
    }

    function applyOrgSettings(settings = {}) {
        state.orgSettings = {
            companyName: settings.companyName || state.orgSettings.companyName,
            legalRepresentative: settings.legalRepresentative || state.orgSettings.legalRepresentative,
            logoUrl: settings.logoUrl || state.orgSettings.logoUrl
        };

        document.title = `Due Diligence - ${state.orgSettings.companyName}`;

        const sidebarLogo = document.querySelector('.sidebar-logo-container img');
        if (sidebarLogo) {
            sidebarLogo.src = state.orgSettings.logoUrl;
            sidebarLogo.alt = `Logo ${state.orgSettings.companyName}`;
            sidebarLogo.style.display = '';
        }

        if (companyInput && (!companyInput.value.trim() || companyInput.value.includes('CFC'))) {
            companyInput.value = state.orgSettings.companyName;
        }

        const settingsCompany = document.getElementById('settings-company-name');
        const settingsLegal = document.getElementById('settings-legal-rep');
        const previewLogo = document.getElementById('settings-logo-preview');
        const previewCompany = document.getElementById('settings-company-preview');
        const previewLegal = document.getElementById('settings-legal-preview');

        if (settingsCompany) settingsCompany.value = state.orgSettings.companyName;
        if (settingsLegal) settingsLegal.value = state.orgSettings.legalRepresentative;
        if (previewLogo) {
            previewLogo.src = state.orgSettings.logoUrl;
            previewLogo.style.display = '';
        }
        if (previewCompany) previewCompany.textContent = state.orgSettings.companyName;
        if (previewLegal) previewLegal.textContent = state.orgSettings.legalRepresentative;
    }

    async function loadOrgSettings() {
        try {
            const data = await requestJson('/api/settings');
            applyOrgSettings(data.settings);
        } catch (e) {
            console.error('Error loading organization settings:', e);
        }
    }

    // Initialize Lucide Icons
    lucide.createIcons();

    async function requestJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : (options.headers || {}),
            ...options
        });
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : null;
        if (!response.ok) {
            throw new Error(data?.error || `HTTP ${response.status}`);
        }
        return data;
    }

    function applyAuthenticatedUser(user) {
        state.currentUser = user;
        state.currentRole = user.role;
        roleSelect.value = user.role;
        document.body.classList.toggle('is-admin', user.role === 'admin');
        loginScreen.style.display = 'none';
        
        if (user.mustChangePassword) {
            showToast('Cambie la contraseña inicial del usuario.', 'info');
            passwordModal.style.display = 'flex';
        }
        
        // Flujo diferenciado por rol
        if (user.role === 'auditor') {
            // Auditor: mostrar pantalla de upload/selección
            welcomeScreen.style.display = 'flex';
            workspace.style.display = 'none';
            loadSavedEvaluationsList();
        } else {
            // Admin, Técnico, Revisor, Informes: ir directo a la plataforma
            welcomeScreen.style.display = 'none';
            loadSavedEvaluationsList();
            // Cargar la primera evaluación disponible o mostrar dashboard vacío
            setTimeout(async () => {
                try {
                    const data = await requestJson('/api/evaluations');
                    if (data.success && data.evaluations && data.evaluations.length > 0) {
                        // Cargar la primera evaluación
                        await loadEvaluationFromDb(data.evaluations[0].id);
                    } else {
                        // Si no hay evaluaciones, mostrar workspace vacío
                        state.evaluationId = '';
                        state.companyName = state.orgSettings.companyName;
                        state.evaluatorName = user.displayName || user.username;
                        state.rows = [];
                        badgeCompany.textContent = state.companyName;
                        badgeDate.textContent = new Date().toISOString().split('T')[0];
                        workspace.style.display = 'flex';
                        applyRoleRestrictions();
                        switchSection('sec-dashboard-exec');
                    }
                } catch (e) {
                    console.error('Error loading evaluations:', e);
                    workspace.style.display = 'flex';
                    applyRoleRestrictions();
                    switchSection('sec-dashboard-exec');
                }
            }, 300);
        }
    }

    async function refreshCaptcha() {
        try {
            const data = await requestJson('/api/auth/captcha');
            document.getElementById('captcha-question').textContent = data.question;
            document.getElementById('login-captcha').value = '';
        } catch (e) {
            showToast('No se pudo generar el captcha.', 'error');
        }
    }

    async function initializeAuth() {
        try {
            const data = await requestJson('/api/auth/me');
            await loadOrgSettings();
            applyAuthenticatedUser(data.user);
        } catch (e) {
            loginScreen.style.display = 'flex';
            welcomeScreen.style.display = 'none';
            workspace.style.display = 'none';
            refreshCaptcha();
        }
    }

    document.getElementById('btn-refresh-captcha').addEventListener('click', refreshCaptcha);
    document.getElementById('btn-login').addEventListener('click', async () => {
        try {
            const data = await requestJson('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    username: document.getElementById('login-username').value.trim(),
                    password: document.getElementById('login-password').value,
                    captcha: document.getElementById('login-captcha').value.trim()
                })
            });
            await loadOrgSettings();
            applyAuthenticatedUser(data.user);
            showToast('Ingreso correcto.', 'success');
        } catch (e) {
            showToast(e.message, 'error');
            refreshCaptcha();
        }
    });

    // Fetch and display saved evaluations from DB
    async function loadSavedEvaluationsList() {
        try {
            const data = await requestJson('/api/evaluations');
            
            if (!data.success) {
                dbEvaluationsList.innerHTML = `<p style="color: var(--color-danger); text-align: center; margin-top: 20px; font-size:0.8rem;">Error: ${data.error}</p>`;
                return;
            }

            if (!data.evaluations.length) {
                dbEvaluationsList.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); margin-top: 25px; font-size: 0.8rem;">
                        <i data-lucide="info" style="width:20px;height:20px;margin-bottom:5px;display:inline-block;"></i>
                        <p>No hay evaluaciones guardadas en la base de datos.</p>
                    </div>
                `;
                lucide.createIcons({ container: dbEvaluationsList });
                return;
            }

            dbEvaluationsList.innerHTML = '';
            data.evaluations.forEach(h => {
                const btn = document.createElement('div');
                btn.className = 'menu-item';
                btn.style.cursor = 'pointer';
                btn.style.padding = '8px 10px';
                btn.style.marginBottom = '6px';
                btn.style.background = '#f8fafc';
                btn.style.border = '1px solid var(--border-color)';
                btn.style.borderRadius = 'var(--radius-sm)';
                btn.style.display = 'flex';
                btn.style.justifyContent = 'space-between';
                btn.style.alignItems = 'center';

                btn.innerHTML = `
                    <div style="flex-grow:1; min-width:0; margin-right:10px;">
                        <div style="font-weight:600; font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary);">
                            ${escapeHtml(h.company_name)}
                        </div>
                        <div style="font-size:0.7rem; color:var(--text-secondary);">
                            ${escapeHtml(h.evaluation_date)} | ${escapeHtml(h.evaluator_name || 'Auditor')}
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="badge badge-success" style="font-size:0.7rem;">${escapeHtml(h.compliance_pct)}%</span>
                        <button class="btn btn-secondary btn-sm delete-db-btn" data-id="${escapeAttribute(h.id)}" style="padding:2px 4px; background:transparent; border:none; color:var(--color-danger);">
                            <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
                        </button>
                    </div>
                `;
                
                btn.addEventListener('click', (e) => {
                    if (e.target.closest('.delete-db-btn')) return;
                    loadEvaluationFromDb(h.id);
                });

                const delBtn = btn.querySelector('.delete-db-btn');
                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`¿Está seguro de eliminar permanentemente la evaluación de ${h.company_name} del ${h.evaluation_date}?`)) {
                        await deleteEvaluation(h.id);
                    }
                });

                dbEvaluationsList.appendChild(btn);
            });
            lucide.createIcons({ container: dbEvaluationsList });
            applyRoleRestrictions();
        } catch (e) {
            console.error('Error fetching evaluations from DB:', e);
            dbEvaluationsList.innerHTML = `<p style="color: var(--color-danger); text-align: center; margin-top: 20px; font-size:0.8rem;">Error al conectar con el servidor.</p>`;
        }
    }

    // Call auth check on startup
    initializeAuth();

    // Start a new evaluation using the template
    document.getElementById('btn-start-new').addEventListener('click', async () => {
        const company = companyInput.value.trim();
        const evaluator = evaluatorInput.value.trim();
        const evalDate = dateInput.value;

        if (!company) {
            showToast('Por favor ingrese el nombre de la empresa', 'error');
            return;
        }

        try {
            showToast('Cargando plantilla de controles...', 'info');
            const response = await fetch('/api/template');
            const data = await response.json();

            if (!data.success) {
                showToast('Error al cargar la plantilla: ' + data.error, 'error');
                return;
            }

            state.evaluationId = 'eval_' + Date.now();
            state.fileName = data.templateName;
            state.companyName = company;
            state.evaluatorName = evaluator || state.currentUser?.displayName || state.currentUser?.username || 'Auditor General';
            state.evaluationDate = evalDate || new Date().toISOString().split('T')[0];
            
            state.rows = data.rows.map(r => {
                const copy = { ...r };
                recalculateRowFormulas(copy);
                return copy;
            });

            populateCategoryFilter();

            badgeCompany.textContent = state.companyName;
            badgeDate.textContent = state.evaluationDate;
            welcomeScreen.style.display = 'none';
            workspace.style.display = 'flex';

            applyRoleRestrictions();
            switchSection('sec-dashboard-exec');
            showToast('Nueva evaluación inicializada', 'success');
        } catch (e) {
            console.error(e);
            showToast('Error al inicializar nueva evaluación.', 'error');
        }
    });

    // Load evaluation from DB
    async function loadEvaluationFromDb(id) {
        try {
            showToast('Cargando evaluación...', 'info');
            const response = await fetch(`/api/evaluations/${id}`);
            const data = await response.json();

            if (!data.success) {
                showToast('Error al cargar la evaluación: ' + data.error, 'error');
                return;
            }

            state.evaluationId = data.evaluation.id;
            state.companyName = data.evaluation.company_name;
            state.evaluatorName = data.evaluation.evaluator_name;
            state.evaluationDate = data.evaluation.evaluation_date;
            state.rows = data.rows;

            state.rows.forEach(r => recalculateRowFormulas(r));
            populateCategoryFilter();

            badgeCompany.textContent = state.companyName;
            badgeDate.textContent = state.evaluationDate;
            welcomeScreen.style.display = 'none';
            workspace.style.display = 'flex';

            applyRoleRestrictions();
            switchSection('sec-dashboard-exec');
            showToast('Evaluación cargada correctamente', 'success');
        } catch (e) {
            console.error(e);
            showToast('Error al cargar la evaluación.', 'error');
        }
    }

    // Delete evaluation
    async function deleteEvaluation(id) {
        try {
            const response = await fetch(`/api/evaluations/${id}`, { method: 'DELETE' });
            const data = await response.json();
            if (data.success) {
                showToast('Evaluación eliminada', 'success');
                loadSavedEvaluationsList();
            } else {
                showToast('Error al eliminar: ' + data.error, 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Error al conectar con el servidor', 'error');
        }
    }

    // --- NAVIGATION MANAGEMENT ---
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSection = item.getAttribute('data-target');
            if (targetSection) {
                // If reports menu link, render reports
                switchSection(targetSection);
            }
        });
    });

    function switchSection(sectionId) {
        document.querySelectorAll('.content-section').forEach(sec => {
            sec.classList.remove('active');
        });
        document.querySelectorAll('.sidebar .menu-item').forEach(menu => {
            menu.classList.remove('active');
        });

        const targetSec = document.getElementById(sectionId);
        if (targetSec) {
            targetSec.classList.add('active');
            const matchingMenu = document.querySelector(`.sidebar .menu-item[data-target="${sectionId}"]`);
            if (matchingMenu) matchingMenu.classList.add('active');
            state.activeSection = sectionId;
            
            // Render view components
            if (sectionId === 'sec-dashboard-exec') {
                renderExecutiveDashboard();
            } else if (sectionId === 'sec-dashboard-tech') {
                renderTechnicalDashboard();
            } else if (sectionId === 'sec-reports') {
                renderReportsSection();
            } else if (sectionId === 'sec-evolution') {
                renderEvolutionSection();
            } else if (sectionId === 'sec-evaluation') {
                renderEvaluationList();
            } else if (sectionId === 'sec-gaps') {
                renderGapTracker();
            } else if (sectionId === 'sec-users') {
                renderUsersSection();
            } else if (sectionId === 'sec-settings') {
                renderSettingsSection();
            } else if (sectionId === 'sec-updates') {
                renderUpdatesSection();
            }
        }
    }

    // Populates category select in filters
    function populateCategoryFilter() {
        const categories = [...new Set(state.rows.map(r => r.category))].filter(Boolean);
        const catFilter = document.getElementById('category-filter');
        catFilter.innerHTML = '<option value="all">Todas las Categorías</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            catFilter.appendChild(opt);
        });
    }

    // Toast Notification helper
    function showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        const toastMessage = document.getElementById('toast-message');
        const toastIcon = document.getElementById('toast-icon');
        
        toast.className = `toast show ${type}`;
        toastMessage.textContent = message;
        
        if (type === 'success') {
            toastIcon.setAttribute('data-lucide', 'check-circle');
        } else if (type === 'error') {
            toastIcon.setAttribute('data-lucide', 'x-circle');
        } else {
            toastIcon.setAttribute('data-lucide', 'info');
        }
        lucide.createIcons({ attrs: { class: 'toast-icon-svg' } });
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);
    }

    // Manual upload fallback
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    fileInput.addEventListener('change', (e) => {
        e.target.value = '';
        showToast('La carga de Excel fue deshabilitada. Use la base de datos como fuente de controles.', 'error');
    });

    function handleManualExcelImport(file) {
        if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
            showToast('Por favor cargue un archivo de Excel válido', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellFormula: true, cellStyles: true });
                
                const sheet = workbook.Sheets['Matriz_DD_Unificada'];
                if (!sheet) {
                    showToast('No se encontró la hoja Matriz_DD_Unificada.', 'error');
                    return;
                }

                const range = XLSX.utils.decode_range(sheet['!ref']);
                const rowsData = [];
                for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                    const getCellVal = (c, def = '') => {
                        const cellRef = XLSX.utils.encode_cell({ r: R, c });
                        const cell = sheet[cellRef];
                        return (cell && cell.v !== undefined) ? cell.v : def;
                    };

                    const idVal = getCellVal(0);
                    if (!idVal) continue;

                    rowsData.push({
                        excelIndex: R,
                        id: idVal,
                        category: getCellVal(1),
                        subcategory: getCellVal(2),
                        control: getCellVal(3),
                        requirement: getCellVal(4),
                        evSource: getCellVal(5),
                        normative: getCellVal(6),
                        controlType: getCellVal(7),
                        domain: getCellVal(8),
                        score: getCellVal(9, ''),
                        state: getCellVal(10, 'Por evaluar'),
                        comment: getCellVal(11),
                        evidence: getCellVal(12),
                        topic: getCellVal(13),
                        priority: getCellVal(14, 'Media'),
                        t: getCellVal(19, ''),
                        u: getCellVal(20, ''),
                        v: getCellVal(21, ''),
                        w: Number(getCellVal(22, 0)),
                        x: getCellVal(23, '')
                    });
                }

                state.evaluationId = 'eval_' + Date.now();
                state.companyName = companyInput.value.trim() || 'Importación Manual';
                state.evaluatorName = evaluatorInput.value.trim() || 'Auditor';
                state.evaluationDate = dateInput.value || new Date().toISOString().split('T')[0];
                state.rows = rowsData;

                state.rows.forEach(r => recalculateRowFormulas(r));
                populateCategoryFilter();

                badgeCompany.textContent = state.companyName;
                badgeDate.textContent = state.evaluationDate;
                welcomeScreen.style.display = 'none';
                workspace.style.display = 'flex';

                applyRoleRestrictions();
                switchSection('sec-dashboard-exec');
                showToast('Importación completada con éxito', 'success');
            } catch (err) {
                console.error(err);
                showToast('Error al importar el archivo Excel.', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    // Drag and drop events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        }, false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        }, false);
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        showToast('La carga de Excel fue deshabilitada. Use la base de datos como fuente de controles.', 'error');
    });


    // --- ROLE AND ACCESS CONTROL MANAGEMENT ---
    roleSelect.addEventListener('change', (e) => {
        e.target.value = state.currentRole;
        applyRoleRestrictions();
        showToast('El perfil se asigna desde el usuario autenticado.', 'info');
    });

    function applyRoleRestrictions() {
        const role = state.currentRole;
        const evalLink = document.querySelector('.menu-item[data-target="sec-evaluation"]');
        const gapsLink = document.querySelector('.menu-item[data-target="sec-gaps"]');
        const saveBtn = document.getElementById('btn-save-eval');
        const changeBtn = document.getElementById('btn-change-file');
        const adminLink = document.querySelector('.menu-item[data-target="sec-users"]');
        const settingsLink = document.querySelector('.menu-item[data-target="sec-settings"]');
        const updatesLink = document.querySelector('.menu-item[data-target="sec-updates"]');
        const cardStartNew = document.getElementById('card-start-new-audit');

        // Reset visibility
        if (evalLink) evalLink.style.display = 'flex';
        if (gapsLink) gapsLink.style.display = 'flex';
        if (saveBtn) saveBtn.style.display = 'flex';
        if (changeBtn) changeBtn.style.display = 'flex';
        if (adminLink) adminLink.style.display = role === 'admin' ? 'flex' : 'none';
        if (settingsLink) settingsLink.style.display = role === 'admin' ? 'flex' : 'none';
        if (updatesLink) updatesLink.style.display = role === 'admin' ? 'flex' : 'none';
        if (cardStartNew) cardStartNew.style.display = role === 'auditor' ? 'flex' : 'none';

        if (role === 'informes') {
            // Read-only report view
            if (evalLink) evalLink.style.display = 'none';
            if (gapsLink) gapsLink.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'none';
        } else if (role === 'revisor') {
            // Cannot save to Database
            if (saveBtn) saveBtn.style.display = 'none';
        } else if (role === 'tecnico') {
            // Cannot save to Database or change files
            if (saveBtn) saveBtn.style.display = 'none';
            if (changeBtn) changeBtn.style.display = 'none';
        }
    }

    function renderSettingsSection() {
        if (state.currentRole !== 'admin') {
            showToast('Solo administradores pueden personalizar la instalacion.', 'error');
            switchSection('sec-dashboard-exec');
            return;
        }
        applyOrgSettings(state.orgSettings);
    }

    document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
        if (state.currentRole !== 'admin') {
            showToast('Solo administradores pueden personalizar la instalacion.', 'error');
            return;
        }

        const companyName = document.getElementById('settings-company-name').value.trim();
        const legalRepresentative = document.getElementById('settings-legal-rep').value.trim();
        const logoFile = document.getElementById('settings-logo').files[0];

        const formData = new FormData();
        formData.append('companyName', companyName);
        formData.append('legalRepresentative', legalRepresentative);
        if (logoFile) formData.append('logo', logoFile);

        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                credentials: 'same-origin',
                body: formData
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'No se pudo guardar la configuracion.');
            }

            document.getElementById('settings-logo').value = '';
            applyOrgSettings(data.settings);
            if (!state.evaluationId) {
                state.companyName = state.orgSettings.companyName;
                badgeCompany.textContent = state.companyName;
            }
            if (state.activeSection === 'sec-reports') generateReportPreview();
            showToast('Personalizacion institucional guardada.', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    document.getElementById('settings-logo')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const previewLogo = document.getElementById('settings-logo-preview');
        previewLogo.src = URL.createObjectURL(file);
        previewLogo.style.display = '';
    });

    async function renderUsersSection() {
        if (state.currentRole !== 'admin') {
            showToast('Solo administradores pueden gestionar usuarios.', 'error');
            switchSection('sec-dashboard-exec');
            return;
        }

        const tbody = document.querySelector('#table-users tbody');
        try {
            const data = await requestJson('/api/users');
            tbody.innerHTML = '';
            data.users.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${escapeHtml(u.username)}</strong></td>
                    <td><input type="text" class="user-name-input" value="${escapeAttribute(u.display_name)}"></td>
                    <td>
                        <select class="user-role-input form-select">
                            ${['admin', 'auditor', 'tecnico', 'revisor', 'informes'].map(role => `<option value="${role}" ${u.role === role ? 'selected' : ''}>${role}</option>`).join('')}
                        </select>
                    </td>
                    <td><input type="checkbox" class="user-active-input" ${u.active ? 'checked' : ''}></td>
                    <td>
                        <button class="btn btn-secondary btn-sm save-user-btn"><i data-lucide="save"></i></button>
                        <button class="btn btn-danger-outline btn-sm reset-user-pass-btn"><i data-lucide="key-round"></i></button>
                    </td>
                `;

                tr.querySelector('.save-user-btn').addEventListener('click', async () => {
                    try {
                        await requestJson(`/api/users/${u.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({
                                displayName: tr.querySelector('.user-name-input').value.trim(),
                                role: tr.querySelector('.user-role-input').value,
                                active: tr.querySelector('.user-active-input').checked
                            })
                        });
                        showToast('Usuario actualizado.', 'success');
                        renderUsersSection();
                    } catch (e) {
                        showToast(e.message, 'error');
                    }
                });

                tr.querySelector('.reset-user-pass-btn').addEventListener('click', async () => {
                    const password = prompt(`Nueva contraseña para ${u.username}:`);
                    if (!password) return;
                    try {
                        await requestJson(`/api/users/${u.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ password })
                        });
                        showToast('Contraseña restablecida.', 'success');
                    } catch (e) {
                        showToast(e.message, 'error');
                    }
                });

                tbody.appendChild(tr);
            });
            lucide.createIcons({ container: tbody });
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--color-danger)">${escapeHtml(e.message)}</td></tr>`;
        }
    }

    document.getElementById('btn-create-user').addEventListener('click', async () => {
        try {
            await requestJson('/api/users', {
                method: 'POST',
                body: JSON.stringify({
                    username: document.getElementById('new-user-username').value.trim(),
                    displayName: document.getElementById('new-user-name').value.trim(),
                    role: document.getElementById('new-user-role').value,
                    password: document.getElementById('new-user-password').value
                })
            });
            ['new-user-username', 'new-user-name', 'new-user-password'].forEach(id => document.getElementById(id).value = '');
            showToast('Usuario creado.', 'success');
            renderUsersSection();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    async function renderUpdatesSection() {
        if (state.currentRole !== 'admin') {
            showToast('Solo administradores pueden gestionar actualizaciones.', 'error');
            switchSection('sec-dashboard-exec');
            return;
        }

        const tbody = document.querySelector('#table-updates tbody');
        try {
            const data = await requestJson('/api/updates');
            tbody.innerHTML = '';
            if (!data.updates.length) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay paquetes registrados.</td></tr>';
                return;
            }

            data.updates.forEach(pkg => {
                const tr = document.createElement('tr');
                const checksumShort = pkg.checksum_sha256 ? String(pkg.checksum_sha256).slice(0, 12) + '...' : 'Sin archivo';
                tr.innerHTML = `
                    <td><strong>${escapeHtml(pkg.version)}</strong></td>
                    <td>${escapeHtml(pkg.title)}<br><small>${escapeHtml(pkg.description || '')}</small></td>
                    <td>${escapeHtml(pkg.package_file_name || 'Registro manual')}</td>
                    <td><span class="badge badge-info">${escapeHtml(pkg.status)}</span></td>
                    <td><code>${escapeHtml(checksumShort)}</code></td>
                    <td>
                        <select class="update-status-input form-select">
                            ${['pendiente', 'probado', 'aplicado', 'descartado'].map(status => `<option value="${status}" ${pkg.status === status ? 'selected' : ''}>${status}</option>`).join('')}
                        </select>
                    </td>
                `;

                tr.querySelector('.update-status-input').addEventListener('change', async (e) => {
                    try {
                        await requestJson(`/api/updates/${pkg.id}/status`, {
                            method: 'PUT',
                            body: JSON.stringify({ status: e.target.value })
                        });
                        showToast('Estado de actualización cambiado.', 'success');
                        renderUpdatesSection();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                });

                tbody.appendChild(tr);
            });
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--color-danger)">${escapeHtml(e.message)}</td></tr>`;
        }
    }

    document.getElementById('btn-register-update').addEventListener('click', async () => {
        const formData = new FormData();
        formData.append('version', document.getElementById('update-version').value.trim());
        formData.append('title', document.getElementById('update-title').value.trim());
        formData.append('description', document.getElementById('update-description').value.trim());
        const file = document.getElementById('update-package').files[0];
        if (file) formData.append('package', file);

        try {
            const response = await fetch('/api/updates', {
                method: 'POST',
                credentials: 'same-origin',
                body: formData
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Error al registrar actualización.');

            ['update-version', 'update-title', 'update-description'].forEach(id => document.getElementById(id).value = '');
            document.getElementById('update-package').value = '';
            showToast('Actualización registrada.', 'success');
            renderUpdatesSection();
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    document.getElementById('btn-open-password').addEventListener('click', () => {
        passwordModal.style.display = 'flex';
    });

    document.getElementById('btn-close-password').addEventListener('click', () => {
        passwordModal.style.display = 'none';
    });

    document.getElementById('btn-save-password').addEventListener('click', async () => {
        try {
            await requestJson('/api/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    currentPassword: document.getElementById('current-password').value,
                    newPassword: document.getElementById('new-password').value
                })
            });
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            passwordModal.style.display = 'none';
            if (state.currentUser) state.currentUser.mustChangePassword = false;
            showToast('Contraseña actualizada.', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
        try {
            await requestJson('/api/auth/logout', { method: 'POST' });
        } catch (e) {
            // Continue local logout even if session was already expired.
        }
        state.currentUser = null;
        state.rows = [];
        workspace.style.display = 'none';
        welcomeScreen.style.display = 'none';
        loginScreen.style.display = 'flex';
        document.body.classList.remove('is-admin');
        refreshCaptcha();
    });


    // --- FORMULA RECALCULATOR ---
    function recalculateRowFormulas(row) {
        const scoreStr = String(row.score).trim().toUpperCase();
        
        // 1. Calculate Compliance State
        if (scoreStr === '') {
            row.state = 'Por evaluar';
        } else if (scoreStr === 'N/A') {
            row.state = 'No aplica';
        } else {
            const scoreNum = Number(scoreStr);
            if (scoreNum === 1) {
                row.state = 'Cumple';
            } else if (scoreNum === 0.5) {
                row.state = 'Parcial';
            } else if (scoreNum === 0) {
                row.state = 'No cumple';
            } else {
                row.state = 'Revisar valor';
            }
        }

        // 2. Action (Column T)
        if (row.state === 'Cumple') {
            row.t = 'Mantener / evidenciar';
        } else if (row.state === 'Parcial') {
            row.t = 'Cerrar brecha parcial';
        } else if (row.state === 'No cumple') {
            row.t = 'Implementar control';
        } else if (row.state === 'No aplica') {
            row.t = 'Sin acción';
        } else {
            row.t = 'Levantar evidencia';
        }

        // 3. Recommended Action (Column U)
        if (row.state === 'Cumple') {
            row.u = 'Mantener evidencia y revisión periódica';
        } else if (row.state === 'No aplica') {
            row.u = 'Documentar justificación de no aplicabilidad';
        } else if (row.state === 'Por evaluar') {
            row.u = 'Levantar evidencia y confirmar aplicabilidad';
        } else if (row.state === 'Parcial') {
            row.u = 'Completar documentación/control y validar efectividad';
        } else if (row.state === 'No cumple') {
            row.u = 'Diseñar, aprobar e implementar control requerido';
        } else {
            row.u = 'Corregir valor de cumplimiento';
        }

        // 4. Timeframe (Column V)
        const priority = String(row.priority).trim().toLowerCase();
        if (row.state === 'No cumple') {
            if (priority === 'alta') row.v = '0-30 días';
            else if (priority === 'media') row.v = '31-60 días';
            else row.v = '61-90 días';
        } else if (row.state === 'Parcial') {
            if (priority === 'alta') row.v = '0-45 días';
            else if (priority === 'media') row.v = '31-75 días';
            else row.v = '61-120 días';
        } else if (row.state === 'Por evaluar') {
            if (priority === 'alta') row.v = '0-15 días';
            else row.v = '0-30 días';
        } else if (row.state === 'Cumple') {
            row.v = 'Revisión periódica';
        } else {
            row.v = 'No aplica';
        }

        // 5. Risk Score (Column W)
        if (row.state === 'No cumple') {
            if (priority === 'alta') row.w = 3;
            else if (priority === 'media') row.w = 2;
            else row.w = 1;
        } else if (row.state === 'Parcial') {
            if (priority === 'alta') row.w = 2;
            else if (priority === 'media') row.w = 1.5;
            else row.w = 1;
        } else if (row.state === 'Por evaluar') {
            if (priority === 'alta') row.w = 1.5;
            else if (priority === 'media') row.w = 1;
            else row.w = 0.5;
        } else {
            row.w = 0;
        }

        // 6. Phase (Column X)
        if (row.state === 'No aplica') {
            row.x = 'No aplica';
        } else if (row.state === 'Cumple') {
            row.x = 'Mantenimiento';
        } else if (row.state === 'Por evaluar') {
            row.x = 'Fase 0 - Evidencia/aplicabilidad';
        } else {
            const cat = String(row.category).trim().toLowerCase();
            if (cat.includes('gobernanza') || cat.includes('sgsi') || cat.includes('contexto') || cat.includes('alcance')) {
                row.x = 'Fase 1 - Gobierno y SGSI';
            } else if (cat.includes('riesgo') || cat.includes('proceso') || cat.includes('persona')) {
                row.x = 'Fase 2 - Riesgos y operación';
            } else if (cat.includes('tercero') || cat.includes('continuidad')) {
                row.x = 'Fase 3 - Continuidad y terceros';
            } else if (cat.includes('tecnolog') || cat.includes('acceso') || cat.includes('ciber') || cat.includes('vulnera') || cat.includes('incidente') || cat.includes('monito')) {
                row.x = 'Fase 4 - Controles técnicos';
            } else {
                row.x = 'Fase 5 - Canales y datos';
            }
        }
    }

    // --- METRICS CALCULATION ---
    function calculateMetrics() {
        const total = state.rows.length;
        if (!total) return null;

        let scoreSum = 0;
        let evaluatedCount = 0;
        let complianceCount = 0;
        let partialCount = 0;
        let nonComplianceCount = 0;
        let naCount = 0;
        let openGaps = 0;
        let highPriorityGaps = 0;
        let totalRiskScore = 0;
        let evidencesUploadedCount = 0;

        // Group counters
        const normative = {
            'Ambas': { total: 0, cumple: 0, parcial: 0, nocumple: 0 },
            'SB': { total: 0, cumple: 0, parcial: 0, nocumple: 0 },
            'SEPS': { total: 0, cumple: 0, parcial: 0, nocumple: 0 }
        };

        const phases = {
            'Fase 1 - Gobierno y SGSI': { total: 0, openGaps: 0, complianceSum: 0, count: 0 },
            'Fase 2 - Riesgos y operación': { total: 0, openGaps: 0, complianceSum: 0, count: 0 },
            'Fase 3 - Continuidad y terceros': { total: 0, openGaps: 0, complianceSum: 0, count: 0 },
            'Fase 4 - Controles técnicos': { total: 0, openGaps: 0, complianceSum: 0, count: 0 },
            'Fase 5 - Canales y datos': { total: 0, openGaps: 0, complianceSum: 0, count: 0 },
            'Mantenimiento': { total: 0, openGaps: 0, complianceSum: 0, count: 0 },
            'No aplica': { total: 0, openGaps: 0, complianceSum: 0, count: 0 }
        };

        const priorities = {
            'Alta': { total: 0, cumple: 0, parcial: 0, nocumple: 0 },
            'Media': { total: 0, cumple: 0, parcial: 0, nocumple: 0 },
            'Baja': { total: 0, cumple: 0, parcial: 0, nocumple: 0 }
        };

        const domains = {};
        
        // Heatmap Matrix Counters: 3x3 matrix [Priority][State]
        const heatmap = {
            'Alta': { 'Cumple': 0, 'Parcial': 0, 'No cumple': 0 },
            'Media': { 'Cumple': 0, 'Parcial': 0, 'No cumple': 0 },
            'Baja': { 'Cumple': 0, 'Parcial': 0, 'No cumple': 0 }
        };

        state.rows.forEach(r => {
            const scoreStr = String(r.score).trim().toUpperCase();
            const prioName = r.priority || 'Media';
            const normName = r.normative || 'Ambas';
            const phaseName = r.x || 'Fase 0 - Evidencia/aplicabilidad';
            const domName = r.domain || 'Tecnología';

            // Init domain details
            if (!domains[domName]) {
                domains[domName] = { total: 0, cumple: 0, parcial: 0, nocumple: 0, na: 0, scoreSum: 0, count: 0 };
            }
            domains[domName].total++;

            if (prioName && priorities[prioName]) priorities[prioName].total++;
            if (normName && normative[normName]) normative[normName].total++;
            if (phaseName && phases[phaseName]) phases[phaseName].total++;

            if (r.evidence_file_path) {
                evidencesUploadedCount++;
            }

            if (scoreStr !== '' && scoreStr !== 'N/A') {
                const s = Number(scoreStr);
                scoreSum += s;
                evaluatedCount++;

                let stateLabel = 'No cumple';
                if (s === 1) stateLabel = 'Cumple';
                else if (s === 0.5) stateLabel = 'Parcial';
                
                if (heatmap[prioName]) {
                    heatmap[prioName][stateLabel]++;
                }

                if (prioName && priorities[prioName]) {
                    if (s === 1) priorities[prioName].cumple++;
                    else if (s === 0.5) priorities[prioName].parcial++;
                    else priorities[prioName].nocumple++;
                }

                if (normName && normative[normName]) {
                    if (s === 1) normative[normName].cumple++;
                    else if (s === 0.5) normative[normName].parcial++;
                    else normative[normName].nocumple++;
                }

                if (phaseName && phases[phaseName]) {
                    phases[phaseName].complianceSum += s;
                    phases[phaseName].count++;
                }

                domains[domName].scoreSum += s;
                domains[domName].count++;

                if (s === 1) {
                    complianceCount++;
                    domains[domName].cumple++;
                } else if (s === 0.5) {
                    partialCount++;
                    openGaps++;
                    domains[domName].parcial++;
                    if (phaseName && phases[phaseName]) phases[phaseName].openGaps++;
                } else if (s === 0) {
                    nonComplianceCount++;
                    openGaps++;
                    domains[domName].nocumple++;
                    if (phaseName && phases[phaseName]) phases[phaseName].openGaps++;
                    if (prioName === 'Alta') {
                        highPriorityGaps++;
                    }
                }
            } else if (scoreStr === 'N/A') {
                naCount++;
                domains[domName].na++;
                if (heatmap[prioName]) {
                    heatmap[prioName]['Cumple']++; // Treat N/A as low risk / complies
                }
            } else {
                // Pending/Por evaluar: count in heatmap as high risk 'No cumple'
                if (heatmap[prioName]) {
                    heatmap[prioName]['No cumple']++;
                }
            }
            totalRiskScore += r.w;
        });

        const applicableCount = total - naCount;
        const compliancePercentage = applicableCount > 0 ? Math.round((scoreSum / applicableCount) * 100) : 0;
        const avgRisk = total > 0 ? (totalRiskScore / total).toFixed(1) : '0.0';
        
        let riskLabel = 'Bajo';
        if (avgRisk >= 2.0) riskLabel = 'Crítico';
        else if (avgRisk >= 1.2) riskLabel = 'Alto';
        else if (avgRisk >= 0.5) riskLabel = 'Medio';

        const domainList = Object.keys(domains).map(dom => {
            const d = domains[dom];
            const pct = d.count > 0 ? Math.round((d.scoreSum / d.count) * 100) : 0;
            const progress = d.total > 0 ? Math.round(((d.count + d.na) / d.total) * 100) : 0;
            return {
                name: dom,
                total: d.total,
                cumple: d.cumple,
                parcial: d.parcial,
                nocumple: d.nocumple,
                na: d.na,
                compliancePct: pct,
                progress
            };
        });

        return {
            compliancePercentage,
            complianceCount,
            partialCount,
            nonComplianceCount,
            naCount,
            pendingCount: total - evaluatedCount - naCount,
            openGaps,
            highPriorityGaps,
            avgRisk,
            riskLabel,
            totalRiskScore: totalRiskScore.toFixed(1),
            evidencesUploadedCount,
            normative,
            phases,
            priorities,
            domains: domainList,
            totalCount: total,
            heatmap
        };
    }

    // --- RENDER EXECUTIVE DASHBOARD ---
    function renderExecutiveDashboard() {
        const metrics = calculateMetrics();
        if (!metrics) return;

        // Executive Metrics cards
        document.getElementById('metric-compliance').textContent = `${metrics.compliancePercentage}%`;
        document.getElementById('metric-compliance-bar').style.width = `${metrics.compliancePercentage}%`;
        
        document.getElementById('metric-controls-count').textContent = `${metrics.complianceCount} / ${metrics.totalCount - metrics.naCount}`;
        document.getElementById('metric-controls-pct').textContent = `${Math.round((metrics.complianceCount / (metrics.totalCount - metrics.naCount || 1)) * 100)}% del total aplicable`;
        
        document.getElementById('metric-gaps-count').textContent = metrics.openGaps;
        document.getElementById('metric-gaps-high').textContent = `${metrics.highPriorityGaps} críticas / alta prioridad`;
        gapCountBadge.textContent = metrics.openGaps;
        
        document.getElementById('metric-risk-level').textContent = metrics.riskLabel;
        document.getElementById('metric-risk-score').textContent = `Riesgo Promedio: ${metrics.avgRisk}`;

        // Setup Metric cards clickable drill-down events
        setupDrillDownCard('metric-card-compliance', { state: 'all', gapOnly: false });
        setupDrillDownCard('metric-card-controls', { state: 'Cumple', gapOnly: false });
        setupDrillDownCard('metric-card-gaps', { state: 'all', gapOnly: true });

        // 1. Render Normative Compliance Table
        const normTbody = document.querySelector('#table-normative-summary tbody');
        normTbody.innerHTML = '';
        Object.keys(metrics.normative).forEach(norm => {
            const n = metrics.normative[norm];
            
            let scoreSum = 0;
            let count = 0;
            state.rows.forEach(r => {
                if (r.normative === norm && r.score !== '' && r.score !== 'N/A') {
                    scoreSum += Number(r.score);
                    count++;
                }
            });
            const pct = count > 0 ? Math.round((scoreSum / count) * 100) : 0;
            
            const tr = document.createElement('tr');
            tr.className = 'clickable-row';
            tr.innerHTML = `
                <td><strong>${norm}</strong></td>
                <td>${n.total}</td>
                <td><span class="badge badge-success">${n.cumple}</span></td>
                <td><span class="badge badge-warning">${n.parcial}</span></td>
                <td><span class="badge badge-danger">${n.nocumple}</span></td>
                <td><strong>${pct}%</strong></td>
            `;
            
            // Drill-down normative filter
            tr.addEventListener('click', () => {
                resetStateFilters();
                state.filters.normative = norm;
                switchSection('sec-evaluation');
            });
            
            normTbody.appendChild(tr);
        });

        // 2. Render Mitigation Phases Advancement Table
        const phaseTbody = document.querySelector('#table-phases-summary tbody');
        phaseTbody.innerHTML = '';
        Object.keys(metrics.phases).forEach(ph => {
            const p = metrics.phases[ph];
            const tr = document.createElement('tr');
            tr.className = 'clickable-row';
            const pct = p.count > 0 ? Math.round((p.complianceSum / p.count) * 100) : 0;
            
            tr.innerHTML = `
                <td>${ph}</td>
                <td>${p.total}</td>
                <td><span class="badge ${p.openGaps > 0 ? 'badge-danger' : 'badge-success'}">${p.openGaps} brechas</span></td>
                <td><strong>${pct}%</strong></td>
            `;
            
            // Drill-down phase filter
            tr.addEventListener('click', () => {
                resetStateFilters();
                state.filters.phase = ph;
                // If they have open gaps, filter only gaps for this phase!
                if (p.openGaps > 0) {
                    state.filters.gapOnly = true;
                }
                switchSection('sec-evaluation');
            });
            
            phaseTbody.appendChild(tr);
        });

        // 3. Render 3x3 Risk Heatmap values
        renderHeatmap(metrics.heatmap);

        // 4. Render charts
        renderStatesChart(metrics);
        renderPrioritiesChart(metrics);

        // 5. Render Top Critical Gaps
        renderTopGapsTable();
    }

    function setupDrillDownCard(elementId, filterCriteria) {
        const card = document.getElementById(elementId);
        if (!card) return;
        
        // Remove existing listener (clone & replace)
        const newCard = card.cloneNode(true);
        card.parentNode.replaceChild(newCard, card);
        
        newCard.addEventListener('click', () => {
            resetStateFilters();
            Object.assign(state.filters, filterCriteria);
            switchSection('sec-evaluation');
        });
    }

    function resetStateFilters() {
        state.filters.category = 'all';
        state.filters.state = 'all';
        state.filters.priority = 'all';
        state.filters.phase = 'all';
        state.filters.domain = 'all';
        state.filters.normative = 'all';
        state.filters.gapOnly = false;
        
        const clearBtn = document.getElementById('btn-clear-filters');
        if (clearBtn) clearBtn.style.display = 'none';
    }

    // Render the Heatmap Matrix values and setup click listeners
    function renderHeatmap(heatmapData) {
        const priorities = ['Alta', 'Media', 'Baja'];
        const states = ['Cumple', 'Parcial', 'No cumple'];
        
        priorities.forEach(prio => {
            states.forEach(st => {
                // Map the cell ID
                const cellId = `cell-${prio.toLowerCase()}-${st.toLowerCase().replace(/\s+/g, '')}`;
                const cell = document.getElementById(cellId);
                if (cell) {
                    const count = heatmapData[prio][st] || 0;
                    cell.querySelector('.cell-count').textContent = count;
                    cell.classList.toggle('has-risk-items', count > 0);
                    
                    // Add click listener to drill down
                    const newCell = cell.cloneNode(true);
                    cell.parentNode.replaceChild(newCell, cell);
                    
                    newCell.addEventListener('click', () => {
                        resetStateFilters();
                        state.filters.priority = prio;
                        state.filters.state = st;
                        switchSection('sec-evaluation');
                    });
                }
            });
        });
    }

    function renderStatesChart(metrics) {
        if (state.charts.states) state.charts.states.destroy();
        
        const ctx = document.getElementById('chart-states').getContext('2d');
        state.charts.states = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Cumple', 'Parcial', 'No cumple', 'Por evaluar', 'No aplica'],
                datasets: [{
                    data: [
                        metrics.complianceCount, 
                        metrics.partialCount, 
                        metrics.nonComplianceCount, 
                        metrics.pendingCount,
                        metrics.naCount
                    ],
                    backgroundColor: [
                        '#10b981', // green
                        '#f59e0b', // yellow
                        '#ef4444', // red
                        '#06b6d4', // cyan
                        '#94a3b8'  // gray
                    ],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#1e293b',
                            font: { family: 'Outfit', size: 12 }
                        }
                    }
                },
                cutout: '70%'
            }
        });
    }

    function renderPrioritiesChart(metrics) {
        if (state.charts.priorities) state.charts.priorities.destroy();
        
        const ctx = document.getElementById('chart-priorities').getContext('2d');
        const prio = metrics.priorities;
        
        state.charts.priorities = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Alta Prioridad', 'Media Prioridad', 'Baja Prioridad'],
                datasets: [
                    {
                        label: 'Cumple',
                        data: [prio['Alta'].cumple, prio['Media'].cumple, prio['Baja'].cumple],
                        backgroundColor: '#10b981'
                    },
                    {
                        label: 'Parcial',
                        data: [prio['Alta'].parcial, prio['Media'].parcial, prio['Baja'].parcial],
                        backgroundColor: '#f59e0b'
                    },
                    {
                        label: 'No Cumple',
                        data: [prio['Alta'].nocumple, prio['Media'].nocumple, prio['Baja'].nocumple],
                        backgroundColor: '#ef4444'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#1e293b', font: { family: 'Outfit', size: 11 } }
                    }
                },
                scales: {
                    y: {
                        stacked: true,
                        grid: { color: '#f1f5f9' },
                        ticks: { color: '#1e293b' }
                    },
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: '#1e293b' }
                    }
                }
            }
        });
    }

    function renderTopGapsTable() {
        const tbody = document.querySelector('#table-top-gaps tbody');
        const gapRows = state.rows.filter(r => r.state === 'No cumple' || r.state === 'Parcial');
        
        gapRows.sort((a, b) => {
            const prioA = String(a.priority).toLowerCase() === 'alta' ? 2 : 1;
            const prioB = String(b.priority).toLowerCase() === 'alta' ? 2 : 1;
            return prioB - prioA;
        });

        const topGaps = gapRows.slice(0, 5);
        if (!topGaps.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay brechas activas registradas. ¡Excelente nivel de cumplimiento!</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        topGaps.forEach(g => {
            const tr = document.createElement('tr');
            tr.className = 'clickable-row';
            const prioBadge = String(g.priority).toLowerCase() === 'alta' ? 'badge-danger' : 'badge-warning';
            
            tr.innerHTML = `
                <td><strong>#${g.id}</strong></td>
                <td><span class="question-category-tag">${g.category}</span></td>
                <td>${g.control || g.requirement}</td>
                <td><span class="badge ${prioBadge}">${g.priority}</span></td>
                <td>${g.v}</td>
                <td><span class="badge badge-muted">${g.x}</span></td>
            `;
            
            // Clicking row goes directly to qualify it
            tr.addEventListener('click', () => {
                resetStateFilters();
                // Filter specifically for this ID
                state.filters.category = 'all';
                state.filters.state = 'all';
                // Custom flag to find by exact ID in rendering
                state.filters.exactId = g.id;
                switchSection('sec-evaluation');
            });

            tbody.appendChild(tr);
        });
    }


    // --- RENDER TECHNICAL DASHBOARD ---
    function renderTechnicalDashboard() {
        const metrics = calculateMetrics();
        if (!metrics) return;

        const techControls = state.rows.filter(r => String(r.category).toLowerCase().includes('tecnolog') || String(r.category).toLowerCase().includes('acceso') || String(r.category).toLowerCase().includes('ciber') || String(r.category).toLowerCase().includes('vulnera'));
        
        document.getElementById('tech-controls-count').textContent = `${techControls.filter(r => r.state === 'Cumple').length} / ${techControls.filter(r => r.state !== 'No aplica').length}`;
        document.getElementById('tech-risk-penalty').textContent = metrics.totalRiskScore;
        
        const totalApplicable = metrics.totalCount - metrics.naCount;
        const uploadPct = totalApplicable > 0 ? Math.round((metrics.evidencesUploadedCount / totalApplicable) * 100) : 0;
        document.getElementById('tech-evidence-pct').textContent = `${uploadPct}%`;
        document.getElementById('tech-evidence-count').textContent = `${metrics.evidencesUploadedCount} de ${totalApplicable} soportes subidos`;

        // Render Domain Compliance Table
        const domainTbody = document.querySelector('#table-domain-summary tbody');
        domainTbody.innerHTML = '';
        metrics.domains.forEach(d => {
            const tr = document.createElement('tr');
            tr.className = 'clickable-row';
            tr.innerHTML = `
                <td><strong>${d.name}</strong></td>
                <td>${d.total}</td>
                <td><span class="badge badge-success">${d.cumple}</span></td>
                <td><span class="badge badge-warning">${d.parcial}</span></td>
                <td><span class="badge badge-danger">${d.nocumple}</span></td>
                <td><span class="badge badge-muted">${d.na}</span></td>
                <td><strong>${d.compliancePct}%</strong></td>
                <td>
                    <div class="progress-bar-container" style="width: 60px; display:inline-block; vertical-align:middle; margin-right:5px;">
                        <div class="progress-bar" style="width: ${d.progress}%; background: var(--color-primary);"></div>
                    </div>
                    <span style="font-size:0.7rem;">${d.progress}%</span>
                </td>
            `;
            
            // Drill down by domain click
            tr.addEventListener('click', () => {
                resetStateFilters();
                state.filters.domain = d.name;
                switchSection('sec-evaluation');
            });

            domainTbody.appendChild(tr);
        });

        renderCategoriesChart(metrics);
    }

    function renderCategoriesChart(metrics) {
        if (state.charts.categories) state.charts.categories.destroy();
        
        const ctx = document.getElementById('chart-categories').getContext('2d');
        const domNames = metrics.domains.map(d => d.name.length > 20 ? d.name.substring(0, 18) + '...' : d.name);
        const domValues = metrics.domains.map(d => d.compliancePct);

        state.charts.categories = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: domNames,
                datasets: [{
                    label: 'Cumplimiento %',
                    data: domValues,
                    backgroundColor: 'rgba(74, 93, 110, 0.2)', // primary alpha
                    borderColor: '#4a5d6e', // primary
                    borderWidth: 2,
                    pointBackgroundColor: '#4a5d6e',
                    pointBorderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    r: {
                        grid: { color: '#e2e8f0' },
                        angleLines: { color: '#e2e8f0' },
                        pointLabels: {
                            color: '#1e293b',
                            font: { family: 'Outfit', size: 10 }
                        },
                        ticks: {
                            backdropColor: 'transparent',
                            color: '#64748b',
                            font: { size: 9 },
                            stepSize: 20
                        },
                        suggestedMin: 0,
                        suggestedMax: 100
                    }
                }
            }
        });
    }


    // --- RENDERING REPORTS TAB ---
    function renderReportsSection() {
        const menuItems = document.querySelectorAll('.report-menu-item');
        
        // Setup click listeners for report menu
        menuItems.forEach(item => {
            const newItem = item.cloneNode(true);
            item.parentNode.replaceChild(newItem, item);
            
            newItem.addEventListener('click', () => {
                document.querySelectorAll('.report-menu-item').forEach(i => i.classList.remove('active'));
                newItem.classList.add('active');
                state.activeReportType = newItem.getAttribute('data-report-type');
                generateReportPreview();
            });
        });
        
        generateReportPreview();
    }

    // Print button triggers standard system printing
    document.getElementById('btn-print-report').addEventListener('click', () => {
        window.print();
    });

    function generateReportPreview() {
        const previewCard = document.getElementById('report-preview-card-content');
        const metrics = calculateMetrics();
        if (!metrics) return;

        const dateFormatted = new Date(state.evaluationDate).toLocaleDateString('es-ES', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // 1. Common Letterhead header
        let reportHeaderHtml = `
            <div class="report-logo-header">
                ${getLogoHtml()}
                <div class="report-title-box">
                    <h2>${escapeHtml(state.orgSettings.companyName)}</h2>
                    <p>Auditoría de Seguridad de la Información y Due Diligence</p>
                </div>
            </div>
            
            <div class="report-metadata-grid">
                <div><strong>Empresa Auditada:</strong> ${state.companyName}</div>
                <div><strong>Fecha de Emisión:</strong> ${dateFormatted}</div>
                <div><strong>Auditor Principal:</strong> ${state.evaluatorName || 'Auditor Asignado'}</div>
                <div><strong>Estado General:</strong> ${metrics.compliancePercentage}% de Cumplimiento</div>
            </div>
        `;

        let reportBodyHtml = '';

        if (state.activeReportType === 'exec-summary') {
            // Executive summary report
            reportBodyHtml = `
                <h3 class="report-section-title">1. Resumen Ejecutivo Gerencial</h3>
                <p style="font-size:0.85rem; line-height:1.6; margin-bottom:15px; text-align:justify;">
                    El presente informe ejecutivo resume los hallazgos y el nivel de madurez técnica del Due Diligence de Seguridad de la Información practicado a la entidad <strong>${state.companyName}</strong>. La auditoría cubre los requerimientos establecidos por la Superintendencia de Bancos (SB) y la Superintendencia de Economía Popular y Solidaria (SEPS) para evaluar la eficacia y el cumplimiento legal de las medidas de ciberseguridad.
                </p>
                
                <h3 class="report-section-title">2. Indicadores Principales de Madurez</h3>
                <table class="table" style="margin-bottom:20px; border:1px solid #e2e8f0;">
                    <thead>
                        <tr style="background:#f8fafc;">
                            <th>Indicador Clave</th>
                            <th style="text-align:right;">Valor</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Nivel de Cumplimiento Global (Aplicable)</td>
                            <td style="text-align:right; font-weight:700; color:var(--color-success-text);">${metrics.compliancePercentage}%</td>
                        </tr>
                        <tr>
                            <td>Controles en Estado de Cumplimiento</td>
                            <td style="text-align:right;">${metrics.complianceCount} de ${metrics.totalCount - metrics.naCount}</td>
                        </tr>
                        <tr>
                            <td>Brechas Abiertas Totales (Parcial/No Cumple)</td>
                            <td style="text-align:right; font-weight:700; color:var(--color-danger-text);">${metrics.openGaps}</td>
                        </tr>
                        <tr>
                            <td>Nivel de Riesgo Promedio Calculado</td>
                            <td style="text-align:right; font-weight:700;">${metrics.riskLabel} (${metrics.avgRisk})</td>
                        </tr>
                        <tr>
                            <td>Documentos y Soportes de Evidencia Física Cargados</td>
                            <td style="text-align:right;">${metrics.evidencesUploadedCount}</td>
                        </tr>
                    </tbody>
                </table>
                
                <h3 class="report-section-title">3. Detalle por Ente Regulador</h3>
                <table class="table" style="margin-bottom:25px;">
                    <thead>
                        <tr>
                            <th>Regulador</th>
                            <th>Total Controles</th>
                            <th>Cumple</th>
                            <th>Parcial</th>
                            <th>No Cumple</th>
                            <th>Cumplimiento %</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.keys(metrics.normative).map(norm => {
                            const n = metrics.normative[norm];
                            let scoreSum = 0; let count = 0;
                            state.rows.forEach(r => {
                                if (r.normative === norm && r.score !== '' && r.score !== 'N/A') {
                                    scoreSum += Number(r.score); count++;
                                }
                            });
                            const pct = count > 0 ? Math.round((scoreSum / count) * 100) : 0;
                            return `
                                <tr>
                                    <td><strong>${norm}</strong></td>
                                    <td>${n.total}</td>
                                    <td>${n.cumple}</td>
                                    <td>${n.parcial}</td>
                                    <td>${n.nocumple}</td>
                                    <td><strong>${pct}%</strong></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        } else if (state.activeReportType === 'gap-plan') {
            // Action Plan and gaps list
            const gaps = state.rows.filter(r => r.state === 'No cumple' || r.state === 'Parcial');
            
            let gapsListHtml = '';
            if (!gaps.length) {
                gapsListHtml = `<p style="text-align:center; padding:30px; color:var(--color-success-text); font-weight:600;">No se registran brechas activas de seguridad. ¡Nivel de cumplimiento del 100%!</p>`;
            } else {
                gapsListHtml = `
                    <table class="table" style="font-size:0.75rem;">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Dominio / Categoría</th>
                                <th>Control / Requerimiento</th>
                                <th>Prioridad</th>
                                <th>Acción de Mitigación Recomendada</th>
                                <th>Plazo</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${gaps.map(g => `
                                <tr>
                                    <td><strong>#${g.id}</strong></td>
                                    <td><small>${g.category}<br><em>${g.domain}</em></small></td>
                                    <td>${g.control || g.requirement}</td>
                                    <td><span class="badge ${String(g.priority).toLowerCase() === 'alta' ? 'badge-danger' : 'badge-warning'}">${g.priority}</span></td>
                                    <td style="background:#fcfcfc;">${g.u}</td>
                                    <td><strong>${g.v}</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }

            reportBodyHtml = `
                <h3 class="report-section-title">Plan de Acción y Mitigación de Brechas de Seguridad</h3>
                <p style="font-size:0.8rem; line-height:1.5; margin-bottom:15px; text-align:justify;">
                    A continuación se listan las brechas de control técnico o normativo identificadas durante el proceso de Due Diligence. El plan define los plazos recomendados en función de la criticidad del control para mitigar penalidades de cumplimiento legal.
                </p>
                ${gapsListHtml}
            `;
        } else if (state.activeReportType === 'regulator-sb') {
            // Regulatory SB report
            const sbControls = state.rows.filter(r => String(r.normative).includes('SB') || String(r.normative).includes('Ambas'));
            
            reportBodyHtml = `
                <h3 class="report-section-title">Reporte de Cumplimiento SB (Superintendencia de Bancos)</h3>
                <p style="font-size:0.8rem; line-height:1.5; margin-bottom:15px;">
                    Este reporte lista la aplicabilidad y estado de cumplimiento normativo conforme a las circulares y resoluciones emitidas por la <strong>Superintendencia de Bancos (SB)</strong> para entidades financieras.
                </p>
                <table class="table" style="font-size:0.75rem;">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Categoría</th>
                            <th>Control Regulado</th>
                            <th>Estado</th>
                            <th>Comentario / Observación</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sbControls.map(c => {
                            let bClass = 'badge-muted';
                            if (c.state === 'Cumple') bClass = 'badge-success';
                            else if (c.state === 'Parcial') bClass = 'badge-warning';
                            else if (c.state === 'No cumple') bClass = 'badge-danger';
                            
                            return `
                                <tr>
                                    <td><strong>#${c.id}</strong></td>
                                    <td><small>${c.category}</small></td>
                                    <td>${c.control || c.requirement}</td>
                                    <td><span class="badge ${bClass}">${c.state}</span></td>
                                    <td>${c.comment || '<span style="color:#bbb;">Sin observaciones</span>'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        } else if (state.activeReportType === 'regulator-seps') {
            // Regulatory SEPS report
            const sepsControls = state.rows.filter(r => String(r.normative).includes('SEPS') || String(r.normative).includes('Ambas'));
            
            reportBodyHtml = `
                <h3 class="report-section-title">Reporte de Cumplimiento SEPS (Superintendencia de Economía Popular y Solidaria)</h3>
                <p style="font-size:0.8rem; line-height:1.5; margin-bottom:15px;">
                    Este reporte detalla los controles y resoluciones aplicables conforme a la <strong>Superintendencia de Economía Popular y Solidaria (SEPS)</strong>.
                </p>
                <table class="table" style="font-size:0.75rem;">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Categoría</th>
                            <th>Control Regulado</th>
                            <th>Estado</th>
                            <th>Comentario / Observación</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sepsControls.map(c => {
                            let bClass = 'badge-muted';
                            if (c.state === 'Cumple') bClass = 'badge-success';
                            else if (c.state === 'Parcial') bClass = 'badge-warning';
                            else if (c.state === 'No cumple') bClass = 'badge-danger';
                            
                            return `
                                <tr>
                                    <td><strong>#${c.id}</strong></td>
                                    <td><small>${c.category}</small></td>
                                    <td>${c.control || c.requirement}</td>
                                    <td><span class="badge ${bClass}">${c.state}</span></td>
                                    <td>${c.comment || '<span style="color:#bbb;">Sin observaciones</span>'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }

        // Add Signature block at bottom
        let signatureHtml = `
            <div class="report-signature-block">
                <div>
                    <div style="height: 60px;"></div>
                    <div class="signature-line"></div>
                    <p style="font-weight:700; margin-top:5px;">Firma del Auditor Principal</p>
                    <p style="color:#64748b; font-size:0.75rem;">${state.evaluatorName || 'Auditor Externo'}</p>
                </div>
                <div>
                    <div style="height: 60px;"></div>
                    <div class="signature-line"></div>
                    <p style="font-weight:700; margin-top:5px;">Firma Representante Legal</p>
                    <p style="color:#64748b; font-size:0.75rem;">${escapeHtml(state.orgSettings.legalRepresentative)}</p>
                </div>
            </div>
        `;

        previewCard.innerHTML = reportHeaderHtml + reportBodyHtml + signatureHtml;
    }


    // --- RENDER ACTIVE EVALUATION (QUESTIONNAIRE) ---
    function renderEvaluationList() {
        const container = document.getElementById('questions-container');
        const catFilter = document.getElementById('category-filter').value;
        const stateFilter = document.getElementById('state-filter').value;

        // Perform filtering logic
        const filtered = state.rows.filter(r => {
            // Apply category filter
            if (catFilter !== 'all' && r.category !== catFilter) return false;
            
            // Apply state filter
            if (stateFilter !== 'all' && r.state !== stateFilter) return false;
            
            // Apply exact ID filter (from top critical gaps table click)
            if (state.filters.exactId && r.id !== state.filters.exactId) return false;
            
            // Apply dashboard drill-down filters if set
            if (state.filters.priority !== 'all' && r.priority !== state.filters.priority) return false;
            if (state.filters.state !== 'all' && r.state !== state.filters.state) return false;
            if (state.filters.phase !== 'all' && r.x !== state.filters.phase) return false;
            if (state.filters.domain !== 'all' && r.domain !== state.filters.domain) return false;
            if (state.filters.normative !== 'all' && r.normative !== state.filters.normative) return false;
            if (state.filters.gapOnly && !(r.state === 'No cumple' || r.state === 'Parcial')) return false;

            return true;
        });

        // Show clear filters button if drill-down filters are active
        const hasDrillDownFilters = state.filters.priority !== 'all' || 
                                    state.filters.state !== 'all' || 
                                    state.filters.phase !== 'all' || 
                                    state.filters.domain !== 'all' || 
                                    state.filters.normative !== 'all' || 
                                    state.filters.gapOnly ||
                                    state.filters.exactId;
                                    
        const clearBtn = document.getElementById('btn-clear-filters');
        if (clearBtn) {
            clearBtn.style.display = hasDrillDownFilters ? 'inline-flex' : 'none';
        }

        // Quick counter update
        document.getElementById('filtered-count').textContent = `Mostrando ${filtered.length} de ${state.rows.length} controles`;
        
        // Update stats
        let cCount = 0, pCount = 0, ncCount = 0, peCount = 0;
        state.rows.forEach(r => {
            if (r.state === 'Cumple') cCount++;
            else if (r.state === 'Parcial') pCount++;
            else if (r.state === 'No cumple') ncCount++;
            else if (r.state === 'Por evaluar') peCount++;
        });
        document.getElementById('qs-cumple').textContent = `${cCount} C`;
        document.getElementById('qs-parcial').textContent = `${pCount} P`;
        document.getElementById('qs-nocumple').textContent = `${ncCount} NC`;
        document.getElementById('qs-evaluar').textContent = `${peCount} PE`;

        if (!filtered.length) {
            container.innerHTML = '<div class="loading-placeholder"><p>No se encontraron controles con los filtros seleccionados.</p></div>';
            return;
        }

        container.innerHTML = '';
        filtered.forEach(r => {
            const card = document.createElement('div');
            card.className = 'question-card';
            card.setAttribute('data-id', r.id);
            
            const activeCumple = r.score === 1 || r.score === '1' ? 'active-cumple' : '';
            const activeParcial = r.score === 0.5 || r.score === '0.5' ? 'active-parcial' : '';
            const activeNocumple = r.score === 0 || r.score === '0' ? 'active-nocumple' : '';
            const activeNoaplica = String(r.score).toUpperCase() === 'N/A' ? 'active-noaplica' : '';

            // Roles accessibility rules
            const role = state.currentRole;
            const isInformes = role === 'informes';
            const isRevisor = role === 'revisor';
            const isTecnico = role === 'tecnico';
            
            const disabledBtnAttr = (isInformes || isRevisor || isTecnico) ? 'disabled style="cursor:not-allowed;"' : '';
            const disabledTextInputAttr = (isInformes || isTecnico) ? 'readonly style="background:#f1f5f9; cursor:not-allowed;"' : '';
            
            // Build file upload section UI
            let fileUploadHtml = '';
            if (r.evidence_file_path) {
                const evidenceHref = escapeAttribute(safeUploadHref(r.evidence_file_path));
                const evidenceName = escapeHtml(r.evidence_file_name || 'Archivo de soporte');
                fileUploadHtml = `
                    <div class="file-upload-info">
                        <i data-lucide="file-check" style="color:var(--color-success); width:14px; height:14px;"></i>
                        <a href="${evidenceHref}" target="_blank" rel="noopener noreferrer">${evidenceName}</a>
                        ${(!isInformes && !isRevisor) ? `<button class="file-delete-btn" title="Eliminar archivo"><i data-lucide="x"></i></button>` : ''}
                    </div>
                `;
            } else {
                // Only Técnico, Auditor and Admin can upload files
                if (!isInformes && !isRevisor) {
                    fileUploadHtml = `
                        <button class="file-upload-btn">
                            <i data-lucide="upload-cloud"></i> Subir Documento Soporte
                        </button>
                        <input type="file" class="control-file-input" style="display:none;">
                    `;
                } else {
                    fileUploadHtml = `<span style="font-size:0.75rem; color:var(--text-muted);">Sin soporte adjunto</span>`;
                }
            }

            card.innerHTML = `
                <div class="question-meta">
                    <span class="question-id">ID: #${escapeHtml(r.id)}</span>
                    <span class="question-category-tag">${escapeHtml(r.category)} &rsaquo; ${escapeHtml(r.subcategory)}</span>
                </div>
                <div class="question-text">${escapeHtml(r.requirement || r.control)}</div>
                
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px; display:flex; gap:15px; flex-wrap:wrap;">
                    <span><strong>Normativa:</strong> ${escapeHtml(r.normative || 'Ambas')}</span>
                    <span><strong>Criticidad:</strong> ${escapeHtml(r.priority)}</span>
                    <span><strong>Tipo:</strong> ${escapeHtml(r.controlType || 'N/D')}</span>
                    <span><strong>Fase:</strong> ${escapeHtml(r.x || 'Fase 0')}</span>
                </div>

                <div class="question-form-controls">
                    <div class="evaluation-buttons-row">
                        <button class="eval-btn ${activeCumple}" data-value="1" ${disabledBtnAttr}>
                            <i data-lucide="check"></i> Cumple (1.0)
                        </button>
                        <button class="eval-btn ${activeParcial}" data-value="0.5" ${disabledBtnAttr}>
                            <i data-lucide="minus"></i> Parcial (0.5)
                        </button>
                        <button class="eval-btn ${activeNocumple}" data-value="0" ${disabledBtnAttr}>
                            <i data-lucide="x"></i> No cumple (0.0)
                        </button>
                        <button class="eval-btn ${activeNoaplica}" data-value="N/A" ${disabledBtnAttr}>
                            <i data-lucide="eye-off"></i> No aplica
                        </button>
                    </div>
                    <div class="notes-input-row">
                        <div class="form-group">
                            <label>Comentario / Hallazgo (Revisor/Auditor)</label>
                            <input type="text" class="comment-input" value="${escapeAttribute(r.comment || '')}" placeholder="Escriba observaciones..." ${disabledTextInputAttr}>
                        </div>
                        <div class="form-group">
                            <label>Evidencia Textual / Ruta</label>
                            <input type="text" class="evidence-input" value="${escapeAttribute(r.evidence || '')}" placeholder="Ruta de archivo, URL o referencia..." ${disabledTextInputAttr}>
                            
                            <!-- Server Upload component -->
                            <div class="evidence-upload-wrapper">
                                ${fileUploadHtml}
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Qualify button actions
            if (!isInformes && !isRevisor && !isTecnico) {
                const buttons = card.querySelectorAll('.eval-btn');
                buttons.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const val = btn.getAttribute('data-value');
                        buttons.forEach(b => b.className = b.className.replace(/active-\w+/g, ''));
                        
                        let activeClass = '';
                        if (val === '1') activeClass = 'active-cumple';
                        else if (val === '0.5') activeClass = 'active-parcial';
                        else if (val === '0') activeClass = 'active-nocumple';
                        else if (val === 'N/A') activeClass = 'active-noaplica';
                        
                        btn.classList.add(activeClass);
                        r.score = val === 'N/A' ? 'N/A' : Number(val);
                        recalculateRowFormulas(r);
                    });
                });
            }

            // Input handlers
            if (!isInformes && !isTecnico) {
                const commentField = card.querySelector('.comment-input');
                commentField.addEventListener('change', (e) => {
                    r.comment = e.target.value.trim();
                });

                const evidenceField = card.querySelector('.evidence-input');
                evidenceField.addEventListener('change', (e) => {
                    r.evidence = e.target.value.trim();
                });
            }

            // Upload evidence file handler
            const uploadBtn = card.querySelector('.file-upload-btn');
            const fileInputNode = card.querySelector('.control-file-input');
            
            if (uploadBtn && fileInputNode && !isInformes && !isRevisor) {
                uploadBtn.addEventListener('click', () => {
                    fileInputNode.click();
                });

                fileInputNode.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    const formData = new FormData();
                    formData.append('file', file);

                    try {
                        showToast(`Subiendo archivo de soporte...`, 'info');
                        const uploadResponse = await fetch('/api/upload-evidence', {
                            method: 'POST',
                            body: formData
                        });
                        const uploadResult = await uploadResponse.json();

                        if (uploadResult.success) {
                            r.evidence_file_path = uploadResult.filePath;
                            r.evidence_file_name = uploadResult.fileName;
                            showToast('Archivo de soporte subido exitosamente.', 'success');
                            renderEvaluationList(); // refresh
                        } else {
                            showToast('Error al subir el archivo: ' + uploadResult.error, 'error');
                        }
                    } catch (uploadError) {
                        console.error(uploadError);
                        showToast('Error de red al subir archivo.', 'error');
                    }
                });
            }

            // Delete evidence file handler
            const deleteBtn = card.querySelector('.file-delete-btn');
            if (deleteBtn && !isInformes && !isRevisor) {
                deleteBtn.addEventListener('click', () => {
                    if (confirm('¿Desea desvincular el archivo de soporte de este control?')) {
                        r.evidence_file_path = null;
                        r.evidence_file_name = null;
                        showToast('Archivo desvinculado.', 'info');
                        renderEvaluationList();
                    }
                });
            }

            container.appendChild(card);
        });
        
        lucide.createIcons({ container });
    }

    // Clear filters button action
    document.getElementById('btn-clear-filters').addEventListener('click', () => {
        resetStateFilters();
        // Reset category and state select boxes
        document.getElementById('category-filter').value = 'all';
        document.getElementById('state-filter').value = 'all';
        renderEvaluationList();
    });

    // Add filter select boxes change event listeners
    document.getElementById('category-filter').addEventListener('change', renderEvaluationList);
    document.getElementById('state-filter').addEventListener('change', renderEvaluationList);


    // --- ACTION PLAN / GAP TRACKER ---
    function renderGapTracker() {
        const container = document.getElementById('gaps-phases-list');
        const gapRows = state.rows.filter(r => r.state === 'No cumple' || r.state === 'Parcial');

        if (!gapRows.length) {
            container.innerHTML = `
                <div class="loading-placeholder">
                    <i data-lucide="sparkles" style="width:48px; height:48px; color:var(--color-success)"></i>
                    <h3>¡Sin Brechas Pendientes!</h3>
                    <p>Todos los controles aplicables están en estado de cumplimiento.</p>
                </div>
            `;
            lucide.createIcons({ container });
            return;
        }

        // Group gaps by Phase
        const phases = {};
        gapRows.forEach(g => {
            const phaseName = g.x || 'Fase No Asignada';
            if (!phases[phaseName]) phases[phaseName] = [];
            phases[phaseName].push(g);
        });

        const orderedPhases = Object.keys(phases).sort();

        container.innerHTML = '';
        orderedPhases.forEach(pName => {
            const phaseGaps = phases[pName];
            const phaseCard = document.createElement('div');
            phaseCard.className = 'phase-group';
            
            phaseCard.innerHTML = `
                <div class="phase-header">
                    <div class="phase-header-title">
                        <i data-lucide="layers" style="color:var(--color-primary)"></i>
                        <h3>${pName}</h3>
                    </div>
                    <span class="phase-count">${phaseGaps.length} brechas</span>
                </div>
                <div class="phase-gaps-list"></div>
            `;

            const gapsList = phaseCard.querySelector('.phase-gaps-list');
            phaseGaps.forEach(g => {
                const gapRow = document.createElement('div');
                gapRow.className = 'gap-row-details';
                const isHigh = String(g.priority).toLowerCase() === 'alta';
                const criticalClass = isHigh ? 'critical' : '';
                
                // Link file link if present
                let fileLinkHtml = '';
                if (g.evidence_file_path) {
                    fileLinkHtml = `<br><span style="color:var(--color-info)"><i data-lucide="paperclip" style="width:12px;height:12px;vertical-align:middle;margin-right:4px;"></i>Soporte: <a href="${g.evidence_file_path}" target="_blank" style="text-decoration:underline;">${g.evidence_file_name}</a></span>`;
                }

                gapRow.innerHTML = `
                    <div class="gap-control-id">#${g.id}</div>
                    <div class="gap-title">
                        <div>${g.control || g.requirement}</div>
                        <span class="question-category-tag">${g.category} &rsaquo; ${g.subcategory}</span>
                    </div>
                    <div class="gap-rec-box ${criticalClass}">
                        <strong>Acción recomendada:</strong> ${g.u}<br>
                        ${g.comment ? `<small style="color:var(--text-secondary)"><strong>Observación:</strong> ${g.comment}</small>` : ''}
                        ${fileLinkHtml}
                    </div>
                    <div class="gap-timeline-badge">
                        <span class="timeline-text"><i data-lucide="calendar" style="width:12px;height:12px;display:inline;margin-right:4px;"></i>${g.v}</span>
                        <span class="priority-text">Criticidad: ${g.priority} | Regulador: ${g.normative || 'Ambas'}</span>
                    </div>
                `;
                gapsList.appendChild(gapRow);
            });

            container.appendChild(phaseCard);
        });

        lucide.createIcons({ container });
    }

    // Print Action
    document.getElementById('btn-print-gaps').addEventListener('click', () => {
        window.print();
    });


    // --- SAVE EVALUATION TO DATABASE ---
    async function saveEvaluationToServer() {
        const metrics = calculateMetrics();
        if (!metrics) return;

        const payload = {
            id: state.evaluationId,
            companyName: state.companyName,
            evaluatorName: state.evaluatorName,
            evaluationDate: state.evaluationDate,
            metrics: {
                compliancePercentage: metrics.compliancePercentage,
                totalCount: metrics.totalCount,
                complianceCount: metrics.complianceCount,
                partialCount: metrics.partialCount,
                nonComplianceCount: metrics.nonComplianceCount,
                naCount: metrics.naCount
            },
            rows: state.rows.map(r => ({
                id: r.id,
                score: r.score,
                state: r.state,
                comment: r.comment,
                evidence: r.evidence,
                evidence_file_path: r.evidence_file_path,
                evidence_file_name: r.evidence_file_name
            }))
        };

        try {
            showToast('Guardando en la base de datos...', 'info');
            const response = await fetch('/api/evaluations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (data.success) {
                showToast('Evaluación guardada exitosamente.', 'success');
                loadSavedEvaluationsList();
            } else {
                showToast('Error al guardar: ' + data.error, 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Error de red al guardar la evaluación.', 'error');
        }
    }

    document.getElementById('btn-save-eval').addEventListener('click', saveEvaluationToServer);


    // --- EVOLUTION HISTORY SECTION ---
    async function renderEvolutionSection() {
        const tbody = document.querySelector('#table-history-list tbody');
        
        try {
            const response = await fetch('/api/evaluations');
            const data = await response.json();

            if (!data.success) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--color-danger)">Error: ${data.error}</td></tr>`;
                return;
            }

            const history = data.evaluations;

            if (!history.length) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">Aún no hay registros en la base de datos.</td></tr>';
                if (state.charts.evolution) {
                    state.charts.evolution.destroy();
                    state.charts.evolution = null;
                }
                return;
            }

            // Sort ascending by date for line chart
            const sortedHistory = [...history].sort((a, b) => new Date(a.evaluation_date) - new Date(b.evaluation_date));

            tbody.innerHTML = '';
            history.forEach(h => {
                const tr = document.createElement('tr');
                const gapsCount = h.total_controls - h.compliant_controls - h.na_controls;
                
                tr.innerHTML = `
                    <td><strong>${h.evaluation_date}</strong></td>
                    <td>${h.evaluator_name || 'No especificado'}</td>
                    <td><span class="badge badge-success">${h.compliance_pct}%</span></td>
                    <td>${h.compliant_controls} cumple / ${h.total_controls - h.na_controls} aplicables</td>
                    <td><span class="badge badge-danger">${gapsCount} brechas</span></td>
                    <td>
                        <button class="btn btn-secondary btn-sm load-hist-btn" data-id="${h.id}" style="padding:4px 8px;font-size:0.75rem;">Cargar</button>
                        <button class="btn btn-danger-outline btn-sm delete-hist-btn" data-id="${h.id}" style="padding:4px 8px;font-size:0.75rem;">Eliminar</button>
                    </td>
                `;
                
                tr.querySelector('.load-hist-btn').addEventListener('click', () => {
                    loadEvaluationFromDb(h.id);
                });

                tr.querySelector('.delete-hist-btn').addEventListener('click', async () => {
                    if (confirm(`¿Eliminar evaluación de ${h.evaluation_date}?`)) {
                        await deleteEvaluation(h.id);
                        renderEvolutionSection();
                    }
                });

                tbody.appendChild(tr);
            });

            // Render line chart
            const ctx = document.getElementById('chart-evolution').getContext('2d');
            if (state.charts.evolution) state.charts.evolution.destroy();

            const dates = sortedHistory.map(h => h.evaluation_date);
            const compliances = sortedHistory.map(h => h.compliance_pct);

            state.charts.evolution = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dates,
                    datasets: [{
                        label: 'Cumplimiento Global %',
                        data: compliances,
                        borderColor: '#4a5d6e',
                        backgroundColor: 'rgba(74, 93, 110, 0.05)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.3,
                        pointBackgroundColor: '#4a5d6e',
                        pointBorderColor: '#fff',
                        pointRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            grid: { color: '#f1f5f9' },
                            ticks: { color: '#1e293b', font: { family: 'Outfit' } },
                            min: 0,
                            max: 100
                        },
                        x: {
                            grid: { color: 'transparent' },
                            ticks: { color: '#1e293b', font: { family: 'Outfit' } }
                        }
                    }
                }
            });
        } catch (e) {
            console.error('Error rendering history:', e);
        }
    }


    // --- RESET / CHANGE EVALUATION ---
    document.getElementById('btn-change-file').addEventListener('click', () => {
        if (confirm('¿Desea salir de la evaluación actual? Los cambios no guardados se perderán.')) {
            state.evaluationId = '';
            state.rows = [];
            welcomeScreen.style.display = 'flex';
            workspace.style.display = 'none';
            loadSavedEvaluationsList();
        }
    });

    // --- EXPORT TO EXCEL ---
    function exportToExcel() {
        if (!state.evaluationId) return;
        showToast('Exportando archivo Excel...', 'info');
        window.location.href = `/api/export-excel/${state.evaluationId}`;
    }

    document.getElementById('btn-export-excel').addEventListener('click', exportToExcel);
});
