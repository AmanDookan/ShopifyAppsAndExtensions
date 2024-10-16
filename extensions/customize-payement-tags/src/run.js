// @ts-check



/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

/**
 * @type {FunctionRunResult}
 */
const NO_CHANGES = {
  operations: [],
};

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
 
  //Get restricted tags if defined in run.graphql 
  const customerTags = input?.cart?.buyerIdentity?.customer?.hasTags || [];

  // Define the ID of the payment method to hide, here it is Cash on delivery
  const hidePaymentMethodID = "gid://shopify/PaymentCustomizationPaymentMethod/3";
  
  
  // Check if there exists any restricted tag
  const hasRestrictedTag = customerTags.some(tagInfo => tagInfo.hasTag);
  // Return no changes if restricted tags are found
  if (hasRestrictedTag && hidePaymentMethodID) {
    return NO_CHANGES;  
  }
  //By default, disable Cash on delivery, only enable is customer has certain tags
  return {
    operations: [{
      hide: {
        paymentMethodId: hidePaymentMethodID
      }
    }]
  };
};