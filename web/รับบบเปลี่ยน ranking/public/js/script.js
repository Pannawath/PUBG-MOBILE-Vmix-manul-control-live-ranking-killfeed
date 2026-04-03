document.addEventListener('DOMContentLoaded', () => {
    const spreadsheetIdInput = document.getElementById('spreadsheetId');
    const configSelect = document.getElementById('configSelect');
    const fetchSheetsBtn = document.getElementById('fetchSheetsBtn');

    // UI Elements
    const sheetSelectGroup = document.getElementById('sheetSelectGroup');
    const controlsContainer = document.getElementById('controls-container');
    const sheetSelects = document.querySelectorAll('.sheet-select');
    const sendBtns = document.querySelectorAll('.send-btn');
    const previewCard = document.getElementById('previewCard');
    const closePreviewBtn = document.getElementById('closePreviewBtn');
    const placeholder = document.getElementById('noDataPlaceholder');
    const credentialsAlert = document.getElementById('credentials-alert');

    // Modal Elements
    const settingsModal = document.getElementById('settingsModal');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');

    // Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Store data per type in memory
    let fetchedSheets = [];
    let currentData = {
        day: null,
        week: null,
        overall: null
    };

    // Mapping for selection persistence
    const selectionKey = 'vMixSelections_tw';
    let savedSelections = JSON.parse(localStorage.getItem(selectionKey)) || {
        day: '',
        week: '',
        overall: '',
        activeTab: 'day-panel'
    };

    // Load spreadsheet ID
    const storedSpreadsheetId = localStorage.getItem('spreadsheetId_tw') || localStorage.getItem('spreadsheetId');
    if (storedSpreadsheetId) {
        spreadsheetIdInput.value = storedSpreadsheetId;
    }

    // Custom Toast Notification System
    const showToast = (message, type = 'success') => {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        
        // Colors base on type
        const colors = {
            success: 'bg-green-500',
            danger: 'bg-red-500',
            warning: 'bg-yellow-500'
        };
        const bgColor = colors[type] || 'bg-blue-500';

        toast.className = `${bgColor} text-white px-4 py-3 rounded shadow-lg flex items-center gap-3 transform translate-y-2 opacity-0 transition-all duration-300 font-bold text-sm`;
        toast.innerHTML = `
            <span>${message}</span>
            <button class="text-white hover:text-gray-200 ml-2">✕</button>
        `;

        container.appendChild(toast);
        
        // Animate in
        requestAnimationFrame(() => {
            toast.classList.remove('translate-y-2', 'opacity-0');
        });

        // Close btn
        toast.querySelector('button').addEventListener('click', () => {
            toast.classList.add('opacity-0');
            setTimeout(() => toast.remove(), 300);
        });

        // Auto close after 3 seconds
        setTimeout(() => {
            if(toast.parentElement) {
                toast.classList.add('opacity-0');
                setTimeout(() => toast.remove(), 300);
            }
        }, 3000);
    };

    // Modal Handling
    const openModal = () => {
        settingsModal.classList.remove('hidden');
        requestAnimationFrame(() => {
            settingsModal.classList.remove('opacity-0');
            settingsModal.querySelector('#settingsModalContent').classList.remove('scale-95');
        });
    };

    const closeModal = () => {
        settingsModal.classList.add('opacity-0');
        settingsModal.querySelector('#settingsModalContent').classList.add('scale-95');
        setTimeout(() => {
            settingsModal.classList.add('hidden');
        }, 300);
    };

    openSettingsBtn.addEventListener('click', openModal);
    closeSettingsBtn.addEventListener('click', closeModal);
    settingsModal.addEventListener('click', (e) => {
        if(e.target === settingsModal) closeModal();
    });

    // Tab Handling
    const switchTab = (targetId) => {
        // Toggle Buttons
        tabBtns.forEach(btn => {
            if(btn.dataset.target === targetId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Toggle Content
        tabContents.forEach(content => {
            if(content.id === targetId) {
                content.classList.remove('hidden');
                content.classList.add('block');
            } else {
                content.classList.add('hidden');
                content.classList.remove('block');
            }
        });

        savedSelections.activeTab = targetId;
        localStorage.setItem(selectionKey, JSON.stringify(savedSelections));

        // Re-render preview
        const type = targetId.split('-')[0];
        if (currentData[type]) {
            renderPreview(currentData[type], type);
        } else {
            previewCard.classList.add('hidden');
            previewCard.classList.remove('flex');
            placeholder.classList.remove('hidden');
            placeholder.classList.add('flex');
        }
    };

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.target));
    });

    // Check auth
    axios.get('/api/check-auth').then(res => {
         if (!res.data.hasCredentials) {
             credentialsAlert.classList.remove('hidden');
         }
    });

    const fetchSheets = async (autoRestore = false) => {
        const spreadsheetId = spreadsheetIdInput.value.trim();
        if (!spreadsheetId) return;

        localStorage.setItem('spreadsheetId_tw', spreadsheetId);

        fetchSheetsBtn.disabled = true;
        fetchSheetsBtn.innerHTML = 'Syncing...';
        fetchSheetsBtn.classList.add('opacity-50');

        try {
            const response = await axios.post('/api/get-sheets', { spreadsheetId });
            fetchedSheets = response.data.sheets;

            // Populate all 3 dropdowns
            sheetSelects.forEach(select => {
                const type = select.dataset.type;
                select.innerHTML = '<option value="">-- Choose Sheet --</option>';
                fetchedSheets.forEach(sheet => {
                    const option = document.createElement('option');
                    option.value = sheet;
                    option.textContent = sheet;
                    // Restore selection
                    if (autoRestore && savedSelections[type] === sheet) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });

                // If restored, trigger data fetch
                if (autoRestore && select.value) {
                    loadDataForType(select.value, type);
                }
            });

            sheetSelectGroup.style.display = 'flex';
            controlsContainer.style.display = 'block';
            if (!autoRestore) {
                showToast('Spreadsheet connected successfully!');
                closeModal();
            }

        } catch (error) {
            console.error(error);
            showToast(error.response?.data?.error || 'Failed to connect spreadsheet', 'danger');
        } finally {
            fetchSheetsBtn.disabled = false;
            fetchSheetsBtn.textContent = 'Apply & Sync Sheets';
            fetchSheetsBtn.classList.remove('opacity-50');
        }
    };

    // Initial load logic
    if (spreadsheetIdInput.value) {
        fetchSheets(true); // autoRestore = true
    } else {
        // Open modal on first visit if no ID
        setTimeout(() => openModal(), 500);
    }

    // Restore active tab
    if (savedSelections.activeTab) {
        switchTab(savedSelections.activeTab);
    }

    async function loadDataForType(sheetName, type) {
        const spreadsheetId = spreadsheetIdInput.value.trim();
        const statusAlert = document.getElementById(`status${capitalize(type)}`);

        statusAlert.classList.remove('hidden');
        statusAlert.className = 'mt-3 text-xs font-bold text-center py-2 rounded status-alert bg-surface2 text-gray-400';
        statusAlert.textContent = 'Loading data...';

        try {
            const response = await axios.post('/api/get-data', { spreadsheetId, sheetName, type });
            currentData[type] = response.data;

            // Only render preview if this type is the active tab
            const activeTabTarget = document.querySelector('.tab-btn.active').dataset.target;
            if (activeTabTarget.startsWith(type)) {
                renderPreview(response.data, type);
            }

            statusAlert.className = 'mt-3 text-xs font-bold text-center py-2 rounded status-alert bg-blue-900/30 text-blue-400 border border-blue-900/50';
            statusAlert.textContent = `Active: ${sheetName}`;

            // Save selection
            savedSelections[type] = sheetName;
            localStorage.setItem(selectionKey, JSON.stringify(savedSelections));

        } catch (error) {
            console.error(error);
            statusAlert.className = 'mt-3 text-xs font-bold text-center py-2 rounded status-alert bg-red-900/30 text-red-400 border border-red-900/50';
            statusAlert.textContent = `Error loading Data`;
            showToast(`Failed to load ${type} data`, 'danger');
        }
    }

    fetchSheetsBtn.addEventListener('click', () => fetchSheets(false));

    if (configSelect) {
        configSelect.addEventListener('change', () => {
            if (configSelect.value) {
                spreadsheetIdInput.value = configSelect.value;
                // fetchSheets(false); // remove auto-fetch on select, wait for button click for clarity
            }
        });
    }

    sheetSelects.forEach(select => {
        select.addEventListener('change', (e) => {
            if (e.target.value) {
                loadDataForType(e.target.value, e.target.dataset.type);
            } else {
                const type = e.target.dataset.type;
                currentData[type] = null;
                savedSelections[type] = '';
                localStorage.setItem(selectionKey, JSON.stringify(savedSelections));
                document.getElementById(`status${capitalize(type)}`).classList.add('hidden');
                
                const activeTabTarget = document.querySelector('.tab-btn.active').dataset.target;
                if (activeTabTarget.startsWith(type)) {
                    previewCard.classList.add('hidden');
                    previewCard.classList.remove('flex');
                    placeholder.classList.remove('hidden');
                    placeholder.classList.add('flex');
                }
            }
        });
    });

    sendBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const type = e.target.dataset.type;
            const dataToSend = currentData[type];

            if (!dataToSend || !dataToSend.data || dataToSend.data.length === 0) {
                showToast('Please select a sheet with data first', 'warning');
                return;
            }

            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = 'SENDING...';
            btn.classList.add('opacity-50', 'cursor-not-allowed');

            try {
                await axios.post('/api/send-to-vmix', {
                    ...dataToSend,
                    type: type
                });
                showToast(`SUCCESS: ${capitalize(type)} data pushed to vMix!`, 'success');
            } catch (error) {
                showToast(`ERROR: Failed to update ${type}`, 'danger');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        });
    });

    closePreviewBtn.addEventListener('click', () => {
        previewCard.classList.add('hidden');
        previewCard.classList.remove('flex');
        placeholder.classList.remove('hidden');
        placeholder.classList.add('flex');
    });

    function renderPreview(data, type) {
        const tableHead = document.getElementById('tableHead');
        const tableBody = document.getElementById('tableBody');
        const previewType = document.getElementById('previewType');

        tableHead.innerHTML = '';
        tableBody.innerHTML = '';
        previewType.textContent = capitalize(type);

        if (data.headers && data.headers.length > 0) {
            data.headers.forEach(h => {
                const th = document.createElement('th');
                th.className = 'p-3 font-bold';
                th.textContent = h;
                tableHead.appendChild(th);
            });
        }

        if (data.data && data.data.length > 0) {
            data.data.forEach(row => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-white/5 transition-colors';
                data.headers.forEach(h => {
                    const td = document.createElement('td');
                    td.className = 'p-3 border-r border-white/5 last:border-0';
                    td.textContent = row[h] || '';
                    tr.appendChild(td);
                });
                tableBody.appendChild(tr);
            });
        }

        previewCard.classList.remove('hidden');
        previewCard.classList.add('flex');
        placeholder.classList.add('hidden');
        placeholder.classList.remove('flex');
    }

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
});
