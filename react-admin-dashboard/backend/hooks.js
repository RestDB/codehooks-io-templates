/**
 * Collection hooks - add your custom business logic here.
 *
 * Available hooks per collection:
 *   hooks.beforePOST(collection, async (data) => { ... })
 *   hooks.afterPOST(collection, async (data) => { ... })
 *   hooks.beforeGET(collection, async (query) => { ... })
 *   hooks.afterGET(collection, async (data) => { ... })
 *   hooks.beforePUT(collection, async (data) => { ... })
 *   hooks.afterPUT(collection, async (data) => { ... })
 *   hooks.beforePATCH(collection, async (data) => { ... })
 *   hooks.afterPATCH(collection, async (data) => { ... })
 *   hooks.beforeDELETE(collection, async (data) => { ... })
 *   hooks.afterDELETE(collection, async (data) => { ... })
 *
 * In before hooks, you can:
 *   - Mutate the data object before it's saved
 *   - Throw an Error to abort the operation (returns 404)
 *
 * In after hooks, you receive the data as saved to the database.
 */
export function registerHooks(hooks) {
  // Example: Auto-generate order numbers and set date
  hooks.beforePOST('orders', async (data) => {
    if (!data.orderNumber) {
      data.orderNumber = `ORD-${Date.now()}`;
    }
    if (!data.orderDate) {
      data.orderDate = new Date().toISOString().split('T')[0];
    }
  });

  // Example: Log after customer creation
  hooks.afterPOST('customers', async (data) => {
    console.log(`New customer created: ${data.name} (${data.email})`);
  });

  // Add your custom hooks below:
  // hooks.beforePOST('products', async (data) => { ... });
  // hooks.afterPOST('products', async (data) => { ... });
}
