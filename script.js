document.getElementById('calculate').addEventListener('click', function() {
    // Retrieve input values
    var initialDataSize = parseFloat(document.getElementById('initialDataSize').value);
    var growthRate = parseFloat(document.getElementById('growthRate').value);
    var duration = parseInt(document.getElementById('duration').value);

    // Validate inputs
    if(isNaN(initialDataSize) || isNaN(growthRate) || isNaN(duration)) {
        alert('Please enter valid numbers for all fields.');
        return;
    }

    // Perform calculation
    var totalStorageNeeded = initialDataSize;
    var totalCost = 0;
    var storageCostPerGbPerMonth = 0.023; // Example cost

    for (var month = 1; month <= duration; month++) {
        if (month > 1) {
            var additionalData = totalStorageNeeded * (growthRate / 100);
            totalStorageNeeded += additionalData;
        }
        var monthlyCost = totalStorageNeeded * storageCostPerGbPerMonth;
        totalCost += monthlyCost;
    }

    // Display results
    document.getElementById('totalStorageNeeded').textContent = totalStorageNeeded.toFixed(2);
    document.getElementById('totalCost').textContent = totalCost.toFixed(2);
});
