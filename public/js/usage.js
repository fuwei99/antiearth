// Detailed Token Usage Telemetry Modal
let currentUsageToken = null;
let usageModalWheelHandler = null;

// Dynamically inject styles for the usage tracking modal
(function injectUsageStyles() {
    if (typeof document === 'undefined') return;
    const styleId = 'usage-telemetry-styles';
    if (document.getElementById(styleId)) return;

    const styles = `
        /* Usage modal summary cards */
        .usage-summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1rem;
            margin-bottom: 1.5rem;
        }
        .usage-summary-card {
            background: rgba(8, 145, 178, 0.04);
            border: 1px solid rgba(8, 145, 178, 0.15);
            border-radius: 0.625rem;
            padding: 1rem 0.75rem;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.01);
            transition: all 0.2s ease;
        }
        .usage-summary-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(8, 145, 178, 0.08);
            border-color: var(--primary);
        }
        @media (prefers-color-scheme: dark) {
            .usage-summary-card {
                background: rgba(30, 41, 59, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.08);
            }
            .usage-summary-card:hover {
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                border-color: var(--primary);
            }
        }
        .usage-summary-card .card-label {
            font-size: 0.75rem;
            color: var(--text-light);
            margin-bottom: 0.5rem;
            font-weight: 500;
        }
        .usage-summary-card .card-value {
            font-size: 1.2rem;
            font-weight: 700;
            color: var(--primary);
        }
        
        /* Table Wrapper & Table */
        .usage-table-wrapper {
            overflow-x: auto;
            border: 1px solid var(--border);
            border-radius: 0.625rem;
            margin-bottom: 1rem;
            max-height: 400px;
            overflow-y: auto;
        }
        .usage-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.8rem;
            text-align: left;
        }
        .usage-table th, .usage-table td {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--border);
            white-space: nowrap;
        }
        .usage-table th {
            background: rgba(8, 145, 178, 0.06);
            font-weight: 600;
            color: var(--text);
            position: sticky;
            top: 0;
            z-index: 10;
        }
        @media (prefers-color-scheme: dark) {
            .usage-table th {
                background: rgba(15, 23, 42, 0.8);
            }
        }
        .usage-table tbody tr:hover {
            background: rgba(8, 145, 178, 0.02);
        }
        .usage-table td {
            color: var(--text);
        }
        
        /* Badges & text styling */
        .usage-model-badge {
            display: inline-block;
            padding: 0.2rem 0.5rem;
            background: rgba(8, 145, 178, 0.08);
            border-radius: 0.375rem;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-weight: 600;
            font-size: 0.75rem;
            color: var(--primary);
            border: 1px solid rgba(8, 145, 178, 0.15);
        }
        .usage-num {
            font-variant-numeric: tabular-nums;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .usage-clear-btn-container {
            margin-right: auto;
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
})();

async function showUsageModal(tokenId) {
    currentUsageToken = tokenId;

    const activeIndex = cachedTokens.findIndex(t => t.id === tokenId);
    const emailTabs = cachedTokens.map((t, index) => {
        const email = t.email || '未知';
        const shortEmail = email.length > 20 ? email.substring(0, 17) + '...' : email;
        const isActive = index === activeIndex;
        return `<button type="button" class="quota-tab${isActive ? ' active' : ''}" data-index="${index}" onclick="switchUsageAccountByIndex(${index})" title="${escapeHtml(email)}">${escapeHtml(shortEmail)}</button>`;
    }).join('');

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'usageModal';
    modal.innerHTML = `
        <div class="modal-content modal-xl">
            <div class="quota-modal-header">
                <div class="modal-title">📈 Token 使用量与估算详情</div>
            </div>
            <div class="quota-tabs" id="usageEmailList">
                ${emailTabs}
            </div>
            <div id="usageContent" class="quota-container">
                <div class="quota-loading">加载中...</div>
            </div>
            <div class="modal-actions">
                <div class="usage-clear-btn-container">
                    <button class="btn btn-danger btn-sm" onclick="clearUsageRecords()">🗑️ 清空记录</button>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="closeUsageModal()">关闭</button>
                <button class="btn btn-info btn-sm" id="usageRefreshBtn" onclick="refreshUsageData()">🔄 刷新</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.onclick = (e) => {
        if (e.target === modal) {
            closeUsageModal();
        }
    };

    await loadUsageData(tokenId);

    const tabsContainer = document.getElementById('usageEmailList');
    if (tabsContainer) {
        usageModalWheelHandler = (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                tabsContainer.scrollLeft += e.deltaY;
            }
        };
        tabsContainer.addEventListener('wheel', usageModalWheelHandler, { passive: false });
    }
}

