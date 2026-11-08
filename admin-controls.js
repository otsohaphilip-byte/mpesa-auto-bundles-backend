
(function () {
  "use strict";

  function addControls() {
    const dashboard = document.getElementById("dashboard");

    if (!dashboard || dashboard.classList.contains("hidden")) return;
    if (document.getElementById("salesControlCard")) return;

    const card = document.createElement("section");
    card.id = "salesControlCard";
    card.className = "card";

    card.innerHTML = `
      <h3>Platform Sales Control</h3>
      <p id="salesControlStatus">Loading sales status...</p>
      <p>
        Pause or resume the platform's sales setting.
      </p>
      <div class="actions">
        <button id="pauseSalesButton" class="danger">
          Pause Sales
        </button>
        <button id="resumeSalesButton">
          Resume Sales
        </button>
        <button id="refreshSalesButton" class="secondary">
          Refresh
        </button>
      </div>
      <p><small>
        Note: Payment and order processing enforcement still needs
        to be connected before this setting can block new sales.
      </small></p>
    `;

    dashboard.appendChild(card);

    const statusText = card.querySelector("#salesControlStatus");
    const pauseButton = card.querySelector("#pauseSalesButton");
    const resumeButton = card.querySelector("#resumeSalesButton");
    const refreshButton = card.querySelector("#refreshSalesButton");

    async function refreshStatus() {
      statusText.textContent = "Loading sales status...";

      try {
        const data = await request("/api/system/sales-status");

        statusText.textContent = data.salesPaused
          ? "Current setting: SALES PAUSED"
          : "Current setting: SALES ACTIVE";

        pauseButton.disabled = data.salesPaused === true;
        resumeButton.disabled = data.salesPaused !== true;
      } catch (error) {
        statusText.textContent =
          "Could not load status: " + error.message;
      }
    }

    async function setSalesPaused(paused) {
      pauseButton.disabled = true;
      resumeButton.disabled = true;

      try {
        await request("/api/admin/system/sales-status", {
          method: "PATCH",
          body: JSON.stringify({ paused })
        });

        await refreshStatus();
      } catch (error) {
        statusText.textContent =
          "Could not update status: " + error.message;

        pauseButton.disabled = false;
        resumeButton.disabled = false;
      }
    }

    pauseButton.addEventListener("click", function () {
      if (confirm("Pause the platform sales setting?")) {
        setSalesPaused(true);
      }
    });

    resumeButton.addEventListener("click", function () {
      if (confirm("Resume the platform sales setting?")) {
        setSalesPaused(false);
      }
    });

    refreshButton.addEventListener("click", refreshStatus);

    refreshStatus();
  }

  function checkDashboard() {
    addControls();
  }

  const observer = new MutationObserver(checkDashboard);

  function start() {
    const dashboard = document.getElementById("dashboard");

    if (!dashboard) return;

    observer.observe(dashboard, {
      attributes: true,
      attributeFilter: ["class"]
    });

    checkDashboard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
      
