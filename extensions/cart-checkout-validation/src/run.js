/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run({ cart, validation }) {
  // Parse the metafield value to get the collection IDs and quantity mappings
  const validationData = JSON.parse(validation.metafield.value);
  const collectionMappings = validationData.mapping.reduce((acc, { collection, qty }) => {
    acc[collection] = parseInt(qty, 10); 
    return acc;
  }, {});

  // Initialize errors array
  const errors = cart.lines.flatMap(({ quantity, merchandise }) => {
    const collectionIds = merchandise.product.inCollections
      .filter(({ isMember }) => isMember)
      .map(({ collectionId }) => collectionId);

    // Check if the product is in any restricted collection
    const validationErrors = collectionIds.flatMap(collectionId => {
      const allowedQty = collectionMappings[collectionId];

      if (allowedQty !== undefined && quantity > allowedQty) {
        return {
          localizedMessage: `Cannot order more than ${allowedQty} of the product`,
          target: "cart",
        };
      }
      return [];
    });

    return validationErrors;
  });

  return {
    errors,
  };
}