function closeUsageModal() {
    const modal = document.getElementById('usageModal');
    if (usageModalWheelHandler) {
        const tabsContainer = document.getElementById('usageEmailList');
        if (tabsContainer) {
            tabsContainer.removeEventListener('wheel', usageModalWheelHandler);
        }
        usageModalWheelHandler = null;
    }
    if (modal) {
        modal.remove();
    }
    currentUsageToken = null;
}

async function switchUsageAccountByIndex(index) {
    if (index < 0 || index >= cachedTokens.length) return;

    const token = cachedTokens[index];
    currentUsageToken = token.id;

    document.querySelectorAll('#usageEmailList .quota-tab').forEach((tab, i) => {
        if (i === index) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    await loadUsageData(token.id);
}

async function loadUsageData(tokenId) {
    const usageContent = document.getElementById('usageContent');
    if (!usageContent) return;

    const refreshBtn = document.getElementById('usageRefreshBtn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳ 加载中...';
    }

    usageContent.innerHTML = '<div class="quota-loading">加载中...</div>';

    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(tokenId)}/usage`);
        const result = await response.json();

        if (result.success && result.data) {
            renderUsageContent(usageContent, result.data);
        } else {
            usageContent.innerHTML = `<div class="quota-error-small">加载失败: ${escapeHtml(result.message || '未知错误')}</div>`;
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            usageContent.innerHTML = '<div class="quota-error-small">网络错误，加载失败</div>';
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 刷新';
        }
    }
}

async function refreshUsageData() {
    if (currentUsageToken) {
        await loadUsageData(currentUsageToken);
    }
}

async function clearUsageRecords() {
    if (!currentUsageToken) return;

    const confirmClear = confirm('确定要清空该 Token 的所有使用量记录吗？清空后将无法恢复。');
    if (!confirmClear) return;

    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(currentUsageToken)}/usage/clear`, {
            method: 'POST'
        });
        const result = await response.json();

        if (result.success) {
            showToast('使用量记录已成功清空', 'success');
            await loadUsageData(currentUsageToken);
        } else {
            showToast('清空失败: ' + (result.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('清空记录出错: ' + error.message, 'error');
    }
}

function formatTimestamp(isoString) {
    if (!isoString) return '--';
    try {
        const date = new Date(isoString);
        return date.toLocaleString('zh-CN', { hour12: false });
    } catch (e) {
        return isoString;
    }
}

function renderUsageContent(container, usageData) {
    let summary = {};
    let history = [];

    if (usageData && usageData.summary && usageData.history) {
        summary = usageData.summary;
        history = usageData.history;
    } else {
        // Fallback for old/flat structure
        summary = usageData || {};
        history = [];
    }

    const models = Object.keys(summary);

    if (models.length === 0 && history.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1rem;">
                <div class="empty-state-icon">📈</div>
                <div class="empty-state-text">暂无使用数据</div>
                <div class="empty-state-hint">当使用此 Token 调用 API 时，会在此处记录使用量与估算价格。</div>
            </div>
        `;
        return;
    }

    let totalCost = 0;
    let totalRequests = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCachedReadTokens = 0;
    let totalCachedWriteTokens = 0;

    const rowsHtml = models.map(modelId => {
        const record = summary[modelId];
        totalCost += record.cost || 0;
        totalRequests += record.requests || 0;
        totalPromptTokens += record.promptTokens || 0;
        totalCompletionTokens += record.completionTokens || 0;
        totalCachedReadTokens += record.cachedReadTokens || 0;
        totalCachedWriteTokens += record.cachedWriteTokens || 0;

        const shortName = modelId.replace('models/', '').replace('publishers/google/', '').split('/').pop();

        return `
            <tr>
                <td><span class="usage-model-badge" title="${escapeHtml(modelId)}">${escapeHtml(shortName)}</span></td>
                <td class="usage-num">${record.requests}</td>
                <td class="usage-num">${record.promptTokens}</td>
                <td class="usage-num">${record.completionTokens}</td>
                <td class="usage-num">${record.cachedReadTokens}</td>
                <td class="usage-num">${record.cachedWriteTokens}</td>
                <td class="usage-num" style="font-weight: 600; color: var(--primary);">$${(record.cost || 0).toFixed(4)}</td>
            </tr>
        `;
    }).join('');

    // Render historical logs of each call
    let historyHtml = '';
    if (history.length > 0) {
        const sortedHistory = [...history].reverse(); // newest first
        const historyRows = sortedHistory.map(record => {
            const shortName = record.modelId.replace('models/', '').replace('publishers/google/', '').split('/').pop();
            const timeStr = formatTimestamp(record.timestamp);

            return `
                <tr>
                    <td class="usage-num">${escapeHtml(timeStr)}</td>
                    <td><span class="usage-model-badge" title="${escapeHtml(record.modelId)}">${escapeHtml(shortName)}</span></td>
                    <td class="usage-num">${record.promptTokens}</td>
                    <td class="usage-num">${record.completionTokens}</td>
                    <td class="usage-num">${record.cachedReadTokens}</td>
                    <td class="usage-num">${record.cachedWriteTokens}</td>
                    <td class="usage-num" style="font-weight: 600; color: var(--primary);">$${(record.cost || 0).toFixed(4)}</td>
                </tr>
            `;
        }).join('');

        historyHtml = `
            <div class="usage-history-section" style="margin-top: 1.5rem;">
                <div class="modal-title" style="margin-bottom: 0.75rem;">📜 每次调用详细记录</div>
                <div class="usage-table-wrapper" style="max-height: 250px;">
                    <table class="usage-table">
                        <thead>
                            <tr>
                                <th>调用时间</th>
                                <th>模型</th>
                                <th>输入 Tokens</th>
                                <th>输出 Tokens</th>
                                <th>缓存读取</th>
                                <th>缓存写入</th>
                                <th>预估美金</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${historyRows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="usage-summary-cards">
            <div class="usage-summary-card">
                <div class="card-label">总预估费用</div>
                <div class="card-value">$${totalCost.toFixed(4)}</div>
            </div>
            <div class="usage-summary-card">
                <div class="card-label">总请求次数</div>
                <div class="card-value">${totalRequests} 次</div>
            </div>
            <div class="usage-summary-card">
                <div class="card-label">总输入/输出 Token</div>
                <div class="card-value">${totalPromptTokens} / ${totalCompletionTokens}</div>
            </div>
            <div class="usage-summary-card">
                <div class="card-label">缓存命中 (读/写)</div>
                <div class="card-value">${totalCachedReadTokens} / ${totalCachedWriteTokens}</div>
            </div>
        </div>
        <div class="usage-table-wrapper">
            <table class="usage-table">
                <thead>
                    <tr>
                        <th>模型</th>
                        <th>调用次数</th>
                        <th>输入 Tokens</th>
                        <th>输出 Tokens</th>
                        <th>缓存读取</th>
                        <th>缓存写入</th>
                        <th>预估美金</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
        ${historyHtml}
    `;
}
