// app.js (v1 - MVP version)

// Get elements
const findRouteBtn = document.getElementById("findRouteBtn");
const transportSection = document.getElementById("transportModes");
const routeDetails = document.getElementById("routeDetails");

// Button click event
findRouteBtn.addEventListener("click", () => {
  
  const from = document.getElementById("fromInput").value;
  const to = document.getElementById("toInput").value;

  // Basic validation
  if (from === "" || to === "") {
    alert("Please enter both locations");
    return;
  }

  // Show transport options
  transportSection.style.display = "block";

  // Display simple message
  routeDetails.innerHTML = `
    <h2>Route Details</h2>
    <p>Route from <strong>${from}</strong> to <strong>${to}</strong> selected.</p>
  `;
});