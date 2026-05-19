document.addEventListener("DOMContentLoaded", () => {
    console.log("TrackSale POS script loaded successfully!");

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('error')) {
        if (urlParams.get('error') === 'account_cooldown') {
            alert("Account cannot be process Please comeback after an hour this is to prevent abuse");
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const btnShowLogin = document.getElementById("show-login");
    const btnShowRegister = document.getElementById("show-register");
    
    if (loginForm) {
        fetch("Main.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "check_session" })
        })
        .then(res => res.json())
        .then(data => {
            if (data.logged_in) window.location.href = "dashboard.php";
        }).catch(err => console.error("Session check failed:", err));
    }

    if (btnShowLogin && btnShowRegister) {
        btnShowLogin.addEventListener("click", () => {
            loginForm.classList.remove("d-none");
            registerForm.classList.add("d-none");
            btnShowLogin.classList.add("active");
            btnShowRegister.classList.remove("active");
        });

        btnShowRegister.addEventListener("click", () => {
            registerForm.classList.remove("d-none");
            loginForm.classList.add("d-none");
            btnShowRegister.classList.add("active");
            btnShowLogin.classList.remove("active");
        });
    }

    const handleAuthSubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        
        submitBtn.innerHTML = "Processing...";
        submitBtn.disabled = true;

        const data = Object.fromEntries(new FormData(form).entries());

        try {
            const response = await fetch("Main.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (response.ok && result.success) {
                window.location.href = result.redirect || "dashboard.php";
            } else {
                alert(result.message || "Authentication failed.");
            }
        } catch (error) {
            console.error("Auth Error:", error);
            alert("A network error occurred.");
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    };

    if (loginForm) loginForm.addEventListener("submit", handleAuthSubmit);
    if (registerForm) registerForm.addEventListener("submit", handleAuthSubmit);

    document.getElementById("btn-google")?.addEventListener("click", () => {
        const clientId = "232871043631-bgvtfqvahodjl29co1nu76tle123hj8v.apps.googleusercontent.com";
        
        let basePath = window.location.origin + window.location.pathname.replace(/index\.html$/, '');
        if (!basePath.endsWith('/')) basePath += '/';
        const redirectUri = encodeURIComponent(basePath + "Main.php?action=google_callback");
        
        const scope = encodeURIComponent("email profile");
        window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    });

    const isDashboard = document.body.classList.contains('dashboard-mode');
    
    if (isDashboard) {
        console.log("Dashboard Module Initialized");
        
        let globalInventory = [];
        let cartItems = [];
        let globalReports = [];
        let salesChartInstance = null;
        let nextProductChartInstance = null;

        const getCurrencySymbol = (code) => {
            const map = { 'USD': '$', 'EUR': '€', 'GBP': '£', 'PHP': '₱' };
            return map[code] || code + ' ';
        };
        let currencySymbol = getCurrencySymbol(window.STORE_CURRENCY);

        window.updateStoreConfigurationUI = function() {
            currencySymbol = getCurrencySymbol(window.STORE_CURRENCY);
            document.querySelectorAll('.currency-addon').forEach(el => el.textContent = currencySymbol);
            
            const posSubtotal = document.getElementById("pos-subtotal-val");
            if(posSubtotal) posSubtotal.innerText = `${currencySymbol}0.00`;
            const posTax = document.getElementById("pos-tax-val");
            if(posTax) posTax.innerText = `${currencySymbol}0.00`;
            const posTotal = document.getElementById("pos-total-val");
            if(posTotal) posTotal.innerText = `${currencySymbol}0.00`;

            const taxInputs = [
                document.getElementById("item-local-tax-name"), document.getElementById("item-local-tax"),
                document.getElementById("item-national-tax-name"), document.getElementById("item-national-tax"),
                document.getElementById("btn-add-more-tax")
            ];
            
            if (window.TAX_HANDLING === "No tax") {
                taxInputs.forEach(el => { if (el) { el.disabled = true; el.title = "Taxes disabled by store configuration."; } });
            } else {
                taxInputs.forEach(el => { if (el) { el.disabled = false; el.title = ""; } });
            }
        };
        
        updateStoreConfigurationUI();

        window.fetchInventory = async function() {
            try {
                const res = await fetch("Main.php", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "get_inventory" })
                });
                const data = await res.json();
                if (data.success) {
                    globalInventory = data.items;
                    renderInventoryTable();
                } else { console.error("Inventory Fetch Error:", data.message); }
            } catch (err) { console.error("Failed to fetch inventory:", err); }
        };
    
    function getItemTaxAndFeesPct(item) {
        let pct = (parseFloat(item.local_tax_percent) || 0) + (parseFloat(item.national_tax_percent) || 0) + (parseFloat(item.service_fee) || 0) + (parseFloat(item.packaging_fee) || 0);
        if (item.custom_taxes) {
            try {
                const ct = JSON.parse(item.custom_taxes);
                ct.forEach(t => pct += (parseFloat(t.rate) || 0));
            } catch (e) {}
        }
        return pct;
    }

        function getHonestPrice(item) {
            const base = parseFloat(item.base_price) || 0;
            const taxAndFeesPct = getItemTaxAndFeesPct(item);
            
            if (window.TAX_HANDLING === "Tax-inclusive pricing") {
                return base;
            } else if (window.TAX_HANDLING === "No tax") {
                return base; 
            } else {
                return base * (1 + (taxAndFeesPct / 100));
            }
        }

        window.fetchReports = async function() {
            try {
                const res = await fetch("Main.php", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "get_reports" })
                });
                const data = await res.json();
                if (data.success) {
                    globalReports = data.reports;
                    renderReportsTable();
                } else { console.error("Reports Fetch Error:", data.message); }
                
                if (window.USER_ROLE === 'owner') {
                    try {
                        const mlRes = await fetch("Main.php", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "get_ml_reports" })
                        });
                        const mlData = await mlRes.json();
                        if (mlData.success) renderMLAnalytics(mlData);
                        else console.error("ML Fetch Error:", mlData.message);
                    } catch(e) { console.error("ML Endpoint Failed:", e); }
                }
            } catch (err) { console.error("Failed to fetch reports:", err); }
        };

        function renderMLAnalytics(mlData) {
            document.getElementById("ml-store-status").innerHTML = mlData.storeStatus.replace(/\$/g, currencySymbol);

            const comboEl = document.getElementById("ml-combos");
            comboEl.innerHTML = mlData.combos.length > 0 ? mlData.combos.map(c => `<li>• ${c.item1} & ${c.item2} <span class="badge bg-secondary ms-1" style="font-size: 0.6em;">${c.combo_count === 'Suggested pairing' ? 'AI Suggestion' : c.combo_count + 'x paired'}</span></li>`).join("") : "<li>Not enough data.</li>";

            const ctx = document.getElementById("salesChart");
            if (ctx) {
                if (salesChartInstance) salesChartInstance.destroy();
                salesChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: mlData.salesData.map(d => d.date),
                        datasets: [
                            { label: 'Sales', data: mlData.salesData.map(d => d.sales), backgroundColor: '#4361ee' },
                            { label: 'Spent (Cost)', data: mlData.salesData.map(d => d.costs), backgroundColor: '#ef233c' }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { color: '#b0b5c5' }, grid: { color: '#2a2d42' } }, x: { ticks: { color: '#b0b5c5' }, grid: { color: '#2a2d42' } } }, plugins: { legend: { labels: { color: '#b0b5c5' } } } }
                });
            }

            const ctxNext = document.getElementById("nextProductChart");
            if (ctxNext) {
                if (mlData.nextProducts.length > 0) {
                    ctxNext.style.display = "block";
                    const noDataMsg = ctxNext.parentElement.querySelector(".no-data-msg");
                    if (noDataMsg) noDataMsg.remove();
                    
                    if (nextProductChartInstance) nextProductChartInstance.destroy();
                    nextProductChartInstance = new Chart(ctxNext, {
                        type: 'bar',
                        data: { labels: mlData.nextProducts.map(d => d.item_name), datasets: [{ label: 'Predicted Volume', data: mlData.nextProducts.map(d => d.volume), backgroundColor: '#2ec4b6' }] },
                        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { color: '#b0b5c5' }, grid: { display: false } }, x: { display: false } }, plugins: { legend: { display: false } } }
                    });
                } else {
                    ctxNext.style.display = "none";
                    if (!ctxNext.parentElement.querySelector(".no-data-msg")) {
                        ctxNext.parentElement.insertAdjacentHTML('beforeend', "<span class='text-muted small no-data-msg'>Not enough data yet. Add items to inventory and make a sale!</span>");
                    }
                }
            }
        }

        window.fetchTeam = async function() {
            try {
                const res = await fetch("Main.php", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "get_team" })
                });
                const data = await res.json();
                if (data.success) {
                    const tbody = document.getElementById("team-table-body");
                    if (!tbody) return;
                    tbody.innerHTML = "";
                    if (data.team.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-muted">No team members found.</td></tr>`;
                        return;
                    }
                    data.team.forEach(user => {
                        const avatarHTML = user.profile_pic ? 
                            `<img src="${user.profile_pic}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 50%;">` : 
                            `<div class="bg-secondary rounded-circle d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;"><i class="bi bi-person"></i></div>`;
                        
                        const roleBadge = user.role === 'owner' ? `<span class="badge bg-danger">Owner</span>` : `<span class="badge bg-info">Worker</span>`;
                        const actions = user.role !== 'owner' ? 
                            `<button class="btn btn-sm btn-outline-danger" title="Kick"><i class="bi bi-person-dash"></i> Kick</button>` : 
                             `<span class="text-muted small">Admin Privileges</span>`;

                        tbody.innerHTML += `
                            <tr>
                                <td class="px-4 py-3"><div class="d-flex align-items-center gap-3">${avatarHTML}<div><div class="fw-bold text-white fs-6">${user.username}</div><div class="text-muted small">${user.email || 'No email'}</div></div></div></td>
                                <td class="py-3 text-light">${roleBadge}</td>
                                <td class="py-3 text-center px-4">${actions}</td>
                            </tr>`;
                    });
                }
            } catch (e) { console.error("Failed to fetch team:", e); }
        };

        function renderInventoryTable() {
            const tbody = document.getElementById("inventory-table-body");
            if (!tbody) return;
            tbody.innerHTML = "";

            const catFilter = document.getElementById("inventory-category-filter");
            const filterValue = catFilter ? catFilter.value : "";
            const searchInput = document.getElementById("inventory-search-input");
            const searchValue = searchInput ? searchInput.value.toLowerCase() : "";

            let filteredInventory = globalInventory.filter(item => {
                const itemCat = item.category || 'Uncategorized';
                if (filterValue && itemCat !== filterValue) return false;
                if (searchValue && !(item.item_name.toLowerCase().includes(searchValue) || (item.barcode && item.barcode.toLowerCase().includes(searchValue)))) return false;
                return true;
            });

            filteredInventory.forEach(item => {
                const honestPrice = getHonestPrice(item);
                const tr = document.createElement("tr");
                const actionButtons = window.USER_ROLE === 'owner' ?
                    `<button class="btn btn-sm btn-outline-light me-2" title="Edit Item" onclick="editInventoryItem(${item.id})"><i class="bi bi-pencil"></i></button>
                     <button class="btn btn-sm btn-outline-danger" title="Delete Item" onclick="deleteInventoryItem(${item.id})"><i class="bi bi-trash"></i></button>` :
                    `<button class="btn btn-sm btn-outline-secondary disabled border-0" title="View Only"><i class="bi bi-eye"></i> View Only</button>`;

                tr.innerHTML = `
                    <td class="px-4 py-3"><div class="fw-bold text-white fs-6">${item.item_name}</div></td>
                    <td class="py-3 text-muted">${item.barcode || 'N/A'}</td>
                    <td class="py-3 text-light"><span class="badge bg-secondary">${item.category || 'Uncategorized'}</span></td>
                    <td class="py-3 text-end fw-bold text-white">${currencySymbol}${honestPrice.toFixed(2)}</td>
                    <td class="py-3 text-center"><span class="badge bg-${item.stock_qty > 0 ? 'success' : 'danger'} fs-6">${item.stock_qty}</span></td>
                    <td class="py-3 text-center px-4">${actionButtons}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        const invSearchInput = document.getElementById("inventory-search-input");
        const invCatFilter = document.getElementById("inventory-category-filter");
        if (invSearchInput) invSearchInput.addEventListener("input", renderInventoryTable);
        if (invCatFilter) invCatFilter.addEventListener("change", renderInventoryTable);

        window.editInventoryItem = function(id) {
            const item = globalInventory.find(i => parseInt(i.id) === id);
            if (!item) return;

            document.getElementById("item-id").value = item.id;
            document.getElementById("item-name").value = item.item_name;
            document.getElementById("item-barcode").value = item.barcode || "";
            document.getElementById("item-base-price").value = item.base_price;
            const catEl = document.getElementById("item-category");
            if (catEl) catEl.value = item.category || "Uncategorized";

            document.getElementById("item-local-tax-name").value = item.local_tax_name || "";
            document.getElementById("item-local-tax").value = item.local_tax_percent || "";
            document.getElementById("item-national-tax-name").value = item.national_tax_name || "";
            document.getElementById("item-national-tax").value = item.national_tax_percent || "";
            document.getElementById("item-service-fee").value = item.service_fee || "";
            document.getElementById("item-packaging-fee").value = item.packaging_fee || "";
            
            document.getElementById("item-stock-qty").value = item.stock_qty || 0;
            document.getElementById("item-supplier-name").value = item.supplier_name || "";
            document.getElementById("item-cost").value = item.cost_per_item || "";

            const taxFieldsContainer = document.getElementById("tax-fields-container");
            document.querySelectorAll(".dynamic-tax-row").forEach(r => r.remove());

            if (item.custom_taxes) {
                try {
                    const ct = JSON.parse(item.custom_taxes);
                    const isDisabled = window.TAX_HANDLING === "No tax" ? "disabled title='Taxes disabled by store configuration.'" : "";
                    ct.forEach(t => {
                        const row = document.createElement("div");
                        row.className = "row mb-2 dynamic-tax-row";
                        row.innerHTML = `
                            <div class="col-5"><input type="text" class="form-control form-control-sm bg-pos-panel border-secondary text-light dyn-tax-name" value="${t.name}" ${isDisabled}></div>
                            <div class="col-5"><input type="number" step="0.1" min="0" oninput="if(this.value<0)this.value=Math.abs(this.value)" class="form-control form-control-sm bg-pos-panel border-secondary text-light dyn-tax-rate" value="${t.rate}" ${isDisabled}></div>
                            <div class="col-2"><button type="button" class="btn btn-sm btn-outline-danger w-100 btn-remove-tax py-1 px-0" ${isDisabled}>X</button></div>
                        `;
                        taxFieldsContainer.appendChild(row);
                        row.querySelector(".btn-remove-tax").addEventListener("click", () => row.remove());
                    });
                } catch (e) {}
            }

            const titleEl = document.getElementById("addItemModalTitle");
            if (titleEl) titleEl.innerHTML = `<i class="bi bi-pencil"></i> Edit Inventory Item`;
            
            const modal = new bootstrap.Modal(document.getElementById('addItemModal'));
            modal.show();
        };

        window.deleteInventoryItem = async function(id) {
            if (!confirm("Are you sure you want to delete this item? This cannot be undone.")) return;
            try {
                const res = await fetch("Main.php", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "delete_inventory_item", item_id: id })
                });
                const data = await res.json();
                if (data.success) { fetchInventory(); } else { alert(data.message || "Failed to delete item."); }
            } catch (e) { alert("Network error."); }
        };

        function renderCart() {
            const posCartTbody = document.getElementById("pos-cart-tbody");
            if (!posCartTbody) return;
            
            posCartTbody.innerHTML = "";
            let baseSubtotal = 0;
            let totalTaxesAndFees = 0;

            cartItems.forEach((item, index) => {
                const honestPrice = getHonestPrice(item);
                const base = parseFloat(item.base_price) || 0;
                const taxAndFeesPct = getItemTaxAndFeesPct(item);
                const itemTotal = item.qty * honestPrice;
                baseSubtotal += (base * item.qty);
                totalTaxesAndFees += ((honestPrice - base) * item.qty);
                
                if (window.TAX_HANDLING === "Tax-inclusive pricing") {
                    // Extract tax backwards from the total cost
                    const realBase = base / (1 + (taxAndFeesPct / 100));
                    baseSubtotal += (realBase * item.qty);
                    totalTaxesAndFees += ((base - realBase) * item.qty);
                } else if (window.TAX_HANDLING === "No tax") {
                    baseSubtotal += (base * item.qty);
                    totalTaxesAndFees += 0;
                } else {
                    // Tax-exclusive
                    baseSubtotal += (base * item.qty);
                    totalTaxesAndFees += ((honestPrice - base) * item.qty);
                }

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td class="px-4 py-3">
                        <div class="fw-bold text-white fs-5">${item.item_name}</div>
                        <div class="text-muted small">Barcode: ${item.barcode || 'N/A'}</div>
                    </td>
                    <td class="py-3 text-light">${currencySymbol}${honestPrice.toFixed(2)}</td>
                    <td class="py-3">
                        <div class="d-flex align-items-center justify-content-center bg-dark rounded p-1 border border-secondary" style="max-width: 120px; margin: 0 auto;">
                            <button class="btn btn-sm btn-dark text-light border-0 fw-bold px-3" onclick="updateCartQty(${index}, -1)">-</button>
                            <input type="number" class="form-control form-control-sm text-center mx-1 fw-bold text-dark bg-light border-0 px-1" style="width: 45px; -moz-appearance: textfield;" value="${item.qty}" onchange="manualUpdateCartQty(${index}, this.value)" oninput="if(this.value<0)this.value=Math.abs(this.value)">
                            <button class="btn btn-sm btn-dark text-light border-0 fw-bold px-3" onclick="updateCartQty(${index}, 1)">+</button>
                        </div>
                    </td>
                    <td class="py-3 text-end fw-bold text-white">${currencySymbol}${itemTotal.toFixed(2)}</td>
                    <td class="py-3 text-center px-4">
                        <button class="btn btn-sm btn-outline-danger rounded-circle p-2" title="Remove Item" onclick="removeFromCart(${index})"><i class="bi bi-x-lg"></i></button>
                    </td>
                `;
                posCartTbody.appendChild(tr);
            });

            document.getElementById("pos-subtotal-label").innerText = `Subtotal (${cartItems.reduce((a, b) => a + b.qty, 0)} items)`;
            document.getElementById("pos-subtotal-val").innerText = `${currencySymbol}${baseSubtotal.toFixed(2)}`;
            document.getElementById("pos-tax-label").innerText = `Taxes & Fees`;
            document.getElementById("pos-tax-val").innerText = `${currencySymbol}${totalTaxesAndFees.toFixed(2)}`;
            document.getElementById("pos-total-val").innerText = `${currencySymbol}${(baseSubtotal + totalTaxesAndFees).toFixed(2)}`;
        }

        window.updateCartQty = function(index, delta) {
            const maxStock = parseInt(cartItems[index].stock_qty) || 0;
            if (delta > 0 && cartItems[index].qty >= maxStock) {
                alert("Cannot add more! Item is out of stock.");
                return;
            }
            cartItems[index].qty += delta;
            if (cartItems[index].qty <= 0) cartItems.splice(index, 1);
            renderCart();
        };
        
        window.manualUpdateCartQty = function(index, value) {
            let newQty = parseInt(value) || 1;
            const maxStock = parseInt(cartItems[index].stock_qty) || 0;
            
            if (newQty > maxStock) newQty = maxStock;
            if (newQty < 1) newQty = 1;
            
            cartItems[index].qty = newQty;
            renderCart();
        };
        
        window.removeFromCart = function(index) {
            cartItems.splice(index, 1);
            renderCart();
        };

        function renderReportsTable() {
            const tbody = document.getElementById("reports-table-body");
            if (!tbody) return;
            tbody.innerHTML = "";
            
            if (globalReports.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No transactions found.</td></tr>`;
                return;
            }

            globalReports.forEach(report => {
                const dateFormatted = new Date(report.created_at).toLocaleString();
                tbody.innerHTML += `
                    <tr>
                        <td class="px-4 py-3 fw-bold text-primary">TXN-${report.id}</td>
                        <td class="py-3 text-light">${dateFormatted}</td>
                        <td class="py-3 text-muted">@${report.cashier_username}</td>
                        <td class="py-3 text-light" style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${report.items_summary || ''}">${report.items_summary || 'No Items'}</td>
                        <td class="py-3 text-center"><span class="badge bg-secondary text-uppercase">${report.payment_method}</span></td>
                        <td class="py-3 text-end fw-bold text-white px-4">${currencySymbol}${parseFloat(report.total_amount).toFixed(2)}</td>
                    </tr>`;
            });
        }

        fetchInventory();
        if (window.USER_ROLE === 'owner') fetchTeam();

        const mobileMenuBtn = document.getElementById("mobile-menu-btn");
        const sidebar = document.querySelector(".sidebar");
        const sidebarOverlay = document.getElementById("sidebar-overlay");

        if (mobileMenuBtn && sidebar && sidebarOverlay) {
            mobileMenuBtn.addEventListener("click", () => {
                sidebar.classList.add("show");
                sidebarOverlay.classList.add("show");
            });

            sidebarOverlay.addEventListener("click", () => {
                sidebar.classList.remove("show");
                sidebarOverlay.classList.remove("show");
            });

            document.querySelectorAll(".sidebar .nav-link-custom").forEach(link => {
                link.addEventListener("click", () => {
                    if (window.innerWidth <= 1024) {
                        sidebar.classList.remove("show");
                        sidebarOverlay.classList.remove("show");
                    }
                });
            });
        }

        const btnPayCash = document.getElementById("btn-pay-cash");
        if (btnPayCash) {
            btnPayCash.addEventListener("click", async () => {
                if (cartItems.length === 0) return alert("Your cart is empty!");

                let baseSubtotal = 0, totalTaxesAndFees = 0;
                cartItems.forEach(item => {
                    const honestPrice = getHonestPrice(item);
                    const base = parseFloat(item.base_price) || 0;
                    baseSubtotal += (base * item.qty);
                    totalTaxesAndFees += ((honestPrice - base) * item.qty);
                    const taxAndFeesPct = getItemTaxAndFeesPct(item);
                    
                    if (window.TAX_HANDLING === "Tax-inclusive pricing") {
                        const realBase = base / (1 + (taxAndFeesPct / 100));
                        baseSubtotal += (realBase * item.qty);
                        totalTaxesAndFees += ((base - realBase) * item.qty);
                    } else if (window.TAX_HANDLING === "No tax") {
                        baseSubtotal += (base * item.qty);
                        totalTaxesAndFees += 0;
                    } else {
                        baseSubtotal += (base * item.qty);
                        totalTaxesAndFees += ((honestPrice - base) * item.qty);
                    }
                });
                let totalAmount = baseSubtotal + totalTaxesAndFees;

                const originalText = btnPayCash.innerHTML;
                btnPayCash.innerHTML = "Processing...";
                btnPayCash.disabled = true;

                try {
                    const res = await fetch("Main.php", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "checkout", cart: cartItems, payment_method: "cash",
                            subtotal: baseSubtotal.toFixed(2), tax_amount: totalTaxesAndFees.toFixed(2), total_amount: totalAmount.toFixed(2)
                        })
                    });
                    const result = await res.json();

                    if (result.success) {
                        printReceiptTemplate(result.transaction_id, result.date, cartItems, baseSubtotal, totalTaxesAndFees, totalAmount);
                        if (typeof HardwareManager !== "undefined") HardwareManager.openCashDrawer();
                        cartItems = [];
                        renderCart();
                        fetchInventory();
                        fetchReports();
                    } else { alert(result.message || "Checkout failed."); }
                } catch (err) { alert("Network error during checkout."); } 
                finally { btnPayCash.innerHTML = originalText; btnPayCash.disabled = false; }
            });
        }

        function printReceiptTemplate(transId, date, items, subtotal, tax, total) {
            let itemsHTML = "";
            items.forEach(item => {
                const honestPrice = getHonestPrice(item);
                itemsHTML += `<tr><td style="vertical-align: top; padding: 2px 0;">${item.qty}x</td><td style="vertical-align: top; padding: 2px 0; word-break: break-word;">${item.item_name}</td><td style="text-align: right; vertical-align: top; padding: 2px 0;">${currencySymbol}${(item.qty * honestPrice).toFixed(2)}</td></tr>`;
            });

            let receiptHTML = "";
            if (window.RECEIPT_TEMPLATE && window.RECEIPT_TEMPLATE.trim() !== "") {
                receiptHTML = window.RECEIPT_TEMPLATE
                    .replace(/\[StoreName\]/gi, window.STORE_NAME)
                    .replace(/\[Date\]/gi, date)
                    .replace(/\[Time\]/gi, "")
                    .replace(/\[Cashier\]/gi, window.CASHIER_NAME)
                    .replace(/\[Items\]/gi, `<table style="width:100%; text-align:left; border-collapse:collapse;">${itemsHTML}</table>`)
                    .replace(/\[Subtotal\]/gi, `${currencySymbol}${subtotal.toFixed(2)}`)
                    .replace(/\[Total\]/gi, `${currencySymbol}${total.toFixed(2)}`)
                    .replace(/\[Change\]/gi, `${currencySymbol}0.00`)
                    .replace(/\[PaymentMethod\]/gi, "Cash");
            } else {
                receiptHTML = `
                    <div style="font-family: monospace; color: black; width: 100%; margin: 0 auto; font-size: 13px;">
                        <div style="text-align: center; border-bottom: 1px dashed black; padding-bottom: 10px; margin-bottom: 10px;">
                            <h2 style="margin: 0; font-size: 16px;">${window.STORE_NAME.toUpperCase()}</h2>
                            <div style="margin: 5px 0 0 0; font-size: 12px; line-height: 1.4;">Receipt #: TXN-${transId}<br>Date: ${date}<br>Cashier: ${window.CASHIER_NAME}</div>
                        </div>
                        <table style="width: 100%; font-size: 13px; text-align: left; margin-bottom: 10px; border-collapse: collapse; table-layout: fixed;">
                            <tr style="border-bottom: 1px solid black;">
                                <th style="width: 15%; padding-bottom: 5px;">Qty</th>
                                <th style="width: 55%; padding-bottom: 5px;">Item</th>
                                <th style="width: 30%; text-align: right; padding-bottom: 5px;">Amt</th>
                            </tr>
                            ${itemsHTML}
                        </table>
                        <div style="border-top: 1px dashed black; padding-top: 5px; margin-top: 5px;">
                            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                                <tr><td style="text-align: right; padding: 2px 0;">Base Subtotal:</td><td style="text-align: right; width: 40%; padding: 2px 0;">${currencySymbol}${subtotal.toFixed(2)}</td></tr>
                                <tr><td style="text-align: right; padding: 2px 0;">Taxes & Fees:</td><td style="text-align: right; padding: 2px 0;">${currencySymbol}${tax.toFixed(2)}</td></tr>
                                <tr><td style="text-align: right; padding: 5px 0;"><strong>Total:</strong></td><td style="text-align: right; padding: 5px 0;"><strong>${currencySymbol}${total.toFixed(2)}</strong></td></tr>
                            </table>
                        </div>
                        <div style="text-align: center; margin-top: 15px; font-size: 12px;">Thank you for your purchase!</div>
                    </div>`;
            }
            
            printJS({ 
                printable: receiptHTML, 
                type: 'raw-html',
                style: '@page { size: auto; margin: 0; } body { padding: 5mm; width: 100%; box-sizing: border-box; } * { box-sizing: border-box; }' 
            }); 
        }

        const roleSelectionWizard = document.getElementById("roleSelectionWizard");
        if (roleSelectionWizard) {
            const roleOptions = roleSelectionWizard.querySelectorAll(".role-option");
            const step1 = document.getElementById("role-step1");
            const stepWorker = document.getElementById("role-step-worker");
            const btnBack = roleSelectionWizard.querySelector(".btn-role-back");
            const btnJoin = roleSelectionWizard.querySelector(".btn-join-company");
            const codeInput = document.getElementById("company-code-input");

            roleOptions.forEach(card => {
                card.addEventListener("click", async () => {
                    const selectedRole = card.getAttribute("data-role");
                    
                    if (selectedRole === "worker") {
                        step1.classList.add("d-none");
                        stepWorker.classList.remove("d-none");
                    } else if (selectedRole === "owner") {
                        card.style.pointerEvents = "none";
                        card.innerHTML = "Creating workspace...";
                        
                        try {
                            const res = await fetch("Main.php", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "set_role", role: "owner" })
                            });
                            const data = await res.json();
                            if (data.success) {
                                window.location.reload();
                            } else {
                                alert(data.message || "Failed to set role");
                                card.style.pointerEvents = "auto";
                                card.innerHTML = `<span class="fs-3 d-block mb-1"><i class="bi bi-person-badge text-secondary"></i></span><h6>I am an Owner / Admin</h6><small class="text-muted">Create a new company workspace</small>`;
                            }
                        } catch (err) {
                            alert("Network error.");
                            card.style.pointerEvents = "auto";
                        }
                    }
                });
            });

            btnBack?.addEventListener("click", () => {
                stepWorker.classList.add("d-none");
                step1.classList.remove("d-none");
            });

            btnJoin?.addEventListener("click", async () => {
                const code = codeInput.value.trim().toUpperCase();
                if (!code) return alert("Please enter a company code.");
                
                const originalText = btnJoin.innerHTML;
                btnJoin.innerHTML = "Joining...";
                btnJoin.disabled = true;

                try {
                    const res = await fetch("Main.php", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "set_role", role: "worker", company_code: code })
                    });
                    const data = await res.json();
                    if (data.success) {
                        window.location.reload();
                    } else {
                        alert(data.message || "Failed to join company.");
                        btnJoin.innerHTML = originalText;
                        btnJoin.disabled = false;
                    }
                } catch (err) {
                    alert("Network error.");
                    btnJoin.innerHTML = originalText;
                    btnJoin.disabled = false;
                }
            });
        }

        const setupWizard = document.getElementById("setupWizard");
        const navHome = document.getElementById("nav-home");
        const navPos = document.getElementById("nav-pos");
        const navInventory = document.getElementById("nav-inventory");
        const navManagement = document.getElementById("nav-management");
        const navAccount = document.getElementById("nav-account");
        const navReports = document.getElementById("nav-reports");
        const navAdvanced = document.getElementById("nav-advanced");

        const views = ["dashboard-home", "pos-system", "inventory-system", "management-system", "account-system", "reports-system", "advanced-system"];
        function showView(targetId) {
            views.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    if (id === targetId) {
                        el.classList.remove("d-none");
                        el.classList.add("d-flex");
                    } else {
                        el.classList.add("d-none");
                        el.classList.remove("d-flex");
                    }
                }
            });

            document.querySelectorAll(".nav-link-custom").forEach(nav => nav.classList.remove("active"));
            if (targetId === "dashboard-home" && navHome) navHome.classList.add("active");
            if (targetId === "pos-system" && navPos) navPos.classList.add("active");
            if (targetId === "inventory-system" && navInventory) navInventory.classList.add("active");
            if (targetId === "management-system" && navManagement) navManagement.classList.add("active");
            if (targetId === "account-system" && navAccount) navAccount.classList.add("active");
            if (targetId === "reports-system" && navReports) navReports.classList.add("active");
            if (targetId === "advanced-system" && navAdvanced) navAdvanced.classList.add("active");
        }

        const enforceSetupWizard = (targetView) => {
            if (setupWizard && !setupWizard.dataset.completed && window.USER_ROLE === 'owner') {
                alert("Please complete the store setup wizard first before navigating!");
                showView("pos-system");
                setupWizard.classList.remove("d-none");
                setupWizard.style.opacity = "1";
                setupWizard.style.animation = "fadeIn 0.5s ease forwards";
                return true;
            }
            return false;
        };

        if (navHome) navHome.addEventListener("click", (e) => { e.preventDefault(); if (!enforceSetupWizard("dashboard-home")) showView("dashboard-home"); });
        if (navInventory) navInventory.addEventListener("click", (e) => { e.preventDefault(); if (!enforceSetupWizard("inventory-system")) showView("inventory-system"); });
        if (navManagement) navManagement.addEventListener("click", (e) => { e.preventDefault(); if (!enforceSetupWizard("management-system")) showView("management-system"); });
        if (navAccount) navAccount.addEventListener("click", (e) => { e.preventDefault(); if (!enforceSetupWizard("account-system")) showView("account-system"); });
        if (navReports) navReports.addEventListener("click", (e) => { e.preventDefault(); if (!enforceSetupWizard("reports-system")) { showView("reports-system"); fetchReports(); } });
        if (navAdvanced) navAdvanced.addEventListener("click", (e) => { e.preventDefault(); if (!enforceSetupWizard("advanced-system")) showView("advanced-system"); });
        if (navPos) navPos.addEventListener("click", (e) => { e.preventDefault(); if (!enforceSetupWizard("pos-system")) showView("pos-system"); });

        function applyResponsiveConstraints() {
            const isMobileOrTablet = window.innerWidth <= 1024 || /Mobi|Android|Tablet|iPad|iPhone/.test(navigator.userAgent);
            
            const btnAddItem = document.getElementById('btn-add-item');
            const navAdvanced = document.getElementById('nav-advanced');
            const navPos = document.getElementById('nav-pos');
            const mobileWarning = document.getElementById('mobile-pos-warning');
            
            if (isMobileOrTablet) {
                if (btnAddItem) {
                    btnAddItem.disabled = true;
                    btnAddItem.style.opacity = "0.5";
                    btnAddItem.title = "Switch to PC to add items";
                    btnAddItem.removeAttribute('data-bs-toggle');
                }
                if (navAdvanced) {
                    navAdvanced.style.pointerEvents = "none";
                    navAdvanced.style.opacity = "0.5";
                    navAdvanced.title = "Switch to PC to access Advanced Settings";
                }
                if (navPos) navPos.classList.add('d-none');
                if (mobileWarning) {
                    mobileWarning.classList.remove('d-none');
                    mobileWarning.classList.add('d-flex');
                }
                
                const posSystem = document.getElementById('pos-system');
                const advSystem = document.getElementById('advanced-system');
                if ((posSystem && !posSystem.classList.contains('d-none')) || (advSystem && !advSystem.classList.contains('d-none'))) {
                    showView("dashboard-home");
                }
            } else {
                if (btnAddItem) {
                    btnAddItem.disabled = false;
                    btnAddItem.style.opacity = "1";
                    btnAddItem.title = "";
                    btnAddItem.setAttribute('data-bs-toggle', 'modal');
                }
                if (navAdvanced) {
                    navAdvanced.style.pointerEvents = "auto";
                    navAdvanced.style.opacity = "1";
                    navAdvanced.title = "";
                }
                if (navPos) navPos.classList.remove('d-none');
                if (mobileWarning) {
                    mobileWarning.classList.remove('d-flex');
                    mobileWarning.classList.add('d-none');
                }
            }
        }
        window.addEventListener('resize', applyResponsiveConstraints);
        applyResponsiveConstraints();

        if (setupWizard) {
            let currentStep = 0;
            const steps = setupWizard.querySelectorAll(".wizard-step");
            const progressBar = document.getElementById("wizardProgress");

            const updateWizard = () => {
                steps.forEach((step, index) => {
                    if (index === currentStep) {
                        step.classList.remove("d-none");
                    } else {
                        step.classList.add("d-none");
                    }
                });
                progressBar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
            };

            setupWizard.querySelectorAll(".btn-next").forEach(btn => {
                btn.addEventListener("click", () => {
                    if (currentStep < steps.length - 1) { currentStep++; updateWizard(); }
                });
            });
            setupWizard.querySelectorAll(".btn-prev").forEach(btn => {
                btn.addEventListener("click", () => {
                    if (currentStep > 0) { currentStep--; updateWizard(); }
                });
            });

            setupWizard.querySelectorAll(".option-card").forEach(card => {
                card.addEventListener("click", () => {
                    card.parentElement.querySelectorAll(".option-card").forEach(c => c.classList.remove("active"));
                    card.classList.add("active");
                });
            });
        }

        const templateInput = document.getElementById("receipt-template-input");
        const templateSuggestions = document.getElementById("template-suggestions");
        const btnSaveTemplate = document.getElementById("btn-save-template");
        const btnPreviewTemplate = document.getElementById("btn-preview-template");

        if (templateInput && templateSuggestions) {
            const availableVariables = ["[StoreName]", "[Date]", "[Time]", "[Cashier]", "[Items]", "[Subtotal]", "[Total]", "[Change]", "[PaymentMethod]", "[(LocalTaxName)]", "[(NationalTaxName)]"];
            let tempFocus = -1;

            templateInput.addEventListener("input", function(e) {
                const cursorPosition = this.selectionStart;
                const textBeforeCursor = this.value.substring(0, cursorPosition);
                
                const match = textBeforeCursor.match(/\[([^\]]*)$/); 
                templateSuggestions.innerHTML = "";
                
                if (match) {
                    const searchStr = match[1].toLowerCase();
                    let hasMatch = false;
                    tempFocus = -1;
                    
                    availableVariables.forEach(v => {
                        if (v.toLowerCase().includes(searchStr)) {
                            hasMatch = true;
                            const li = document.createElement("li");
                            li.className = "list-group-item list-group-item-action bg-dark text-light border-secondary fw-bold text-primary";
                            li.style.cursor = "pointer";
                            li.innerText = v;
                            
                            li.addEventListener("click", () => {
                                const beforeMatch = textBeforeCursor.substring(0, textBeforeCursor.lastIndexOf("["));
                                const afterCursor = this.value.substring(cursorPosition);
                                this.value = beforeMatch + v + afterCursor;
                                this.selectionStart = this.selectionEnd = beforeMatch.length + v.length;
                                templateSuggestions.classList.add("d-none");
                                templateInput.focus();
                            });
                            templateSuggestions.appendChild(li);
                        }
                    });
                    hasMatch ? templateSuggestions.classList.remove("d-none") : templateSuggestions.classList.add("d-none");
                } else {
                    templateSuggestions.classList.add("d-none");
                }
            });

            templateInput.addEventListener("keydown", function(e) {
                if (!templateSuggestions.classList.contains("d-none")) {
                    let items = templateSuggestions.getElementsByTagName("li");
                    if (e.key === "ArrowDown") { e.preventDefault(); tempFocus++; addActiveTemp(items); } 
                    else if (e.key === "ArrowUp") { e.preventDefault(); tempFocus--; addActiveTemp(items); } 
                    else if (e.key === "Enter") {
                        e.preventDefault();
                        if (tempFocus > -1 && items.length > 0) items[tempFocus].click();
                        else if (items.length > 0) items[0].click();
                    }
                }
            });

            function addActiveTemp(items) {
                if (!items) return false;
                for (let i = 0; i < items.length; i++) items[i].classList.replace("bg-primary", "bg-dark");
                if (tempFocus >= items.length) tempFocus = 0;
                if (tempFocus < 0) tempFocus = (items.length - 1);
                items[tempFocus].classList.replace("bg-dark", "bg-primary");
            }
            
            if (btnSaveTemplate) {
                btnSaveTemplate.addEventListener("click", async () => {
                    const originalText = btnSaveTemplate.innerHTML;
                    btnSaveTemplate.innerHTML = "Saving..."; btnSaveTemplate.disabled = true;
                    try {
                        await fetch("Main.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_receipt_template", template: templateInput.value }) });
                        window.RECEIPT_TEMPLATE = templateInput.value;
                        alert("Receipt Template Saved!");
                    } catch (err) { alert("Network error."); } finally { btnSaveTemplate.innerHTML = originalText; btnSaveTemplate.disabled = false; }
                });
            }

            if (btnPreviewTemplate) {
                btnPreviewTemplate.addEventListener("click", () => {
                    let templateStr = templateInput.value;
                    if (!templateStr) {
                        templateStr = `<div style="text-align: center; color: gray; margin-top: 50px;">Template is empty. Type some HTML here!</div>`;
                    } else {
                        const dummyItems = `
                            <tr><td>1x</td><td>Wireless Mouse</td><td style="text-align: right;">${currencySymbol}25.00</td></tr>
                            <tr><td>2x</td><td>USB Cable</td><td style="text-align: right;">${currencySymbol}10.00</td></tr>
                        `;
                        templateStr = templateStr
                            .replace(/\[StoreName\]/gi, window.STORE_NAME)
                            .replace(/\[Date\]/gi, new Date().toLocaleDateString())
                            .replace(/\[Time\]/gi, new Date().toLocaleTimeString())
                            .replace(/\[Cashier\]/gi, window.CASHIER_NAME)
                            .replace(/\[Items\]/gi, `<table style="width:100%; text-align:left; border-collapse:collapse;">${dummyItems}</table>`)
                            .replace(/\[Subtotal\]/gi, `${currencySymbol}35.00`)
                            .replace(/\[Total\]/gi, `${currencySymbol}38.50`)
                            .replace(/\[Change\]/gi, `${currencySymbol}1.50`)
                            .replace(/\[PaymentMethod\]/gi, "Cash")
                            .replace(/\[\(LocalTaxName\)\]/gi, "City Tax")
                            .replace(/\[\(NationalTaxName\)\]/gi, "VAT");
                    }
                    document.getElementById("preview-container").innerHTML = templateStr;
                    const previewModal = new bootstrap.Modal(document.getElementById("receiptPreviewModal"));
                    previewModal.show();
                });

                const previewFormatSelect = document.getElementById("preview-format-select");
                const previewContainer = document.getElementById("preview-container");
                if (previewFormatSelect && previewContainer) {
                    previewFormatSelect.addEventListener("change", function() {
                        previewContainer.style.width = this.value;
                    });
                }
            }
        }

        // Use event delegation for the import button to ensure it works even with complex DOM changes.
        document.body.addEventListener('click', function(event) {
            if (event.target && event.target.id === 'btn-import-template-tab') {
                window.open("import_pdf.php", "_blank");
            }
        });

        const locationInput = document.getElementById("biz-location");
        const locationSuggestions = document.getElementById("biz-location-suggestions");
        const currencySelect = document.getElementById("biz-currency");
        const timezoneSelect = document.getElementById("biz-timezone");

        if (locationInput && locationSuggestions) {
            let countryData = [];
            
            fetch("https://restcountries.com/v3.1/all?fields=name,currencies,timezones")
                .then(res => res.json())
                .then(data => {
                    countryData = data.map(c => {
                        let currency = c.currencies ? Object.keys(c.currencies)[0] : "USD";
                        let timezone = (c.timezones && c.timezones.length > 0) ? c.timezones[0] : "UTC";
                        return { name: c.name.common, currency: currency, timezone: timezone };
                    }).sort((a, b) => a.name.localeCompare(b.name));
                }).catch(err => console.error("Failed to fetch countries API:", err));

            let currentFocus = -1;

            locationInput.addEventListener("input", function() {
                const val = this.value;
                locationSuggestions.innerHTML = "";
                if (!val) return locationSuggestions.classList.add("d-none");
                
                currentFocus = -1;
                let hasSuggestions = false;

                countryData.forEach((country) => {
                    if (country.name.substr(0, val.length).toUpperCase() == val.toUpperCase()) {
                        hasSuggestions = true;
                        const li = document.createElement("li");
                        li.className = "list-group-item list-group-item-action bg-dark text-light border-secondary";
                        li.style.cursor = "pointer";
                        li.innerHTML = `<strong>${country.name.substr(0, val.length)}</strong>${country.name.substr(val.length)}`;
                        
                        li.addEventListener("click", function() {
                            locationInput.value = country.name;
                            currencySelect.value = country.currency;
                            timezoneSelect.value = country.timezone;
                            locationSuggestions.innerHTML = "";
                            locationSuggestions.classList.add("d-none");
                        });
                        locationSuggestions.appendChild(li);
                    }
                });
                hasSuggestions ? locationSuggestions.classList.remove("d-none") : locationSuggestions.classList.add("d-none");
            });

            locationInput.addEventListener("keydown", function(e) {
                let items = locationSuggestions.getElementsByTagName("li");
                if (e.keyCode == 40) { currentFocus++; addActive(items); }
                else if (e.keyCode == 38) { currentFocus--; addActive(items); }
                else if (e.keyCode == 13) {
                    e.preventDefault();
                    if (currentFocus > -1 && items) items[currentFocus].click();
                }
            });

            function addActive(items) {
                if (!items) return false;
                for (let i = 0; i < items.length; i++) items[i].classList.replace("bg-primary", "bg-dark");
                if (currentFocus >= items.length) currentFocus = 0;
                if (currentFocus < 0) currentFocus = (items.length - 1);
                items[currentFocus].classList.replace("bg-dark", "bg-primary");
            }
        }

        const accountForm = document.getElementById("account-form");
        if (accountForm) {
            let base64ProfilePic = "";
            const accPicInput = document.getElementById("acc-pic");
            const avatarPreview = document.getElementById("avatar-preview");
            const avatarPlaceholder = document.getElementById("avatar-placeholder");

            if (accPicInput) {
                accPicInput.addEventListener("change", function(e) {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = function(event) {
                        const img = new Image();
                        img.onload = function() {
                            const canvas = document.createElement("canvas");
                            const MAX_SIZE = 720;
                            let width = img.width;
                            let height = img.height;
                            
                            if (width > height && width > MAX_SIZE) {
                                height *= MAX_SIZE / width; width = MAX_SIZE;
                            } else if (height > MAX_SIZE) {
                                width *= MAX_SIZE / height; height = MAX_SIZE;
                            }
                            
                            canvas.width = width; canvas.height = height;
                            const ctx = canvas.getContext("2d");
                            ctx.drawImage(img, 0, 0, width, height);
                            base64ProfilePic = canvas.toDataURL("image/jpeg", 0.8);
                            
                            if (avatarPreview && avatarPlaceholder) {
                                avatarPreview.src = base64ProfilePic;
                                avatarPreview.classList.remove("d-none");
                                avatarPlaceholder.classList.add("d-none");
                            }
                        };
                        img.src = event.target.result;
                    };
                    reader.readAsDataURL(file);
                });
            }

            accountForm.addEventListener("submit", async (e) => {
                e.preventDefault();
                const btn = accountForm.querySelector("button[type='submit']");
                const originalText = btn.innerHTML;
                btn.innerHTML = "Saving...";
                btn.disabled = true;

                const data = {
                    action: "save_account",
                    name: document.getElementById("acc-name")?.value || "",
                    age: document.getElementById("acc-age")?.value || "",
                    email: document.getElementById("acc-email")?.value || "",
                    bio: document.getElementById("acc-bio")?.value || "",
                    profile_pic: base64ProfilePic
                };

                try {
                    const res = await fetch("Main.php", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(data)
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert("Account details saved successfully!");
                    } else {
                        alert(result.message || "Failed to save account details.");
                    }
                } catch (err) {
                    console.error("Account Save Error:", err);
                    alert("A network error occurred.");
                } finally {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            });
        }
        
        if (setupWizard) {
            const bizCatalog = document.getElementById("biz-catalog");
            const wizardImportUi = document.getElementById("wizard-import-ui");
            
            if (bizCatalog && wizardImportUi) {
                bizCatalog.addEventListener("change", (e) => {
                    if (e.target.value === "import") {
                        wizardImportUi.classList.remove("d-none");
                    } else {
                        wizardImportUi.classList.add("d-none");
                    }
                });
            }

            setupWizard.querySelector(".btn-finish")?.addEventListener("click", async () => {
                const btnFinish = setupWizard.querySelector(".btn-finish");
                const catalogChoice = document.getElementById("biz-catalog")?.value || "sample";
                let importData = null;

                if (catalogChoice === "import") {
                    const fileInput = document.getElementById("wizard-import-file");
                    if (!fileInput.files.length) return alert("Please select an Excel or CSV file to import.");
                    try {
                        const file = fileInput.files[0];
                        const data = await file.arrayBuffer();
                        const workbook = XLSX.read(data, { type: 'array' });
                        const sheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[sheetName];
                        importData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                        if (importData.length === 0) return alert("The selected file is empty or could not be read.");
                    } catch (err) { return alert("An error occurred reading the file. Ensure it is a valid .xlsx or .csv."); }
                }

                btnFinish.innerHTML = "Saving Configuration... <i class='bi bi-hourglass-split'></i>";
                btnFinish.disabled = true;

                const configData = {
                    action: "save_config",
                    business_name: document.getElementById("biz-name")?.value || "",
                    account_type: setupWizard.querySelector(".option-card.active")?.dataset.value || "individual",
                    location: document.getElementById("biz-location")?.value || "",
                    currency: document.getElementById("biz-currency")?.value || "USD",
                    timezone: document.getElementById("biz-timezone")?.value || "UTC",
                    tax_handling: document.getElementById("biz-tax")?.value || "No tax",
                    scale_locations: document.getElementById("biz-locations")?.value || 1,
                    scale_terminals: document.getElementById("biz-terminals")?.value || 1,
                    catalog_choice: catalogChoice,
                    hw_printer: document.getElementById("hw1")?.checked ? 1 : 0,
                    hw_scanner: document.getElementById("hw2")?.checked ? 1 : 0,
                    hw_drawer: document.getElementById("hw3")?.checked ? 1 : 0,
                    hw_scale: document.getElementById("hw4")?.checked ? 1 : 0,
                    pay_cash: document.getElementById("pm1")?.checked ? 1 : 0,
                    pay_card: document.getElementById("pm2")?.checked ? 1 : 0,
                    pay_ewallet: document.getElementById("pm3")?.checked ? 1 : 0,
                    pay_bank: document.getElementById("pm4")?.checked ? 1 : 0,
                    pay_credit: document.getElementById("pm5")?.checked ? 1 : 0,
                    inventory_data: importData
                };

                try {
                    await fetch("Main.php", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(configData)
                    });
                } catch (err) {
                    console.error("Failed to save configuration", err);
                }

                window.STORE_CURRENCY = configData.currency;
                window.TAX_HANDLING = configData.tax_handling;
                if (typeof updateStoreConfigurationUI === 'function') updateStoreConfigurationUI();

                setupWizard.dataset.completed = "true";
                setupWizard.style.transition = "opacity 0.5s ease";
                setupWizard.style.opacity = "0";
                setTimeout(() => {
                    setupWizard.classList.add("d-none");
                    const isMobile = window.innerWidth <= 1024 || /Mobi|Android|Tablet|iPad|iPhone/.test(navigator.userAgent);
                    showView(isMobile ? "dashboard-home" : "pos-system");
                    fetchInventory();
                }, 500);
            });
        }

        const posSearchInput = document.getElementById("pos-search-input");
        const posSearchSuggestions = document.getElementById("pos-search-suggestions");

        if (posSearchInput && posSearchSuggestions) {
            let posFocus = -1;

            posSearchInput.addEventListener("input", function() {
                const val = this.value.toLowerCase();
                posSearchSuggestions.innerHTML = "";
                if (!val) return posSearchSuggestions.classList.add("d-none");
                
                posFocus = -1;
                let hasSuggestions = false;
                let count = 0;

                globalInventory.forEach(item => {
                    if (count >= 2) return;
                    if (item.item_name.toLowerCase().includes(val) || (item.barcode && item.barcode.toLowerCase().includes(val))) {
                        hasSuggestions = true;
                        count++;
                        const li = document.createElement("li");
                        li.className = "list-group-item list-group-item-action bg-dark text-light border-secondary d-flex justify-content-between align-items-center";
                        li.style.cursor = "pointer";
                        const honestPrice = getHonestPrice(item);
                        li.innerHTML = `<span><strong>${item.item_name}</strong> <small class="text-muted ms-2">${item.barcode || ''}</small></span><span class="text-success fw-bold">${currencySymbol}${honestPrice.toFixed(2)}</span>`;
                        
                        li.addEventListener("click", function() {
                            const maxStock = parseInt(item.stock_qty) || 0;
                            let existing = cartItems.find(c => c.id === item.id);
                            if (existing) {
                                if (existing.qty < maxStock) existing.qty++;
                                else return alert("Cannot add more! Item is out of stock.");
                            } else {
                                if (maxStock > 0) cartItems.push({...item, qty: 1});
                                else return alert("Item is completely out of stock!");
                            }
                            renderCart();
                            
                            posSearchInput.value = "";
                            posSearchSuggestions.innerHTML = "";
                            posSearchSuggestions.classList.add("d-none");
                        });
                        posSearchSuggestions.appendChild(li);
                    }
                });
                hasSuggestions ? posSearchSuggestions.classList.remove("d-none") : posSearchSuggestions.classList.add("d-none");
            });

            posSearchInput.addEventListener("keydown", function(e) {
                let items = posSearchSuggestions.getElementsByTagName("li");
                if (e.keyCode == 40) { posFocus++; addActivePos(items); }
                else if (e.keyCode == 38) { posFocus--; addActivePos(items); }
                else if (e.keyCode == 13) {
                    e.preventDefault();
                    if (posFocus > -1 && items && items.length > 0) {
                        items[posFocus].click();
                    } else {
                        const searchVal = this.value.toLowerCase().trim();
                        if (searchVal) {
                            const exactMatch = globalInventory.find(i => (i.barcode && i.barcode.toLowerCase() === searchVal) || i.item_name.toLowerCase() === searchVal);
                            const closestMatch = exactMatch || globalInventory.find(i => i.item_name.toLowerCase().includes(searchVal) || (i.barcode && i.barcode.toLowerCase().includes(searchVal)));
                            
                            if (closestMatch) {
                                const maxStock = parseInt(closestMatch.stock_qty) || 0;
                                let existing = cartItems.find(c => c.id === closestMatch.id);
                                if (existing) {
                                    if (existing.qty < maxStock) existing.qty++;
                                    else return alert("Cannot add more! Item is out of stock.");
                                } else {
                                    if (maxStock > 0) cartItems.push({...closestMatch, qty: 1});
                                    else return alert("Item is completely out of stock!");
                                }
                                renderCart();
                                
                                posSearchInput.value = "";
                                posSearchSuggestions.innerHTML = "";
                                posSearchSuggestions.classList.add("d-none");
                            } else {
                                alert("No matching item found.");
                            }
                        }
                    }
                }
            });

            function addActivePos(items) {
                if (!items) return false;
                for (let i = 0; i < items.length; i++) items[i].classList.replace("bg-primary", "bg-dark");
                if (posFocus >= items.length) posFocus = 0;
                if (posFocus < 0) posFocus = (items.length - 1);
                items[posFocus].classList.replace("bg-dark", "bg-primary");
            }
        }

        const adContent = document.getElementById('rotating-ad-content');
        if (adContent) {
            let fetchedAds = [];
            let currentAd = 0;
            let adInterval;

            async function loadExternalAds() {
                try {
                    const response = await fetch('https://dummyjson.com/products/category/smartphones');
                    if (!response.ok) throw new Error("API request failed");
                    
                    const data = await response.json();
                    
                    const shuffledProducts = data.products.sort(() => 0.5 - Math.random());
                    const topThree = shuffledProducts.slice(0, 3);
                    
                    fetchedAds = topThree.map((item, index) => ({
                        title: `${item.brand || 'Premium'} ${item.title}`,
                        desc: `⭐⭐⭐⭐⭐ Top Rated. ${item.description.substring(0, 50)}...`,
                        btn: `Shop Amazon - $${item.price}`,
                        color: "#FF9900",

                        
                        img: item.thumbnail,
                        link: `https://www.amazon.com/s?k=${encodeURIComponent((item.brand || '') + ' ' + item.title + ' smartphone')}`
                    }));
                    
                    startAdRotation();
                } catch (error) {
                    console.error("Ad Network Error:", error);
                    fetchedAds = [{
                        title: "System Update <i class=\"bi bi-gear text-secondary\"></i>",
                        desc: "Keep your workspace updated to the latest build for maximum stability.",
                        btn: "View Logs",
                        color: "#6c757d",
                        img: "Images/ksale_logo_.png",
                        link: "#"
                    }];
                    startAdRotation();
                }
            }

            function rotateAd() {
                if (fetchedAds.length === 0) return;
                
                adContent.style.opacity = 0;
                setTimeout(() => {
                    const ad = fetchedAds[currentAd];
                    adContent.innerHTML = `
                        <div class="d-flex align-items-center gap-3">
                            <img src="${ad.img}" alt="Ad" style="width: 50px; height: 50px; object-fit: contain; border-radius: 8px; background: white; padding: 2px;">
                            <div>
                                <h5 class="text-white fw-bold mb-1" style="font-size: 1.1rem;">${ad.title}</h5>
                                <p class="text-muted mb-0 small">${ad.desc}</p>
                            </div>
                        </div>
                        <button class="btn btn-sm text-dark fw-bold px-4 py-2 shadow-sm text-nowrap mt-3 mt-sm-0" style="background-color: ${ad.color}; border: none;" onclick="window.open('${ad.link}', '_blank')">${ad.btn}</button>
                    `;
                    adContent.style.opacity = 1;
                    currentAd = (currentAd + 1) % fetchedAds.length;
                }, 500); 
            }

            function startAdRotation() {
                rotateAd(); 
                if (adInterval) clearInterval(adInterval);
                adInterval = setInterval(rotateAd, 8000); 
            }

            loadExternalAds();
        }

        const inviteSearchInput = document.getElementById("invite-search-input");
        const inviteSearchSuggestions = document.getElementById("invite-search-suggestions");

        if (inviteSearchInput && inviteSearchSuggestions) {
            let debounceTimer;
            inviteSearchInput.addEventListener("input", function() {
                clearTimeout(debounceTimer);
                const val = this.value.trim();
                inviteSearchSuggestions.innerHTML = "";
                if (val.length === 0) return inviteSearchSuggestions.classList.add("d-none");

                debounceTimer = setTimeout(async () => {
                    try {
                        const res = await fetch("Main.php", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "search_users", query: val })
                        });
                        const data = await res.json();
                        
                        inviteSearchSuggestions.innerHTML = "";
                        if (data.success && data.users.length > 0) {
                            data.users.forEach(user => {
                                const li = document.createElement("li");
                                li.className = "list-group-item list-group-item-action bg-dark text-light border-secondary d-flex justify-content-between align-items-center";
                                const avatarHTML = user.profile_pic ? `<img src="${user.profile_pic}" style="width: 30px; height: 30px; object-fit: cover; border-radius: 50%; margin-right: 10px;">` : `<div class="bg-secondary rounded-circle d-flex align-items-center justify-content-center" style="width: 30px; height: 30px; margin-right: 10px;"><i class="bi bi-person"></i></div>`;
                                const roleBadge = user.role === 'owner' ? `<span class="badge bg-danger ms-2">Owner</span>` : '';
                                
                                li.innerHTML = `<div class="d-flex align-items-center">${avatarHTML} <strong>${user.username}</strong> ${roleBadge}</div> <button class="btn btn-sm btn-primary invite-btn">Add User</button>`;
                                
                                const inviteBtn = li.querySelector(".invite-btn");
                                if (user.role === 'owner' || user.company_id) {
                                    inviteBtn.disabled = true; inviteBtn.innerText = "Unavailable"; inviteBtn.classList.replace("btn-primary", "btn-secondary");
                                } else {
                                    inviteBtn.addEventListener("click", async () => {
                                        inviteBtn.disabled = true; inviteBtn.innerText = "Adding...";
                                        const invRes = await fetch("Main.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "invite_user", target_username: user.username }) });
                                        const invData = await invRes.json();
                                        if (invData.success) {
                                            inviteBtn.innerHTML = "Added <i class=\"bi bi-check2\"></i>"; inviteBtn.classList.replace("btn-primary", "btn-success");
                                            fetchTeam();
                                        } else {
                                            alert(invData.message); inviteBtn.disabled = false; inviteBtn.innerText = "Add User";
                                        }
                                    });
                                }
                                inviteSearchSuggestions.appendChild(li);
                            });
                            inviteSearchSuggestions.classList.remove("d-none");
                        } else {
                            inviteSearchSuggestions.innerHTML = `<li class="list-group-item bg-dark text-muted border-secondary text-center">No matches or query too short.</li>`;
                            inviteSearchSuggestions.classList.remove("d-none");
                        }
                    } catch (err) {}
                }, 300);
            });
        }

        const toggleAdvancedPrice = document.getElementById("toggleAdvancedPrice");
        const advancedPriceOptions = document.getElementById("advancedPriceOptions");
        if (toggleAdvancedPrice && advancedPriceOptions) {
            toggleAdvancedPrice.addEventListener("change", (e) => {
                e.target.checked ? advancedPriceOptions.classList.remove("d-none") : advancedPriceOptions.classList.add("d-none");
            });
        }

        const toggleAdvancedStock = document.getElementById("toggleAdvancedStock");
        const advancedStockOptions = document.getElementById("advancedStockOptions");
        if (toggleAdvancedStock && advancedStockOptions) {
            toggleAdvancedStock.addEventListener("change", (e) => {
                e.target.checked ? advancedStockOptions.classList.remove("d-none") : advancedStockOptions.classList.add("d-none");
            });
        }

        const btnAddMoreTax = document.getElementById("btn-add-more-tax");
        const taxFieldsContainer = document.getElementById("tax-fields-container");
        if (btnAddMoreTax && taxFieldsContainer) {
            btnAddMoreTax.addEventListener("click", () => {
                const row = document.createElement("div");
                row.className = "row mb-2 dynamic-tax-row";
                row.innerHTML = `
                    <div class="col-5"><input type="text" class="form-control form-control-sm bg-pos-panel border-secondary text-light dyn-tax-name" placeholder="Custom Tax Name"></div>
                    <div class="col-5"><input type="number" step="0.1" min="0" oninput="if(this.value<0)this.value=Math.abs(this.value)" class="form-control form-control-sm bg-pos-panel border-secondary text-light dyn-tax-rate" placeholder="Tax (%)"></div>
                    <div class="col-2"><button type="button" class="btn btn-sm btn-outline-danger w-100 btn-remove-tax py-1 px-0">X</button></div>
                `;
                taxFieldsContainer.appendChild(row);
                
                row.querySelector(".btn-remove-tax").addEventListener("click", () => row.remove());
            });
        }

        const btnRequestDelete = document.getElementById("btn-request-delete");
        const btnConfirmDelete = document.getElementById("btn-confirm-delete");
        if (btnRequestDelete) {
            btnRequestDelete.addEventListener("click", async () => {
                const originalText = btnRequestDelete.innerHTML;
                btnRequestDelete.innerHTML = "Sending code... <i class='bi bi-hourglass-split'></i>"; btnRequestDelete.disabled = true;
                try {
                    const res = await fetch("Main.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_delete_account" }) });
                    const result = await res.json();
                    if (result.success) {
                        document.getElementById("delete-request-ui").classList.add("d-none");
                        document.getElementById("delete-confirm-ui").classList.remove("d-none");
                        alert(result.message);
                    } else { alert(result.message); btnRequestDelete.disabled = false; btnRequestDelete.innerHTML = originalText; }
                } catch (err) { alert("Network error."); btnRequestDelete.disabled = false; btnRequestDelete.innerHTML = originalText; }
            });
        }
        if (btnConfirmDelete) {
            btnConfirmDelete.addEventListener("click", async () => {
                const code = document.getElementById("delete-code-input").value;
                if (!code || code.length !== 6) return alert("Please enter the 6-digit code.");
                const originalText = btnConfirmDelete.innerHTML;
                btnConfirmDelete.innerHTML = "Deleting... <i class='bi bi-hourglass-split'></i>"; btnConfirmDelete.disabled = true;
                try {
                    const res = await fetch("Main.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm_delete_account", code: code }) });
                    const result = await res.json();
                    if (result.success) {
                        alert("Your account has been successfully deleted.");
                        window.location.href = "index.html";
                    } else { alert(result.message); btnConfirmDelete.disabled = false; btnConfirmDelete.innerHTML = originalText; }
                } catch (err) { alert("Network error."); btnConfirmDelete.disabled = false; btnConfirmDelete.innerHTML = originalText; }
            });
        }

        const btnSaveItem = document.getElementById("btn-save-item");
        if (btnSaveItem) {
            btnSaveItem.addEventListener("click", async () => {
                const itemId = document.getElementById("item-id").value;
                const itemName = document.getElementById("item-name").value;
                const basePrice = document.getElementById("item-base-price").value;

                if (!itemName || !basePrice) return alert("Please fill in the Item Name and Base Price.");

                const originalText = btnSaveItem.innerHTML;
                btnSaveItem.innerHTML = "Saving...";
                btnSaveItem.disabled = true;

                const dynamicTaxes = [];
                document.querySelectorAll(".dynamic-tax-row").forEach(row => {
                    const name = row.querySelector(".dyn-tax-name").value;
                    const rate = row.querySelector(".dyn-tax-rate").value;
                    if (name && rate) dynamicTaxes.push({ name: name, rate: parseFloat(rate) });
                });

                const data = {
                    action: itemId ? "edit_inventory_item" : "add_inventory_item",
                    item_id: itemId,
                    item_name: itemName,
                    barcode: document.getElementById("item-barcode").value,
                    base_price: basePrice,
                    local_tax_name: document.getElementById("item-local-tax-name").value,
                    local_tax: document.getElementById("item-local-tax").value,
                    national_tax_name: document.getElementById("item-national-tax-name").value,
                    national_tax: document.getElementById("item-national-tax").value,
                    custom_taxes: JSON.stringify(dynamicTaxes),
                    service_fee: document.getElementById("item-service-fee").value,
                    packaging_fee: document.getElementById("item-packaging-fee").value,
                    stock_qty: document.getElementById("item-stock-qty").value,
                    supplier_name: document.getElementById("item-supplier-name").value,
                    cost_per_item: document.getElementById("item-cost").value,
                    category: document.getElementById("item-category") ? document.getElementById("item-category").value : "Uncategorized"
                };

                try {
                    const res = await fetch("Main.php", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(data)
                    });
                    const result = await res.json();
                    if (result.success) {
                        document.getElementById("add-item-form").reset();
                        const modal = bootstrap.Modal.getInstance(document.getElementById('addItemModal'));
                        if (modal) modal.hide();
                        fetchInventory();
                    } else { alert(result.message || "Failed to save item."); }
                } catch (err) {
                    alert("Network error occurred.");
                } finally { btnSaveItem.innerHTML = originalText; btnSaveItem.disabled = false; }
            });
        }

        const btnAddItemModalOpen = document.getElementById("btn-add-item");
        if (btnAddItemModalOpen) {
            btnAddItemModalOpen.addEventListener("click", () => {
                document.getElementById("add-item-form").reset();
                document.getElementById("item-id").value = "";
                document.querySelectorAll(".dynamic-tax-row").forEach(r => r.remove());
                const titleEl = document.getElementById("addItemModalTitle");
                if (titleEl) titleEl.innerHTML = "<i class=\"bi bi-plus-lg\"></i> Add New Inventory Item";
                const catEl = document.getElementById("item-category");
                if (catEl) catEl.value = "Uncategorized";
            });
        }

        const btnImportData = document.getElementById("btn-import-data");
        if (btnImportData) {
            btnImportData.addEventListener("click", async () => {
                const fileInput = document.getElementById("import-file-input");
                const overrideCheck = document.getElementById("import-override-check");

                if (!fileInput.files.length) {
                    return alert("Please select a file to import.");
                }

                if (overrideCheck.checked) {
                    if (!confirm("Are you absolutely sure? This will DELETE your entire current inventory and replace it with the imported file. This action cannot be undone.")) {
                        return;
                    }
                }

                const originalText = btnImportData.innerHTML;
                btnImportData.innerHTML = "Parsing file...";
                btnImportData.disabled = true;

                try {
                    const file = fileInput.files[0];
                    const data = await file.arrayBuffer();
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                    if (jsonData.length === 0) {
                        alert("The selected file is empty or could not be read.");
                        return;
                    }
                    
                    btnImportData.innerHTML = "Importing...";

                    const res = await fetch("Main.php", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "import_inventory",
                            inventory_data: jsonData,
                            override: overrideCheck.checked
                        })
                    });
                    const result = await res.json();

                    if (result.success) {
                        alert(result.message);
                        fetchInventory();
                    } else { alert("Import failed: " + result.message); }
                } catch (err) {
                    console.error("Import Error:", err);
                    alert("An error occurred during import. Please ensure it's a valid .xlsx or .csv file.");
                } finally {
                    btnImportData.innerHTML = originalText;
                    btnImportData.disabled = false;
                    fileInput.value = '';
                }
            });
        }
    }
});
