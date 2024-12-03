const { setupMissingOrders } = require("../kite/scheduledJobs");
const { kiteSession } = require("../kite/setup");


(async () => {
    console.log("Setting up missing orders");
    // await kiteSession();

    await setupMissingOrders();
})();
